import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryFixture } from './learner-memory-fixture';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import {
  simulatedScope,
  simulatedSeed,
  simulatedSource,
  SIMULATED_STUDENTS,
} from '@/lib/learner-memory/simulated-seeds';
import {
  SIMULATED_MEMORY_SYSTEM,
  SIMULATED_PROMPT_SHA256,
} from '@/lib/learner-memory/simulated-prompt';
import {
  SECTIONS,
  type CapturedMemoryReply,
  type PreparedMemoryRun,
} from '@/lib/learner-memory/contracts';
import { readMemory } from '@/lib/server/learner-memory';

// Explicit scripted plumbing reply, not a real model result or semantic-quality label.
function scriptedRewrite(run: PreparedMemoryRun): CapturedMemoryReply {
  const old = Object.entries(run.aliases).find(
    ([alias, source]) => alias.startsWith('s') && source.id.endsWith(':past-choice'),
  );
  return {
    text: JSON.stringify({
      status: 'ready',
      sections: [{ section: 'learning_experiences', pieceIds: ['m-past'] }],
      pieces: [
        {
          id: 'm-past',
          text: '过去时选择题正确选出went、ate、saw；直接改写中将goes改为went，并将every Sunday替换为yesterday。',
          formation: 'synthesis',
          supports: [old![0], 'e1'],
        },
      ],
      retired: [],
      decisions: [
        {
          source: 'e1',
          action: 'adopt',
          pieceIds: ['m-past'],
          reason: '脚本fixture：补充直接改写经历。',
        },
      ],
    }),
    finishReason: 'stop',
    model: 'scripted-test-no-provider-call',
    origin: 'model',
    usage: null,
  };
}
async function lifecycle(url?: string) {
  const f = await memoryFixture(url);
  const env = new SimulatedMemoryEnvironment(f.store.provider);
  const second = new SimulatedMemoryEnvironment(f.store.provider);
  try {
    await expect(env.read('B')).rejects.toThrow('SIMULATED_MEMORY_NOT_INITIALIZED');
    expect(
      (await Promise.all([env.initialize(), second.initialize()]))
        .flat()
        .filter((s) => s.state === 'created'),
    ).toHaveLength(3);
    const [a, b, c] = await Promise.all(SIMULATED_STUDENTS.map((id) => env.read(id)));
    expect(a.usable.pieces).toEqual([]);
    expect(Object.keys(b.sections)).toEqual([...SECTIONS]);
    expect(b.sections.background[0].text).toBe('目前读初二。');
    expect(b.sections.learning_experiences).toHaveLength(2);
    expect(c.sections.learning_experiences).toHaveLength(1);
    for (const piece of b.usable.pieces)
      for (const support of piece.supports) {
        expect(support.sourceNature).toBe('synthetic');
        expect(support.id.startsWith('sim:B:')).toBe(true);
        const sourceFile = path.resolve('..', support.provenance.file);
        expect(createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex')).toBe(
          support.provenance.sha256,
        );
      }
    expect(await readMemory(second.store, simulatedScope('B'))).toEqual(b);
    await expect(env.ingest('C', [simulatedSource('B', 'past-rewrite')])).rejects.toThrow(
      'SIMULATED_SOURCE_STUDENT_MISMATCH',
    );
    let calls = 0;
    const invoke = async (run: PreparedMemoryRun) => {
      calls++;
      expect(run.prompt.system).toBe(SIMULATED_MEMORY_SYSTEM);
      return scriptedRewrite(run);
    };
    await env.ingest('C', [simulatedSource('C', 'past-rewrite')]);
    const updated = await env.update('C', 'rewrite', invoke);
    expect(updated.run.state).toBe('completed');
    expect(updated.memory.sections.learning_experiences[0].supports.map((s) => s.id)).toEqual([
      'sim:C:past-choice',
      'sim:C:past-rewrite',
    ]);
    expect(await second.read('C')).toEqual(updated.memory);
    expect((await env.initialize()).every((r) => r.state === 'retained')).toBe(true);
    expect(await env.read('C')).toEqual(updated.memory);
    expect((await env.update('C', 'rewrite', invoke)).run.state).toBe('completed');
    expect((await env.update('C', 'repeat', invoke)).run.state).toBe('noop');
    expect(calls).toBe(1);
    const foreign = { namespace: 'f67-test:other-environment', learnerKey: 'sim-c' };
    await f.store.ingest(foreign, [simulatedSource('C', 'past-choice')]);
    const other = await f.store.read(foreign);
    await env.reset('C');
    expect(await second.read('C')).toEqual(c);
    expect(await second.read('A')).toEqual(a);
    expect(await second.read('B')).toEqual(b);
    expect(await f.store.read(foreign)).toEqual(other);
    // Withdrawal is reflected by the same public read projection; fixture reset restores its source.
    await env.store.restrictSource(simulatedScope('C'), 'sim:C:past-choice', '模拟来源撤回');
    expect((await env.read('C')).sections.learning_experiences).toEqual([]);
    expect((await env.read('C')).usable.restricted).toHaveLength(1);
    await env.reset('C');
    expect((await env.read('C')).snapshot).toEqual(simulatedSeed('C').snapshot);
  } finally {
    await f.close();
  }
}

