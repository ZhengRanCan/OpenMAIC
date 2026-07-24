import { NextRequest } from 'next/server';
import { createFusionDemoLessonSession } from '@/lib/fusion/session-catalog';
import { apiError, apiSuccess } from '@/lib/server/api-response';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * 创建 F02 的演示课程会话。
 *
 * 当前没有真实登录或 DeepTutor 运行时连接：此 endpoint 只从经审阅的静态目录
 * 选择固定投影，并且仅把 opaque session id 返回给浏览器。
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await req.json());
  } catch {
    // 统一走下方的安全错误，不把解析细节暴露给客户端。
  }

  const result = createFusionDemoLessonSession(body?.demoStudent, body?.requirement);
  if (!result.ok) {
    return apiError(
      'INVALID_REQUEST',
      400,
      'The selected demo profile is unavailable. Please choose it again or continue without a demo profile.',
    );
  }

  return apiSuccess({ fusionSessionId: result.session.id });
}
