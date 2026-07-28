import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  listSharedClassrooms,
  publishSharedClassroom,
  sanitizeSharedClassroom,
  storeSharedAudio,
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
          providerUrl: 'https://relay.example/v1',
          requestConfig: { unsafe: true },
          connectionOptions: { unsafe: true },
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

  it('keeps every classroom when a host publishes its local catalog concurrently', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openmaic-f22-concurrent-'));
    const persist = vi.fn().mockResolvedValue({});
    try {
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          publishSharedClassroom(
            {
              baseUrl: 'http://localhost:3000',
              stage: { id: `f22-concurrent-${index}`, name: `课堂 ${index}` } as never,
              scenes: [],
            },
            projectRoot,
            persist,
          ),
        ),
      );

      expect(await listSharedClassrooms(projectRoot)).toHaveLength(5);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes a host audio blob and attaches its same-origin URL to the shared speech action', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openmaic-f22-audio-'));
    const classroomId = 'f22-audio-classroom';
    try {
      const classroomDir = path.join(projectRoot, 'data', 'classrooms');
      await mkdir(classroomDir, { recursive: true });
      await writeFile(
        path.join(classroomDir, `${classroomId}.json`),
        JSON.stringify({
          id: classroomId,
          stage: { id: classroomId, name: '有声音的课堂' },
          scenes: [
            {
              actions: [
                { type: 'speech', audioId: 'tts_s0_intro' },
                { type: 'speech', audioId: 'tts_s0_summary' },
              ],
            },
          ],
        }),
      );

      const [stored, summary] = await Promise.all(
        [
          {
            audioId: 'tts_s0_intro',
            contentType: 'audio/mpeg',
            bytes: Buffer.from('audio-bytes'),
          },
          {
            audioId: 'tts_s0_summary',
            contentType: 'audio/wav',
            bytes: Buffer.from('summary-bytes'),
          },
        ].map((audio) => storeSharedAudio({ classroomId, ...audio }, projectRoot)),
      );

      expect(stored.url).toBe(`/api/classroom-media/${classroomId}/audio/tts_s0_intro.mp3`);
      await expect(
        readFile(path.join(classroomDir, classroomId, 'audio', 'tts_s0_intro.mp3'), 'utf8'),
      ).resolves.toBe('audio-bytes');
      await expect(
        readFile(path.join(classroomDir, classroomId, 'audio', 'tts_s0_summary.wav'), 'utf8'),
      ).resolves.toBe('summary-bytes');
      await expect(
        readFile(path.join(classroomDir, `${classroomId}.json`), 'utf8'),
      ).resolves.toContain(stored.url);
      await expect(
        readFile(path.join(classroomDir, `${classroomId}.json`), 'utf8'),
      ).resolves.toContain(summary.url);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
