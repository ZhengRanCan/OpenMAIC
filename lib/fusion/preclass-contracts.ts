import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The F40 pre-class boundary.  This module deliberately has no route, session,
 * provider, or browser dependency: F41/F42 own those integration concerns.
 */
export const PRECLASS_CONTRACT_VERSION = 'preclass-fusion-v1' as const;
export const SEMANTIC_REQUEST_DIGEST_SCHEMA = 'fusion-semantic-request-digest-v1' as const;
export const FUSION_CANONICALIZATION = 'fusion-c14n-v1' as const;

type JsonRecord = Record<string, unknown>;
export type DigestPurpose = 'semantic-request' | 'lesson-fact-set' | 'profile-update-candidate';

export class PreClassContractError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'PreClassContractError';
  }
}

export interface KnowledgeRef {
  namespace: string;
  scopeId: string;
  id: string;
}
export interface MaterialRef {
  materialId: string;
  digest: string;
  purpose: string;
}
export interface LessonSemanticRequest {
  schemaVersion: typeof PRECLASS_CONTRACT_VERSION;
  semanticRequestId: string;
  semanticRequestRevision: string;
  lessonSessionId: string;
  semanticRequestDigest: string;
  normalizedTopic: string;
  normalizedLearningObjectives: string[];
  authorizedKnowledgeScope: {
    namespace: string;
    scopeId: string;
    allowedKnowledgeRefs: KnowledgeRef[];
  };
  audienceSemantics: { audienceType: string; language: string; priorKnowledgeBand?: string };
  teachingConstraints: {
    durationMinutes?: number;
    maxSceneCount?: number;
    requiredModes?: string[];
    prohibitedModes?: string[];
  };
  requestedKnowledgeRefs: KnowledgeRef[];
  sourceMaterialRefs: MaterialRef[];
  warnings: string[];
}

export interface PreClassTeachingContextProposal {
  schemaVersion: typeof PRECLASS_CONTRACT_VERSION;
  proposalId: string;
  basedOnSemanticRequestId: string;
  basedOnSemanticRequestRevision: string;
  semanticRequestDigest: string;
  resolutionStatus: 'ready' | 'needs_clarification' | 'partial' | 'unresolved' | 'rejected';
  interpretedLessonSemantics: { normalizedTopic: string; normalizedLearningObjectives: string[] };
  lessonKnowledgeMap: { mappingId: string; mappingRevision: string; knowledgeRefs: KnowledgeRef[] };
  learnerCognitiveProjection: { projectionRevision: string; signals: string[] };
  teachingGuidance: { guidanceRevision: string; recommendedApproaches: string[] };
  sourceRevisions: string[];
  clarificationIssues: string[];
  warnings: string[];
  createdAt: string;
}

export interface SemanticResolution {
  schemaVersion: typeof PRECLASS_CONTRACT_VERSION;
  semanticRequestId: string;
  semanticRequestRevision: string;
  semanticRequestDigest: string;
  status: PreClassTeachingContextProposal['resolutionStatus'];
  reasonCode?: string;
  clarificationIssues: string[];
}

