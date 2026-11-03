export interface ChatSessionScope {
  stageId: string;
  epoch: number;
}

export function isChatSessionScopeCurrent(
  captured: ChatSessionScope | undefined,
  current: ChatSessionScope | undefined,
  currentStageId: string | undefined,
): boolean {
  return (
    !!captured &&
    !!current &&
    captured.stageId === currentStageId &&
    captured.stageId === current.stageId &&
    captured.epoch === current.epoch
  );
}
