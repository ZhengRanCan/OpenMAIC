import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { buildDialogueEvidenceContext } from '../lib/dialogue/evidence-context';
import { validateDialogueEvidenceReply } from '../lib/dialogue/evidence-validation';
import { digest } from '../lib/learner-memory/contracts';
import type { DialogueSourceWindow } from '../lib/dialogue/trace-types';
import type { DialogueEvidenceRun } from '../lib/dialogue/evidence-contracts';

const fixture = z.object({
  modelInput: z.object({
    session: z.object({ id: z.string(), mode: z.enum(['qa', 'discussion']) }),
    initialContext: z
      .object({
        classroom: z.object({ id: z.string(), title: z.string() }),
        scene: z.object({ id: z.string(), title: z.string() }).nullable(),
      })
      .nullable(),
    messages: z
      .array(
        z.object({
          id: z.string(),
          role: z.enum(['student', 'agent']),
          authorId: z.string(),
          sequence: z.number(),
          createdAt: z.string().nullable(),
          content: z.string(),
          interrupted: z.boolean(),
        }),
      )
      .max(200),
  }),
});
/** Fixture adapter for offline protocol checks; paid execution always uses the saved-source API. */
export function dialogueReplaySource(input: unknown): DialogueSourceWindow {
  const saved = input as {
    snapshot?: DialogueSourceWindow;
    source?: DialogueSourceWindow;
    sourceVersion?: string;
  } | null;
  const source = saved?.snapshot ?? saved?.source ?? saved;
  if (source && 'sourceVersion' in source && source.sourceVersion === 'dialogue-source.v1')
    return source as DialogueSourceWindow;
  const parsed = fixture.safeParse(input);
  if (!parsed.success) throw Error('INVALID_REPLAY_SOURCE');
  const v = parsed.data.modelInput,
    context = v.initialContext;
  return {
    sourceVersion: 'dialogue-source.v1',
    ownerId: 'synthetic-fixture',
    stageId: context?.classroom.id ?? 'unknown-stage',
    chatSessionId: v.session.id,
    runtimeSessionId: 'offline-fixture',
    generation: 0,
    type: v.session.mode,
    title: '',
    status: 'completed',
    createdAt: 0,
    updatedAt: 0,
    contentDigest: digest(v),
    window: { maxMessages: 200, historyCompleteness: 'window-only' },
    initialContext: context
      ? {
          stageId: context.classroom.id,
          stageTitle: context.classroom.title,
          ...(context.scene ? { sceneId: context.scene.id, sceneTitle: context.scene.title } : {}),
        }
      : null,
    messages: v.messages.map((m) => ({
      text: m.content,
      message: {
        id: m.id,
        role: m.role === 'student' ? 'user' : 'assistant',
        parts: [{ type: 'text', text: m.content }],
        metadata: {
          originalRole: m.role === 'student' ? 'user' : 'agent',
          ...(m.role === 'agent' ? { agentId: m.authorId } : {}),
          ...(m.createdAt ? { createdAt: Date.parse(m.createdAt) } : {}),
          interrupted: m.interrupted,
        },
      },
    })),
  };
}
export function replayDialogueEvidence(
  input: unknown,
  reply: { text: string; finishReason: string },
) {
  return validateDialogueEvidenceReply(
    reply,
    buildDialogueEvidenceContext(dialogueReplaySource(input)),
  );
}
export function validateDialogueOrigin(value: string) {
  const url = new URL(value);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('EXPLICIT_LOCAL_ORIGIN_REQUIRED');
  return url.origin;
}
async function main() {
  const args = process.argv.slice(2),
    values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--execute') {
      if (execute) throw Error('DUPLICATE_ARGUMENT');
      execute = true;
      continue;
    }
    if (
      !['--input', '--reply', '--output', '--origin', '--run'].includes(key) ||
      values.has(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw Error('INVALID_ARGUMENTS');
    values.set(key, args[++i]);
  }
  const output = values.get('--output');
  if (!output) throw Error('OUTPUT_REQUIRED');
  let result: unknown;
  if (execute) {
    if (
      values.has('--input') ||
      values.has('--reply') ||
      !values.has('--run') ||
      !values.has('--origin')
    )
      throw Error('EXPLICIT_RUN_REQUIRED');
    const origin = validateDialogueOrigin(values.get('--origin')!),
      id = values.get('--run')!;
    if (!/^[\w-]{1,200}$/.test(id)) throw Error('INVALID_RUN_ID');
    const headers: Record<string, string> = { 'content-type': 'application/json', origin };
    if (process.env.F73_OWNER_COOKIE) headers.cookie = process.env.F73_OWNER_COOKIE;
    const get = await fetch(`${origin}/api/dialogue-evidence/runs/${id}`, {
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!get.ok) throw Error('SOURCE_READ_FAILED_' + get.status);
    const run: DialogueEvidenceRun = await get.json();
    if (run.state !== 'prepared' || !run.context || run.context.inputBytes > 8192)
      throw Error('SMOKE_NOT_PREPARED_OR_OVER_BUDGET');
    // Freeze the full request before exactly one HTTP invocation; no retry loop.
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(
      resolve(output) + '.request.json',
      JSON.stringify(
        { run, maxCalls: 1, maxOutputTokens: 4096, frozenAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    const response = await fetch(`${origin}/api/dialogue-evidence/runs/${id}/extract`, {
      method: 'POST',
      headers,
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(150000),
    });
    result = { httpStatus: response.status, result: await response.json() };
  } else {
    if (
      !values.has('--input') ||
      !values.has('--reply') ||
      values.has('--origin') ||
      values.has('--run')
    )
      throw Error('REPLAY_INPUT_AND_REPLY_REQUIRED');
    const captured = JSON.parse(await readFile(values.get('--reply')!, 'utf8'));
    result = replayDialogueEvidence(
      JSON.parse(await readFile(values.get('--input')!, 'utf8')),
      captured.reply ?? captured,
    );
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log('Saved', basename(output));
}
if (process.argv[1] && basename(process.argv[1]) === 'dialogue-evidence-replay.ts')
  main().catch(() => {
    console.error(
      'Dialogue run failed; inspect the saved request and source state before retrying.',
    );
    process.exitCode = 1;
  });