export interface FrozenLessonGenerationContext {
  schemaVersion: typeof PRECLASS_CONTRACT_VERSION;
  contextId: string;
  semanticRequest: LessonSemanticRequest;
  proposal: PreClassTeachingContextProposal;
  resolution: SemanticResolution;
  frozenAt: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw new PreClassContractError(code);
}
function requireExactFields(value: JsonRecord, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('unknown_field');
  for (const key of required) if (!(key in value)) fail('missing_required_field');
}
function nonEmpty(value: unknown, max = 512): string {
  if (typeof value !== 'string' || !value || value.length > max) return fail('invalid_string');
  return normalizedString(value);
}
function normalizedString(value: string): string {
  const normalized = value.normalize('NFC');
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      (index + 1 >= normalized.length ||
        normalized.charCodeAt(index + 1) < 0xdc00 ||
        normalized.charCodeAt(index + 1) > 0xdfff)
    )
      fail('invalid_unicode');
    if (
      code >= 0xdc00 &&
      code <= 0xdfff &&
      (index === 0 ||
        normalized.charCodeAt(index - 1) < 0xd800 ||
        normalized.charCodeAt(index - 1) > 0xdbff)
    )
      fail('invalid_unicode');
  }
  return normalized;
}
function asciiId(value: unknown): string {
  const text = nonEmpty(value, 256);
  if (!/^[\x21-\x7e]+$/.test(text)) fail('invalid_ascii_identifier');
  return text;
}
function digest(value: unknown): string {
  const text = asciiId(value);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) fail('invalid_digest');
  return text;
}
function stringArray(value: unknown, max = 128): string[] {
  if (!Array.isArray(value) || value.length > max) fail('invalid_array');
  return value.map((item) => nonEmpty(item));
}
function timestamp(value: unknown): string {
  const text = nonEmpty(value, 32);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(text))
    fail('invalid_timestamp');
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) fail('invalid_timestamp');
  if (/\.(\d{4,})(?:Z|[+-])/.test(text)) fail('timestamp_precision_unsupported');
  return date.toISOString();
}
function finiteInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    fail('unsafe_integer');
  return value;
}
function parseRef(value: unknown): KnowledgeRef {
  if (!isRecord(value)) fail('invalid_reference');
  requireExactFields(value, ['namespace', 'scopeId', 'id']);
  return {
    namespace: asciiId(value.namespace),
    scopeId: asciiId(value.scopeId),
    id: asciiId(value.id),
  };
}
function refKey(value: KnowledgeRef): string {
  return `${value.namespace}\u0000${value.scopeId}\u0000${value.id}`;
}
function setRefs(value: unknown, max = 128): KnowledgeRef[] {
  if (!Array.isArray(value) || value.length > max) fail('invalid_array');
  const result = value
    .map(parseRef)
    .sort((left, right) =>
      refKey(left) < refKey(right) ? -1 : refKey(left) > refKey(right) ? 1 : 0,
    );
  if (result.some((ref, index) => index > 0 && refKey(ref) === refKey(result[index - 1])))
    fail('duplicate_set_member');
  return result;
}
function stringSet(value: unknown, max = 128): string[] {
  const result = stringArray(value, max).map(asciiId).sort();
  if (result.some((item, index) => index > 0 && item === result[index - 1]))
    fail('duplicate_set_member');
  return result;
}
function parseMaterial(value: unknown): MaterialRef {
  if (!isRecord(value)) fail('invalid_reference');
  requireExactFields(value, ['materialId', 'digest', 'purpose']);
  return {
    materialId: asciiId(value.materialId),
    digest: digest(value.digest),
    purpose: asciiId(value.purpose),
  };
}
function materialSet(value: unknown): MaterialRef[] {
  if (!Array.isArray(value) || value.length > 64) fail('invalid_array');
  const result = value
    .map(parseMaterial)
    .sort((left, right) =>
      left.materialId < right.materialId ? -1 : left.materialId > right.materialId ? 1 : 0,
    );
  if (result.some((item, index) => index > 0 && item.materialId === result[index - 1].materialId))
    fail('duplicate_set_member');
  return result;
}

export function projectSemanticRequestForDigest(value: LessonSemanticRequest): JsonRecord {
  return {
    normalizedTopic: value.normalizedTopic,
    normalizedLearningObjectives: value.normalizedLearningObjectives,
    authorizedKnowledgeScope: value.authorizedKnowledgeScope,
    audienceSemantics: value.audienceSemantics,
    teachingConstraints: value.teachingConstraints,
    requestedKnowledgeRefs: value.requestedKnowledgeRefs,
    sourceMaterialRefs: value.sourceMaterialRefs,
  };
}

function utf16Compare(left: string, right: string): number {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference) return difference;
  }
  return left.length - right.length;
}
function normalizeForCanonical(value: unknown): unknown {
  if (typeof value === 'string') return normalizedString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_number');
    if (!Number.isSafeInteger(value) && Number.isInteger(value)) fail('unsafe_integer');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeForCanonical);
  if (!isRecord(value)) fail('canonicalization_failed');
  const normalized: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizedString(key);
    if (normalizedKey in normalized) fail('normalized_key_collision');
    normalized[normalizedKey] = normalizeForCanonical(item);
  }
  return normalized;
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const key of Object.keys(value).sort(utf16Compare)) result[key] = ordered(value[key]);
  return result;
}

