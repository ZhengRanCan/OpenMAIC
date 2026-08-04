export type FusionCapability =
  | 'profile-read'
  | 'preclass-context-read'
  | 'diagnosis'
  | 'classroom-event-write'
  | 'profile-update-submit';
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class CapabilityCircuitBreakers {
  private readonly states = new Map<FusionCapability, { failures: number; openUntil?: number }>();
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1 || options.cooldownMs < 1)
      throw new Error('Circuit breaker policy must be positive');
    this.now = options.now ?? Date.now;
  }

  state(capability: FusionCapability): CircuitState {
    const state = this.states.get(capability);
    if (!state?.openUntil) return 'closed';
    return state.openUntil > this.now() ? 'open' : 'half_open';
  }

  async run<T>(capability: FusionCapability, operation: () => Promise<T>): Promise<T> {
    if (this.state(capability) === 'open') throw new Error(`${capability}_circuit_open`);
    try {
      const result = await operation();
      this.states.set(capability, { failures: 0 });
      return result;
    } catch (error) {
      const failures = (this.states.get(capability)?.failures ?? 0) + 1;
      this.states.set(capability, {
        failures,
        ...(failures >= this.options.failureThreshold
          ? { openUntil: this.now() + this.options.cooldownMs }
          : {}),
      });
      throw error;
    }
  }
}
