'use client';

import { LAN_DEMO_CLASSROOM } from '@/lib/fusion/lan-demo-classroom';
import { useI18n } from '@/lib/hooks/use-i18n';

/** A standalone, read-only classroom that works with an empty browser profile. */
export default function LanDemoPage() {
  const { t } = useI18n();

  return (
    <main className="min-h-[100dvh] bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="rounded-3xl border border-violet-400/30 bg-slate-900 p-6 shadow-2xl shadow-violet-950/30 sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-300">
            {t('lanDemo.eyebrow')}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
            {t('lanDemo.title', { topic: LAN_DEMO_CLASSROOM.topic })}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            {t('lanDemo.description')}
          </p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-800/80 p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t('lanDemo.studentLabel')}
              </dt>
              <dd className="mt-1 font-medium text-white">{t('lanDemo.studentA')}</dd>
            </div>
            <div className="rounded-2xl bg-slate-800/80 p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t('lanDemo.modeLabel')}
              </dt>
              <dd className="mt-1 font-medium text-white">{t('lanDemo.readOnly')}</dd>
            </div>
          </dl>
        </header>

        <section className="mt-8" aria-labelledby="lan-demo-scenes">
          <h2 id="lan-demo-scenes" className="text-xl font-semibold">
            {t('lanDemo.lessonFlow')}
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {LAN_DEMO_CLASSROOM.scenes.map((scene, index) => (
              <li key={scene.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
                <p className="text-sm font-medium text-violet-300">
                  {t('lanDemo.step', { number: index + 1 })}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">{t(scene.titleKey)}</h3>
                <p className="mt-2 leading-7 text-slate-300">{t(scene.bodyKey)}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-8 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100" role="note">
          {t('lanDemo.safetyNotice')}
        </p>
      </div>
    </main>
  );
}
