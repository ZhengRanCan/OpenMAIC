import { findDelegation } from '@/lib/fusion/identity/delegation-store';
import {
  ensureFusionServices,
  isProductionFusion,
} from '@/lib/fusion/reliability/production-services';
async function credentialFor(lessonSessionId: string) {
  if (!isProductionFusion()) return findDelegation(lessonSessionId);
  const services = await ensureFusionServices();
  const session = await services.sessions.get(lessonSessionId);
  return session ? services.credentials.get(session.credentialRef, lessonSessionId) : undefined;
}
async function call(
  path: string,
  capability: 'diagnosis' | 'profile-update-submit',
  lessonSessionId: string,
  payload: unknown,
  fetchFn: typeof fetch = fetch,
) {
  const operation = async () => {
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
  };
  if (!isProductionFusion()) return operation();
  return (await ensureFusionServices()).circuits.run(capability, operation);
}
export const requestRealDiagnosis = (event: { lessonSessionId: string }) =>
  call('/api/v1/fusion/real-diagnosis', 'diagnosis', event.lessonSessionId, event);
export const submitRealUpdate = (candidate: { lessonSessionId: string }) =>
  call(
    '/api/v1/fusion/real-profile-updates',
    'profile-update-submit',
    candidate.lessonSessionId,
    candidate,
  );
