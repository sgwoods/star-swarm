/**
 * `npm run validate-packs` — the gate from `docs/DESIGN.md` sections 8.2 and 11.
 * A pack that fails validation never loads, and CI runs this on every push.
 *
 * Three passes, reported per file:
 *
 *   1. **Layout** — content lives in the section 9 directories, a pack that has
 *      content has a `pack.json`, and no JSON is loose.
 *   2. **Schema** — every document against its schema in `src/content/schema.ts`.
 *   3. **References** — every id one document names exists: sprites, sounds,
 *      paths, aliens, formations, stages in a sequence, roles.
 *
 * Passes 2 and 3 are `loadPack` itself, so the script and the game agree by
 * construction rather than by two implementations staying in step.
 *
 * Still to come: the **playability checks** of section 8 step 2 — paths staying
 * on screen, a stage being clearable, no unavoidable bullet walls, a stage
 * finishing inside a time limit. Those need the headless sim and are Milestone 3
 * work; nothing here runs the simulation.
 *
 * Succeeds on an empty or absent `packs/` tree, and on a pack whose content
 * directories are still empty.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import type { ContentError } from '../src/content/errors.js';
import { formatContentErrors } from '../src/content/errors.js';
import { listPackDirs, readPackSource } from '../src/content/fs.js';
import { loadPack } from '../src/content/loader.js';
import { CONTENT_DIRS } from '../src/content/schema.js';

/** Files that are bookkeeping rather than content. */
const IGNORED_FILES = new Set(['.gitkeep', '.DS_Store', 'README.md']);

/** JSON allowed at a pack's root, as opposed to inside a content directory. */
const ROOT_FILES = new Set(['pack.json', 'rules.json']);

const PACKS_ROOT = resolve(process.argv[2] ?? 'packs');

const problems: ContentError[] = [];
const notes: string[] = [];

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

/** Pass 1: is this shaped like a pack at all? */
function checkLayout(packDir: string, pack: string): { hasManifest: boolean; hasContent: boolean } {
  const entries = listDir(packDir);
  const hasManifest = entries.includes('pack.json');
  let hasContent = false;

  for (const name of entries) {
    const path = join(packDir, name);
    if (isDirectory(path)) {
      if (!(CONTENT_DIRS as readonly string[]).includes(name)) {
        problems.push({
          pack,
          file: name,
          message: `unexpected directory; expected one of ${CONTENT_DIRS.join(', ')}`,
        });
      } else if (listDir(path).length > 0) {
        hasContent = true;
      }
    } else if (name.endsWith('.json') && !ROOT_FILES.has(name)) {
      problems.push({
        pack,
        file: name,
        message: `loose JSON file; move it into one of ${CONTENT_DIRS.join(', ')}`,
      });
    }
  }

  if (entries.includes('rules.json')) hasContent = true;
  return { hasManifest, hasContent };
}

function validatePack(packDir: string): void {
  const pack = basename(packDir);
  const { hasManifest, hasContent } = checkLayout(packDir, pack);

  if (!hasManifest && !hasContent) {
    // A directory of empty content folders is not yet a pack. Flagging it would
    // fail CI over a tree of .gitkeeps.
    notes.push(`${pack}: empty skeleton, nothing to validate yet`);
    return;
  }

  const { source, errors } = readPackSource(packDir);
  if (source === undefined) {
    problems.push(...errors);
    return;
  }

  const result = loadPack(source);
  if (!result.ok) {
    problems.push(...result.errors);
    return;
  }

  const { pack: loaded } = result;
  const counts = [
    `${String(loaded.aliens.size)} alien(s)`,
    `${String(loaded.paths.size)} path(s)`,
    `${String(loaded.stages.size)} stage(s)`,
    `${String(loaded.sprites.size)} sprite(s)`,
    `${String(loaded.sounds.size)} sound(s)`,
    `${String(loaded.formations.size)} formation(s)`,
    loaded.rules === undefined ? 'no rules.json' : 'rules.json',
  ];
  notes.push(`${pack}: OK — ${counts.join(', ')}`);
}

function main(): void {
  if (!isDirectory(PACKS_ROOT)) {
    console.log(
      `validate-packs: no packs directory at ${relative(process.cwd(), PACKS_ROOT)}; nothing to validate`,
    );
    return;
  }

  // Loose JSON directly under packs/ is a pack that forgot its directory.
  for (const name of listDir(PACKS_ROOT)) {
    if (!isDirectory(join(PACKS_ROOT, name)) && name.endsWith('.json')) {
      problems.push({ pack: '.', file: name, message: 'JSON file outside any pack directory' });
    }
  }

  const packDirs = listPackDirs(PACKS_ROOT);
  for (const packDir of packDirs) validatePack(packDir);

  for (const note of notes) console.log(`validate-packs: ${note}`);

  if (problems.length > 0) {
    console.error(`\nvalidate-packs: ${String(problems.length)} problem(s):`);
    for (const line of formatContentErrors(problems)) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `validate-packs: OK — ${String(packDirs.length)} pack(s) in ${relative(process.cwd(), PACKS_ROOT) || '.'}`,
  );
}

main();
