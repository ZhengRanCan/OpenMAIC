import type { Queryable } from '@openmaic/storage/document/pg';
import { buildDialogueEvidenceContext } from '@/lib/dialogue/evidence-context';
import { validatePreparedSource } from '@/lib/evidence/context';
import { EvidenceError } from '@/lib/evidence/contracts';
import { digest } from '@/lib/learner-memory/contracts';
import type {
  ProfileMemoryKind,
  ProfileMemorySource,
} from '@/lib/learner-memory/profile-memory-contracts';
import { QuizTraceError } from '@/lib/quiz/trace-validation';
import { readDialogueSourceIn } from './dialogue-trace-read';
import { readPreparedIn } from './quiz-trace';

export type ProfileSourceLocator = {
  stage_id: string;
  profile_id: string;
  kind: ProfileMemoryKind;
  activity_id: string;
  record_id: string;
  review_id?: string | null;
  manually_added?: boolean;
};
export type ProfileSourceAccess = {
  owner_id: string;
  title: string;
};

/** Latest authoritatively saved dialogue view and its learner messages, scoped to stage alias s. */
export const PROFILE_DIALOGUE_MESSAGES = `JOIN runtime_sessions runtime ON runtime.stage_id=s.stage_id
  AND runtime.learner_key=s.owner_id AND runtime.kind='chat' AND runtime.status IN ('active','completed')
  CROSS JOIN LATERAL (
    SELECT state.data#>>'{payload,type}' AS kind, state.data#>>'{payload,chatSessionId}' AS chat_id,
      state.data#>'{payload,messageIds}' AS message_ids, state.seq
    FROM runtime_records state WHERE state.session_id=runtime.id
      AND state.data#>>'{payload,kind}'='chat_session_state'
    ORDER BY state.seq DESC LIMIT 1
  ) view
  JOIN runtime_records message ON message.session_id=runtime.id AND message.seq < view.seq
    AND message.data#>>'{payload,kind}'='chat_message'
    AND message.data#>>'{payload,message,role}'='user'
    AND view.message_ids ? (message.data#>>'{payload,message,id}')`;

/** For queries with learner_profile_memory_jobs aliased as j. */
export const PROFILE_MEMORY_JOB_AUTHORIZED = `COALESCE((
  SELECT b.profile_id=j.profile_id FROM classroom_learner_profiles b WHERE b.stage_id=j.stage_id
),j.manually_added)`;

export async function readProfileSourceAccess(
  tx: Queryable,
  locator: ProfileSourceLocator,
  lock = false,
): Promise<ProfileSourceAccess | undefined> {
  const { rows } = await tx.query<ProfileSourceAccess>(
    `SELECT s.owner_id, d.name AS title
       FROM stage_meta s
       JOIN document_stages d ON d.id=s.stage_id
       WHERE s.stage_id=$1 AND s.deleted_at IS NULL AND COALESCE((
         SELECT b.profile_id=$2 FROM classroom_learner_profiles b WHERE b.stage_id=s.stage_id
       ),$3::boolean)${lock ? ' FOR UPDATE OF s' : ''}`,
    [locator.stage_id, locator.profile_id, locator.manually_added === true],
  );
  return rows[0];
}

