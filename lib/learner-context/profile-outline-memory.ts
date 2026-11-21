import type { LearnerProfileSelection } from './learner-profile-contracts';
import type {
  ProfileMemoryKind,
  ProfileMemorySection,
  ProfileMemorySource,
} from '@/lib/learner-memory/profile-memory-contracts';

export function interactiveOutlineProfileId(input: {
  interactive?: boolean;
  taskEngine?: boolean;
  learnerProfileSelection?: LearnerProfileSelection;
}) {
  return input.interactive &&
    !input.taskEngine &&
    input.learnerProfileSelection?.mode === 'existing'
    ? input.learnerProfileSelection.profileId
    : undefined;
}

type SourcePart = ProfileMemorySource['parts'][number];
export type OutlineMemoryRecord = {
  text: string;
  section: ProfileMemorySection;
  source: 'user' | ProfileMemoryKind;
  conditions: Pick<SourcePart, 'help' | 'review'>[];
};
export type ProfileOutlineCandidate = OutlineMemoryRecord & { key: string };
export type ProfileOutlineMemory = {
  profileId: string;
  selected: ProfileOutlineCandidate[];
};
export type ProfileOutlineMemoryPreview = {
  selected: OutlineMemoryRecord[];
};

export function projectProfileOutlineMemory(
  memory: ProfileOutlineMemory,
): ProfileOutlineMemoryPreview {
  return {
    selected: memory.selected.map(({ text, section, source, conditions }) => ({
      text,
      section,
      source,
      conditions,
    })),
  };
}
