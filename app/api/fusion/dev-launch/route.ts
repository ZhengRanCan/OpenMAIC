import { apiError, apiSuccess } from '@/lib/server/api-response';

/**
 * Development-only bridge used by the local OpenMAIC UI. It never returns a
 * delegation credential: only an immediately-consumed, single-use launch code.
 */
export async function POST() {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.FUSION_DEVELOPMENT_UI_ENABLED !== 'true'
  ) {
    return apiError('PROVIDER_DISABLED', 403, 'Development Fusion launch is unavailable.');
  }

  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  if (!base) return apiError('PROVIDER_DISABLED', 503, 'Fusion launch is unavailable.');

  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/api/v1/fusion/launch-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    const classroomLaunchCode =
      typeof payload === 'object' && payload !== null && 'classroomLaunchCode' in payload
        ? (payload as { classroomLaunchCode?: unknown }).classroomLaunchCode
        : undefined;
    if (!response.ok || typeof classroomLaunchCode !== 'string' || !classroomLaunchCode) {
      return apiError('PROVIDER_DISABLED', 503, 'Development Fusion launch is unavailable.');
    }
    return apiSuccess({ classroomLaunchCode });
  } catch {
    return apiError('PROVIDER_DISABLED', 503, 'Development Fusion launch is unavailable.');
  }
}
