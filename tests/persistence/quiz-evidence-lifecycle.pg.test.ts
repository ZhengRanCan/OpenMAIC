import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootClaimHarness,
  courseNaming,
  anonymousPrincipal,
  accountPrincipal,
  ANON,
  ACCOUNT,
  type ClaimHarness,
} from './_owner-claim-scenarios';
import { testScene } from './quiz-trace-fixture';
import { evidenceInputs } from './quiz-evidence-fixture';
import { QuizTraceService, readPreparedIn } from '@/lib/persistence/quiz-trace';
import { QuizEvidenceStore } from '@/lib/persistence/quiz-evidence-store';
import { readEvidenceRun } from '@/lib/persistence/quiz-evidence-read';
import { claimOwner } from '@/lib/persistence/owner-claims';

describe.skipIf(!process.env.PG_CONTRACT_URL)(
  'Evidence full-host lifecycle (real PostgreSQL)',
  () => {
    let pool: Pool, admin: Pool, schema: string, h: ClaimHarness;
    beforeEach(async () => {
      schema = 'f64_test_' + randomUUID().replaceAll('-', '');
      admin = new Pool({ connectionString: process.env.PG_CONTRACT_URL });
      await admin.query('CREATE SCHEMA ' + schema);
      pool = new Pool({
        connectionString: process.env.PG_CONTRACT_URL,
        options: '-c search_path=' + schema,
        max: 8,
      });
      const url = `postgres://f64-contract-${randomUUID()}`;
      vi.stubEnv('DATABASE_URL', url);
      vi.stubEnv('ASSET_S3_BUCKET', '');
      h = await bootClaimHarness(pool, url);
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      await pool?.end();
      if (schema) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
      await admin?.end();
    });

    async function seed(owner = ANON, stageId = 'evidence-course') {
      const scene = { ...structuredClone(testScene), stageId, id: `${stageId}-quiz` };
      const course = courseNaming(stageId);
      await h
        .documents(owner === ANON ? anonymousPrincipal(owner) : accountPrincipal(owner))
        .saveDocument({ ...course, scenes: [scene] } as never);
      const trace = new QuizTraceService(h.provider);
      const prepared = await trace.prepare(owner, {
        operationId: randomUUID(),
        mode: 'start',
        stageId,
        sceneId: scene.id,
        scene,
      });
      await trace.submit(owner, prepared.attemptId, {
        operationId: randomUUID(),
        submissionId: randomUUID(),
        answers: { q: 'A' },
      });
      const source = await readPreparedIn(pool, owner, prepared.attemptId);
      const input = evidenceInputs(source),
        store = new QuizEvidenceStore(h.provider),
        request = input.request();
      const { run } = await store.reserve(owner, request, input.model, input.settings);
      const invocation = await store.claim(owner, run.id);
      if (!invocation) throw new Error('claim');
      const reply = {
        text: JSON.stringify({
          schemaVersion: 'quiz-evidence.v1',
          overview: {
            outcome: 'no-new',
            inspectedRefs: [],
            notes: ['No new interpretation'],
            unfinished: [],
          },
          items: [],
        }),
        finishReason: 'stop',
        usage: {},
        receivedAt: new Date().toISOString(),
        modelIdentity: input.model,
      };
      return { store, source, request, run, invocation, reply };
    }
    it('full owner claim moves live invocation with stable IDs and forwards its late capture', async () => {
      const seeded = await seed();
      const result = await claimOwner(ANON, ACCOUNT, { provider: h.provider });
      expect(result.status).toBe('claimed');
      expect(result.status === 'claimed' && result.moved['quiz-evidence']).toBe(1);
      await expect(readEvidenceRun(h.provider, ANON, seeded.run.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await seeded.store.capture(ANON, seeded.invocation, seeded.reply)).toBe(ACCOUNT);
      const saved = await seeded.store.finalize(ACCOUNT, seeded.run.id);
      expect(saved.state).toBe('completed');
      expect(saved.sourceEnvelope.anchor.attemptId).toBe(seeded.source.attemptId);
      expect((await readEvidenceRun(h.provider, ACCOUNT, seeded.run.id)).visibility).toBe(
        'visible',
      );
      expect((await pool.query('SELECT owner_id FROM quiz_evidence_requests')).rows).toEqual([
        { owner_id: ACCOUNT },
      ]);
    });
    it('receipt collisions roll the whole owner claim back, including courses and Quiz bindings', async () => {
      const seeded = await seed();
      await pool.query(
        'INSERT INTO quiz_evidence_requests(owner_id,operation_id,stage_id,intent_digest,run_id) SELECT $1,operation_id,stage_id,intent_digest,run_id FROM quiz_evidence_requests WHERE owner_id=$2',
        [ACCOUNT, ANON],
      );
      await expect(claimOwner(ANON, ACCOUNT, { provider: h.provider })).rejects.toBeDefined();
      expect(
        (
          await pool.query('SELECT owner_id FROM stage_meta WHERE stage_id=$1', [
            seeded.run.stageId,
          ])
        ).rows[0].owner_id,
      ).toBe(ANON);
      expect(
        (
          await pool.query('SELECT owner_id FROM quiz_trace_attempts WHERE id=$1', [
            seeded.source.attemptId,
          ])
        ).rows[0].owner_id,
      ).toBe(ANON);
      expect((await pool.query('SELECT owner_id FROM quiz_evidence_runs')).rows[0].owner_id).toBe(
        ANON,
      );
      expect((await pool.query('SELECT * FROM owner_merges')).rows).toHaveLength(0);
    });
    it('host soft-delete clears all snapshots and receipts atomically and refuses a late LLM save', async () => {
      const seeded = await seed();
      await h.documents(anonymousPrincipal()).deleteDocument(seeded.run.stageId);
      for (const table of [
        'quiz_evidence_runs',
        'quiz_evidence_requests',
        'quiz_trace_attempts',
        'quiz_trace_reviews',
        'scene_history_versions',
      ])
        expect((await pool.query('SELECT * FROM ' + table)).rows).toHaveLength(0);
      await expect(
        seeded.store.capture(ANON, seeded.invocation, seeded.reply),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (
          await pool.query('SELECT deleted_at FROM stage_meta WHERE stage_id=$1', [
            seeded.run.stageId,
          ])
        ).rows[0].deleted_at,
      ).not.toBeNull();
    });
  },
);
