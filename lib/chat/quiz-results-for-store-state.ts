import type { QuestionResult } from '@/lib/quiz/grading';
import type { QuizAnswers } from '@/lib/quiz/persistence';
import { loadQuizForPlay } from '@/lib/quiz/trace-client';

export interface QuizResultsForStoreState {
  sceneId: string;
  answers: QuizAnswers;
  results: QuestionResult[];
  versionId?: string;
  submissionId?: string;
  reviewId?: string;
  limitations?: string[];
}
export function didActiveSceneRemainUnchanged(
  scenesBefore: readonly { id: string }[],
  currentSceneIdBefore: string | null,
  scenesAfter: readonly { id: string }[],
  currentSceneIdAfter: string | null,
): boolean {
  return (
    !!currentSceneIdBefore &&
    currentSceneIdAfter === currentSceneIdBefore &&
    scenesBefore.some((s) => s.id === currentSceneIdBefore) &&
    scenesAfter.some((s) => s.id === currentSceneIdAfter)
  );
}
/** Only server-bound usable evaluations; never migrate old data while preparing chat. */
export async function buildQuizResultsForStoreState(
  scenes: { id: string; type?: string; stageId?: string }[],
  currentSceneId: string | null,
): Promise<QuizResultsForStoreState | undefined> {
  const scene = scenes.find((s) => s.id === currentSceneId && s.type === 'quiz');
  if (!scene?.stageId) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      loadQuizForPlay(scene.stageId, scene.id),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Quiz context timeout')), 1500);
      }),
    ]);
    if (!state?.submission || !state.review) return;
    const results = state.review.results.filter((r) => r.evaluation.state === 'normal');
    if (!results.length) return;
    return {
      sceneId: scene.id,
      answers: state.submission.answers,
      results,
      versionId: state.version.id,
      submissionId: state.submission.id,
      reviewId: state.review.id,
      limitations: [
        'Task-specific evaluation; no independent mastery or help inference.',
        ...(state.review.summary.status !== 'complete'
          ? ['Some questions have no usable evaluation.']
          : []),
      ],
    };
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
}
