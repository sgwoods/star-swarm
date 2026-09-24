/**
 * `npm run validate-packs` — the gate from docs/DESIGN.md sections 8.2 and 11.
 * A pack that fails validation never loads, and CI runs this on every push.
 *
 * Milestone 0 scope: the schemas (`src/content/schema.ts`) do not exist yet, so
 * this checks everything that can be checked without them —
 *
 *   - every `*.json` under `packs/` parses;
 *   - a directory holding content also holds a `pack.json`;
 *   - `pack.json` is an object with a string `id` matching its directory name;
 *   - content lives in the directories section 9 defines.
 *
 * ...and succeeds on an empty or absent `packs/` tree. Those are real checks: a
 * malformed pack fails today. Milestone 1 adds the schema and reference passes at
 * the marked seam, and Milestone 3 the headless playability checks.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Content subdirectories a pack may contain (docs/DESIGN.md section 9). */
const CONTENT_DIRS = ['aliens', 'paths', 'stages', 'sprites', 'sounds'] as const;

/** Files that are bookkeeping rather than content. */
const IGNORED_FILES = new Set(['.gitkeep', '.DS_Store', 'README.md']);

const PACKS_ROOT = resolve(process.argv[2] ?? 'packs');

interface Problem {
  readonly path: string;
  readonly message: string;
}

const problems: Problem[] = [];
const notes: string[] = [];

function fail(path: string, message: string): void {
  problems.push({ path: relative(process.cwd(), path) || path, message });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDir(path: string): string[] {
  return readdirSync(path)
    .filter((name) => !IGNORED_FILES.has(name))
    .sort();
}

/** Every `*.json` beneath `dir`, recursively. */
function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of listDir(dir)) {
    const path = join(dir, name);
    if (isDirectory(path)) {
      out.push(...jsonFilesUnder(path));
    } else if (name.endsWith('.json')) {
      out.push(path);
    }
  }
  return out;
}

/** Parse a JSON file, reporting rather than throwing. */
function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    fail(path, `unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(path, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Milestone 1 seam. Replace the body with the Zod schema for `kind` from
 * `src/content/schema.ts`; the walk above already finds every document.
 */
function validateDocument(path: string, kind: (typeof CONTENT_DIRS)[number], value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected a JSON object describing one ${kind.replace(/s$/, '')}`);
    return;
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== 'string' || id.trim() === '') {
    fail(path, `missing a non-empty string "id"`);
  }
}

function validatePack(packDir: string, packName: string): void {
  const entries = listDir(packDir);
  const hasPackJson = entries.includes('pack.json');
  const contentDirs = entries.filter(
    (name) =>
      isDirectory(join(packDir, name)) &&
      (CONTENT_DIRS as readonly string[]).includes(name) &&
      listDir(join(packDir, name)).length > 0,
  );
  const hasContent = contentDirs.length > 0;

  if (!hasPackJson && !hasContent) {
    // An empty skeleton is not yet a pack. Milestone 0 ships exactly this for
    // `classic/`, and flagging it would fail CI over a directory of .gitkeeps.
    notes.push(`${packName}: empty skeleton, nothing to validate yet`);
    return;
  }

  if (!hasPackJson) {
    fail(join(packDir, 'pack.json'), 'pack has content but no pack.json');
  } else {
    const manifest = readJson(join(packDir, 'pack.json'));
    if (manifest !== undefined) {
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        fail(join(packDir, 'pack.json'), 'expected a JSON object');
      } else {
        const id = (manifest as Record<string, unknown>).id;
        if (typeof id !== 'string' || id.trim() === '') {
          fail(join(packDir, 'pack.json'), 'missing a non-empty string "id"');
        } else if (id !== packName) {
          fail(join(packDir, 'pack.json'), `"id" is "${id}" but the directory is "${packName}"`);
        }
      }
    }
  }

  // Content must live in one of the section 9 directories, so the loader knows
  // what it is reading without guessing.
  for (const name of entries) {
    const path = join(packDir, name);
    if (isDirectory(path)) {
      if (!(CONTENT_DIRS as readonly string[]).includes(name)) {
        fail(path, `unexpected directory; expected one of ${CONTENT_DIRS.join(', ')}`);
      }
    } else if (name !== 'pack.json' && name.endsWith('.json')) {
      fail(path, `loose JSON file; move it into one of ${CONTENT_DIRS.join(', ')}`);
    }
  }

  let documents = 0;
  for (const kind of CONTENT_DIRS) {
    const dir = join(packDir, kind);
    if (!isDirectory(dir)) continue;
    for (const path of jsonFilesUnder(dir)) {
      const value = readJson(path);
      if (value === undefined) continue;
      validateDocument(path, kind, value);
      documents += 1;
    }
  }

  notes.push(`${packName}: ${String(documents)} document(s) checked`);
}

function main(): void {
  if (!isDirectory(PACKS_ROOT)) {
    console.log(
      `validate-packs: no packs directory at ${relative(process.cwd(), PACKS_ROOT)}; nothing to validate`,
    );
    return;
  }

  const packNames = listDir(PACKS_ROOT).filter((name) => isDirectory(join(PACKS_ROOT, name)));

  // Loose JSON directly under packs/ is a pack that forgot its directory.
  for (const name of listDir(PACKS_ROOT)) {
    if (!isDirectory(join(PACKS_ROOT, name)) && name.endsWith('.json')) {
      fail(join(PACKS_ROOT, name), 'JSON file outside any pack directory');
    }
  }

  for (const name of packNames) validatePack(join(PACKS_ROOT, name), name);

  for (const note of notes) console.log(`validate-packs: ${note}`);

  if (problems.length > 0) {
    console.error(`\nvalidate-packs: ${String(problems.length)} problem(s):`);
    for (const { path, message } of problems) console.error(`  ${path}: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `validate-packs: OK — ${String(packNames.length)} pack(s) in ${relative(process.cwd(), PACKS_ROOT) || '.'}`,
  );
}

main();
