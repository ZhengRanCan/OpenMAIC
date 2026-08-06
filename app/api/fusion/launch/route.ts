import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { storeDelegation } from '@/lib/fusion/identity/delegation-store';
import {
  ensureFusionServices,
  isProductionFusion,
} from '@/lib/fusion/reliability/production-services';
import { createLessonRuntimeState } from '@/lib/fusion/lesson-runtime-state';
const COOKIE = 'openmaic_fusion_session';
export async function POST(request: NextRequest) {
  let code = '';
  try {
    code = String((await request.json()).classroomLaunchCode || '');
  } catch {}
  if (!code) return apiError('INVALID_REQUEST', 400, 'Launch code is required.');
  const lessonSessionId = crypto.randomUUID();
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!base) return apiError('PROVIDER_DISABLED', 503, 'Fusion launch is unavailable.');
  const response = await fetch(`${base.replace(/\/+$/, '')}/api/v1/fusion/launch/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, audience: 'openmaic', lessonSessionId }),
  });
  if (!response.ok)
    return apiError('INVALID_CREDENTIALS', 401, 'Launch code is invalid or expired.');
  const credential = await response.json();
  const scopes = [
    'preclass-context:read',
    'diagnosis:request',
    'classroom-event:write',
    'profile-update:submit',
  ];
  if (
    credential.audience !== 'openmaic' ||
    credential.lessonSessionId !== lessonSessionId ||
    !Array.isArray(credential.scope) ||
    credential.scope.length !== scopes.length ||
    !scopes.every((scope) => credential.scope.includes(scope)) ||
    typeof credential.expiresAt !== 'number' ||
    credential.expiresAt <= Math.floor(Date.now() / 1000) ||
    typeof credential.token !== 'string' ||
    typeof credential.tokenId !== 'string' ||
    typeof credential.learnerId !== 'string' ||
    typeof credential.courseScopeId !== 'string' ||
    !credential.courseScopeId ||
    typeof credential.courseScopeRevision !== 'string' ||
    !credential.courseScopeRevision
  )
    return apiError('INVALID_CREDENTIALS', 401, 'Delegation is invalid.');
  if (!isProductionFusion()) {
    storeDelegation(credential);
    return apiSuccess({ lessonSessionId });
  }
  try {
    const services = await ensureFusionServices();
    const credentialRef = await services.credentials.store(credential);
    const sessionToken = crypto.randomUUID();
    try {
      await services.sessions.create(
        {
          lessonSessionId,
          learnerId: credential.learnerId,
          credentialRef,
          courseScopeRef: {
            scopeId: credential.courseScopeId,
            revision: credential.courseScopeRevision,
          },
          // F45: formal pre-class semantics are resolved later by the signed
          // LessonSemanticRequest route. Legacy profile/map/catalog snapshots
          // are no longer captured for new sessions.
          runtimeState: JSON.parse(JSON.stringify(createLessonRuntimeState())),
          degradationState: 'none',
          expiresAt: new Date(credential.expiresAt * 1000).toISOString(),
        },
        sessionToken,
      );
    } catch (error) {
      await services.credentials.delete(credentialRef).catch(() => undefined);
      throw error;
    }
    const result = apiSuccess({ lessonSessionId });
    result.cookies.set(COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });
    return result;
  } catch {
    return apiError('PROVIDER_DISABLED', 503, 'Fusion production storage is unavailable.');
  }
}