describe('simulated student Memory environment', () => {
  it('keeps the exact frozen System bytes', () => {
    expect(createHash('sha256').update(SIMULATED_MEMORY_SYSTEM).digest('hex')).toBe(
      SIMULATED_PROMPT_SHA256,
    );
    expect(SIMULATED_MEMORY_SYSTEM).toBe(
      fs.readFileSync(
        path.resolve('../docs/log/artifacts/F67/memory-v0.3.1-2026-10-26/system-prompt.txt'),
        'utf8',
      ),
    );
  });
  it(
    'initializes, consumes, updates and resets three isolated identities without duplication',
    () => lifecycle(),
    30000,
  );
  it.skipIf(!process.env.PG_CONTRACT_URL)(
    'persists the same lifecycle through real PostgreSQL transactions and independent reads',
    () => lifecycle(process.env.PG_CONTRACT_URL),
    30000,
  );
  it('refuses reset while a run is prepared, calling or captured', async () => {
    const f = await memoryFixture();
    const env = new SimulatedMemoryEnvironment(f.store.provider);
    try {
      await env.initialize();
      await env.ingest('C', [simulatedSource('C', 'past-rewrite')]);
      const prepared = await env.store.prepare(simulatedScope('C'), 'busy');
      await expect(env.reset('C')).rejects.toThrow('SIMULATED_MEMORY_BUSY');
      const claim = await env.store.claim(simulatedScope('C'), prepared.id);
      expect(claim).not.toBeNull();
      await expect(env.reset()).rejects.toThrow('SIMULATED_MEMORY_BUSY');
      await env.store.capture(
        simulatedScope('C'),
        prepared.id,
        scriptedRewrite(prepared),
        claim!.claimToken,
      );
      await expect(env.reset('C')).rejects.toThrow('SIMULATED_MEMORY_BUSY');
      expect((await env.store.commit(simulatedScope('C'), prepared.id)).state).toBe('completed');
      await env.reset('C');
      expect((await env.read('C')).snapshot).toEqual(simulatedSeed('C').snapshot);
      await expect(Reflect.apply(env.reset, env, [''])).rejects.toThrow(
        'UNKNOWN_SIMULATED_STUDENT',
      );
      await expect(Reflect.apply(env.reset, env, ['D'])).rejects.toThrow(
        'UNKNOWN_SIMULATED_STUDENT',
      );
    } finally {
      await f.close();
    }
  });
  it('rolls back all selected identities when a reset write fails', async () => {
    const f = await memoryFixture();
    let fail = false;
    const env = new SimulatedMemoryEnvironment({
      withTransaction: (body) =>
        f.store.provider.withTransaction((tx) =>
          body({
            query: async (sql, args) => {
              if (
                fail &&
                sql.startsWith('INSERT INTO learner_memory_sources') &&
                args?.[2] === 'sim:C:background'
              )
                throw new Error('seed write failed');
              return tx.query(sql, args);
            },
          }),
        ),
    });
    try {
      await env.initialize();
      await env.store.restrictSource(simulatedScope('B'), 'sim:B:density', '模拟待核对');
      const before = await Promise.all(SIMULATED_STUDENTS.map((id) => env.read(id)));
      fail = true;
      await expect(env.reset()).rejects.toThrow('seed write failed');
      expect(await Promise.all(SIMULATED_STUDENTS.map((id) => env.read(id)))).toEqual(before);
      fail = false;
      await env.reset();
      expect((await env.read('B')).snapshot).toEqual(simulatedSeed('B').snapshot);
    } finally {
      await f.close();
    }
  });
});
