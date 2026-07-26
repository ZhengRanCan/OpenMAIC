import { findDelegation } from '@/lib/fusion/identity/delegation-store';
import {
  ensureFusionServices,
  isProductionFusion,
} from '@/lib/fusion/reliability/production-services';
import type { FusionJson, FusionJsonObject } from '../session-store/types';
async function credentialFor(lessonSessionId: string) {
  if (!isProductionFusion()) return findDelegation(lessonSessionId);
  const services = await ensureFusionServices();
  const session = await services.sessions.get(lessonSessionId);
  return session ? services.credentials.get(session.credentialRef, lessonSessionId) : undefined;
}

/**
 * Launch is the sole point at which a delegation credential exists only in
 * memory.  Capture both immutable snapshots before the browser receives a
 * session cookie; neither snapshot is ever reconstructed from browser input.
 */
export async function getRealProfileAndKnowledgeMap(
  lessonSessionId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ profile: FusionJsonObject; lessonKnowledgeMap: FusionJsonObject }> {
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!base || !token) throw new Error('profile_unavailable');
  const root = base.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const [profileResponse, mapResponse] = await Promise.all([
    fetchFn(`${root}/api/v1/fusion/profile?lessonSessionId=${encodeURIComponent(lessonSessionId)}`, {
      headers,
    }),
    fetchFn(`${root}/api/v1/fusion/knowledge-map?lessonSessionId=${encodeURIComponent(lessonSessionId)}`, {
      headers,
    }),
  ]);
  if (!profileResponse.ok || !mapResponse.ok) throw new Error('profile_unavailable');
  const [profile, lessonKnowledgeMap] = await Promise.all([profileResponse.json(), mapResponse.json()]);
  if (!isFusionJsonObject(profile) || !isFusionJsonObject(lessonKnowledgeMap)) {
    throw new Error('profile_unavailable');
  }
  return {
    profile,
    lessonKnowledgeMap,
  };
}

function isFusionJson(value: unknown): value is FusionJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return true;
  if (Array.isArray(value)) return value.every(isFusionJson);
  return isFusionJsonObject(value);
}

function isFusionJsonObject(value: unknown): value is FusionJsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isFusionJson);
}

export async function getRealProfile(lessonSessionId: string, fetchFn: typeof fetch = fetch) {
  const operation = async () => {
    const credential = await credentialFor(lessonSessionId);
    const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
    if (!credential || !base) throw new Error('profile_unavailable');
    const response = await fetchFn(
      `${base.replace(/\/+$/, '')}/api/v1/fusion/profile?lessonSessionId=${encodeURIComponent(lessonSessionId)}`,
      { headers: { Authorization: `Bearer ${credential.token}` } },
    );
    if (!response.ok) throw new Error('profile_unavailable');
    return response.json();
  };
  if (!isProductionFusion()) return operation();
  return (await ensureFusionServices()).circuits.run('profile-read', operation);
}
