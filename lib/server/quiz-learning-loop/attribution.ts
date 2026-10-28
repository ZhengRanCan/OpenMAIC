import type { LearningLoopJob } from './store';

/** Attribution is frozen when the task is queued, never inferred from owner or answer text. */
export async function requestFromStoredAttribution(job: LearningLoopJob) {
  const attribution = job.attribution;
  if (
    !attribution ||
    !['A', 'B', 'C'].includes(attribution.student) ||
    !['proxy', 'synthetic'].includes(attribution.sourceNature) ||
    !Array.isArray(attribution.conditions) ||
    attribution.conditions.length === 0 ||
    attribution.conditions.some(
      (condition) => typeof condition !== 'string' || !condition.trim(),
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      attribution.memoryEnvironmentId,
    )
  )
    throw new Error('INVALID_SOURCE_ATTRIBUTION');
  return {
    owner: job.owner_id,
    submissionId: job.submission_id,
    attemptId: job.attempt_id,
    generationRunId: job.generation_run_id,
    ...attribution,
    ...(job.evidence_retry_of ? { retryOf: job.evidence_retry_of } : {}),
    promptVersion: 'selection-v2' as const,
  };
}
