import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from '@playwright/test';
import {
  evidenceDigest,
  provenanceFingerprint,
  validatePreparedSource,
} from '../lib/evidence/context';
import { parseEvidenceProvenance } from '../lib/server/evidence-provenance';
import type { PreparedQuiz } from '../lib/quiz/trace-types';

export interface PreflightOptions {
  baseUrl: string;
  storageStatePath: string;
  baselinePath: string;
  outputPath: string;
}
export function validateLiveEvidenceOrigin(value: string): string {
  const base = new URL(value);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('F64 requires an explicit local origin');
  return base.origin;
}
/** GET only. The frozen files are expectations, never substitutes for business input. */
export async function preflightEvidenceSources(
  options: PreflightOptions,
): Promise<{ sources: number; manifestDigest: string }> {
  const origin = validateLiveEvidenceOrigin(options.baseUrl);
  const baseline = JSON.parse(await readFile(options.baselinePath, 'utf8'));
  if (
    baseline.personalLearnerEvidence !== false ||
    !Array.isArray(baseline.items) ||
    !Array.isArray(baseline.files)
  )
    throw new Error('Invalid controlled F63 baseline');
  // This baseline uses workspace-relative paths. Find its workspace, not the caller cwd.
  const suffix =
    'docs/harness/features/F64-native-evidence-memory-mastery/details/input-baseline.json';
  const absolute = resolve(options.baselinePath).replaceAll('\\', '/');
  if (!absolute.endsWith('/' + suffix)) throw new Error('Unexpected baseline location');
  const workspace = absolute.slice(0, -suffix.length);
  const validatedFiles = new Set<string>();
  for (const entry of baseline.files) {
    const p = resolve(workspace, entry.path);
    if (!p.startsWith(resolve(workspace) + (process.platform === 'win32' ? '\\' : '/')))
      throw new Error('Baseline path escape');
    const digest = createHash('sha256')
      .update(await readFile(p))
      .digest('hex');
    if (digest !== entry.sha256) throw new Error('Frozen baseline changed');
    validatedFiles.add(p);
  }
  const selected = baseline.items.filter((x: { subject: string }) =>
    ['english', 'physics'].includes(x.subject),
  );
  if (
    selected.some(
      (x: { historySnapshot: string }) =>
        typeof x.historySnapshot !== 'string' ||
        !validatedFiles.has(resolve(workspace, x.historySnapshot)),
    )
  )
    throw new Error('Unverified historical snapshot');
  const api = await request.newContext({
    baseURL: origin,
    storageState: options.storageStatePath,
    timeout: 15000,
  });
  const sources = [];
  try {
    for (const item of selected) {
      if (!/^[A-Za-z0-9_.:-]+$/.test(item.attemptId)) throw new Error('Invalid baseline source');
      const response = await api.get(
        '/api/quiz-trace/attempts/' + encodeURIComponent(item.attemptId),
      );
      if (response.status() !== 200)
        throw new Error('Source preflight refused: HTTP ' + response.status());
      const live = (await response.json()) as PreparedQuiz;
      validatePreparedSource(live);
      if (
        live.attemptId !== item.attemptId ||
        live.stageId !== item.stageId ||
        live.sceneId !== item.sceneId ||
        live.version.id !== item.versionId ||
        live.submission?.id !== item.submissionId
      )
        throw new Error('Source identity mismatch');
      const historical = JSON.parse(
        await readFile(resolve(workspace, item.historySnapshot), 'utf8'),
      ).attempts.find((x: PreparedQuiz) => x.attemptId === item.attemptId);
      if (!historical || evidenceDigest(live) !== evidenceDigest(historical))
        throw new Error('Live source differs from frozen F63 record');
      sources.push({
        stageId: live.stageId,
        sceneId: live.sceneId,
        attemptId: live.attemptId,
        versionId: live.version.id,
        submissionId: live.submission!.id,
        sourceFingerprint: provenanceFingerprint(live),
        conditions: [
          'controlled-proxy',
          'reference-access-before-submit',
          'not-personal-learner-evidence',
        ],
      });
    }
    if (!sources.length) throw new Error('No controlled sources');
    const manifest = parseEvidenceProvenance({ version: 1, sources });
    await mkdir(dirname(resolve(options.outputPath)), { recursive: true });
    try {
      await writeFile(options.outputPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const prior = JSON.parse(await readFile(options.outputPath, 'utf8'));
      if (evidenceDigest(prior) !== evidenceDigest(manifest))
        throw new Error('Refusing to replace an existing different provenance manifest');
    }
    return { sources: sources.length, manifestDigest: evidenceDigest(manifest) };
  } finally {
    await api.dispose();
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/evidence-live-preflight.ts')) {
  const names = [
    'F64_LIVE_BASE_URL',
    'F64_LIVE_STORAGE_STATE',
    'F64_SOURCE_BASELINE',
    'F64_PROVENANCE_OUTPUT',
  ] as const;
  if (names.some((n) => !process.env[n])) {
    console.error('Missing explicit F64 preflight configuration');
    process.exitCode = 1;
  } else
    preflightEvidenceSources({
      baseUrl: process.env.F64_LIVE_BASE_URL!,
      storageStatePath: process.env.F64_LIVE_STORAGE_STATE!,
      baselinePath: process.env.F64_SOURCE_BASELINE!,
      outputPath: process.env.F64_PROVENANCE_OUTPUT!,
    })
      .then((x) => console.log(JSON.stringify(x)))
      .catch(() => {
        console.error('F64 source preflight failed; no model invoked');
        process.exitCode = 1;
      });
}
