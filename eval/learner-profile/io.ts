import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve, dirname, isAbsolute, relative } from 'node:path';
import { digest } from '@/lib/learner-memory/contracts';

export function readRecords(path: string): unknown {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  return path.endsWith('.jsonl')
    ? text
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((s) => JSON.parse(s))
    : JSON.parse(text);
}
export function output(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function inside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export function createOutput(directory: string, inputs: string[]) {
  const parent = realpathSync(dirname(resolve(directory))),
    target = resolve(parent, directory.split(/[\\/]/).at(-1)!);
  if (existsSync(target) || inputs.some((p) => inside(target, realpathSync(p))))
    throw new Error('OUTPUT_EXISTS_OR_OVERLAPS_INPUT');
  mkdirSync(target);
  return target;
}
export function sourceFiles() {
  const files = ['eval/learner-profile', 'lib/learner-memory'].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `${dir}/${f}`),
  );
  return Object.fromEntries(files.sort().map((path) => [path, digest(readFileSync(path, 'utf8'))]));
}
