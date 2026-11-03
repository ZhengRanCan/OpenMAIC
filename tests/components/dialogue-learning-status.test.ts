// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
import { DialogueLearningStatus } from '@/components/chat/dialogue-learning-status';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const response = (job: unknown) => ({ status: 200, ok: true, json: async () => ({ job }) });
const job = {
  id: 'job',
  stageId: 's',
  chatSessionId: 'c',
  state: 'completed',
  evidenceState: 'completed',
  memoryState: 'completed',
  reason: null,
};
it('shows Evidence and Memory separately and legal empty without adoption claims', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...job, memoryState: 'empty' })));
  await act(async () =>
    root.render(createElement(DialogueLearningStatus, { stageId: 's', chatSessionId: 'c' })),
  );
  expect(container.textContent).toContain('chat.learning.evidence');
  expect(container.textContent).toContain('chat.learning.phaseEmpty');
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});
it('cancelled unknown confirmation sends no POST; accepting sends both cost flags for the Memory stage', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(response({ ...job, state: 'unknown', memoryState: 'unknown' }));
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () =>
    root.render(createElement(DialogueLearningStatus, { stageId: 's', chatSessionId: 'c' })),
  );
  const retry = Array.from(container.querySelectorAll('button')).find(
    (x) => x.textContent === 'chat.learning.retry',
  )!;
  await act(async () => retry.click());
  expect(fetcher).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  await act(async () => retry.click());
  const post = fetcher.mock.calls.find((c) => c[1]?.method === 'POST')!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    action: 'retry_memory',
    acknowledgeAdditionalCall: true,
    acknowledgeUnknownCost: true,
  });
});
it('ignores a stale status reply when the visible Session changes', async () => {
  let finish!: (value: unknown) => void;
  const slow = new Promise((resolve) => {
    finish = resolve;
  });
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(slow)
    .mockResolvedValue(response({ ...job, chatSessionId: 'new', state: 'not_eligible' }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(createElement(DialogueLearningStatus, { stageId: 's', chatSessionId: 'old' })),
  );
  await act(async () =>
    root.render(createElement(DialogueLearningStatus, { stageId: 's', chatSessionId: 'new' })),
  );
  await act(async () => finish(response({ ...job, state: 'unknown' })));
  expect(container.textContent).toContain('chat.learning.not_eligible');
  expect(container.textContent).not.toContain('chat.learning.unknown');
});
it('offers explicit Evidence retry for a crashed stage projected as unknown', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      response({ ...job, state: 'unknown', evidenceState: 'unknown', memoryState: 'pending' }),
    );
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () =>
    root.render(createElement(DialogueLearningStatus, { stageId: 's', chatSessionId: 'c' })),
  );
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'chat.learning.retry')!
      .click(),
  );
  const post = fetcher.mock.calls.find((c) => c[1]?.method === 'POST')!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    action: 'retry_evidence',
    acknowledgeAdditionalCall: true,
    acknowledgeUnknownCost: true,
  });
});
