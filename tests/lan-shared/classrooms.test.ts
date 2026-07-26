import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  listSharedClassrooms,
  publishSharedClassroom,
  sanitizeSharedClassroom,
} from '@/lib/lan-shared/classrooms';

describe('LAN shared classroom publishing', () => {
  it('removes provider credentials recursively before a classroom is shared', () => {
    expect(
      sanitizeSharedClassroom({
        name: '一次函数',
        apiKey: 'must-not-leave-host',
        provider: { baseUrl: 'https://relay.example/v1', model: 'deepseek-v4-flash' },
        request: {
          authorization: 'also-hidden',
          cookie: 'also-hidden',
          endpoint: 'https://relay.example/v1',
          headers: { unsafe: true },
        },
        scenes: [{ token: 'also-hidden', title: '函数图像' }],
      }),
    ).toEqual({
      name: '一次函数',
      request: {},
      scenes: [{ title: '函数图像' }],
    });
  });

  it('writes a sanitized server-side listing without changing the browser source', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openmaic-f22-'));
    const persist = vi.fn().mockResolvedValue({});
    try {
      await publishSharedClassroom(
        {
          baseUrl: 'http://10.23.13.210:3000',
          stage: {
            id: 'f22-classroom',
            name: '一次函数',
            createdAt: 1,
            provider: { apiKey: 'must-not-persist' },
          } as never,
          scenes: [],
        },
        projectRoot,
        persist,
      );

      expect(persist).toHaveBeenCalledOnce();
      expect(await listSharedClassrooms(projectRoot)).toMatchObject([
        { id: 'f22-classroom', name: '一次函数', sceneCount: 0 },
      ]);
      const manifest = await readFile(
        path.join(projectRoot, 'data', 'lan-shared', 'classrooms.json'),
        'utf8',
      );
      expect(manifest).not.toContain('must-not-persist');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
