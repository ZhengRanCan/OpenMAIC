import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseEvidenceProvenance,
  loadEvidenceSettings,
  matchEvidenceProvenance,
} from '@/lib/server/evidence-provenance';
import { provenanceFingerprint } from '@/lib/evidence/context';
import type { PreparedQuiz } from '@/lib/quiz/trace-types';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';

const liveMocks = vi.hoisted(() => ({ newContext: vi.fn(), callLLM: vi.fn() }));
vi.mock('@playwright/test', () => ({ request: { newContext: liveMocks.newContext } }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: liveMocks.callLLM }));

describe('trusted evidence provenance', () => {
  it('only permits known confirmed conditions and strict source identity', () => {
    const source = {
      stageId: 'stage',
      sceneId: 'scene',
      attemptId: 'a',
      versionId: 'v',
      submissionId: 's',
      sourceFingerprint: 'a'.repeat(64),
      conditions: ['controlled-proxy', 'not-personal-learner-evidence'],
    };
    expect(parseEvidenceProvenance({ version: 1, sources: [source] }).sources).toHaveLength(1);
    expect(() =>
      parseEvidenceProvenance({
        version: 1,
        sources: [{ ...source, conditions: ['independent-student'] }],
      }),
    ).toThrow();
    expect(() => parseEvidenceProvenance({ version: 1, sources: [source, source] })).toThrow();
    expect(() =>
      parseEvidenceProvenance({ version: 1, sources: [{ ...source, expectedEvidence: 'leak' }] }),
    ).toThrow();
  });
  it('does not enable collection when the feature flag is merely truthy', async () => {
    await expect(loadEvidenceSettings({ OPENMAIC_EVIDENCE_ENABLED: '1' })).rejects.toMatchObject({
      code: 'EVIDENCE_DISABLED',
      status: 404,
    });
    await expect(loadEvidenceSettings({ OPENMAIC_EVIDENCE_ENABLED: 'true' })).rejects.toMatchObject(
      { code: 'EVIDENCE_PROVENANCE_UNAVAILABLE', status: 503 },
    );
  });
  it('loads only a strict trusted file and matches both tuple and stable source fingerprint', async () => {
    const quiz: PreparedQuiz = {
      attemptId: 'a',
      stageId: 'stage',
      sceneId: 'scene',
      lastSeq: 1,
      answers: { q: 'A' },
      reviews: [],
      submission: {
        id: 's',
        attemptId: 'a',
        versionId: 'v',
        answers: { q: 'A' },
        recordId: 'record',
        seq: 1,
        savedAt: '2026-10-20',
      },
      version: {
        id: 'v',
        capturedAt: '2026-10-20',
        resources: [],
        resourceCoverage: { taskPresentation: 'text-and-math-quiz', unavailableBackgroundRefs: [] },
        scene: {
          id: 'scene',
          stageId: 'stage',
          title: 'Synthetic',
          order: 0,
          type: 'quiz',
          content: {
            type: 'quiz',
            questions: [{ id: 'q', type: 'short_answer', question: 'Explain a synthetic task.' }],
          },
        },
      },
    };
    const source = {
      stageId: 'stage',
      sceneId: 'scene',
      attemptId: 'a',
      versionId: 'v',
      submissionId: 's',
      sourceFingerprint: provenanceFingerprint(quiz),
      conditions: ['controlled-proxy', 'not-personal-learner-evidence'],
    };
    const directory = await mkdtemp(join(tmpdir(), 'evidence-provenance-'));
    try {
      const path = join(directory, 'conditions.json');
      await writeFile(path, JSON.stringify({ version: 1, sources: [source] }));
      const settings = await loadEvidenceSettings({
        OPENMAIC_EVIDENCE_ENABLED: 'true',
        OPENMAIC_EVIDENCE_PROVENANCE_FILE: path,
      });
      expect(matchEvidenceProvenance(quiz, settings)).toHaveLength(2);
      quiz.submission!.answers.q = 'Changed';
      expect(() => matchEvidenceProvenance(quiz, settings)).toThrowError('PROVENANCE_MISMATCH');
      expect(() =>
        matchEvidenceProvenance(
          { ...quiz, attemptId: 'other', submission: { ...quiz.submission!, attemptId: 'other' } },
          settings,
        ),
      ).toThrowError('SOURCE_NOT_ENABLED');
      await writeFile(path, '{broken');
      await expect(
        loadEvidenceSettings({
          OPENMAIC_EVIDENCE_ENABLED: 'true',
          OPENMAIC_EVIDENCE_PROVENANCE_FILE: path,
        }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function preflightQuiz(): PreparedQuiz {
  return {
    attemptId: 'offline-attempt',
    stageId: 'stage',
    sceneId: 'scene',
    answers: { q: 'PRIVATE_ANSWER_MARKER' },
    lastSeq: 1,
    reviews: [],
    submission: {
      id: 'submission',
      attemptId: 'offline-attempt',
      versionId: 'version',
      answers: { q: 'PRIVATE_ANSWER_MARKER' },
      recordId: 'record',
      seq: 1,
      savedAt: '2026-10-20',
    },
    version: {
      id: 'version',
      capturedAt: '2026-10-20',
      resources: [],
      resourceCoverage: { taskPresentation: 'text-and-math-quiz', unavailableBackgroundRefs: [] },
      scene: {
        id: 'scene',
        stageId: 'stage',
        title: 'Synthetic',
        order: 0,
        type: 'quiz',
        content: {
          type: 'quiz',
          questions: [{ id: 'q', type: 'short_answer', question: 'PRIVATE_QUESTION_MARKER' }],
        },
      },
    },
  };
}

async function preflightFixture(
  body: (fixture: {
    directory: string;
    baselinePath: string;
    outputPath: string;
    storageStatePath: string;
    historyPath: string;
    options: {
      baseUrl: string;
      storageStatePath: string;
      baselinePath: string;
      outputPath: string;
    };
    source: PreparedQuiz;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'f64-preflight-offline-'));
  const absolute = resolve(directory);
  if (
    !absolute.startsWith(resolve(tmpdir()) + sep) ||
    !basename(absolute).startsWith('f64-preflight-offline-')
  )
    throw new Error('Unsafe fixture cleanup target');
  try {
    const baselinePath = join(
      directory,
      'docs/harness/features/F64-native-evidence-memory-mastery/details/input-baseline.json',
    );
    const historyPath = join(directory, 'classroom/review/F63/synthetic/history.json');
    const outputPath = join(directory, 'output/provenance.json');
    const storageStatePath = join(directory, 'session-private.json');
    const source = preflightQuiz();
    const history = JSON.stringify({ attempts: [source] });
    await mkdir(dirname(baselinePath), { recursive: true });
    await mkdir(dirname(historyPath), { recursive: true });
    await writeFile(historyPath, history);
    await writeFile(
      storageStatePath,
      JSON.stringify({
        cookies: [{ name: 'session', value: 'PRIVATE_COOKIE_MARKER' }],
        origins: [],
      }),
    );
    await writeFile(
      baselinePath,
      JSON.stringify({
        personalLearnerEvidence: false,
        items: [
          {
            subject: 'english',
            stageId: source.stageId,
            sceneId: source.sceneId,
            attemptId: source.attemptId,
            submissionId: source.submission!.id,
            versionId: source.version.id,
            historySnapshot: 'classroom/review/F63/synthetic/history.json',
          },
        ],
        files: [
          {
            path: 'classroom/review/F63/synthetic/history.json',
            sha256: createHash('sha256').update(history).digest('hex'),
          },
        ],
      }),
    );
    await body({
      directory,
      baselinePath,
      outputPath,
      storageStatePath,
      historyPath,
      source,
      options: { baseUrl: 'http://127.0.0.1:3002', storageStatePath, baselinePath, outputPath },
    });
  } finally {
    await rm(absolute, { recursive: true, force: true });
  }
}

describe('offline live-source preflight guardrails', () => {
  beforeEach(() => {
    liveMocks.newContext.mockReset();
    liveMocks.callLLM.mockReset();
  });
  it('imports without invoking CLI, opening a browser context or calling a model', async () => {
    const preflightModule = await import('../../scripts/evidence-live-preflight');
    expect(preflightModule.preflightEvidenceSources).toBeTypeOf('function');
    expect(liveMocks.newContext).not.toHaveBeenCalled();
    expect(liveMocks.callLLM).not.toHaveBeenCalled();
  });
  it.each([401, 404])(
    'refuses HTTP %s and leaves no provenance file or model call',
    async (status) => {
      const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
      await preflightFixture(async (fixture) => {
        const dispose = vi.fn();
        const get = vi.fn().mockResolvedValue({ status: () => status, json: vi.fn() });
        liveMocks.newContext.mockResolvedValue({ get, dispose });
        await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
          'Source preflight refused',
        );
        await expect(readFile(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(get).toHaveBeenCalledExactlyOnceWith('/api/quiz-trace/attempts/offline-attempt');
        expect(dispose).toHaveBeenCalledOnce();
        expect(liveMocks.callLLM).not.toHaveBeenCalled();
      });
    },
  );
  it('rejects live source mismatch rather than replacing it with frozen answers', async () => {
    const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
    await preflightFixture(async (fixture) => {
      const altered = structuredClone(fixture.source);
      altered.submission!.answers.q = 'DIFFERENT';
      liveMocks.newContext.mockResolvedValue({
        get: vi.fn().mockResolvedValue({ status: () => 200, json: async () => altered }),
        dispose: vi.fn(),
      });
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Live source differs',
      );
      await expect(readFile(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(liveMocks.callLLM).not.toHaveBeenCalled();
    });
  });
  it('checks all frozen hashes and baseline location before opening a context', async () => {
    const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
    await preflightFixture(async (fixture) => {
      await writeFile(fixture.historyPath, 'tampered');
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Frozen baseline changed',
      );
      const wrongPath = join(fixture.directory, 'input-baseline.json');
      await writeFile(wrongPath, await readFile(fixture.baselinePath));
      await expect(
        preflightEvidenceSources({ ...fixture.options, baselinePath: wrongPath }),
      ).rejects.toThrow('Unexpected baseline location');
      await expect(readFile(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(liveMocks.newContext).not.toHaveBeenCalled();
      expect(liveMocks.callLLM).not.toHaveBeenCalled();
    });
  });
  it('writes only the strict manifest and never exports source bodies or cookies', async () => {
    const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
    await preflightFixture(async (fixture) => {
      const dispose = vi.fn(),
        get = vi.fn().mockResolvedValue({
          status: () => 200,
          json: async () => structuredClone(fixture.source),
        });
      liveMocks.newContext.mockResolvedValue({ get, dispose });
      const result = await preflightEvidenceSources(fixture.options);
      const raw = await readFile(fixture.outputPath, 'utf8');
      const manifest = parseEvidenceProvenance(JSON.parse(raw));
      expect(result.sources).toBe(1);
      expect(manifest.sources[0].sourceFingerprint).toBe(provenanceFingerprint(fixture.source));
      expect(manifest.sources[0].conditions).toEqual([
        'controlled-proxy',
        'reference-access-before-submit',
        'not-personal-learner-evidence',
      ]);
      expect(raw).not.toContain('PRIVATE_');
      expect(liveMocks.newContext).toHaveBeenCalledExactlyOnceWith({
        baseURL: 'http://127.0.0.1:3002',
        storageState: fixture.storageStatePath,
        timeout: 15000,
      });
      expect(dispose).toHaveBeenCalledOnce();
      expect(liveMocks.callLLM).not.toHaveBeenCalled();
      expect(await readFile(fixture.storageStatePath, 'utf8')).toContain('PRIVATE_COOKIE_MARKER');
    });
  });
  it.each([
    'https://example.com',
    'http://127.0.0.1:3002/private',
    'http://name:secret@127.0.0.1:3002',
    'http://localhost:3002/?query=1',
  ])('rejects non-explicit or non-local origin %s', async (value) => {
    const { validateLiveEvidenceOrigin } = await import('../../scripts/evidence-live-preflight');
    expect(() => validateLiveEvidenceOrigin(value)).toThrow();
    expect(liveMocks.newContext).not.toHaveBeenCalled();
  });
  it('refuses unhashed and escaping selected snapshots before opening a context', async () => {
    const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
    await preflightFixture(async (fixture) => {
      const baseline = JSON.parse(await readFile(fixture.baselinePath, 'utf8'));
      baseline.files = [];
      await writeFile(fixture.baselinePath, JSON.stringify(baseline));
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Unverified historical snapshot',
      );
      baseline.items[0].historySnapshot = '../outside.json';
      await writeFile(fixture.baselinePath, JSON.stringify(baseline));
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Unverified historical snapshot',
      );
      expect(liveMocks.newContext).not.toHaveBeenCalled();
      await expect(readFile(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
  it('checks every hashed entry and refuses a mismatched live tuple', async () => {
    const { preflightEvidenceSources } = await import('../../scripts/evidence-live-preflight');
    await preflightFixture(async (fixture) => {
      const baseline = JSON.parse(await readFile(fixture.baselinePath, 'utf8'));
      const extraPath = join(fixture.directory, 'extra.txt');
      await writeFile(extraPath, 'actual');
      baseline.files.push({ path: 'extra.txt', sha256: '0'.repeat(64) });
      await writeFile(fixture.baselinePath, JSON.stringify(baseline));
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Frozen baseline changed',
      );
      expect(liveMocks.newContext).not.toHaveBeenCalled();
      baseline.files.pop();
      baseline.items[0].submissionId = 'incorrect-submission';
      await writeFile(fixture.baselinePath, JSON.stringify(baseline));
      const dispose = vi.fn();
      liveMocks.newContext.mockResolvedValue({
        get: vi.fn().mockResolvedValue({ status: () => 200, json: async () => fixture.source }),
        dispose,
      });
      await expect(preflightEvidenceSources(fixture.options)).rejects.toThrow(
        'Source identity mismatch',
      );
      await expect(readFile(fixture.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(dispose).toHaveBeenCalledOnce();
      expect(liveMocks.callLLM).not.toHaveBeenCalled();
    });
  });
});
