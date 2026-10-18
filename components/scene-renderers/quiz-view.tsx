'use client';

import { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { answerIncludesOption } from '@/lib/quiz/grading';
import {
  PieChart,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Check,
  BookOpenText,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';

const log = createLogger('QuizView');
import type { QuizQuestion, Scene } from '@/lib/types/stage';
import { SpeechButton } from '@/components/audio/speech-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { QuestionResult } from '@/lib/quiz/grading';
import { renderQuizMathText } from '@/lib/quiz/math-text';
import type { QuizAnswers } from '@/lib/quiz/persistence';
import type {
  PreparedQuiz,
  PrepareQuizInput,
  QuizHistoryRead,
  QuizReview,
} from '@/lib/quiz/trace-types';
import {
  createQuizDraftWriter,
  createQuizOperationId,
  loadQuizForPlay,
  prepareQuiz,
  readQuizHistory,
  requestQuizReview,
  submitQuiz,
  readPendingQuizSubmission,
  rememberPendingQuizSubmission,
  readPendingQuizReview,
  rememberPendingQuizReview,
  quizReviewRequest,
  type QuizDraftWriter,
  type PendingQuizSubmission,
  type PendingQuizReview,
} from '@/lib/quiz/trace-client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuizViewProps {
  readonly scene: Scene;
  readonly planning?: Record<string, unknown>;
}

const QuizMathText = memo(function QuizMathText({
  text,
  className,
  allowDisplayMode = false,
}: {
  text: string;
  className?: string;
  allowDisplayMode?: boolean;
}) {
  const segments = useMemo(() => renderQuizMathText(text), [text]);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className={className}>{segments[0].value}</span>;
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.value}</span>;
        }

        return (
          <span
            key={index}
            className={cn(
              allowDisplayMode && segment.displayMode
                ? 'block my-1 overflow-x-auto [&_.katex-display]:!my-0'
                : 'inline-block align-baseline [&_.katex-display]:!my-0',
            )}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        );
      })}
    </span>
  );
});

// ─── Sub-components ─────────────────────────────────────────────────────────

function QuizCover({
  questionCount,
  totalPoints,
  onStart,
}: {
  questionCount: number;
  totalPoints: number;
  onStart: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-6 opacity-[0.03]">
        <PieChart className="w-52 h-52 text-violet-500" />
      </div>
      <div className="absolute bottom-0 left-0 p-6 opacity-[0.02]">
        <BookOpenText className="w-40 h-40 text-violet-500 rotate-12" />
      </div>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="w-16 h-16 bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/50 dark:to-purple-900/30 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-100 dark:shadow-violet-900/30 ring-1 ring-violet-200/50 dark:ring-violet-700/50"
      >
        <PieChart className="w-8 h-8 text-violet-500" />
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center z-10"
      >
        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('quiz.title')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('quiz.subtitle')}</p>
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex gap-5 text-sm z-10"
      >
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
            <BookOpenText className="w-3.5 h-3.5 text-violet-500" />
          </div>
          <span>
            {questionCount} {t('quiz.questionsCount')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
            <PieChart className="w-3.5 h-3.5 text-violet-500" />
          </div>
          <span>
            {t('quiz.totalPrefix')} {totalPoints} {t('quiz.pointsSuffix')}
          </span>
        </div>
      </motion.div>

      <motion.button
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onStart}
        className="mt-1 px-8 py-2.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-full font-medium shadow-lg shadow-violet-200/50 dark:shadow-violet-900/50 hover:shadow-violet-300/50 transition-shadow z-10 flex items-center gap-2"
      >
        {t('quiz.startQuiz')}
        <ChevronRight className="w-4 h-4" />
      </motion.button>
    </div>
  );
}

function SingleChoiceQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;

  return (
    <QuestionCard question={question} index={index} result={result}>
      <div className="grid gap-2">
        {question.options?.map((opt) => {
          const selected = value === opt.value;
          const isCorrectOpt = isReview && answerIncludesOption(question, opt.value);
          const isWrong = isReview && selected && result?.status === 'incorrect';

          return (
            <button
              key={opt.value}
              disabled={disabled}
              onClick={() => !disabled && onChange(opt.value)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all text-sm',
                // Default state
                !isReview &&
                  !selected &&
                  'border-gray-200 dark:border-gray-600 hover:border-violet-200 dark:hover:border-violet-700 hover:bg-violet-50/50 dark:hover:bg-violet-900/30',
                !isReview &&
                  selected &&
                  'border-violet-400 bg-violet-50 dark:bg-violet-900/30 ring-1 ring-violet-200 dark:ring-violet-700',
                // Review states
                isReview &&
                  isCorrectOpt &&
                  'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
                isReview &&
                  isWrong &&
                  !isCorrectOpt &&
                  'border-red-300 bg-red-50 dark:bg-red-900/30',
                isReview &&
                  !isCorrectOpt &&
                  !selected &&
                  'border-gray-100 dark:border-gray-700 opacity-60',
                disabled && !isReview && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
                  !isReview &&
                    !selected &&
                    'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
                  !isReview && selected && 'bg-violet-500 text-white',
                  isReview && isCorrectOpt && 'bg-emerald-500 text-white',
                  isReview && isWrong && !isCorrectOpt && 'bg-red-400 text-white',
                  isReview &&
                    !isCorrectOpt &&
                    !selected &&
                    'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                )}
              >
                {opt.value}
              </span>
              <span
                className={cn(
                  'flex-1',
                  isReview && !isCorrectOpt && !selected && 'text-gray-400 dark:text-gray-500',
                )}
              >
                <QuizMathText text={opt.label} />
              </span>
              {isReview && isCorrectOpt && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              )}
              {isReview && isWrong && !isCorrectOpt && (
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </QuestionCard>
  );
}

function MultipleChoiceQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  const selected = value ?? [];

  const toggle = (optValue: string) => {
    if (disabled) return;
    if (selected.includes(optValue)) {
      onChange(selected.filter((v) => v !== optValue));
    } else {
      onChange([...selected, optValue]);
    }
  };

  const { t } = useI18n();

  return (
    <QuestionCard question={question} index={index} result={result}>
      {!isReview && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
          {t('quiz.multipleChoiceHint')}
        </p>
      )}
      <div className="grid gap-2">
        {question.options?.map((opt) => {
          const isSelected = selected.includes(opt.value);
          const isCorrectOpt = isReview && answerIncludesOption(question, opt.value);
          const isWrong = isReview && isSelected && !isCorrectOpt;

          return (
            <button
              key={opt.value}
              disabled={disabled}
              onClick={() => toggle(opt.value)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all text-sm',
                !isReview &&
                  !isSelected &&
                  'border-gray-200 dark:border-gray-600 hover:border-violet-200 dark:hover:border-violet-700 hover:bg-violet-50/50 dark:hover:bg-violet-900/30',
                !isReview &&
                  isSelected &&
                  'border-violet-400 bg-violet-50 dark:bg-violet-900/30 ring-1 ring-violet-200 dark:ring-violet-700',
                isReview &&
                  isCorrectOpt &&
                  'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
                isReview && isWrong && 'border-red-300 bg-red-50 dark:bg-red-900/30',
                isReview &&
                  !isCorrectOpt &&
                  !isSelected &&
                  'border-gray-100 dark:border-gray-700 opacity-60',
                disabled && !isReview && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
                  !isReview &&
                    !isSelected &&
                    'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
                  !isReview && isSelected && 'bg-violet-500 text-white',
                  isReview && isCorrectOpt && 'bg-emerald-500 text-white',
                  isReview && isWrong && 'bg-red-400 text-white',
                  isReview &&
                    !isCorrectOpt &&
                    !isSelected &&
                    'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                )}
              >
                {!isReview && isSelected ? <Check className="w-3.5 h-3.5" /> : opt.value}
              </span>
              <span
                className={cn(
                  'flex-1',
                  isReview && !isCorrectOpt && !isSelected && 'text-gray-400 dark:text-gray-500',
                )}
              >
                <QuizMathText text={opt.label} />
              </span>
              {isReview && isCorrectOpt && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              )}
              {isReview && isWrong && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
            </button>
          );
        })}
      </div>
    </QuestionCard>
  );
}

function ShortAnswerQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  const { t } = useI18n();
  // Ref to track latest value for voice transcription append
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  return (
    <QuestionCard question={question} index={index} result={result}>
      {!isReview ? (
        <div className="relative">
          <textarea
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={t('quiz.inputPlaceholder')}
            className="w-full min-h-[100px] p-3 pb-10 rounded-xl border border-gray-200 dark:border-gray-600 text-sm resize-none focus:outline-none focus:border-violet-300 dark:focus:border-violet-600 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/50 transition-all disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-500 dark:bg-gray-800/50 dark:text-gray-200 dark:placeholder:text-gray-500"
          />
          <SpeechButton
            size="sm"
            disabled={disabled}
            className="absolute bottom-3 left-3"
            onTranscription={(text) => {
              const cur = valueRef.current ?? '';
              onChange(cur + (cur ? ' ' : '') + text);
            }}
          />
          <span className="absolute bottom-3 right-3 text-xs text-gray-300 dark:text-gray-600">
            {(value ?? '').length} {t('quiz.charCount')}
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('quiz.yourAnswer')}</p>
            {value ? (
              <QuizMathText text={value} />
            ) : (
              <span className="text-gray-400 dark:text-gray-500 italic">
                {t('quiz.notAnswered')}
              </span>
            )}
          </div>
          {result.aiComment && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800">
              <Sparkles className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-0.5">
                  {t('quiz.aiComment')}
                </p>
                <p className="text-xs text-violet-600/80 dark:text-violet-400/80">
                  <QuizMathText text={result.aiComment} />
                </p>
              </div>
              <span className="ml-auto text-xs font-bold text-violet-600 dark:text-violet-400 shrink-0">
                {result.earned}/{question.points ?? 1}
                {t('quiz.pointsSuffix')}
              </span>
            </div>
          )}
        </div>
      )}
    </QuestionCard>
  );
}

function QuestionCard({
  question,
  index,
  result,
  children,
}: {
  question: QuizQuestion;
  index: number;
  result?: QuestionResult;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const isReview = !!result;
  const pts = question.points ?? 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-2xl border p-5 relative overflow-hidden',
        !isReview && 'border-gray-150 dark:border-gray-700 shadow-sm',
        isReview &&
          result.status === 'correct' &&
          'border-emerald-200 dark:border-emerald-800 shadow-sm shadow-emerald-50 dark:shadow-emerald-900/20',
        isReview &&
          result.status === 'incorrect' &&
          'border-red-200 dark:border-red-800 shadow-sm shadow-red-50 dark:shadow-red-900/20',
      )}
    >
      {/* Left accent */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl',
          !isReview && 'bg-violet-400',
          isReview && result.status === 'correct' && 'bg-emerald-400',
          isReview && result.status === 'incorrect' && 'bg-red-400',
        )}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
              !isReview &&
                'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400',
              isReview &&
                result.status === 'correct' &&
                'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
              isReview &&
                result.status === 'incorrect' &&
                'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
            )}
          >
            {index + 1}
          </span>
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-relaxed">
              <QuizMathText text={question.question} allowDisplayMode />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {question.type === 'single'
                ? t('quiz.singleChoice')
                : question.type === 'multiple'
                  ? t('quiz.multipleChoice')
                  : t('quiz.shortAnswer')}
              {' · '}
              {pts} {t('quiz.pointsSuffix')}
            </p>
          </div>
        </div>
        {isReview && (
          <div className="shrink-0 ml-2">
            {result.status === 'correct' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
            {result.status === 'incorrect' && <XCircle className="w-6 h-6 text-red-400" />}
          </div>
        )}
      </div>

      {/* Body */}
      {children}

      {/* Analysis (review only) */}
      {isReview && question.analysis && (
        <div className="mt-3 p-3 rounded-lg bg-blue-50/70 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          <span className="font-medium">{t('quiz.analysis')}</span>
          <QuizMathText text={question.analysis} allowDisplayMode />
        </div>
      )}
    </motion.div>
  );
}

