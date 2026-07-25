import { NextRequest, NextResponse } from 'next/server';
import { createSession, recoverSession } from '@/lib/fusion/session/store';
import {
  isProductionFusion,
  requireProductionFusionServices,
} from '@/lib/fusion/reliability/production-services';
const COOKIE = 'openmaic_fusion_session';
const secure = process.env.NODE_ENV === 'production';
export async function POST(request: NextRequest) {
  let lessonSessionId = '';
  try {
    lessonSessionId = String((await request.json()).lessonSessionId || '');
  } catch {}
  if (isProductionFusion()) {
    try {
      const record = await requireProductionFusionServices().sessions.recover(
        request.cookies.get(COOKIE)?.value ?? '',
      );
      if (!record || record.lessonSessionId !== lessonSessionId)
        return NextResponse.json(
          { success: false, error: 'Session unavailable. Restart the classroom.' },
          { status: 401 },
        );
      return NextResponse.json({ success: true, lessonSessionId });
    } catch {
      return NextResponse.json(
        { success: false, error: 'Production session storage is unavailable.' },
        { status: 503 },
      );
    }
  }
  const token = createSession(lessonSessionId);
  if (!token)
    return NextResponse.json(
      { success: false, error: 'Session unavailable. Restart the classroom.' },
      { status: 401 },
    );
  const response = NextResponse.json({ success: true, lessonSessionId });
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 900,
  });
  return response;
}
export async function GET(request: NextRequest) {
  if (isProductionFusion()) {
    try {
      const record = await requireProductionFusionServices().sessions.recover(
        request.cookies.get(COOKIE)?.value ?? '',
      );
      if (!record)
        return NextResponse.json(
          { success: false, error: 'Session expired. Restart the classroom.' },
          { status: 401 },
        );
      return NextResponse.json({
        success: true,
        session: {
          lessonSessionId: record.lessonSessionId,
          revision: record.revision,
          degradationState: record.degradationState,
        },
      });
    } catch {
      return NextResponse.json(
        { success: false, error: 'Production session storage is unavailable.' },
        { status: 503 },
      );
    }
  }
  const record = recoverSession(request.cookies.get(COOKIE)?.value);
  if (!record)
    return NextResponse.json(
      { success: false, error: 'Session expired. Restart the classroom.' },
      { status: 401 },
    );
  return NextResponse.json({
    success: true,
    session: {
      lessonSessionId: record.lessonSessionId,
      revision: record.revision,
      degradationState: record.degradationState,
    },
  });
}
