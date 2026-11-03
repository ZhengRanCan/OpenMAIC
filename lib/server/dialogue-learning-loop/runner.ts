import { readDialogueLoopConfig } from './config';
import { activateDialogueLoop } from './registration';
import { DialogueLoopStore } from './store';
import { discoverClosedDialogues } from './discovery';
import { processDialogueJob } from './process';
import { withDialogueLoopDeps } from './adapter';
import { digest } from '@/lib/learner-memory/contracts';
export interface DialogueRunnerOptions {
  activate(): Promise<void>;
  tick(): Promise<void>;
  intervalMs?: number;
}
export async function startDialogueLearningLoop(options?: DialogueRunnerOptions) {
  let draining = false;
  if (!options) {
    const config = readDialogueLoopConfig();
    if (!config) return undefined;
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const app = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const jobs = new DialogueLoopStore(app);
    options = {
      activate: () => activateDialogueLoop(app, config),
      tick: async () => {
        const current = readDialogueLoopConfig();
        if (!current || digest(current) !== digest(config)) return;
        await discoverClosedDialogues(app, config);
        const job = await jobs.claim();
        if (!job) return;
        try {
          await withDialogueLoopDeps(
            job,
            app,
            config,
            (d) => processDialogueJob(job, d),
            () => !draining,
          );
        } catch {
          job.state = 'blocked';
          job.reason = 'CONFIGURATION_OR_DEPENDENCY_UNAVAILABLE';
          try {
            await jobs.checkpoint(job);
          } catch {
            /*lease/revocation wins*/
          }
        }
      },
    };
  }
  await options.activate();
  let stopped = false,
    pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) return;
    pending = options!
      .tick()
      .catch(() => {
        console.error('[dialogue-learning-loop] tick failed');
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, options.intervalMs ?? 10_000);
  timer.unref?.();
  return {
    stop: async () => {
      draining = true;
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
