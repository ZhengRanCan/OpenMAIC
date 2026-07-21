import { FUSION_CONTRACT_VERSION, type StudentProfile } from './contracts';
import { FusionProviderError, type FusionProfileProvider, type StudentProfileRequest } from './provider';

export interface DeepTutorProviderOptions {
  /** Example: http://localhost:8001. This is server-only deployment configuration. */
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseProfile(value: unknown): StudentProfile {
  const candidate = isRecord(value) && isRecord(value.profile) ? value.profile : value;
  if (!isRecord(candidate) || typeof candidate.learnerId !== 'string') {
    throw new FusionProviderError('DeepTutor returned no valid student profile.', 'invalid_response');
  }

  const knowledgeState = Array.isArray(candidate.knowledgeState)
    ? candidate.knowledgeState.flatMap((item) => {
        if (!isRecord(item) || typeof item.knowledgePointId !== 'string' || typeof item.name !== 'string') {
          return [];
        }
        const mastery = typeof item.mastery === 'number' ? Math.max(0, Math.min(1, item.mastery)) : 0;
        return [
          {
            knowledgePointId: item.knowledgePointId,
            name: item.name,
            mastery,
            ...(Array.isArray(item.evidence) ? { evidence: asStringArray(item.evidence) } : {}),
          },
        ];
      })
    : [];

  if (knowledgeState.length === 0) {
    throw new FusionProviderError('DeepTutor profile is missing knowledgeState.', 'invalid_response');
  }

  const preferences = isRecord(candidate.learningPreferences) ? candidate.learningPreferences : {};
  const recentMisconceptions = Array.isArray(candidate.recentMisconceptions)
    ? candidate.recentMisconceptions.flatMap((item) => {
        if (!isRecord(item) || typeof item.knowledgePoint !== 'string' || typeof item.description !== 'string') {
          return [];
        }
        const errorType = item.errorType;
        if (!['structural', 'deviation', 'application', 'metacognitive'].includes(String(errorType))) {
          return [];
        }
        return [
          {
            ...(typeof item.knowledgePointId === 'string' ? { knowledgePointId: item.knowledgePointId } : {}),
            knowledgePoint: item.knowledgePoint,
            errorType: errorType as StudentProfile['recentMisconceptions'][number]['errorType'],
            description: item.description,
          },
        ];
      })
    : [];

  return {
    contractVersion: FUSION_CONTRACT_VERSION,
    learnerId: candidate.learnerId,
    ...(typeof candidate.displayName === 'string' ? { displayName: candidate.displayName } : {}),
    source: 'deeptutor',
    knowledgeState,
    strengths: asStringArray(candidate.strengths),
    weakPoints: asStringArray(candidate.weakPoints),
    learningPreferences: {
      ...(Array.isArray(preferences.preferredExamples)
        ? { preferredExamples: asStringArray(preferences.preferredExamples) }
        : {}),
      ...(Array.isArray(preferences.preferredRepresentations)
        ? {
            preferredRepresentations: preferences.preferredRepresentations.filter(
              (item): item is 'visual' | 'concrete' | 'formula' | 'step_by_step' =>
                ['visual', 'concrete', 'formula', 'step_by_step'].includes(String(item)),
            ),
          }
        : {}),
      ...(preferences.pace === 'slow' || preferences.pace === 'standard' || preferences.pace === 'fast'
        ? { pace: preferences.pace }
        : {}),
    },
    recentMisconceptions,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
}

/** Server-side provider for the future stable DeepTutor profile endpoint. */
export class DeepTutorFusionProfileProvider implements FusionProfileProvider {
  readonly id = 'deeptutor';
  private readonly baseUrl: string | null;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: DeepTutorProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.DEEPTUTOR_BASE_URL);
    this.apiKey = options.apiKey ?? process.env.DEEPTUTOR_API_KEY;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getStudentProfile(request: StudentProfileRequest): Promise<StudentProfile> {
    if (!this.baseUrl) {
      throw new FusionProviderError('DeepTutor is not configured.', 'not_configured');
    }

    const endpoint = new URL(
      `/api/v1/fusion/students/${encodeURIComponent(request.learnerId)}/profile`,
      this.baseUrl,
    );
    endpoint.searchParams.set('topic', request.topic);
    if (request.subject) endpoint.searchParams.set('subject', request.subject);

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal: request.signal,
      });
    } catch (error) {
      throw new FusionProviderError('Unable to reach DeepTutor.', 'upstream_error', error);
    }

    if (response.status === 404) {
      throw new FusionProviderError(`Learner ${request.learnerId} was not found in DeepTutor.`, 'not_found');
    }
    if (!response.ok) {
      throw new FusionProviderError(`DeepTutor profile request failed with HTTP ${response.status}.`, 'upstream_error');
    }

    try {
      return parseProfile(await response.json());
    } catch (error) {
      if (error instanceof FusionProviderError) throw error;
      throw new FusionProviderError('DeepTutor returned invalid JSON.', 'invalid_response', error);
    }
  }
}
