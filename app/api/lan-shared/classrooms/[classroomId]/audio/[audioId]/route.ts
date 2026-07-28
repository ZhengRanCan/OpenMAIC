import { type NextRequest } from 'next/server';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { isLanSharedMode, storeSharedAudio } from '@/lib/lan-shared/classrooms';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classroomId: string; audioId: string }> },
) {
  if (!isLanSharedMode()) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'LAN shared workspace is not enabled.');
  }

  const { classroomId, audioId } = await params;
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  try {
    const audio = await storeSharedAudio({
      classroomId,
      audioId,
      contentType,
      bytes: Buffer.from(await request.arrayBuffer()),
    });
    return apiSuccess({ audio }, 201);
  } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Audio could not be shared.');
  }
}
