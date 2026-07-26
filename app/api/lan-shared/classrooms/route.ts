import { type NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  isLanSharedMode,
  listSharedClassrooms,
  publishSharedClassroom,
} from '@/lib/lan-shared/classrooms';

function unavailable() {
  return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'LAN shared workspace is not enabled.');
}

export async function GET() {
  if (!isLanSharedMode()) return unavailable();
  try {
    return apiSuccess({ classrooms: await listSharedClassrooms() });
  } catch {
    return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to list shared classrooms.');
  }
}

export async function POST(request: NextRequest) {
  if (!isLanSharedMode()) return unavailable();
  try {
    const body = (await request.json()) as { stage?: Stage; scenes?: Scene[] };
    if (!body.stage || !body.scenes) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing stage or scenes.');
    }
    const classroom = await publishSharedClassroom({
      stage: body.stage,
      scenes: body.scenes,
      baseUrl: buildRequestOrigin(request),
    });
    return apiSuccess({ classroom }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish classroom.';
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, message);
  }
}
