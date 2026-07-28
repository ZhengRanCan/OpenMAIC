import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Scene, Stage } from '@/lib/types/stage';
import { isValidClassroomId, persistClassroom } from '@/lib/server/classroom-storage';
import type { Slide } from '@openmaic/dsl';

const MANIFEST_VERSION = 1;
// A shared classroom never needs request credentials or a provider configuration:
// model availability is read separately from the server-managed provider catalog.
const SHARED_FORBIDDEN_FIELD =
  /(?:api[_-]?key|base[_-]?url|token|secret|password|credential|access[_-]?key|authorization|cookie|headers?|endpoint|proxy|provider|settings?|config(?:uration)?|connection|relay|origin)/i;

export interface SharedClassroomSummary {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
  interactiveMode?: boolean;
  taskEngineMode?: boolean;
  firstSlide?: Slide;
}

interface SharedClassroomManifest {
  version: typeof MANIFEST_VERSION;
  classrooms: SharedClassroomSummary[];
}

// The home page publishes the whole local catalog concurrently. Keep the
// read-modify-write manifest update in one process-local queue so entries do
// not overwrite one another or reuse the same atomic-write temporary file.
let manifestUpdateQueue: Promise<void> = Promise.resolve();
let audioUpdateQueue: Promise<void> = Promise.resolve();

const AUDIO_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
};

export function isLanSharedMode(): boolean {
  return process.env.OPENMAIC_LAN_SHARED_MODE === 'true';
}

export function sanitizeSharedClassroom<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeSharedClassroom) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SHARED_FORBIDDEN_FIELD.test(key))
      .map(([key, item]) => [key, sanitizeSharedClassroom(item)]),
  ) as T;
}

function firstSlide(scenes: Scene[]): Slide | undefined {
  const scene = scenes.find((item) => item.content?.type === 'slide');
  return scene?.content.type === 'slide' ? scene.content.canvas : undefined;
}

function summaryFor(stage: Stage, scenes: Scene[]): SharedClassroomSummary {
  const now = Date.now();
  return {
    id: stage.id,
    name: stage.name || 'Untitled Stage',
    description: stage.description,
    sceneCount: scenes.length,
    createdAt: stage.createdAt || now,
    updatedAt: now,
    interactiveMode: stage.interactiveMode,
    taskEngineMode: stage.taskEngineMode,
    firstSlide: firstSlide(scenes),
  };
}

function manifestPath(projectRoot: string): string {
  return path.join(projectRoot, 'data', 'lan-shared', 'classrooms.json');
}

async function readManifest(projectRoot: string): Promise<SharedClassroomManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath(projectRoot), 'utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== MANIFEST_VERSION ||
      !Array.isArray((parsed as { classrooms?: unknown }).classrooms)
    ) {
      return { version: MANIFEST_VERSION, classrooms: [] };
    }
    return parsed as SharedClassroomManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: MANIFEST_VERSION, classrooms: [] };
    }
    throw error;
  }
}

async function writeManifest(
  projectRoot: string,
  manifest: SharedClassroomManifest,
): Promise<void> {
  const target = manifestPath(projectRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

function updateManifest(projectRoot: string, summary: SharedClassroomSummary): Promise<void> {
  const update = manifestUpdateQueue.then(async () => {
    const current = await readManifest(projectRoot);
    const classrooms = current.classrooms.filter((item) => item.id !== summary.id);
    classrooms.unshift(summary);
    await writeManifest(projectRoot, { version: MANIFEST_VERSION, classrooms });
  });

  // A failed request must not permanently block subsequent publishers.
  manifestUpdateQueue = update.catch(() => undefined);
  return update;
}

export async function listSharedClassrooms(
  projectRoot = process.cwd(),
): Promise<SharedClassroomSummary[]> {
  const manifest = await readManifest(projectRoot);
  return [...manifest.classrooms].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function publishSharedClassroom(
  input: { stage: Stage; scenes: Scene[]; baseUrl: string },
  projectRoot = process.cwd(),
  persist = persistClassroom,
): Promise<SharedClassroomSummary> {
  if (!input.stage?.id || !isValidClassroomId(input.stage.id) || !Array.isArray(input.scenes)) {
    throw new Error('A valid classroom stage and scenes are required.');
  }

  const stage = sanitizeSharedClassroom(input.stage);
  const scenes = sanitizeSharedClassroom(input.scenes);
  await persist({ id: stage.id, stage, scenes }, input.baseUrl);

  const summary = summaryFor(stage, scenes);
  await updateManifest(projectRoot, summary);
  return summary;
}

export interface StoredSharedAudio {
  filename: string;
  url: string;
}

export async function storeSharedAudio(
  input: { classroomId: string; audioId: string; contentType: string; bytes: Buffer },
  projectRoot = process.cwd(),
): Promise<StoredSharedAudio> {
  if (!isValidClassroomId(input.classroomId) || !isValidClassroomId(input.audioId)) {
    throw new Error('A valid classroom ID and audio ID are required.');
  }
  if (!input.bytes.length) throw new Error('Audio content is required.');
  if (input.bytes.length > 25 * 1024 * 1024) throw new Error('Audio file exceeds the 25 MB limit.');

  const extension = AUDIO_EXTENSION_BY_CONTENT_TYPE[input.contentType.toLowerCase()];
  if (!extension) throw new Error('Unsupported audio content type.');

  const filename = `${input.audioId}.${extension}`;
  const url = `/api/classroom-media/${input.classroomId}/audio/${filename}`;
  const update = audioUpdateQueue.then(async () => {
    const classroomsDir = path.join(projectRoot, 'data', 'classrooms');
    const classroomPath = path.join(classroomsDir, `${input.classroomId}.json`);
    const parsed = JSON.parse(await fs.readFile(classroomPath, 'utf8')) as {
      scenes?: Array<{ actions?: Array<{ type?: string; audioId?: string; audioUrl?: string }> }>;
    };

    let found = false;
    for (const scene of parsed.scenes ?? []) {
      for (const action of scene.actions ?? []) {
        if (action.type === 'speech' && action.audioId === input.audioId) {
          action.audioUrl = url;
          found = true;
        }
      }
    }
    if (!found) throw new Error('Shared classroom does not reference this audio ID.');

    const audioDir = path.join(classroomsDir, input.classroomId, 'audio');
    await fs.mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, filename);
    const temporary = `${audioPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, input.bytes);
    await fs.rename(temporary, audioPath);
    await writeJsonAtomically(classroomPath, parsed);
  });

  audioUpdateQueue = update.catch(() => undefined);
  await update;
  return { filename, url };
}
