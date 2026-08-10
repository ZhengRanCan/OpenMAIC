import { NextResponse } from 'next/server';

/** F02 demo retired; clients must use formal lesson sessions or normal generation. */
export function POST() {
  return NextResponse.json(
    { error: { code: 'F02_DEMO_RETIRED', message: 'The F02 demo is no longer available.' } },
    { status: 410 },
  );
}
