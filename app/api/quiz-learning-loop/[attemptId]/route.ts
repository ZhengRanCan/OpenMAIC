import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { QuizShortFactsService } from '@/lib/server/quiz-short-facts';
import { retryEvidence } from '@/lib/server/quiz-learning-loop/retry-evidence';
import { retryMemory } from '@/lib/server/quiz-learning-loop/retry-memory';
import { openSimulatedMemory } from '@/lib/server/simulated-memory';
import { readSimulatedLearningLoopConfig } from '@/lib/server/quiz-learning-loop/config';
import { retryUnstartedLearningLoop } from '@/lib/server/quiz-learning-loop/store';

export const runtime = 'nodejs';

/** Status contains no answers, prompts or provider credentials. */
export async function GET(req: Request, context: { params: Promise<{ attemptId: string }> }) {
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    try {
      if (!readSimulatedLearningLoopConfig()) return new Response(null, { status: 204, headers });
      const { attemptId } = await context.params;
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const result = await provider.pool.query(
        `SELECT j.state,j.evidence_run_id,j.error_code,j.created_at,j.updated_at
         FROM quiz_learning_loop_jobs j JOIN stage_meta m ON m.stage_id=(
           SELECT stage_id FROM quiz_trace_attempts WHERE id=j.attempt_id AND owner_id=j.owner_id
         ) AND m.owner_id=j.owner_id AND m.deleted_at IS NULL
         WHERE j.owner_id=$1 AND j.attempt_id=$2 ORDER BY j.created_at DESC LIMIT 1`,
        [principal.ownerId, attemptId],
      );
      if (!result.rows.length) {
        const eligibility = await provider.pool.query<{ eligible: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM quiz_trace_attempts a
           JOIN stage_meta m ON m.stage_id=a.stage_id AND m.owner_id=a.owner_id AND m.deleted_at IS NULL
           JOIN generation_runs g ON g.owner_id=a.owner_id AND g.stage_id=a.stage_id
           WHERE a.owner_id=$1 AND a.id=$2 AND g.input->>'simulatedLearner' IN ('A','B','C')
             AND EXISTS (SELECT 1 FROM quiz_trace_reviews r WHERE r.id=a.current_review_id
               AND r.attempt_id=a.id AND r.result IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM quiz_learning_loop_preexisting_reviews p WHERE p.review_id=r.id))
             AND (EXISTS (SELECT 1 FROM generation_run_steps s WHERE s.run_id=g.id
               AND s.step_id LIKE 'scene:%:narration' AND s.output->'scene'->>'id'=a.scene_id)
               OR EXISTS (SELECT 1 FROM quiz_learning_scene_bindings b WHERE b.run_id=g.id
                 AND b.owner_id=a.owner_id AND b.stage_id=a.stage_id AND b.scene_id=a.scene_id
                 AND b.student=g.input->>'simulatedLearner'))) AS eligible`,
          [principal.ownerId, attemptId],
        );
        if (!eligibility.rows[0]?.eligible) return new Response(null, { status: 204, headers });
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404, headers });
      }
      return Response.json({ job: result.rows[0] }, { headers });
    } catch {
      return Response.json(
        { error: { code: 'LEARNING_LOOP_UNAVAILABLE' } },
        { status: 503, headers },
      );
    }
  });
}

/** The Evidence ID is checkpointed before any model call; absent ID means no call started. */
export async function POST(req: Request, context: { params: Promise<{ attemptId: string }> }) {
  return withRequestOwner(req, async (principal, headers) => {
    headers.set('cache-control', 'private, no-store');
    if (!isSameOriginJsonRequest(req))
      return Response.json({ error: { code: 'INVALID_ORIGIN' } }, { status: 403, headers });
    try {
      const { attemptId } = await context.params;
      const body = await req.json();
      if (!body || body.action !== 'retry')
        return Response.json({ error: { code: 'INVALID_REQUEST' } }, { status: 400, headers });
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      if (
        await retryUnstartedLearningLoop(
          provider.pool,
          principal.ownerId,
          attemptId,
          body.confirmUnknown === true,
        )
      )
        return Response.json({ job: { state: 'queued' } }, { headers });
      const retried = await retryEvidence(
        provider.pool,
        new QuizShortFactsService(provider.withTransaction),
        principal.ownerId,
        attemptId,
        body.confirmUnknown === true,
      );
      if (retried) return Response.json({ job: { state: 'queued' } }, { headers });
      const environment = await openSimulatedMemory();
      try {
        const state = await retryMemory(
          provider.pool,
          new QuizShortFactsService(provider.withTransaction),
          environment.memory,
          principal.ownerId,
          attemptId,
          body.confirmUnknown === true,
        );
        if (state) return Response.json({ job: { state } }, { headers });
      } finally {
        await environment.close();
      }
      return Response.json({ error: { code: 'RETRY_NOT_AVAILABLE' } }, { status: 409, headers });
    } catch {
      return Response.json(
        { error: { code: 'LEARNING_LOOP_UNAVAILABLE' } },
        { status: 503, headers },
      );
    }
  });
}
