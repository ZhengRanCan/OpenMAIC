import { describe, expect, it } from 'vitest';

function request(body: unknown) {
  return {
    json: async () => body,
  };
}

describe('F02 演示会话 API', () => {
  it('只返回 opaque session id，而不返回画像或 promptText', async () => {
    const { POST } = await import('@/app/api/fusion/demo-session/route');
    const response = await POST(
      request({ demoStudent: 'a', requirement: '请生成一次函数的课堂' }) as unknown as Parameters<
        typeof POST
      >[0],
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, fusionSessionId: 'fusion-demo-linear-function-a-v1' });
    expect(JSON.stringify(body)).not.toContain('promptText');
    expect(JSON.stringify(body)).not.toContain('教学层级');
  });

  it('拒绝非一次函数或未知学生，且错误不泄露内部详情', async () => {
    const { POST } = await import('@/app/api/fusion/demo-session/route');
    const response = await POST(
      request({
        demoStudent: 'unknown',
        requirement: '请生成二次函数课堂',
      }) as unknown as Parameters<typeof POST>[0],
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, errorCode: 'INVALID_REQUEST' });
    expect(JSON.stringify(body)).not.toContain('unknown_demo_student');
    expect(JSON.stringify(body)).not.toContain('demo-student');
  });
});
