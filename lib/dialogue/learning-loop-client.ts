import {
  learningClosureSchema,
  type LearningClosure,
  type DialogueLoopStatus,
  type LoopRecovery,
} from './learning-loop-contracts';
import { runIdOfCourse } from '@/lib/generation-run-client/run-id';
export const learningRunCandidate = (state: {
  outlineProducer?: string | null;
  outlineProducerRef?: string | null;
}) => runIdOfCourse(state.outlineProducer, state.outlineProducerRef) ?? undefined;
export function captureLearningClosure(source: string): LearningClosure | undefined {
  const result = learningClosureSchema.safeParse({ id: crypto.randomUUID(), source });
  return result.success ? result.data : undefined;
}
export async function readDialogueLearningStatus(
  stageId: string,
  chatSessionId: string,
  signal: AbortSignal,
): Promise<DialogueLoopStatus | null | 'disabled'> {
  const response = await fetch(
    '/api/dialogue-learning-loop/status?' + new URLSearchParams({ stageId, chatSessionId }),
    { signal, cache: 'no-store' },
  );
  if (response.status === 204) return 'disabled';
  if (!response.ok) throw Error('status unavailable');
  const json = await response.json();
  return json.job ?? null;
}
export async function recoverDialogueLearning(
  id: string,
  request: LoopRecovery,
  signal: AbortSignal,
) {
  const response = await fetch(
    '/api/dialogue-learning-loop/jobs/' + encodeURIComponent(id) + '/recover',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!response.ok) throw Error('recovery unavailable');
}
