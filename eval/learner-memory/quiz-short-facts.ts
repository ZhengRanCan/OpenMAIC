/** Explicit local F68 entrypoint. No automatic calls or learner identity inference. */
import fs from 'node:fs';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  ensureShortFactsSchema,
  initializeMemoryEnvironment,
  QuizShortFactsService,
} from '@/lib/server/quiz-short-facts';
import { invokeSimulatedMemoryModel, openSimulatedMemory } from '@/lib/server/simulated-memory';
import { resolveModel } from '@/lib/server/resolve-model';
import { callLLM } from '@/lib/ai/llm';
import { Pool } from 'pg';
import {
  nodePostgresTransaction,
  type ConnectableQueryable,
} from '@openmaic/storage/server/reference';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { DEFAULT_BUDGETS } from '@/lib/learner-memory/contracts';
import path from 'node:path';

export async function main(args: string[]) {
  const [command, owner, argument, flag, recoveryFlag] = args;
  if (command === 'classroom-db-init') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL);
    try {
      await ensureShortFactsSchema(provider.pool);
      console.log(JSON.stringify({ state: 'initialized' }));
    } finally {
      await provider.pool.end();
    }
    return;
  }
  if (command === 'memory-env-init') {
    const environment = await openSimulatedMemory();
    try {
      const id = await environment.memory.provider.withTransaction(initializeMemoryEnvironment);
      console.log(JSON.stringify({ memoryEnvironmentId: id }));
    } finally {
      await environment.close();
    }
    return;
  }
  if (
    ![
      'preflight',
      'preview',
      'prepare',
      'read',
      'extract',
      'handoff',
      'interrupt',
      'interrupt-memory',
    ].includes(command) ||
    !owner ||
    !argument
  )
    throw new Error('INVALID_ARGUMENTS');
  if (['extract', 'handoff'].includes(command) && flag !== '--live')
    throw new Error('LIVE_FLAG_REQUIRED');
  if (['interrupt', 'interrupt-memory'].includes(command) && flag !== '--confirm-unknown')
    throw new Error('CONFIRM_UNKNOWN_REQUIRED');
  if (
    recoveryFlag &&
    (!['handoff', 'interrupt-memory'].includes(command) ||
      !/^--retry=[\w-]{1,32}$/.test(recoveryFlag))
  )
    throw new Error('INVALID_RECOVERY_ID');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  if (command === 'preview' || command === 'preflight') {
    const request = JSON.parse(fs.readFileSync(argument, 'utf8'));
    if (request.owner !== owner) throw new Error('OWNER_MISMATCH');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const service = new QuizShortFactsService(
        nodePostgresTransaction(pool as unknown as ConnectableQueryable),
      );
      const context = await service.preview(request);
      if (command === 'preview') console.log(JSON.stringify(context, null, 2));
      else {
        if (!process.env.MEMORY_DATABASE_URL || !process.env.F68_OUTPUT_DIR)
          throw new Error('PREFLIGHT_CONFIGURATION_REQUIRED');
        const directory = path.resolve(process.env.F68_OUTPUT_DIR);
        if (fs.existsSync(directory)) throw new Error('OUTPUT_DIRECTORY_EXISTS');
        fs.accessSync(path.dirname(directory), fs.constants.W_OK);
        const scope = simulatedScope(request.student);
        const memoryPool = new Pool({ connectionString: process.env.MEMORY_DATABASE_URL });
        const client = await memoryPool.connect();
        try {
          await client.query('BEGIN READ ONLY');
          const identity = await client.query(
            'SELECT id FROM f67_simulated_memory.f68_memory_environment WHERE singleton=true',
          );
          if (identity.rows.length !== 1 || identity.rows[0].id !== request.memoryEnvironmentId)
            throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
          const state = await client.query(
            'SELECT snapshot,maintenance FROM f67_simulated_memory.learner_memory_states WHERE namespace=$1 AND learner_key=$2',
            [scope.namespace, scope.learnerKey],
          );
          if (state.rows.length !== 1 || state.rows[0].maintenance)
            throw new Error('MEMORY_NOT_READY');
          const pending = await client.query(
            "SELECT count(*)::int AS n FROM f67_simulated_memory.learner_memory_runs WHERE namespace=$1 AND learner_key=$2 AND state IN ('prepared','calling','captured')",
            [scope.namespace, scope.learnerKey],
          );
          if (pending.rows[0].n) throw new Error('MEMORY_BUSY');
          const unprocessed = await client.query(
            'SELECT count(*)::int AS n FROM f67_simulated_memory.learner_memory_sources WHERE namespace=$1 AND learner_key=$2 AND processed=false AND current=true AND valid=true',
            [scope.namespace, scope.learnerKey],
          );
          if (unprocessed.rows[0].n) throw new Error('MEMORY_PENDING_SOURCES');
          await client.query('ROLLBACK');
          console.log(
            JSON.stringify(
              {
                context,
                memory: {
                  scope,
                  snapshot: state.rows[0].snapshot,
                  pendingSources: unprocessed.rows[0].n,
                  budgets: DEFAULT_BUDGETS,
                },
                outputDirectory: directory,
                calls: { extraction: 1, memory: 1, maxOutputTokens: 16000, timeoutMs: 180000 },
              },
              null,
              2,
            ),
          );
        } finally {
          client.release();
          await memoryPool.end();
        }
      }
    } finally {
      await pool.end();
    }
    return;
  }
  const provider = await getServerPersistenceProvider(process.env.DATABASE_URL);
  try {
    await ensureShortFactsSchema(provider.pool);
    const service = new QuizShortFactsService(provider.withTransaction);
    let result;
    let unsuccessful = false;
    if (command === 'prepare') {
      const request = JSON.parse(fs.readFileSync(argument, 'utf8'));
      if (request.owner !== owner) throw new Error('OWNER_MISMATCH');
      if (!process.env.MEMORY_DATABASE_URL) throw new Error('MEMORY_DATABASE_URL_REQUIRED');
      const memoryPool = new Pool({
        connectionString: process.env.MEMORY_DATABASE_URL,
        options: '-c search_path=f67_simulated_memory',
      });
      try {
        const identity = await memoryPool.query(
          'SELECT id FROM f68_memory_environment WHERE singleton=true',
        );
        if (identity.rows.length !== 1 || identity.rows[0].id !== request.memoryEnvironmentId)
          throw new Error('MEMORY_ENVIRONMENT_MISMATCH');
      } finally {
        await memoryPool.end();
      }
      result = await service.prepare(request);
    } else if (command === 'read') result = await service.read(owner, argument);
    else if (command === 'interrupt') result = await service.interrupt(owner, argument);
    else if (command === 'extract') {
      result = await service.extract(owner, argument, async (system, prompt) => {
        const resolved = await resolveModel({
          stage: 'quiz-evidence',
          workspaceId: null,
          modelString: 'deepseek:deepseek-v4-flash',
        });
        const reply = await callLLM(
          {
            model: resolved.model,
            system,
            prompt,
            maxOutputTokens: 16000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(180000),
          },
          'quiz-evidence',
          { retries: 0 },
          resolved.thinkingConfig,
          { enabled: false, serverManaged: resolved.serverManaged },
        );
        return {
          text: reply.text,
          finishReason: reply.finishReason ?? 'unknown',
          model: reply.response?.modelId ?? resolved.modelString,
          usage: reply.totalUsage ?? reply.usage ?? null,
        };
      });
      unsuccessful = result.state !== 'completed';
    } else if (command === 'interrupt-memory') {
      const environment = await openSimulatedMemory();
      try {
        result = await service.interruptMemory(
          owner,
          argument,
          environment.memory,
          recoveryFlag?.slice('--retry='.length),
        );
      } finally {
        await environment.close();
      }
    } else {
      const environment = await openSimulatedMemory();
      try {
        result = await service.handoff(
          owner,
          argument,
          environment.memory,
          invokeSimulatedMemoryModel,
          recoveryFlag?.slice('--retry='.length),
        );
        unsuccessful =
          result.update !== null && !['completed', 'noop'].includes(result.update.run.state);
      } finally {
        await environment.close();
      }
    }
    console.log(JSON.stringify(result, null, 2));
    if (unsuccessful) process.exitCode = 1;
  } finally {
    await provider.pool.end();
  }
}
