import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ensureFusionServices, isProductionFusion } from './reliability/production-services';
import type { FusionJsonObject, FusionSessionRecord } from './session-store/types';
import {
  createFrozenTeachingContext,
  parseFrozenTeachingContext,
  renderFrozenTeachingPrompt,
  type FrozenTeachingContext,
} from './teaching-context';

const COOKIE = 'openmaic_fusion_session';
export type { FrozenTeachingContext } from './teaching-context';

export type FormalFusionResolution =
  | { kind: 'none' }
  | { kind: 'resolved'; context: FrozenTeachingContext; record: FusionSessionRecord };

export class FormalFusionError extends Error {
  constructor(
    readonly code:
      | 'FUSION_SESSION_UNAVAILABLE'
      | 'FUSION_SESSION_MISMATCH'
      | 'FUSION_CONTEXT_INVALID'
      | 'FUSION_SESSION_ALREADY_GENERATED',
  ) {
    super('Restart the classroom from a new Launch Code.');
  }
}

export function formalFusionErrorResponse(error: FormalFusionError): NextResponse {
  const status = error.code === 'FUSION_SESSION_MISMATCH' ? 403 : 401;
  return NextResponse.json(
    {
      success: false,
      errorCode: error.code,
      error: 'Fusion session cannot generate this classroom. Restart from Launch.',
    },
    { status },
  );
}

function contextFrom(record: FusionSessionRecord): FrozenTeachingContext | undefined {
  return parseFrozenTeachingContext(record.generationContext);
}

function createContext(record: FusionSessionRecord, requirement: unknown): FrozenTeachingContext {
  try {
    return createFrozenTeachingContext(record, requirement);
  } catch {
    throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  }
}

async function recoverFormalSession(
  request: NextRequest,
  lessonSessionId: unknown,
): Promise<FusionSessionRecord> {
  if (typeof lessonSessionId !== 'string' || !lessonSessionId)
    throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  if (!isProductionFusion()) throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  const record = await (
    await ensureFusionServices()
  ).sessions.recover(request.cookies.get(COOKIE)?.value ?? '');
  if (!record) throw new FormalFusionError('FUSION_SESSION_UNAVAILABLE');
  if (record.lessonSessionId !== lessonSessionId)
    throw new FormalFusionError('FUSION_SESSION_MISMATCH');
  return record;
}

/** Resolves the already frozen formal context for content/actions; no provider calls occur here. */
export async function resolveFormalFusion(
  request: NextRequest,
  lessonSessionId: unknown,
): Promise<FormalFusionResolution> {
  if (lessonSessionId === undefined || lessonSessionId === null || lessonSessionId === '')
    return { kind: 'none' };
  const record = await recoverFormalSession(request, lessonSessionId);
  const context = contextFrom(record);
  if (!context) throw new FormalFusionError('FUSION_CONTEXT_INVALID');
  return { kind: 'resolved', context, record };
}

/** Atomically creates the sole formal context for this 15-minute lesson session. */
export async function freezeFormalFusionForOutline(
  request: NextRequest,
  lessonSessionId: unknown,
  requirement: unknown,
): Promise<FormalFusionResolution> {
  if (lessonSessionId === undefined || lessonSessionId === null || lessonSessionId === '')
    return { kind: 'none' };
  const record = await recoverFormalSession(request, lessonSessionId);
  if (record.generationContext) throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  const context = createContext(record, requirement);
  const sessions = (await ensureFusionServices()).sessions;
  const updated = await sessions.compareAndSet(
    record.lessonSessionId,
    record.revision,
    (current) => ({
      ...current,
      generationContext: context as unknown as FusionJsonObject,
    }),
  );
  if (!updated) throw new FormalFusionError('FUSION_SESSION_ALREADY_GENERATED');
  return { kind: 'resolved', context, record: updated };
}

/** Deliberately renders only the frozen, minimal projection; no identity/raw snapshot enters prompts. */
export const appendFormalTeachingPrompt = renderFrozenTeachingPrompt;
