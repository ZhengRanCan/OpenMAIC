import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Scene, Stage } from '@/lib/types/stage';
import { isValidClassroomId, persistClassroom } from '@/lib/server/classroom-storage';
import type { Slide } from '@openmaic/dsl';

const MANIFEST_VERSION = 1;
const SENSITIVE_FIELD =
  /(?:api[_-]?key|base[_-]?url|token|secret|password|credential|access[_-]?key)/i;

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

export function isLanSharedMode(): boolean {
  return process.env.OPENMAIC_LAN_SHARED_MODE === 'true';
}

export function sanitizeSharedClassroom<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeSharedClassroom) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_FIELD.test(key))
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
  const current = await readManifest(projectRoot);
  const classrooms = current.classrooms.filter((item) => item.id !== summary.id);
  classrooms.unshift(summary);
  await writeManifest(projectRoot, { version: MANIFEST_VERSION, classrooms });
  return summary;
}
