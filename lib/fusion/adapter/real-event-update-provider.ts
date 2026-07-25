import { findDelegation } from '@/lib/fusion/identity/delegation-store';
import {
  isProductionFusion,
  requireProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
async function credentialFor(lessonSessionId: string) {
  if (!isProductionFusion()) return findDelegation(lessonSessionId);
  const services = requireProductionFusionServices();
  const session = await services.sessions.get(lessonSessionId);
  return session ? services.credentials.get(session.credentialRef, lessonSessionId) : undefined;
}
async function call(
  path: string,
  lessonSessionId: string,
  payload: unknown,
  fetchFn: typeof fetch = fetch,
) {
  const credential = await credentialFor(lessonSessionId);
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!credential || !base) throw new Error('capability_unavailable');
  const response = await fetchFn(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.token}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('capability_unavailable');
  return response.json();
}
export const requestRealDiagnosis = (event: { lessonSessionId: string }) =>
  call('/api/v1/fusion/real-diagnosis', event.lessonSessionId, event);
export const submitRealUpdate = (candidate: { lessonSessionId: string }) =>
  call('/api/v1/fusion/real-profile-updates', candidate.lessonSessionId, candidate);
