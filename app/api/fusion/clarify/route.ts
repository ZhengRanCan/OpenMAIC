import { NextRequest, NextResponse } from 'next/server';
import {
  FormalFusionError,
  formalFusionErrorResponse,
  submitPreClassClarification,
} from '@/lib/fusion/generation-session';

/**
 * F48: explicit initiator clarification revision for a `needs_clarification`
 * pre-class outcome. One supplement creates a new request revision and digest;
 * a resolved outcome freezes a brand-new context. partial/unresolved/rejected
 * outcomes and any second revision fail closed.
 */
export async function POST(request: NextRequest) {
  let lessonSessionId = '';
  let supplement: unknown;
  try {
    const body = await request.json();
    lessonSessionId = String(body.lessonSessionId || '');
    supplement = body.supplement;
  } catch {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Invalid clarification payload.' },
      { status: 400 },
    );
  }
  try {
    const resolution = await submitPreClassClarification(request, lessonSessionId, supplement);
    if (resolution.kind !== 'resolved') throw new FormalFusionError('FUSION_CONTEXT_INVALID');
    return NextResponse.json({
      success: true,
      lessonSessionId,
      contextId: resolution.context.contextId,
      semanticRequestRevision: resolution.context.semanticRequest.semanticRequestRevision,
      semanticRequestDigest: resolution.context.semanticRequest.semanticRequestDigest,
    });
  } catch (error) {
    if (error instanceof FormalFusionError) return formalFusionErrorResponse(error);
    return NextResponse.json(
      { success: false, errorCode: 'INTERNAL_ERROR', error: String(error) },
      { status: 500 },
    );
  }
}