function ScoreBanner({
  score,
  total,
  results,
}: {
  score: number;
  total: number;
  results: QuestionResult[];
}) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const correctCount = results.filter((r) => r.status === 'correct').length;
  const incorrectCount = results.filter((r) => r.status === 'incorrect').length;

  const color = pct >= 80 ? 'emerald' : pct >= 60 ? 'amber' : 'red';
  const colorMap = {
    emerald: {
      bg: 'from-emerald-500 to-teal-500',
      shadow: 'shadow-emerald-200/50 dark:shadow-emerald-900/50',
      ring: 'bg-emerald-400/30',
      text: t('quiz.excellent'),
    },
    amber: {
      bg: 'from-amber-500 to-yellow-500',
      shadow: 'shadow-amber-200/50 dark:shadow-amber-900/50',
      ring: 'bg-amber-400/30',
      text: t('quiz.keepGoing'),
    },
    red: {
      bg: 'from-red-500 to-rose-500',
      shadow: 'shadow-red-200/50 dark:shadow-red-900/50',
      ring: 'bg-red-400/30',
      text: t('quiz.needsReview'),
    },
  };
  const c = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('rounded-2xl p-6 bg-gradient-to-r text-white shadow-lg', c.bg, c.shadow)}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-sm font-medium">{c.text}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-black">{score}</span>
            <span className="text-white/60 text-lg">/ {total}</span>
          </div>
          <div className="flex gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {correctCount} {t('quiz.correct')}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> {incorrectCount} {t('quiz.incorrect')}
            </span>
          </div>
        </div>

        {/* Percentage ring */}
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="6"
            />
            <motion.circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="white"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 34}`}
              initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 34 * (1 - pct / 100) }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-black">{pct}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function QuizQuestions({
  questions,
  answers,
  review,
  locked,
  onChange,
}: {
  questions: QuizQuestion[];
  answers: QuizAnswers;
  review?: QuizReview;
  locked: boolean;
  onChange: (id: string, answer: string | string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {questions.map((q, index) => {
        const evaluated = review?.results.find((result) => result.questionId === q.id);
        const result = evaluated?.evaluation.state === 'normal' ? evaluated : undefined;
        const props = { question: q, index, disabled: locked, result };
        return (
          <div key={q.id}>
            {q.type === 'single' ? (
              <SingleChoiceQuestion
                {...props}
                value={answers[q.id] as string | undefined}
                onChange={(value) => onChange(q.id, value)}
              />
            ) : q.type === 'multiple' ? (
              <MultipleChoiceQuestion
                {...props}
                value={answers[q.id] as string[] | undefined}
                onChange={(value) => onChange(q.id, value)}
              />
            ) : (
              <ShortAnswerQuestion
                {...props}
                value={answers[q.id] as string | undefined}
                onChange={(value) => onChange(q.id, value)}
              />
            )}
            {evaluated && evaluated.evaluation.state !== 'normal' && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" role="status">
                {t(
                  evaluated.evaluation.state === 'fallback'
                    ? 'quiz.traceFallback'
                    : 'quiz.traceFailed',
                )}
                {evaluated.aiComment && <span> {evaluated.aiComment}</span>}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

function TraceScore({ review }: { review: QuizReview }) {
  const { t } = useI18n();
  const summary = review.summary;
  return (
    <div className="space-y-2" data-testid="quiz-trace-score">
      {summary.status === 'complete' && (
        <ScoreBanner
          score={summary.usableEarned}
          total={summary.usablePossible}
          results={review.results.filter((result) => result.evaluation.state === 'normal')}
        />
      )}
      <p className="text-sm" role="status">
        {t(
          summary.status === 'complete'
            ? 'quiz.traceComplete'
            : summary.status === 'partial'
              ? 'quiz.tracePartial'
              : 'quiz.traceUnavailable',
          {
            earned: summary.usableEarned,
            possible: summary.usablePossible,
            total: summary.quizPossible,
            count: summary.unusableQuestionCount,
          },
        )}
      </p>
    </div>
  );
}

function TraceReviewRecord({
  review,
  questions,
  current,
}: {
  review: QuizReview;
  questions: QuizQuestion[];
  current: boolean;
}) {
  const { t, locale } = useI18n();
  const summary = review.summary;
  return (
    <details className="rounded-lg border p-3" data-testid="quiz-grading-record">
      <summary className="cursor-pointer flex-wrap text-sm">
        {t('quiz.traceGradingNumber', { number: review.ordinal })}
        <time className="ml-2 text-muted-foreground" dateTime={review.savedAt}>
          {new Date(review.savedAt).toLocaleString(locale)}
        </time>
        {current && <span className="ml-2 font-medium">{t('quiz.traceAdoptedGrading')}</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm" role="status">
          {t(
            summary.status === 'complete'
              ? 'quiz.traceComplete'
              : summary.status === 'partial'
                ? 'quiz.tracePartial'
                : 'quiz.traceUnavailable',
            {
              earned: summary.usableEarned,
              possible: summary.usablePossible,
              total: summary.quizPossible,
              count: summary.unusableQuestionCount,
            },
          )}
        </p>
        <ul className="space-y-3">
          {review.results.map((result, index) => {
            const questionIndex = questions.findIndex((q) => q.id === result.questionId);
            const question = questions[questionIndex];
            return (
              <li key={result.questionId} className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {t('quiz.traceQuestionNumber', {
                    number: questionIndex >= 0 ? questionIndex + 1 : index + 1,
                  })}
                  {result.evaluation.state === 'normal' && question && (
                    <span>
                      {' '}
                      · {result.earned} / {question.points ?? 1} {t('quiz.pointsSuffix')}
                    </span>
                  )}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t(
                      result.evaluation.method === 'model'
                        ? 'quiz.traceModelGrading'
                        : 'quiz.traceKeyGrading',
                    )}
                  </span>
                </p>
                {result.evaluation.state !== 'normal' && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300" role="status">
                    {t(
                      result.evaluation.state === 'fallback'
                        ? 'quiz.traceFallback'
                        : 'quiz.traceFailed',
                    )}
                  </p>
                )}
                {result.aiComment && (
                  <div className="mt-2">
                    <p className="font-medium">{t('quiz.aiComment')}</p>
                    <QuizMathText text={result.aiComment} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function TraceHistory({
  history,
  sceneId,
  onSelect,
}: {
  history: QuizHistoryRead;
  sceneId: string;
  onSelect: (attempt: PreparedQuiz) => void;
}) {
  const { t, locale } = useI18n();
  const submissions = history.attempts.filter(
    (attempt) => attempt.sceneId === sceneId && attempt.submission,
  );
  return (
    <section className="space-y-3" data-testid="quiz-trace-history">
      <p className="font-medium">{t('quiz.traceHistoryCount', { count: submissions.length })}</p>
      <p role="status">
        {t(
          history.completeness === 'complete'
            ? 'quiz.traceHistoryComplete'
            : history.completeness === 'partial'
              ? 'quiz.traceHistoryPartial'
              : 'quiz.traceHistoryUnknown',
        )}
      </p>
      {history.failures.map((failure) => (
        <p key={failure.attemptId} className="text-sm text-amber-700">
          {failure.attemptId}: {failure.code}
        </p>
      ))}
      {submissions.length === 0 && history.completeness === 'complete' && (
        <p className="text-muted-foreground">{t('quiz.traceHistoryEmpty')}</p>
      )}
      {submissions.map((attempt, index) => (
        <details
          key={attempt.attemptId}
          className="border-t pt-3"
          data-testid="quiz-submission-history-entry"
        >
          <summary className="cursor-pointer font-medium">
            {t('quiz.traceSubmission', { number: index + 1 })}
            {attempt.submission && (
              <time
                className="ml-2 font-normal text-muted-foreground"
                dateTime={attempt.submission.savedAt}
              >
                {new Date(attempt.submission.savedAt).toLocaleString(locale)}
              </time>
            )}
          </summary>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('quiz.traceDebug')}</summary>
            <p className="break-all">
              <code>{attempt.attemptId}</code>
            </p>
            <p className="break-all">
              {t('quiz.traceVersion')}: {attempt.version.id}
            </p>
          </details>
          {Boolean(attempt.version.resourceCoverage?.unavailableBackgroundRefs.length) && (
            <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
              {t('quiz.traceResourceLimits', {
                count: attempt.version.resourceCoverage!.unavailableBackgroundRefs.length,
              })}
            </p>
          )}
          {attempt.version.planning && (
            <details className="text-xs">
              <summary className="cursor-pointer">{t('quiz.tracePlanning')}</summary>
              <p>{t('quiz.tracePlanningLimits')}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(attempt.version.planning, null, 2)}
              </pre>
            </details>
          )}
          <p className="text-sm">
            {t(attempt.submission ? 'quiz.traceLocked' : 'quiz.traceDraft')}
          </p>
          {attempt.version.scene.content.type === 'quiz' && (
            <div className="space-y-3 mt-3">
              <QuizQuestions
                questions={attempt.version.scene.content.questions}
                answers={attempt.submission?.answers ?? attempt.answers}
                review={attempt.review}
                locked
                onChange={() => {}}
              />
              {attempt.review && <TraceScore review={attempt.review} />}
              <details className="rounded-lg border p-3" data-testid="quiz-grading-history">
                <summary className="cursor-pointer font-medium">
                  {t('quiz.traceGradingHistory', { count: attempt.reviews.length })}
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('quiz.traceRegradingExplanation')}
                </p>
                <div className="mt-3 space-y-3">
                  {attempt.reviews.map((review) => (
                    <TraceReviewRecord
                      key={review.id}
                      review={review}
                      questions={
                        attempt.version.scene.content.type === 'quiz'
                          ? attempt.version.scene.content.questions
                          : []
                      }
                      current={attempt.review?.id === review.id}
                    />
                  ))}
                </div>
              </details>
              <button type="button" className="text-sm underline" onClick={() => onSelect(attempt)}>
                {t('quiz.traceViewAttempt')}
              </button>
            </div>
          )}
        </details>
      ))}
      {history.legacy.length > 0 && (
        <details className="border-t pt-2 text-xs">
          <summary className="cursor-pointer">{t('quiz.traceLegacy')}</summary>
          {history.legacy.map((legacy) => (
            <details key={legacy.attemptId} className="border-t pt-2">
              <summary className="cursor-pointer break-all">
                {legacy.attemptId} · {t('quiz.traceLegacy')}
              </summary>
              <p>{t('quiz.traceLegacyExplanation')}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(legacy.records, null, 2)}
              </pre>
            </details>
          ))}
        </details>
      )}
    </section>
  );
}

export function QuizView({ scene, planning }: QuizViewProps) {
  const { t, locale } = useI18n();
  const { stageId, id: sceneId } = scene;
  const [prepared, setPrepared] = useState<PreparedQuiz | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [evaluationRequested, setEvaluationRequested] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<QuizHistoryRead | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historical, setHistorical] = useState(false);
  const [legacyOnly, setLegacyOnly] = useState(false);
  const preparedRef = useRef<PreparedQuiz | null>(null);
  const writerRef = useRef<QuizDraftWriter | null>(null);
  const pendingSubmission = useRef<PendingQuizSubmission | null>(null);
  const pendingReview = useRef<PendingQuizReview | null>(null);
  const pendingPrepare = useRef<PrepareQuizInput | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const gradingRef = useRef(false);

  const install = useCallback((next: PreparedQuiz, open = true) => {
    writerRef.current?.cancel();
    preparedRef.current = next;
    setPrepared(next);
    setAnswers(next.submission?.answers ?? next.answers);
    setStarted(open);
    setHistorical(false);
    setLegacyOnly(false);
    const token = generation.current;
    writerRef.current = next.submission
      ? null
      : createQuizDraftWriter(next, {
          onSaved: (value) => {
            if (token !== generation.current || preparedRef.current?.attemptId !== value.attemptId)
              return;
            preparedRef.current = value;
            setPrepared(value);
          },
          onError: (error) => {
            log.warn('Quiz draft needs recovery', error);
            if (token === generation.current) {
              setNotice('quiz.traceSaveFailed');
              setStatus('error');
            }
          },
        });
  }, []);

  const restore = useCallback(async () => {
    const token = ++generation.current;
    writerRef.current?.cancel();
    setStatus('loading');
    setNotice(null);
    setBusy(false);
    busyRef.current = false;
    setGrading(false);
    gradingRef.current = false;
    try {
      const next = await loadQuizForPlay(stageId, sceneId);
      if (token !== generation.current) return;
      const pending = readPendingQuizSubmission(stageId, sceneId);
      if (next) {
        install(next);
        const savedPendingReview = readPendingQuizReview(stageId, sceneId);
        pendingReview.current =
          savedPendingReview?.attemptId === next.attemptId &&
          savedPendingReview.input.submissionId === next.submission?.id
            ? savedPendingReview
            : null;
        if (
          pendingReview.current?.reviewId &&
          next.reviews.some((review) => review.id === pendingReview.current?.reviewId)
        ) {
          pendingReview.current = null;
          rememberPendingQuizReview(stageId, sceneId, null);
        }
        setEvaluationRequested(Boolean(next.review || next.pendingReview || pendingReview.current));
        if (
          pendingPrepare.current?.mode === 'start' ||
          (pendingPrepare.current?.mode === 'retry' &&
            pendingPrepare.current.previousAttemptId !== next.attemptId)
        ) {
          pendingPrepare.current = null;
        }
        if (next.submission) {
          pendingSubmission.current = null;
          rememberPendingQuizSubmission(stageId, sceneId, null);
          setUncertain(false);
        } else if (pending?.attemptId === next.attemptId) {
          pendingSubmission.current = pending;
          setAnswers(pending.input.answers);
          setUncertain(true);
        } else {
          pendingSubmission.current = null;
          setUncertain(false);
        }
      } else {
        preparedRef.current = null;
        setPrepared(null);
        setAnswers({});
        setStarted(false);
        setUncertain(Boolean(pending));
        pendingSubmission.current = pending;
        // This read is side-effect free: legacy records never acquire today's questions.
        try {
          const read = await readQuizHistory(stageId);
          if (token !== generation.current) return;
          setHistory(read);
          const legacy = read.legacy.some((item) =>
            item.records.some(
              (record) =>
                typeof record === 'object' &&
                record !== null &&
                'sceneId' in record &&
                record.sceneId === sceneId,
            ),
          );
          setLegacyOnly(legacy);
          setShowHistory(legacy);
        } catch {
          if (token === generation.current) setNotice('quiz.traceHistoryUnknown');
        }
      }
      if (token === generation.current) setStatus('ready');
    } catch (error) {
      log.warn('Quiz restore failed', error);
      if (token === generation.current) {
        setNotice('quiz.traceRestoreFailed');
        setStatus('error');
      }
    }
  }, [install, sceneId, stageId]);

  useEffect(() => {
    void restore();
    return () => {
      // This counter deliberately invalidates async work from the departing view.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      void writerRef.current?.flush().catch(() => {});
    };
  }, [restore]);

  const handleStart = async (retry = false) => {
    if (busyRef.current) return;
    if (!retry && preparedRef.current && !historical) {
      setStarted(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const token = ++generation.current;
    writerRef.current?.cancel();
    const previous = preparedRef.current;
    pendingPrepare.current ??=
      retry && previous
        ? {
            operationId: createQuizOperationId(),
            mode: 'retry',
            stageId,
            sceneId,
            previousAttemptId: previous.attemptId,
          }
        : {
            operationId: createQuizOperationId(),
            mode: 'start',
            stageId,
            sceneId,
            scene: structuredClone(scene),
            ...(planning ? { planning: structuredClone(planning) } : {}),
          };
    try {
      const next = await prepareQuiz(pendingPrepare.current);
      if (token !== generation.current) return;
      pendingPrepare.current = null;
      pendingSubmission.current = null;
      rememberPendingQuizSubmission(stageId, sceneId, null);
      pendingReview.current = null;
      rememberPendingQuizReview(stageId, sceneId, null);
      setUncertain(false);
      setEvaluationRequested(Boolean(next.review || next.pendingReview));
      install(next, !retry);
      setStatus('ready');
    } catch (error) {
      log.warn('Quiz preparation needs recovery', error);
      if (token === generation.current) {
        setNotice('quiz.tracePrepareFailed');
        setStatus('error');
      }
    } finally {
      if (token === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const requestGrade = async (current: PreparedQuiz, explicitlyNew = false) => {
    if (!current.submission || gradingRef.current) return;
    const token = generation.current;
    gradingRef.current = true;
    setGrading(true);
    setEvaluationRequested(true);
    setNotice(null);
    const operation = quizReviewRequest(
      current.attemptId,
      current.submission.id,
      locale,
      pendingReview.current,
      explicitlyNew,
    );
    pendingReview.current = operation;
    rememberPendingQuizReview(stageId, sceneId, operation);
    try {
      const review = await requestQuizReview(current.attemptId, operation.input);
      if (token !== generation.current || preparedRef.current?.attemptId !== current.attemptId)
        return;
      if ('pending' in review) {
        setNotice('quiz.traceEvaluationPending');
        return;
      }
      if (
        review.attemptId !== current.attemptId ||
        review.submissionId !== current.submission.id ||
        review.versionId !== current.version.id
      )
        throw new Error('Mismatched quiz review');
      operation.reviewId = review.id;
      rememberPendingQuizReview(stageId, sceneId, operation);
      // Adopt the server projection: a late result must not replace a newer adopted review.
      const next = await loadQuizForPlay(stageId, sceneId);
      if (token !== generation.current || preparedRef.current?.attemptId !== current.attemptId)
        return;
      if (
        !next ||
        next.attemptId !== current.attemptId ||
        next.submission?.id !== current.submission.id ||
        !next.reviews.some((item) => item.id === review.id)
      )
        throw new Error('Review not confirmed in saved state');
      pendingReview.current = null;
      rememberPendingQuizReview(stageId, sceneId, null);
      install(next);
    } catch (error) {
      log.warn('Quiz evaluation needs recovery', error);
      if (token !== generation.current) return;
      // Reading is safe after an uncertain POST. Unknown review identity is recovered by
      // replaying the SAME operation, rather than assuming any latest review belongs to it.
      try {
        const saved = await loadQuizForPlay(stageId, sceneId);
        if (token !== generation.current) return;
        if (
          saved?.attemptId === current.attemptId &&
          saved.submission?.id === current.submission.id
        ) {
          install(saved);
          if (
            operation.reviewId &&
            saved.reviews.some((review) => review.id === operation.reviewId)
          ) {
            pendingReview.current = null;
            rememberPendingQuizReview(stageId, sceneId, null);
            return;
          }
        }
      } catch {
        /* Keep the original operation for explicit recovery. */
      }
      if (token === generation.current) setNotice('quiz.traceEvaluationFailed');
    } finally {
      if (token === generation.current) {
        gradingRef.current = false;
        setGrading(false);
      }
    }
  };

  const handleSubmit = async () => {
    const current = preparedRef.current;
    if (!current || current.submission || busyRef.current || historical) return;
    busyRef.current = true;
    setBusy(true);
    setUncertain(true);
    setNotice(null);
    const token = generation.current;
    try {
      if (!pendingSubmission.current) {
        pendingSubmission.current = {
          attemptId: current.attemptId,
          input: {
            operationId: createQuizOperationId(),
            submissionId: createQuizOperationId(),
            answers: structuredClone(answers),
          },
        };
        rememberPendingQuizSubmission(stageId, sceneId, pendingSubmission.current);
        // Persist the locked intent before awaiting the draft. A refresh during
        // that flush must recover this same submission, never reopen editing.
        await writerRef.current?.flush();
      }
      const pending = pendingSubmission.current;
      const submission = await submitQuiz(pending.attemptId, pending.input);
      if (token !== generation.current || preparedRef.current?.attemptId !== pending.attemptId)
        return;
      if (submission.attemptId !== current.attemptId || submission.versionId !== current.version.id)
        throw new Error('Mismatched quiz submission');
      const next = {
        ...preparedRef.current,
        answers: submission.answers,
        submission,
        lastSeq: submission.seq,
      };
      pendingSubmission.current = null;
      rememberPendingQuizSubmission(stageId, sceneId, null);
      setUncertain(false);
      install(next);
      await requestGrade(next);
    } catch (error) {
      log.warn('Quiz submission needs recovery', error);
      if (token === generation.current) setNotice('quiz.traceSubmissionUncertain');
    } finally {
      if (token === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const handleAnswer = (id: string, value: string | string[]) => {
    if (prepared?.submission || uncertain || busyRef.current || historical) return;
    setAnswers((previous) => {
      const next = { ...previous, [id]: value };
      writerRef.current?.schedule(next);
      return next;
    });
  };
  const questions =
    prepared?.version.scene.content.type === 'quiz' ? prepared.version.scene.content.questions : [];
  const totalPoints = questions.reduce((sum, question) => sum + (question.points ?? 1), 0);
  const allAnswered =
    questions.length > 0 &&
    questions.every((question) => {
      const answer = answers[question.id];
      return Array.isArray(answer)
        ? answer.length > 0
        : typeof answer === 'string' && answer.trim().length > 0;
    });
  const locked = Boolean(prepared?.submission) || uncertain || busy || historical;
  const openHistory = async () => {
    const token = generation.current;
    setNotice((current) => (current === 'quiz.traceHistoryUnknown' ? null : current));
    setShowHistory(true);
    setHistoryBusy(true);
    try {
      const read = await readQuizHistory(stageId);
      if (token === generation.current) setHistory(read);
    } catch {
      if (token === generation.current) setNotice('quiz.traceHistoryUnknown');
    } finally {
      if (token === generation.current) setHistoryBusy(false);
    }
  };
  const buttonClass =
    'rounded-lg px-4 py-2 text-sm bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <Dialog open={showHistory} onOpenChange={setShowHistory}>
      <div
        className="w-full h-full bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-900 overflow-y-auto flex flex-col"
        data-testid="quiz-learning-trace"
      >
        <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="font-semibold mr-auto">
            {t(prepared?.submission ? 'quiz.quizReport' : 'quiz.title')}
          </span>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={historyBusy}
              onClick={() => void openHistory()}
            >
              <BookOpenText aria-hidden="true" />
              {t('quiz.traceHistory')}
            </Button>
          </DialogTrigger>
          {prepared?.submission && !historical && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void handleStart(true)}
            >
              {t('quiz.traceNewAttempt')}
            </button>
          )}
        </div>
        {notice && (
          <p role="alert" className="px-6 py-3 text-sm text-amber-800 dark:text-amber-200">
            {t(notice)}
          </p>
        )}
        {status === 'loading' && (
          <div role="status" className="p-6 flex gap-2">
            <Loader2 className="animate-spin" />
            {t('quiz.traceRestoring')}
          </div>
        )}
        {status === 'error' && (
          <div className="p-6 flex flex-wrap gap-3">
            {pendingPrepare.current && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => void handleStart(pendingPrepare.current?.mode === 'retry')}
              >
                {t('quiz.traceRetrySave')}
              </button>
            )}
            <button type="button" className={buttonClass} onClick={() => void restore()}>
              {t('quiz.traceRecover')}
            </button>
          </div>
        )}
        {status === 'ready' && (
          <>
            {legacyOnly && !prepared && (
              <div className="p-6 space-y-3">
                <p>{t('quiz.traceLegacyExplanation')}</p>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || uncertain}
                  onClick={() => void handleStart()}
                >
                  {t('quiz.traceStartNewVersion')}
                </button>
              </div>
            )}
            {!started && !legacyOnly && !uncertain && (
              <div className="min-h-80 flex-1 relative">
                <QuizCover
                  questionCount={
                    prepared
                      ? questions.length
                      : scene.content.type === 'quiz'
                        ? scene.content.questions.length
                        : 0
                  }
                  totalPoints={
                    prepared
                      ? totalPoints
                      : scene.content.type === 'quiz'
                        ? scene.content.questions.reduce((sum, q) => sum + (q.points ?? 1), 0)
                        : 0
                  }
                  onStart={() => void handleStart()}
                />
                {busy && (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-gray-900/90"
                    role="status"
                  >
                    <Loader2 className="animate-spin mr-2" />
                    {t('quiz.tracePreparing')}
                  </div>
                )}
              </div>
            )}
            {uncertain && (
              <div className="p-6 space-y-3" data-testid="quiz-submission-uncertain">
                <p role="status">{t('quiz.traceSubmissionUncertain')}</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void restore()}
                  >
                    {t('quiz.traceRecover')}
                  </button>
                  {prepared && pendingSubmission.current && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => void handleSubmit()}
                    >
                      {t('quiz.traceRetrySubmission')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {started && prepared && (
              <div className="px-6 py-4 space-y-4">
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">{t('quiz.traceDebug')}</summary>
                  <p className="break-all">
                    {t('quiz.traceVersion')}: {prepared.version.id}
                  </p>
                </details>
                {(prepared.submission || historical) && (
                  <p role="status" className="text-sm">
                    {t('quiz.traceLocked')}
                  </p>
                )}
                {prepared.review && <TraceScore review={prepared.review} />}
                {prepared.previousUsableReview && (
                  <div className="rounded-xl border border-amber-300 p-3 space-y-2">
                    <p className="text-sm">{t('quiz.tracePreviousUsable')}</p>
                    <TraceScore review={prepared.previousUsableReview} />
                  </div>
                )}
                {prepared.submission && !historical && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={grading || busy}
                      onClick={() =>
                        void requestGrade(prepared, evaluationRequested && !pendingReview.current)
                      }
                    >
                      {t(
                        pendingReview.current
                          ? 'quiz.traceRecoverEvaluation'
                          : evaluationRequested
                            ? 'quiz.traceRegrade'
                            : 'quiz.traceGrade',
                      )}
                    </button>
                    {pendingReview.current && (
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={grading || busy}
                        onClick={() => void requestGrade(prepared, true)}
                      >
                        {t('quiz.traceRegrade')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-sm underline"
                      disabled={busy}
                      onClick={() => void restore()}
                    >
                      {t('quiz.traceCheckEvaluation')}
                    </button>
                    {(grading || prepared.pendingReview) && (
                      <p role="status" className="text-sm flex gap-2">
                        <Loader2 className="animate-spin h-4 w-4" />
                        {t('quiz.traceEvaluationPending')}
                      </p>
                    )}
                  </div>
                )}
                <QuizQuestions
                  questions={questions}
                  answers={answers}
                  review={prepared.review}
                  locked={locked}
                  onChange={handleAnswer}
                />
                {!prepared.submission && !historical && !uncertain && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!allAnswered || busy}
                    onClick={() => void handleSubmit()}
                  >
                    {t(busy ? 'quiz.traceSaving' : 'quiz.submitAnswers')}
                  </button>
                )}
                {historical && (
                  <button type="button" className={buttonClass} onClick={() => void restore()}>
                    {t('quiz.traceCurrentAttempt')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <DialogContent
          className="w-[95vw] max-w-3xl max-h-[85dvh] flex flex-col gap-4"
          showCloseButton={false}
        >
          <DialogHeader className="pr-10">
            <DialogTitle>{t('quiz.traceHistory')}</DialogTitle>
            <DialogDescription>{t('quiz.traceHistoryDescription')}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4"
              aria-label={t('common.close')}
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
          <div className="min-h-0 overflow-y-auto space-y-3">
            {historyBusy && <p role="status">{t('quiz.traceRestoring')}</p>}
            {!historyBusy &&
              (notice === 'quiz.traceHistoryUnknown' || notice === 'quiz.traceSaveFailed') && (
                <p role="alert">{t(notice)}</p>
              )}
            {history && (
              <TraceHistory
                history={history}
                sceneId={sceneId}
                onSelect={(attempt) => {
                  if (busyRef.current || uncertain) return;
                  const token = generation.current;
                  void (async () => {
                    try {
                      await writerRef.current?.flush();
                    } catch {
                      if (token === generation.current) setNotice('quiz.traceSaveFailed');
                      return;
                    }
                    if (token !== generation.current) return;
                    generation.current++;
                    writerRef.current?.cancel();
                    preparedRef.current = attempt;
                    setPrepared(attempt);
                    setAnswers(attempt.submission?.answers ?? attempt.answers);
                    setHistorical(true);
                    setShowHistory(false);
                    setStarted(true);
                    setStatus('ready');
                    setUncertain(false);
                    gradingRef.current = false;
                    setGrading(false);
                  })();
                }}
              />
            )}
          </div>
        </DialogContent>
      </div>
    </Dialog>
  );
}
