'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/hooks/use-i18n';
import { saveFolderMemberOrder } from '@/lib/utils/stage-storage';

type Course = { id: string; name: string };

export function FolderOrderDialog({
  folderId,
  courses,
  onSaved,
  reload,
}: {
  folderId: string;
  courses: Course[];
  onSaved: (ids: string[]) => void;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<Course[]>([]);
  const [draft, setDraft] = useState<Course[]>([]);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const moveButton = useRef<HTMLButtonElement>(null);
  const changed = draft.some((course, index) => course.id !== original[index]?.id);

  useLayoutEffect(() => {
    moveButton.current?.focus();
    moveButton.current = null;
  }, [draft]);

  function onOpenChange(next: boolean) {
    if (pending) return;
    if (next) {
      setOriginal(courses);
      setDraft(courses);
      setConflict(false);
      setFailed(false);
      setAnnouncement('');
    }
    setOpen(next);
  }

  function move(from: number, to: number, button: HTMLButtonElement) {
    if (pending || conflict || to < 0 || to >= draft.length) return;
    const reordered = [...draft];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    moveButton.current = button;
    setDraft(reordered);
    setAnnouncement(
      t('classroom.folderOrderMoved', { name: reordered[to].name, position: to + 1 }),
    );
  }

  async function save() {
    if (pending || conflict || !changed) return;
    setPending(true);
    setFailed(false);
    try {
      const ids = draft.map(({ id }) => id);
      const result = await saveFolderMemberOrder(
        folderId,
        original.map(({ id }) => id),
        ids,
      );
      if (result === 'conflict') {
        setConflict(true);
        return;
      }
      onSaved(ids);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function reloadOrder() {
    setPending(true);
    setFailed(false);
    try {
      await reload();
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <ListOrdered aria-hidden="true" className="size-4" />
          {t('classroom.folderOrderTitle')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{t('classroom.folderOrderTitle')}</DialogTitle>
          <DialogDescription>
            {t(draft.length < 2 ? 'classroom.folderOrderTooFew' : 'classroom.folderOrderHint')}
          </DialogDescription>
        </DialogHeader>
        {draft.length > 0 && (
          <ol className="max-h-[50vh] space-y-2 overflow-auto px-1 py-1">
            {draft.map((course, index) => (
              <li key={course.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 break-words text-sm">{course.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('classroom.folderOrderUp', { name: course.name })}
                  aria-disabled={pending || conflict || index === 0}
                  className="aria-disabled:opacity-35"
                  onClick={(event) => move(index, index - 1, event.currentTarget)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('classroom.folderOrderDown', { name: course.name })}
                  aria-disabled={pending || conflict || index === draft.length - 1}
                  className="aria-disabled:opacity-35"
                  onClick={(event) => move(index, index + 1, event.currentTarget)}
                >
                  <ArrowDown />
                </Button>
              </li>
            ))}
          </ol>
        )}
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {(failed || conflict) && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              failed
                ? conflict
                  ? 'classroom.folderOrderReloadFailed'
                  : 'classroom.folderOrderFailed'
                : 'classroom.folderOrderConflict',
            )}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          {conflict ? (
            <Button disabled={pending} onClick={reloadOrder}>
              {t('classroom.folderOrderReload')}
            </Button>
          ) : (
            <Button disabled={pending || !changed} onClick={save}>
              {t(pending ? 'classroom.folderOrderSaving' : 'classroom.folderOrderSave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
