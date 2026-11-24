import { useI18n } from '@/lib/hooks/use-i18n';
import {
  profileOutlineRecordForUse,
  type ProfileOutlineMemoryPreview,
} from '@/lib/learner-context/profile-outline-memory';

export function ProfileOutlineMemorySummary({ memory }: { memory: ProfileOutlineMemoryPreview }) {
  const { t } = useI18n();
  const selected = memory.selected.map(profileOutlineRecordForUse).filter(({ text }) => text);
  return (
    <div className="min-w-0 rounded-md border border-muted bg-muted/30 px-4 py-3 text-left text-sm [overflow-wrap:anywhere]">
      <p>{t('generation.interactiveMemoryCount', { count: selected.length })}</p>
      {!selected.length ? (
        <p className="mt-1 text-muted-foreground">{t('generation.interactiveMemoryEmpty')}</p>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('generation.learnerContextViewSelection')}
          </summary>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
            {selected.map((record, index) => {
              const conditions = new Set(
                record.conditions.flatMap(({ help, review }) => [
                  ...(review ? [t(`profileMemory.review.${review}`)] : []),
                  ...(help === 'prior-teacher-messages'
                    ? [t('generation.interactiveMemoryEarlierTeaching')]
                    : help
                      ? [t(`profileMemory.help.${help}`)]
                      : []),
                ]),
              );
              return (
                <li key={index}>
                  <p className="text-xs">
                    {t(`profileMemory.sections.${record.section}`)} ·{' '}
                    {record.source === 'user'
                      ? t('profileMemory.personal')
                      : t(`profileMemory.kind.${record.source}`)}
                  </p>
                  <p>{record.text}</p>
                  {[...conditions].map((condition) => (
                    <p key={condition} className="mt-1 text-xs">
                      {condition}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
