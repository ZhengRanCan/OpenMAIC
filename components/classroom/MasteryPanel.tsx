'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Target, X } from 'lucide-react';

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
import { useI18n } from '@/lib/hooks/use-i18n';
import type {
  ClassroomMastery,
  MasteryCard,
  MasteryCardSource,
} from '@/lib/learner-mastery/classroom';

type PanelState =
  | { status: 'loading' | 'empty' | 'error' }
  | { status: 'ready'; data: ClassroomMastery };

function SourceContent({ source }: { source: MasteryCardSource }) {
  const { t, locale } = useI18n();
  const date = new Date(source.occurredAt);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>{t(`mastery.${source.kind}`)}</span>
        {source.title && <span className="break-words">{source.title}</span>}
        {!Number.isNaN(+date) && (
          <time dateTime={source.occurredAt}>{date.toLocaleString(locale)}</time>
        )}
      </div>
      {source.kind === 'quiz' ? (
        <ul className="space-y-3">
          {source.questions.map((question, index) => {
            const answer =
              question.type === 'short_answer'
                ? question.submitted
                : [question.submitted]
                    .flat()
                    .filter(Boolean)
                    .map(
                      (value) =>
                        question.options?.find((option) => option.value === value)?.label ?? value,
                    )
                    .join(' · ');
            return (
              <li key={index} className="space-y-1">
                <p className="whitespace-pre-wrap break-words font-medium">{question.prompt}</p>
                <p className="text-muted-foreground">{t('mastery.submitted')}</p>
                <p className="whitespace-pre-wrap break-words">{answer || t('mastery.noAnswer')}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="space-y-2">
          {source.messages.map((message, index) => (
            <li key={index}>
              <p className="text-xs font-medium text-muted-foreground">
                {t(`mastery.speaker.${message.role}`)}
              </p>
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TargetCard({
  card,
  updating,
  retry,
}: {
  card: MasteryCard;
  updating: boolean;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-4">
      <h3 className="break-words font-semibold">{card.target.statement}</h3>
      {card.status === 'ready' ? (
        <>
          <p className="break-words text-muted-foreground">{card.summary}</p>
          {card.observations?.map((observation) => (
            <details
              key={observation.evidenceRef}
              className="rounded-md border bg-background px-3 py-2"
            >
              <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('mastery.evidence')} · {t(`mastery.result.${observation.result}`)}
                {observation.assistance !== 'unknown' &&
                  ` · ${t(`mastery.assistance.${observation.assistance}`)}`}
              </summary>
              <div className="mt-2 space-y-2 break-words">
                <p className="text-xs text-muted-foreground">
                  {t(`mastery.coverage.${observation.coverage}`)}
                </p>
                <p>{observation.text}</p>
                <SourceContent source={observation.source} />
              </div>
            </details>
          ))}
        </>
      ) : (
        <p className="text-muted-foreground">{t(`mastery.card.${card.status}`)}</p>
      )}
      {card.update && (
        <p className="text-xs text-muted-foreground" role="status">
          {t(`mastery.update.${card.update}`)}
        </p>
      )}
      {retry && card.update === 'failed' && (
        <Button type="button" size="sm" variant="outline" disabled={updating} onClick={retry}>
          {t('mastery.update.retry')}
        </Button>
      )}
    </article>
  );
}

export function MasteryPanel({ stageId }: { stageId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<PanelState>({ status: 'loading' });
  const [updating, setUpdating] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<'queued' | 'unchanged' | 'disabled' | 'error'>();
  const endpoint = `/api/learner-mastery/${encodeURIComponent(stageId)}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (!controller.signal.aborted) setView({ status: 'empty' });
          return;
        }
        if (!response.ok) throw new Error('Mastery read failed');
        const data = (await response.json()) as ClassroomMastery;
        if (!controller.signal.aborted) setView({ status: 'ready', data });
      } catch {
        if (!controller.signal.aborted) setView({ status: 'error' });
        return;
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 6_000);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, refresh, endpoint]);

  async function requestUpdate(target?: Pick<MasteryCard['target'], 'id' | 'revision'>) {
    setUpdating(true);
    setUpdateNotice(undefined);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Mastery update request failed');
      const { status } = await response.json();
      if (status !== 'queued' && status !== 'unchanged' && status !== 'disabled')
        throw new Error('Unexpected mastery update status');
      setUpdateNotice(status);
      setRefresh((previous) => previous + 1);
    } catch {
      setUpdateNotice('error');
    } finally {
      setUpdating(false);
    }
  }

  const canUpdate = view.status === 'ready' && view.data.canUpdate;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setView({ status: 'loading' });
          setUpdateNotice(undefined);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          title={t('mastery.title')}
          aria-label={t('mastery.title')}
          data-mastery-controls
        >
          <Target className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">{t('mastery.title')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        data-mastery-controls
        className="max-h-[85dvh] max-w-[min(40rem,calc(100vw-2rem))] gap-4 overflow-y-auto p-4 sm:p-6"
      >
        <DialogHeader className="pr-9">
          <DialogTitle className="text-lg">{t('mastery.title')}</DialogTitle>
          <DialogDescription>{t('mastery.description')}</DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 right-3"
            aria-label={t('common.close')}
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>
        {view.status === 'ready' ? (
          <div className="min-w-0 space-y-3">
            {view.data.courseObjective && (
              <p className="break-words font-medium">{view.data.courseObjective}</p>
            )}
            {view.data.cards.map((card) => (
              <TargetCard
                card={card}
                key={`${card.target.id}:${card.target.revision}`}
                updating={updating}
                retry={
                  canUpdate
                    ? () => requestUpdate({ id: card.target.id, revision: card.target.revision })
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <p role="status" className="text-muted-foreground">
            {view.status === 'loading' ? t('common.loading') : t(`mastery.${view.status}`)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canUpdate && (
            <Button type="button" size="sm" disabled={updating} onClick={() => requestUpdate()}>
              {t('mastery.update.manual')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={view.status === 'loading'}
            onClick={() => {
              if (view.status === 'error') setView({ status: 'loading' });
              setRefresh((previous) => previous + 1);
            }}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {view.status === 'error' ? t('common.retry') : t('mastery.refresh')}
          </Button>
        </div>
        {(updating || updateNotice) && (
          <p
            className={
              updateNotice === 'error'
                ? 'text-sm text-destructive'
                : 'text-sm text-muted-foreground'
            }
            role={updateNotice === 'error' ? 'alert' : 'status'}
          >
            {t(`mastery.update.${updating ? 'submitting' : updateNotice}`)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
