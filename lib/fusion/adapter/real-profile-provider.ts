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
export async function getRealProfile(lessonSessionId: string, fetchFn: typeof fetch = fetch) {
  const credential = await credentialFor(lessonSessionId);
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!credential || !base) throw new Error('profile_unavailable');
  const response = await fetchFn(
    `${base.replace(/\/+$/, '')}/api/v1/fusion/profile?lessonSessionId=${encodeURIComponent(lessonSessionId)}`,
    { headers: { Authorization: `Bearer ${credential.token}` } },
  );
  if (!response.ok) throw new Error('profile_unavailable');
  return response.json();
}
