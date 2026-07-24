import {
  type ClassroomEvent,
  type LearningDiagnosis,
  parseClassroomEvent,
  parseLearningDiagnosis,
  serializeClassroomContract,
} from '../contracts';

export const DEVELOPMENT_MOCK_LEARNER_ID = 'development-mock-learner' as const;
export const DEVELOPMENT_MOCK_KNOWLEDGE_POINT_ID = 'lesson-linear-function-slope' as const;

export interface ClassroomDiagnosisPort {
  diagnose(event: ClassroomEvent): Promise<unknown>;
}

/** Server-only transport for the F08 Development Only endpoint. */
export function createF08DiagnosisPort(fetchFn: typeof fetch = fetch): ClassroomDiagnosisPort {
  const baseUrl = process.env.DEEPTUTOR_FUSION_BASE_URL;
  return {
    async diagnose(event) {
      if (!baseUrl) throw new DevelopmentOnlyConfigurationError('DeepTutor Fusion transport is not configured.');
      const response = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/api/v1/fusion/diagnosis`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
      });
      if (!response.ok) throw new Error('Fusion diagnosis is unavailable.');
      return response.json();
    },
  };
}

export interface DevelopmentOnlyAdapterConfiguration {
  environment: string | undefined;
  developmentMockEnabled: boolean;
}

export class DevelopmentOnlyConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'DevelopmentOnlyConfigurationError'; }
}

function assertDevelopmentOnly(configuration: DevelopmentOnlyAdapterConfiguration): void {
  if (!configuration.developmentMockEnabled) throw new DevelopmentOnlyConfigurationError('Development classroom mock is disabled.');
  if (configuration.environment !== 'development' && configuration.environment !== 'test') throw new DevelopmentOnlyConfigurationError('Development classroom mock is unavailable outside development or test.');
}

/**
 * Server-side, transport-agnostic Facade. Browser inputs cannot choose a
 * learner: the sole mock identity is fixed here and only exists for F07 tests.
 */
export class ClassroomDiagnosisAdapter {
  readonly learnerId = DEVELOPMENT_MOCK_LEARNER_ID;

  constructor(configuration: DevelopmentOnlyAdapterConfiguration, private readonly diagnosisPort: ClassroomDiagnosisPort) {
    assertDevelopmentOnly(configuration);
  }

  async diagnoseCheckpoint(input: unknown): Promise<LearningDiagnosis> {
    const event = parseClassroomEvent(input);
    // Serialize before invoking the port so a future transport has the exact JSON boundary.
    const response = await this.diagnosisPort.diagnose(JSON.parse(serializeClassroomContract(event)) as ClassroomEvent);
    const diagnosis = parseLearningDiagnosis(response);
    if (diagnosis.eventId !== event.eventId) throw new Error('Diagnosis eventId does not match the submitted event.');
    return diagnosis;
  }
}
