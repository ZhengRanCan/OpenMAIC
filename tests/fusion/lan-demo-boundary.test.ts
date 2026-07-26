import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('F21 LAN demo boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('allows only the fixed demo page while LAN demo mode is active', async () => {
    vi.stubEnv('OPENMAIC_LAN_DEMO_MODE', 'true');

    expect((await middleware(new NextRequest('http://openmaic.local/lan-demo'))).status).toBe(200);
    expect((await middleware(new NextRequest('http://openmaic.local/'))).status).toBe(404);
    expect(
      (await middleware(new NextRequest('http://openmaic.local/api/server-providers'))).status,
    ).toBe(404);
  });
});
