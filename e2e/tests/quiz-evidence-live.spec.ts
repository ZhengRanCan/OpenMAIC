import { readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '../fixtures/evidence-live';
test('one live English generation, persisted recovery and exact reuse', async ({ request }) => {
  const baselinePath = process.env.F64_SOURCE_BASELINE;
  const reportPath = process.env.F64_LIVE_REPORT;
  if (!baselinePath || !reportPath)
    throw new Error('Explicit baseline and private report destination required');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const source = baseline.items.find((x: { subject: string }) => x.subject === 'english');
  const endpoint = '/api/quiz-trace/attempts/' + source.attemptId;
  const beforeResponse = await request.get(endpoint);
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.submission.id).toBe(source.submissionId);
  expect(before.version.id).toBe(source.versionId);
  const body = {
    operationId: crypto.randomUUID(),
    stageId: source.stageId,
    anchor: { attemptId: source.attemptId, submissionId: source.submissionId },
    related: [],
    language: 'zh-CN',
    action: 'reuse-or-create',
  };
  // Save the durable operation identity BEFORE paying. Existing files refuse a rerun.
  await writeFile(
    reportPath,
    JSON.stringify(
      { operationId: body.operationId, state: 'request-pending', request: body },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const response = await request.post('/api/quiz-evidence/runs', { data: body });
  const result = await response.json();
  // Preserve a failed/partial/zero result; never resample to make the assertion pass.
  await writeFile(
    reportPath,
    JSON.stringify({ operationId: body.operationId, status: response.status(), result }, null, 2),
  );
  expect(response.status()).toBe(201);
  expect(result.semanticStatus).toBe('unreviewed');
  expect(result.adoptionAllowed).toBe(false);
  expect(result.visibility).toBe('visible');
  expect(['completed', 'partial', 'failed']).toContain(result.state);
  const saved = await request.get('/api/quiz-evidence/runs/' + result.id);
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual(result);
  const replay = await request.post('/api/quiz-evidence/runs', { data: body });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).id).toBe(result.id);
  const operation = await request.get('/api/quiz-evidence/operations/' + body.operationId);
  expect(operation.status()).toBe(200);
  expect((await operation.json()).id).toBe(result.id);
  if (result.state !== 'failed') {
    const reuse = await request.post('/api/quiz-evidence/runs', {
      data: { ...body, operationId: crypto.randomUUID() },
    });
    expect(reuse.status()).toBe(200);
    const reused = await reuse.json();
    expect(reused.id).toBe(result.id);
    expect(reused.state).toBe(result.state);
    expect(reused.delivery).toEqual(result.delivery);
  }
  // A model failure remains a failed model outcome, even if the surrounding business path works.
  const after = await request.get(endpoint);
  expect(await after.json()).toEqual(before);
});
