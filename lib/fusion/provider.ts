import type { LessonDescriptor, StudentProfile } from './contracts';

export interface StudentProfileRequest extends LessonDescriptor {
  learnerId: string;
  signal?: AbortSignal;
}

/**
 * Source boundary for learner data. Providers return the shared semantic
 * contract, never their own persistence or implementation details.
 */
export interface FusionProfileProvider {
  readonly id: string;
  getStudentProfile(request: StudentProfileRequest): Promise<StudentProfile>;
}

export class FusionProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'not_found' | 'upstream_error' | 'invalid_response',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FusionProviderError';
  }
}