export function canonicalizeDigestEnvelope(
  purpose: DigestPurpose,
  valueSchemaVersion: string,
  canonicalValue: unknown,
): Uint8Array {
  if (!['semantic-request', 'lesson-fact-set', 'profile-update-candidate'].includes(purpose))
    fail('unsupported_digest_purpose');
  if (!/^fusion-[a-z0-9-]+-digest-v1$/.test(valueSchemaVersion)) fail('unsupported_digest_schema');
  const envelope = ordered(
    normalizeForCanonical({
      canonicalization: FUSION_CANONICALIZATION,
      purpose,
      valueSchemaVersion,
      value: canonicalValue,
    }),
  );
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}
export function digestCanonicalBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
export function computeSemanticRequestDigest(value: LessonSemanticRequest): string {
  return digestCanonicalBytes(
    canonicalizeDigestEnvelope(
      'semantic-request',
      SEMANTIC_REQUEST_DIGEST_SCHEMA,
      projectSemanticRequestForDigest(value),
    ),
  );
}
export function equalDigest(expected: string, actual: string): boolean {
  if (!/^sha256:[a-f0-9]{64}$/.test(expected) || !/^sha256:[a-f0-9]{64}$/.test(actual))
    return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function parseLessonSemanticRequest(value: unknown): LessonSemanticRequest {
  if (!isRecord(value)) fail('invalid_request');
  requireExactFields(value, [
    'schemaVersion',
    'semanticRequestId',
    'semanticRequestRevision',
    'lessonSessionId',
    'semanticRequestDigest',
    'normalizedTopic',
    'normalizedLearningObjectives',
    'authorizedKnowledgeScope',
    'audienceSemantics',
    'teachingConstraints',
    'requestedKnowledgeRefs',
    'sourceMaterialRefs',
    'warnings',
  ]);
  if (value.schemaVersion !== PRECLASS_CONTRACT_VERSION) fail('unsupported_schema_version');
  if (
    !isRecord(value.authorizedKnowledgeScope) ||
    !isRecord(value.audienceSemantics) ||
    !isRecord(value.teachingConstraints)
  )
    fail('invalid_request');
  const scope = value.authorizedKnowledgeScope;
  requireExactFields(scope, ['namespace', 'scopeId', 'allowedKnowledgeRefs']);
  const audience = value.audienceSemantics;
  requireExactFields(audience, ['audienceType', 'language'], ['priorKnowledgeBand']);
  const constraints = value.teachingConstraints;
  requireExactFields(
    constraints,
    [],
    ['durationMinutes', 'maxSceneCount', 'requiredModes', 'prohibitedModes'],
  );
  const request: LessonSemanticRequest = {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    semanticRequestId: asciiId(value.semanticRequestId),
    semanticRequestRevision: asciiId(value.semanticRequestRevision),
    lessonSessionId: asciiId(value.lessonSessionId),
    semanticRequestDigest: digest(value.semanticRequestDigest),
    normalizedTopic: nonEmpty(value.normalizedTopic),
    normalizedLearningObjectives: stringArray(value.normalizedLearningObjectives),
    authorizedKnowledgeScope: {
      namespace: asciiId(scope.namespace),
      scopeId: asciiId(scope.scopeId),
      allowedKnowledgeRefs: setRefs(scope.allowedKnowledgeRefs),
    },
    audienceSemantics: {
      audienceType: asciiId(audience.audienceType),
      language: asciiId(audience.language),
      ...(audience.priorKnowledgeBand === undefined
        ? {}
        : { priorKnowledgeBand: asciiId(audience.priorKnowledgeBand) }),
    },
    teachingConstraints: {
      ...(constraints.durationMinutes === undefined
        ? {}
        : { durationMinutes: finiteInteger(constraints.durationMinutes, 600) }),
      ...(constraints.maxSceneCount === undefined
        ? {}
        : { maxSceneCount: finiteInteger(constraints.maxSceneCount, 100) }),
      ...(constraints.requiredModes === undefined
        ? {}
        : { requiredModes: stringSet(constraints.requiredModes) }),
      ...(constraints.prohibitedModes === undefined
        ? {}
        : { prohibitedModes: stringSet(constraints.prohibitedModes) }),
    },
    requestedKnowledgeRefs: setRefs(value.requestedKnowledgeRefs),
    sourceMaterialRefs: materialSet(value.sourceMaterialRefs),
    warnings: stringArray(value.warnings),
  };
  const allowed = new Set(request.authorizedKnowledgeScope.allowedKnowledgeRefs.map(refKey));
  if (
    request.requestedKnowledgeRefs.some(
      (ref) =>
        ref.namespace !== request.authorizedKnowledgeScope.namespace ||
        ref.scopeId !== request.authorizedKnowledgeScope.scopeId ||
        !allowed.has(refKey(ref)),
    )
  )
    fail('unauthorized_reference');
  if (!equalDigest(request.semanticRequestDigest, computeSemanticRequestDigest(request)))
    fail('digest_mismatch');
  return request;
}

function parseProposal(value: unknown): PreClassTeachingContextProposal {
  if (!isRecord(value)) fail('invalid_proposal');
  requireExactFields(value, [
    'schemaVersion',
    'proposalId',
    'basedOnSemanticRequestId',
    'basedOnSemanticRequestRevision',
    'semanticRequestDigest',
    'resolutionStatus',
    'interpretedLessonSemantics',
    'lessonKnowledgeMap',
    'learnerCognitiveProjection',
    'teachingGuidance',
    'sourceRevisions',
    'clarificationIssues',
    'warnings',
    'createdAt',
  ]);
  if (
    value.schemaVersion !== PRECLASS_CONTRACT_VERSION ||
    !['ready', 'needs_clarification', 'partial', 'unresolved', 'rejected'].includes(
      String(value.resolutionStatus),
    ) ||
    !isRecord(value.interpretedLessonSemantics) ||
    !isRecord(value.lessonKnowledgeMap) ||
    !isRecord(value.learnerCognitiveProjection) ||
    !isRecord(value.teachingGuidance)
  )
    fail('invalid_proposal');
  const semantics = value.interpretedLessonSemantics;
  requireExactFields(semantics, ['normalizedTopic', 'normalizedLearningObjectives']);
  const map = value.lessonKnowledgeMap;
  requireExactFields(map, ['mappingId', 'mappingRevision', 'knowledgeRefs']);
  const projection = value.learnerCognitiveProjection;
  requireExactFields(projection, ['projectionRevision', 'signals']);
  const guidance = value.teachingGuidance;
  requireExactFields(guidance, ['guidanceRevision', 'recommendedApproaches']);
  return {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    proposalId: asciiId(value.proposalId),
    basedOnSemanticRequestId: asciiId(value.basedOnSemanticRequestId),
    basedOnSemanticRequestRevision: asciiId(value.basedOnSemanticRequestRevision),
    semanticRequestDigest: digest(value.semanticRequestDigest),
    resolutionStatus: value.resolutionStatus as PreClassTeachingContextProposal['resolutionStatus'],
    interpretedLessonSemantics: {
      normalizedTopic: nonEmpty(semantics.normalizedTopic),
      normalizedLearningObjectives: stringArray(semantics.normalizedLearningObjectives),
    },
    lessonKnowledgeMap: {
      mappingId: asciiId(map.mappingId),
      mappingRevision: asciiId(map.mappingRevision),
      knowledgeRefs: setRefs(map.knowledgeRefs),
    },
    learnerCognitiveProjection: {
      projectionRevision: asciiId(projection.projectionRevision),
      signals: stringArray(projection.signals),
    },
    teachingGuidance: {
      guidanceRevision: asciiId(guidance.guidanceRevision),
      recommendedApproaches: stringArray(guidance.recommendedApproaches),
    },
    sourceRevisions: stringArray(value.sourceRevisions),
    clarificationIssues: stringArray(value.clarificationIssues),
    warnings: stringArray(value.warnings),
    createdAt: timestamp(value.createdAt),
  };
}
export function parsePreClassTeachingContextProposal(
  value: unknown,
  request?: LessonSemanticRequest,
): PreClassTeachingContextProposal {
  const proposal = parseProposal(value);
  if (
    request &&
    (proposal.basedOnSemanticRequestId !== request.semanticRequestId ||
      proposal.basedOnSemanticRequestRevision !== request.semanticRequestRevision ||
      !equalDigest(proposal.semanticRequestDigest, request.semanticRequestDigest))
  )
    fail('semantic_request_mismatch');
  return proposal;
}
export function parseSemanticResolution(
  value: unknown,
  request?: LessonSemanticRequest,
): SemanticResolution {
  if (!isRecord(value)) fail('invalid_resolution');
  requireExactFields(
    value,
    [
      'schemaVersion',
      'semanticRequestId',
      'semanticRequestRevision',
      'semanticRequestDigest',
      'status',
      'clarificationIssues',
    ],
    ['reasonCode'],
  );
  if (
    value.schemaVersion !== PRECLASS_CONTRACT_VERSION ||
    !['ready', 'needs_clarification', 'partial', 'unresolved', 'rejected'].includes(
      String(value.status),
    )
  )
    fail('invalid_resolution');
  const result: SemanticResolution = {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    semanticRequestId: asciiId(value.semanticRequestId),
    semanticRequestRevision: asciiId(value.semanticRequestRevision),
    semanticRequestDigest: digest(value.semanticRequestDigest),
    status: value.status as SemanticResolution['status'],
    ...(value.reasonCode === undefined ? {} : { reasonCode: asciiId(value.reasonCode) }),
    clarificationIssues: stringArray(value.clarificationIssues),
  };
  if (
    request &&
    (result.semanticRequestId !== request.semanticRequestId ||
      result.semanticRequestRevision !== request.semanticRequestRevision ||
      !equalDigest(result.semanticRequestDigest, request.semanticRequestDigest))
  )
    fail('semantic_request_mismatch');
  return result;
}
export function parseFrozenLessonGenerationContext(value: unknown): FrozenLessonGenerationContext {
  if (!isRecord(value)) fail('invalid_frozen_context');
  requireExactFields(value, [
    'schemaVersion',
    'contextId',
    'semanticRequest',
    'proposal',
    'resolution',
    'frozenAt',
  ]);
  if (value.schemaVersion !== PRECLASS_CONTRACT_VERSION) fail('unsupported_schema_version');
  const request = parseLessonSemanticRequest(value.semanticRequest);
  const proposal = parsePreClassTeachingContextProposal(value.proposal, request);
  const resolution = parseSemanticResolution(value.resolution, request);
  if (resolution.status !== 'ready' || proposal.resolutionStatus !== 'ready')
    fail('frozen_context_not_ready');
  return {
    schemaVersion: PRECLASS_CONTRACT_VERSION,
    contextId: asciiId(value.contextId),
    semanticRequest: request,
    proposal,
    resolution,
    frozenAt: timestamp(value.frozenAt),
  };
}

/** Strict JSON parsing with duplicate-key detection before schema parsing. */
export function parseStrictJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length > 256 * 1024) fail('payload_too_large');
  const source = raw;
  const whitespace = (index: number) => {
    while (index < source.length && /[\t\n\r ]/.test(source[index])) index += 1;
    return index;
  };
  const stringEnd = (index: number) => {
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '"') return index + 1;
      index += 1;
    }
    fail('invalid_json');
  };
  const scanValue = (start: number): number => {
    let index = whitespace(start);
    const token = source[index];
    if (token === '"') return stringEnd(index);
    if (token === '{') {
      index = whitespace(index + 1);
      const rawKeys = new Set<string>();
      const normalizedKeys = new Set<string>();
      if (source[index] === '}') return index + 1;
      while (true) {
        if (source[index] !== '"') fail('invalid_json');
        const end = stringEnd(index);
        let rawKey: string;
        let normalizedKey: string;
        try {
          rawKey = JSON.parse(source.slice(index, end));
          normalizedKey = normalizedString(rawKey);
        } catch {
          fail('invalid_json');
        }
        if (rawKeys.has(rawKey)) fail('duplicate_key');
        if (normalizedKeys.has(normalizedKey)) fail('normalized_key_collision');
        rawKeys.add(rawKey);
        normalizedKeys.add(normalizedKey);
        index = whitespace(end);
        if (source[index] !== ':') fail('invalid_json');
        index = whitespace(scanValue(index + 1));
        if (source[index] === '}') return index + 1;
        if (source[index] !== ',') fail('invalid_json');
        index = whitespace(index + 1);
      }
    }
    if (token === '[') {
      index = whitespace(index + 1);
      if (source[index] === ']') return index + 1;
      while (true) {
        index = whitespace(scanValue(index));
        if (source[index] === ']') return index + 1;
        if (source[index] !== ',') fail('invalid_json');
        index = whitespace(index + 1);
      }
    }
    while (index < source.length && !/[\t\n\r ,\]}]/.test(source[index])) index += 1;
    return index;
  };
  let end: number;
  try {
    end = whitespace(scanValue(0));
    if (end !== source.length) fail('invalid_json');
    return normalizeForCanonical(JSON.parse(source));
  } catch (error) {
    if (error instanceof PreClassContractError) throw error;
    fail('invalid_json');
  }
}
