import { apiSuccess } from '@/lib/server/api-response';

const REQUIRED_PATHS = [
  '/api/v1/fusion/launch-codes',
  '/api/v1/fusion/launch/exchange',
  '/api/v1/fusion/profile',
  '/api/v1/fusion/knowledge-map',
];

/**
 * Reports only whether the server-side Fusion configuration is usable.
 * The DeepTutor URL deliberately never crosses this route boundary.
 */
export async function GET() {
  const base = process.env.DEEPTUTOR_FUSION_BASE_URL;
  const developmentUiEnabled =
    process.env.NODE_ENV === 'development' && process.env.FUSION_DEVELOPMENT_UI_ENABLED === 'true';

  if (!base) {
    return apiSuccess({ configured: false, reachable: false, developmentUiEnabled });
  }

  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/openapi.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    const document: unknown = await response.json();
    const paths =
      typeof document === 'object' && document !== null && 'paths' in document
        ? (document as { paths?: unknown }).paths
        : undefined;
    const compatible =
      typeof paths === 'object' &&
      paths !== null &&
      REQUIRED_PATHS.every((path) => path in (paths as Record<string, unknown>));

    return apiSuccess({
      configured: true,
      reachable: response.ok && compatible,
      developmentUiEnabled,
    });
  } catch {
    return apiSuccess({ configured: true, reachable: false, developmentUiEnabled });
  }
}
