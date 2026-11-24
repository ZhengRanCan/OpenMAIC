'use client';

import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from 'lucide-react';
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
import { cn } from '@/lib/utils';

type Course = { id: string; name: string };
type DragPreview = { from: number; slot: number | null };
type ActiveDrag = DragPreview & { pointerId: number; x: number; y: number; frame: number };

function insideList(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function insertionSlot(list: HTMLOListElement, y: number) {
  for (const [index, row] of Array.from(list.children).entries()) {
    const { top, height } = row.getBoundingClientRect();
    if (y < top + height / 2) return index;
  }
  return list.children.length;
}

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
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<ActiveDrag | null>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const changed = draft.some((course, index) => course.id !== original[index]?.id);
  const locked = pending || conflict || dragPreview !== null;

  useEffect(() => {
    return () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    };
  }, []);

  useLayoutEffect(() => {
    moveButton.current?.focus();
    moveButton.current = null;
  }, [draft]);

  function onOpenChange(next: boolean) {
    if (pending) return;
    clearDrag();
    if (next) {
      setOriginal(courses);
      setDraft(courses);
      setConflict(false);
      setFailed(false);
      setAnnouncement('');
    }
    setOpen(next);
  }

  function move(from: number, to: number, button?: HTMLButtonElement) {
    if (pending || conflict || drag.current || from === to || to < 0 || to >= draft.length) return;
    const reordered = [...draft];
    const [course] = reordered.splice(from, 1);
    reordered.splice(to, 0, course);
    moveButton.current = button ?? null;
    setDraft(reordered);
    setAnnouncement(t('classroom.folderOrderMoved', { name: course.name, position: to + 1 }));
  }

  function clearDrag() {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setDragPreview(null);
  }

  function trackDrag() {
    const active = drag.current;
    const element = list.current;
    if (!active || !element) return;

    const rect = element.getBoundingClientRect();
    let slot = null;
    if (insideList(rect, active.x, active.y)) {
      const edge = Math.min(32, rect.height / 3);
      if (active.y < rect.top + edge) element.scrollTop -= 12;
      if (active.y > rect.bottom - edge) element.scrollTop += 12;
      const next = insertionSlot(element, active.y);
      if (next !== active.from && next !== active.from + 1) slot = next;
    }
    if (slot !== active.slot) {
      active.slot = slot;
      setDragPreview({ from: active.from, slot });
    }
    active.frame = requestAnimationFrame(trackDrag);
  }

  function startDrag(event: PointerEvent<HTMLSpanElement>, from: number) {
    if (locked || drag.current || draft.length < 2 || !event.isPrimary || event.button !== 0)
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      from,
      slot: null,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      frame: requestAnimationFrame(trackDrag),
    };
    setDragPreview({ from, slot: null });
  }

  function movePointer(event: PointerEvent<HTMLOListElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
  }

  function endDrag(event: PointerEvent<HTMLOListElement>, drop: boolean) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    clearDrag();
    if (drop && insideList(element.getBoundingClientRect(), event.clientX, event.clientY)) {
      const slot = insertionSlot(element, event.clientY);
      move(active.from, slot > active.from ? slot - 1 : slot);
    }
  }

  async function save() {
    if (pending || conflict || drag.current || !changed) return;
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
          <ol
            ref={list}
            className="max-h-[50vh] space-y-2 overflow-auto px-1 py-1"
            onPointerMove={movePointer}
            onPointerUp={(event) => endDrag(event, true)}
            onPointerCancel={(event) => endDrag(event, false)}
            onLostPointerCapture={(event) => endDrag(event, false)}
          >
            {draft.map((course, index) => (
              <li
                key={course.id}
                className={cn(
                  'relative flex items-center gap-2 rounded-lg border px-2 py-2',
                  dragPreview?.from === index && 'bg-muted text-muted-foreground',
                  dragPreview?.slot === index &&
                    'before:absolute before:inset-x-0 before:-top-[5px] before:h-0.5 before:rounded before:bg-primary',
                  dragPreview?.slot === draft.length &&
                    index === draft.length - 1 &&
                    'after:absolute after:inset-x-0 after:-bottom-[5px] after:h-0.5 after:rounded after:bg-primary',
                )}
              >
                {draft.length > 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground',
                      pending || conflict
                        ? 'opacity-35'
                        : 'cursor-grab hover:bg-muted active:cursor-grabbing',
                    )}
                    onPointerDown={(event) => startDrag(event, index)}
                  >
                    <GripVertical className="size-4" />
                  </span>
                )}
                <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 break-words text-sm">{course.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('classroom.folderOrderUp', { name: course.name })}
                  aria-disabled={locked || index === 0}
                  className="aria-disabled:opacity-35"
                  onClick={(event) => move(index, index - 1, event.currentTarget)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('classroom.folderOrderDown', { name: course.name })}
                  aria-disabled={locked || index === draft.length - 1}
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
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {conflict ? (
            <Button disabled={pending} onClick={reloadOrder}>
              {t('classroom.folderOrderReload')}
            </Button>
          ) : (
            <Button disabled={locked || !changed} onClick={save}>
              {t(pending ? 'classroom.folderOrderSaving' : 'classroom.folderOrderSave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
