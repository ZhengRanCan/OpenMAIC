import type { Stage, Scene } from '@/lib/types/stage';
import type { ChatSessionInitialContext } from '@/lib/types/chat';

export interface ChatInitialContextState {
  stage: Pick<Stage, 'id' | 'name'> | null;
  scenes: readonly Pick<Scene, 'id' | 'stageId' | 'title'>[];
  currentSceneId: string | null;
}

export function captureChatSessionInitialContext(
  state: ChatInitialContextState,
): ChatSessionInitialContext | undefined {
  if (!state.stage) return undefined;
  const { id: stageId, name: stageTitle } = state.stage;
  const scene = state.scenes.find(
    (item) => item.id === state.currentSceneId && item.stageId === stageId,
  );
  return {
    stageId,
    stageTitle,
    ...(scene ? { sceneId: scene.id, sceneTitle: scene.title } : {}),
  };
}

export function isChatSessionInitialContext(value: unknown): value is ChatSessionInitialContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.stageId === 'string' &&
    c.stageId.length > 0 &&
    typeof c.stageTitle === 'string' &&
    ((c.sceneId === undefined && c.sceneTitle === undefined) ||
      (typeof c.sceneId === 'string' && c.sceneId.length > 0 && typeof c.sceneTitle === 'string'))
  );
}
