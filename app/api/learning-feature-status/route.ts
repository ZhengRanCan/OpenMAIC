import {
  isAutomaticMasteryEnabled,
  isDialogueLearnerContextConfigured,
  isDialogueLearnerContextEnabled,
  isQuizFeedbackEnabled,
  isQuizPracticeConfigured,
  isQuizPracticeEnabled,
} from '@/lib/config/feature-flags';

export const dynamic = 'force-dynamic';

type ToggleStatus = 'enabled' | 'disabled';
export type LearningFeatureStatuses = {
  automaticMastery: ToggleStatus;
  quizFeedback: ToggleStatus;
  quizPractice: ToggleStatus | 'requiresFeedback';
  dialogueLearnerContext: ToggleStatus | 'requiresPi';
};

// Deployment configuration only. The usual access-code middleware still applies.
export function GET() {
  const statuses: LearningFeatureStatuses = {
    automaticMastery: isAutomaticMasteryEnabled() ? 'enabled' : 'disabled',
    quizFeedback: isQuizFeedbackEnabled() ? 'enabled' : 'disabled',
    quizPractice: isQuizPracticeEnabled()
      ? 'enabled'
      : isQuizPracticeConfigured()
        ? 'requiresFeedback'
        : 'disabled',
    dialogueLearnerContext: isDialogueLearnerContextEnabled()
      ? 'enabled'
      : isDialogueLearnerContextConfigured()
        ? 'requiresPi'
        : 'disabled',
  };
  return Response.json(statuses, { headers: { 'Cache-Control': 'private, no-store' } });
}
