import type { QuizQuestion } from '@/lib/types/stage';
import type { PreparedQuiz, QuizReview } from './trace-types';

export const QUIZ_PRACTICE_HELP_EVENT = 'openmaic:quiz-practice-help';

export type QuizPracticeHelp = {
  id: string;
  attemptId: string;
  versionId: string;
};

export type QuizPracticeHelpRequest = {
  stageId: string;
  sceneId: string;
  link: QuizPracticeHelp;
  question: string;
  options: string[];
};

export type QuizPracticeStatus =
  | { status: 'disabled' | 'idle' | 'pending' | 'unknown' }
  | { status: 'failed'; retryToken: string }
  | {
      status: 'ready';
      attemptId: string;
      lastSeq: number;
      question: QuizQuestion;
      choice?: string;
      submitted: boolean;
      review?: QuizReview;
      helpRequested: boolean;
    };

export function unreviewedPracticeQuestion(question: QuizQuestion): QuizQuestion {
  return {
    id: question.id,
    type: question.type,
    question: question.question,
    options: question.options,
    points: question.points,
  };
}

export function maskUnreviewedQuizPractice(quiz: PreparedQuiz | null): PreparedQuiz | null {
  if (!quiz?.practiceSourceReviewId || quiz.review || quiz.version.scene.type !== 'quiz')
    return quiz;
  const { scene } = quiz.version;
  return {
    ...quiz,
    version: {
      ...quiz.version,
      scene: {
        ...scene,
        content: {
          ...scene.content,
          questions: scene.content.questions.map(unreviewedPracticeQuestion),
        },
      },
    },
  };
}
