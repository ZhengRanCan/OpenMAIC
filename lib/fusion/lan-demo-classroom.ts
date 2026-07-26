import { FUSION_DEMO_TOPIC } from './topic';

/**
 * F21's presentation route is deliberately frozen and provider-free. It is
 * not a learner record, classroom export, or generated lesson.
 */
export const LAN_DEMO_CLASSROOM = {
  schemaVersion: 'v1',
  demoStudent: 'a',
  topic: FUSION_DEMO_TOPIC,
  synthetic: true,
  scenes: [
    { id: 'warmup', titleKey: 'lanDemo.scenes.warmup.title', bodyKey: 'lanDemo.scenes.warmup.body' },
    { id: 'graph', titleKey: 'lanDemo.scenes.graph.title', bodyKey: 'lanDemo.scenes.graph.body' },
    { id: 'checkpoint', titleKey: 'lanDemo.scenes.checkpoint.title', bodyKey: 'lanDemo.scenes.checkpoint.body' },
    { id: 'summary', titleKey: 'lanDemo.scenes.summary.title', bodyKey: 'lanDemo.scenes.summary.body' },
  ],
} as const;