async function quizSource(
  tx: Queryable,
  locator: ProfileSourceLocator,
  access: ProfileSourceAccess,
) {
  try {
    const quiz = await readPreparedIn(tx, access.owner_id, locator.activity_id);
    if (quiz.stageId !== locator.stage_id || quiz.submission?.id !== locator.record_id) return null;
    validatePreparedSource(quiz);
    const scene = quiz.version.scene;
    if (scene.type !== 'quiz' || quiz.version.resourceCoverage?.unavailableBackgroundRefs.length)
      return null;
    const review = locator.review_id
      ? quiz.reviews.find(({ id }) => id === locator.review_id)
      : quiz.review;
    if (!review) return null;
    const {
      rows: [help],
    } = await tx.query<{ requested: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM quiz_practice_help
        WHERE attempt_id=$1 AND version_id=$2 AND requested_at <= $3::timestamptz) AS requested`,
      [quiz.attemptId, quiz.version.id, quiz.submission.savedAt],
    );
    const basis: ProfileMemorySource = {
      stageId: quiz.stageId,
      title: access.title,
      kind: 'quiz',
      occurredAt: quiz.submission.savedAt,
      historicalReview: review.id !== quiz.review?.id,
      parts: scene.content.questions.flatMap((question) => {
        const answer = quiz.submission!.answers[question.id];
        if (!answer?.length) return [];
        const result = review.results.find((entry) => entry.questionId === question.id);
        const correct = result?.evaluation.state === 'normal' ? result.correct : null;
        return [
          {
            question: question.question,
            ...(question.options?.length
              ? { options: question.options.map((o) => `${o.value}. ${o.label}`) }
              : {}),
            answer: Array.isArray(answer) ? answer.join(', ') : answer,
            review: correct === null ? 'unknown' : correct ? 'correct' : 'incorrect',
            help: help.requested ? 'practice-requested' : 'unknown',
          },
        ];
      }),
    };
    if (!basis.parts.length) return null;
    return {
      basis,
      sceneId: quiz.sceneId,
      dialogueMastery: undefined,
      quizQuestions: scene.content.questions.flatMap(({ id, question, type, options }) => {
        const submitted = quiz.submission!.answers[id];
        return submitted?.length ? [{ prompt: question, type, options, submitted }] : [];
      }),
      quizAnswerKeys: scene.content.questions.flatMap(({ id, answer }) =>
        quiz.submission!.answers[id]?.length ? [answer] : [],
      ),
      reviewId: review.id,
      digest: digest({ version: quiz.version.id, review: review.id, parts: basis.parts }),
    };
  } catch (error) {
    if (error instanceof EvidenceError || (error instanceof QuizTraceError && error.status < 500))
      return null;
    throw error;
  }
}

export async function readProfileMemorySource(
  tx: Queryable,
  locator: ProfileSourceLocator,
  access: ProfileSourceAccess,
) {
  if (locator.kind === 'quiz') return quizSource(tx, locator, access);
  const result = await readDialogueSourceIn(tx, access.owner_id, {
    stageId: locator.stage_id,
    chatSessionId: locator.activity_id,
  });
  if (result.status === 'unreadable') throw new Error('PROFILE_MEMORY_DIALOGUE_UNREADABLE');
  if (result.status !== 'available' || result.source.type !== locator.kind) return null;
  const { source } = result;
  const { sourceIndex, messageVersions } = buildDialogueEvidenceContext(source);
  const index = source.messages.findIndex(({ message }) => message.id === locator.record_id);
  const original = source.messages[index];
  if (
    !original?.text.trim() ||
    sourceIndex[original.message.id].role !== 'student' ||
    original.message.metadata?.interrupted === true
  )
    return null;
  const prior = source.messages.slice(Math.max(0, index - 2), index);
  const previous = prior.flatMap(({ message, text }) => {
    const role = sourceIndex[message.id].role;
    if (!text.trim() || role === 'unknown') return [];
    return [{ role: role === 'agent' ? ('teacher' as const) : ('student' as const), text }];
  });
  const preceding = source.messages.slice(Math.max(0, index - 8), index);
  const masteryContext = preceding.flatMap(({ message, text }) => {
    const role = sourceIndex[message.id].role;
    if (!text.trim() || message.metadata?.interrupted === true || role === 'unknown') return [];
    return [{ role: role === 'agent' ? ('teacher' as const) : ('student' as const), text }];
  });
  const completePrefix =
    index <= 8 &&
    source.messages.length < source.window.maxMessages &&
    preceding.every(
      ({ message, text }) =>
        !text.trim() ||
        (sourceIndex[message.id].role !== 'unknown' && message.metadata?.interrupted !== true),
    );
  const basis: ProfileMemorySource = {
    stageId: source.stageId,
    title: access.title,
    kind: source.type,
    occurredAt: new Date(original.message.metadata?.createdAt ?? source.createdAt).toISOString(),
    parts: [
      {
        answer: original.text,
        previous,
        help: previous.some((entry) => entry.role === 'teacher')
          ? 'prior-teacher-messages'
          : 'unknown',
      },
    ],
  };
  return {
    basis,
    sceneId: source.initialContext?.sceneId,
    dialogueMastery: {
      topic: source.title,
      completePrefix,
      messages: masteryContext,
      digest: digest({
        context: source.initialContext,
        topic: source.title,
        messages: [...preceding, original].map(({ message }) => messageVersions[message.id]),
      }),
    },
    quizQuestions: undefined,
    quizAnswerKeys: undefined,
    reviewId: null,
    digest: digest({
      kind: source.type,
      messages: [...prior, original].map(({ message }) => messageVersions[message.id]),
    }),
  };
}

type ResolvedProfileSource = NonNullable<Awaited<ReturnType<typeof readProfileMemorySource>>>;

/** Use the expanded, versioned teaching prefix for new Dialogue records. */
export function profileMemorySourceVersion(
  source: ResolvedProfileSource | null,
  recordedDigest?: string,
) {
  if (!source) return null;
  const dialogue = source.dialogueMastery;
  if (dialogue && (recordedDigest === undefined || recordedDigest === dialogue.digest)) {
    return {
      ...source,
      digest: dialogue.digest,
      basis: {
        ...source.basis,
        parts: [
          {
            ...source.basis.parts[0],
            previous: dialogue.messages,
            help: dialogue.messages.some(({ role }) => role === 'teacher')
              ? ('prior-teacher-messages' as const)
              : ('unknown' as const),
          },
        ],
      },
    };
  }
  return recordedDigest === undefined || recordedDigest === source.digest ? source : null;
}
