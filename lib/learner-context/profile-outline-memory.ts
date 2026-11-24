import type { LearnerProfileSelection } from './learner-profile-contracts';
import { omitUnknownHelpFromExperience } from '@/lib/learner-memory/profile-memory-content';
import type {
  ProfileMemoryKind,
  ProfileMemorySection,
  ProfileMemorySource,
} from '@/lib/learner-memory/profile-memory-contracts';

export function outlineLearnerProfileId(input: {
  taskEngine?: boolean;
  learnerProfileSelection?: LearnerProfileSelection;
}) {
  return !input.taskEngine && input.learnerProfileSelection?.mode === 'existing'
    ? input.learnerProfileSelection.profileId
    : undefined;
}

type SourcePart = ProfileMemorySource['parts'][number];
export type OutlineMemoryRecord = {
  text: string;
  section: ProfileMemorySection;
  source: 'user' | ProfileMemoryKind;
  conditions: Partial<Pick<SourcePart, 'help' | 'review'>>[];
};
export type ProfileOutlineCandidate = OutlineMemoryRecord & { key: string };
export type ProfileOutlineMemory = {
  profileId: string;
  selected: ProfileOutlineCandidate[];
};
export type ProfileOutlineMemoryPreview = {
  selected: OutlineMemoryRecord[];
};

export function profileOutlineRecordForUse({
  text,
  section,
  source,
  conditions,
}: OutlineMemoryRecord): OutlineMemoryRecord {
  return {
    text:
      source !== 'user' && section === 'experiences' ? omitUnknownHelpFromExperience(text) : text,
    section,
    source,
    conditions: conditions
      .map(({ help, review }) => ({
        ...(help && help !== 'unknown' ? { help } : {}),
        ...(review ? { review } : {}),
      }))
      .filter(({ help, review }) => help || review),
  };
}

export function projectProfileOutlineMemory(
  memory: ProfileOutlineMemory,
): ProfileOutlineMemoryPreview {
  return {
    selected: memory.selected.map(profileOutlineRecordForUse).filter(({ text }) => text),
  };
}
