import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BoardRecord, PersistedState } from './models.js';

const file = resolve(process.cwd(), 'data/state.json');
let state: PersistedState = { boards: {} };
let writeChain: Promise<void> = Promise.resolve();

export async function loadState() {
  try {
    state = JSON.parse(await readFile(file, 'utf8')) as PersistedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await persist();
  }
}

async function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  const tempFile = `${file}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(tempFile, snapshot, 'utf8');
  await rename(tempFile, file);
}

export function readState() {
  return state;
}

export function change<T>(fn: (current: PersistedState) => T): Promise<T> {
  const result = writeChain.then(async () => {
    const value = fn(state);
    await persist();
    return value;
  });
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function getBoard(id: string): BoardRecord | undefined {
  return state.boards[id];
}
