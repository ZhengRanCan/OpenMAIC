// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { QuizLearningStatus } from '@/components/scene-renderers/quiz-learning-status';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
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

describe('Quiz learning memory status', () => {
  it('shows successful processing independently from the score', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ job: { state: 'completed' } }),
        }),
    );
    await act(async () => {
      root.render(createElement(QuizLearningStatus, { attemptId: 'a' }));
    });
    expect(container.textContent).toContain('quiz.learningCompleted');
  });
  it('requires confirmation before retrying an unknown model call', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ job: { state: 'unknown' } }),
      });
    vi.stubGlobal('fetch', fetcher);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      root.render(createElement(QuizLearningStatus, { attemptId: 'a' }));
    });
    const button = container.querySelector('button')!;
    await act(async () => button.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    await act(async () => button.click());
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: '{"action":"retry","confirmUnknown":true}',
    });
  });
});
