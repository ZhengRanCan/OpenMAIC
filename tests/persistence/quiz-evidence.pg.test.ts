import { describe, expect, it } from 'vitest';
import { QuizEvidenceStore } from '@/lib/persistence/quiz-evidence-store';
import { evidenceFixture } from './quiz-evidence-fixture';

describe.skipIf(!process.env.PG_CONTRACT_URL)(
  'Evidence concurrent contracts (real PostgreSQL)',
  () => {
    it('enforces one active reservation and exactly one invocation claim over independent connections', async () => {
      const f = await evidenceFixture(process.env.PG_CONTRACT_URL);
      try {
        const store = new QuizEvidenceStore(f.provider);
        const requests = [f.request(), f.request()];
        const attempts = await Promise.allSettled(
          requests.map((request) => store.reserve('learner', request, f.model, f.settings)),
        );
        const reservations = attempts.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        expect(reservations.length).toBeGreaterThanOrEqual(1);
        for (const result of attempts)
          if (result.status === 'rejected')
            expect(result.reason.code).toBe('CONCURRENT_EVIDENCE_UPDATE');
        expect((await f.db.query('SELECT id FROM quiz_evidence_runs')).rows).toHaveLength(1);
        const runId = reservations[0].run.id;
        const claims = await Promise.all([
          store.claim('learner', runId),
          store.claim('learner', runId),
        ]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        for (const request of requests) {
          const saved = await store.lookupRequest('learner', request);
          if (saved) expect(saved.id).toBe(runId);
        }
      } finally {
        await f.close();
      }
    });
    it('pins the complete evaluation set even while another connection appends a review', async () => {
      const f = await evidenceFixture(process.env.PG_CONTRACT_URL);
      try {
        const store = new QuizEvidenceStore(f.provider),
          request = f.request();
        const first = await store.reserve('learner', request, f.model, f.settings);
        await f.service.beginReview('learner', f.source.attemptId, {
          operationId: 'later-review',
          submissionId: 'submission',
          language: 'en-US',
        });
        const saved = await store.lookupRequest('learner', request);
        expect(saved?.sourceEnvelope.anchor.pendingReview).toBeUndefined();
        expect(saved?.context.digest).toBe(first.run.context.digest);
        await expect(
          store.reserve('learner', f.request(), f.model, f.settings),
        ).rejects.toMatchObject({ code: 'EVIDENCE_BUSY' });
      } finally {
        await f.close();
      }
    });
  },
);
