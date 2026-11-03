import { describe, it, expect, vi } from 'vitest';
import { startDialogueLearningLoop } from '@/lib/server/dialogue-learning-loop/runner';
describe('automatic dialogue startup', () => {
  it('does not scan before the persistent activation baseline commits', async () => {
    let release!: () => void;
    const activation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tick = vi.fn(async () => {});
    let ready = false;
    const starting = startDialogueLearningLoop({
      activate: () => activation,
      tick,
      intervalMs: 5,
    }).then((r) => {
      ready = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
    expect(tick).not.toHaveBeenCalled();
    release();
    const runner = await starting;
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    await runner!.stop();
    const count = tick.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(tick).toHaveBeenCalledTimes(count);
  });
});
