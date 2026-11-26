import { callLLM } from '@/lib/ai/llm';
import { resolveEvalModel } from '../shared/resolve-model';
import type { CallRecord, CallRequest, Config, Invoker } from './contracts';
import { safeError } from './contracts';

export async function createInvoker(config: Config): Promise<Invoker> {
  if (config.mode === 'fixture')
    return async (request) => ({
      text: request.fixtureReply,
      model: 'fixture-protocol-only',
      inputTokens: null,
      outputTokens: null,
      finishReason: 'stop',
    });
  const resolved = await resolveEvalModel('F113_MODEL', config.model);
  if (resolved.modelString !== config.model) throw new Error('MODEL_CONFIGURATION_MISMATCH');
  return async (request, signal) => {
    const result = await callLLM(
      {
        model: resolved.model,
        system: request.system,
        prompt: request.user,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        maxRetries: 0,
        abortSignal: signal,
      },
      'f113-offline-evaluation',
      undefined,
      { mode: 'disabled', enabled: false },
      { enabled: false },
    );
    return {
      text: result.text,
      model: resolved.modelString,
      inputTokens: result.totalUsage?.inputTokens ?? null,
      outputTokens: result.totalUsage?.outputTokens ?? null,
      finishReason: result.finishReason,
    };
  };
}

export class ModelSession {
  readonly calls: CallRecord[] = [];
  context: { learnerId?: string; method?: CallRecord['method']; questionId?: string } = {};
  constructor(
    readonly config: Config,
    private invoke: Invoker,
    private capture: (record: CallRecord) => void = () => {},
  ) {}
  async call(request: CallRequest): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      if (this.calls.length >= this.config.maxCalls) throw new Error('CALL_BUDGET_EXHAUSTED');
      const record: CallRecord = {
        ...this.context,
        index: this.calls.length + 1,
        stage: request.stage,
        system: request.system,
        user: request.user,
        model: this.config.mode === 'fixture' ? 'fixture-protocol-only' : this.config.model!,
        inputTokens: null,
        outputTokens: null,
        durationMs: 0,
      };
      this.calls.push(record);
      // Persist dispatch first. A crash leaves an explicit unknown outcome.
      this.capture({ ...record, error: 'CALL_DISPATCHED_OUTCOME_UNKNOWN' });
      const started = Date.now(),
        controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const reply = await Promise.race([
          this.invoke(request, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('CALL_TIMEOUT'));
            }, this.config.timeoutMs);
          }),
        ]);
        if (reply.model !== record.model) throw new Error('MODEL_CONFIGURATION_MISMATCH');
        Object.assign(record, reply, { durationMs: Date.now() - started });
        if (Buffer.byteLength(reply.text, 'utf8') > 64000) throw new Error('REPLY_LIMIT');
        if (reply.finishReason !== 'stop') throw new Error('INCOMPLETE_MODEL_OUTPUT');
        this.capture({ ...record });
        return reply.text;
      } catch (error) {
        record.error = safeError(error);
        record.durationMs = Date.now() - started;
        this.capture({ ...record });
        // An aborted call may have been billed. Do not replay unknown outcomes automatically.
        if (
          attempt >= this.config.maxRetries ||
          record.error === 'CALL_TIMEOUT' ||
          record.error === 'MODEL_CONFIGURATION_MISMATCH'
        )
          throw new Error(record.error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}
