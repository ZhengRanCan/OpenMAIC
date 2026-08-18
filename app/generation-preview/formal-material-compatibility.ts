export type FormalMaterialCompatibilityInput = {
  formalLessonSessionId: string | null;
  courseMaterialsCount: number;
  forceOrdinary?: boolean;
};

export function shouldPromptFormalMaterialCompatibility({
  formalLessonSessionId,
  courseMaterialsCount,
  forceOrdinary = false,
}: FormalMaterialCompatibilityInput): boolean {
  return !forceOrdinary && Boolean(formalLessonSessionId) && courseMaterialsCount > 0;
}
