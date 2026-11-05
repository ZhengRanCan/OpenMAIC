import type { DialogueLoopJob } from '@/lib/dialogue/learning-loop-contracts';
import { LEGACY_DIALOGUE_PROMPT_VERSION } from '@/lib/dialogue/evidence-contracts';
import { DialogueLoopError } from '@/lib/dialogue/learning-loop-contracts';
import { DIALOGUE_MEMORY_SYSTEM } from '@/lib/learner-memory/dialogue-prompt';
import { SimulatedMemoryEnvironment } from '@/lib/learner-memory/simulated-environment';
import { simulatedScope } from '@/lib/learner-memory/simulated-seeds';
import { DialogueEvidenceStore } from '@/lib/persistence/dialogue-evidence-store';
import { readDialogueEvidenceRun } from '@/lib/persistence/dialogue-evidence-read';
import { openSimulatedMemory } from '../simulated-memory';
import { resolveModel } from '../resolve-model';
import { dialogueModelIdentity, invokeDialogueModel } from '../dialogue-evidence';
import {
  dialogueMemoryModelIdentity,
  invokeDialogueMemoryModel,
  checkDialogueMemoryModelCapacity,
} from '../dialogue-memory-model';
import { loadDialogueMemorySettings } from '../dialogue-memory-authority';
import { DialogueMemoryService } from '../dialogue-memory';
import { DialogueLoopStore, type LoopProvider } from './store';
import type { DialogueLoopDeps } from './process';
import { readDialogueLoopConfig, type DialogueLoopConfig } from './config';
import { digest } from '@/lib/learner-memory/contracts';
export async function withDialogueLoopDeps<T>(
  job: DialogueLoopJob,
  app: LoopProvider,
  config: DialogueLoopConfig,
  body: (d: DialogueLoopDeps) => Promise<T>,
  isActive: () => boolean = () => true,
): Promise<T> {
  const guard = () => {
    const current = readDialogueLoopConfig();
    if (!isActive() || !current) throw new DialogueLoopError('AUTOMATIC_DISABLED');
    if (digest(current) !== digest(config)) throw new DialogueLoopError('CONFIG_CHANGED');
  };
  guard();
  const opened = await openSimulatedMemory();
  try {
    if (!job.binding) throw new DialogueLoopError('NOT_ELIGIBLE');
    await opened.memory.provider.withTransaction(async (tx) => {
      const env = await tx.query("SELECT to_regclass('f68_memory_environment') AS present");
      if (!env.rows[0]?.present) throw new DialogueLoopError('MEMORY_ENVIRONMENT_NOT_INITIALIZED');
      const id = await tx.query('SELECT id FROM f68_memory_environment WHERE singleton=true');
      if (id.rows[0]?.id !== job.binding!.memoryEnvironmentId)
        throw new DialogueLoopError('MEMORY_ENVIRONMENT_MISMATCH');
      const scope = simulatedScope(job.binding!.student);
      const state = await tx.query(
        'SELECT learner_key FROM learner_memory_states WHERE namespace=$1 AND learner_key=$2',
        [scope.namespace, scope.learnerKey],
      );
      if (!state.rows.length) throw new DialogueLoopError('SIMULATED_MEMORY_NOT_INITIALIZED');
    });
    const model = await resolveModel({ stage: 'quiz-evidence', workspaceId: job.ownerId });
    const memory = new SimulatedMemoryEnvironment({
      ...opened.memory.provider,
      systemPrompt: DIALOGUE_MEMORY_SYSTEM,
    });
    const d: DialogueLoopDeps = {
      jobs: new DialogueLoopStore(app),
      evidence: new DialogueEvidenceStore(app),
      memory: new DialogueMemoryService(app, memory, loadDialogueMemorySettings),
      config,
      settings: loadDialogueMemorySettings,
      evidenceModel: dialogueModelIdentity(
        model,
        job.evidencePromptVersion ?? LEGACY_DIALOGUE_PROMPT_VERSION,
      ),
      memoryModel: dialogueMemoryModelIdentity(model),
      readEvidence: (owner, id) => readDialogueEvidenceRun(app, owner, id),
      invokeEvidence: (run) => {
        guard();
        return invokeDialogueModel(model, run);
      },
      invokeMemory: (run) => {
        guard();
        return invokeDialogueMemoryModel(model, run);
      },
      checkEvidence: (run) => {
        guard();
        const bytes = Buffer.byteLength(run.system) + (run.context?.inputBytes ?? 0);
        if (
          !run.context ||
          run.context.tooLarge ||
          !Number.isFinite(model.modelInfo?.contextWindow) ||
          model.modelInfo!.contextWindow! < bytes + 4096 + 1024
        )
          throw new DialogueLoopError('MODEL_CONTEXT_CAPACITY');
        if (model.modelInfo?.outputWindow !== undefined && model.modelInfo.outputWindow < 4096)
          throw new DialogueLoopError('MODEL_OUTPUT_CAPACITY');
      },
      checkMemory: (run) => {
        guard();
        checkDialogueMemoryModelCapacity(model, run);
      },
    };
    return await body(d);
  } finally {
    await opened.close();
  }
}
