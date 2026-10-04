/**
 * `npm run validate-packs` — the gate from `docs/DESIGN.md` sections 8.2 and 11.
 * A pack that fails validation never loads, and CI runs this on every push.
 *
 * Five passes, reported per file:
 *
 *   1. **Layout** — content lives in the section 9 directories, a pack that has
 *      content has a `pack.json`, and no JSON is loose.
 *   2. **Schema** — every document against its schema in `src/content/schema.ts`.
 *   3. **References** — every id one document names exists: sprites, sounds,
 *      paths, aliens, formations, stages in a sequence, roles.
 *   4. **Variants** — every `variants/*.json` against its own schema, then against
 *      the packs that loaded: the packs it names must be installed, it must have
 *      rules to run on, every difficulty preset must name a rank those rules
 *      declare, and every autoplay persona must have its own id and be the one a
 *      `defaultPersona` names.
 *   5. **Playability** — the playability checks of section 8 step 2, which start
 *      the headless simulation: every stage every variant plays is flown, its
 *      entry, its dives and its bullets checked, and autoplay personas fly it to
 *      the end. `./playability.ts` holds the checks and the protocol they run on.
 *
 * Passes 2 and 3 are `loadPack` itself and pass 4 is `loadVariants`, so the script
 * and the game agree by construction rather than by two implementations staying in
 * step. Pass 5 flies the variants pass 4 resolved, through the same `createWorld`
 * the game runs.
 *
 * Succeeds on an empty or absent `packs/` tree, and on a pack whose content
 * directories are still empty. The variants root is `variants/` beside the packs
 * root, or `process.argv[3]`; an absent one is not a failure either, because a
 * tree with no games is not a *malformed* tree — it is `src/main.ts` that refuses
 * to boot on one, and it says so.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import type { ContentError } from '../src/content/errors.js';
import { formatContentErrors } from '../src/content/errors.js';
import { listPackDirs, readPackSource, readVariantSources } from '../src/content/fs.js';
import type { LoadedPack } from '../src/content/loader.js';
import { loadPack } from '../src/content/loader.js';
import { CONTENT_DIRS } from '../src/content/schema.js';
import type { ResolvedVariant } from '../src/content/variants.js';
import { loadVariants } from '../src/content/variants.js';
import { asContentErrors, checkPlayability } from './playability.js';

/** Files that are bookkeeping rather than content. */
const IGNORED_FILES = new Set(['.gitkeep', '.DS_Store', 'README.md']);

/** JSON allowed at a pack's root, as opposed to inside a content directory. */
const ROOT_FILES = new Set(['pack.json', 'rules.json']);

const PACKS_ROOT = resolve(process.argv[2] ?? 'packs');
const VARIANTS_ROOT = resolve(process.argv[3] ?? join(PACKS_ROOT, '..', 'variants'));

/** Every pack that loaded, keyed by id, for the variant pass to resolve against. */
const loadedPacks = new Map<string, LoadedPack>();

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
  loadedPacks.set(loaded.id, loaded);
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

/** Every variant that resolved, for the playability pass to fly. */
const resolvedVariants: ResolvedVariant[] = [];

/**
 * Pass 4: the variants.
 *
 * Runs after every pack, because a variant is validated *against* the packs that
 * loaded — a variant naming a pack that failed its own schemas would otherwise be
 * reported as naming a pack that does not exist, which sends the author to the
 * wrong file.
 */
function validateVariants(): void {
  const { sources, errors } = readVariantSources(VARIANTS_ROOT);
  if (errors.length > 0) {
    problems.push(...errors);
    return;
  }
  if (sources.length === 0) {
    notes.push('variants: none declared');
    return;
  }

  const result = loadVariants(sources, loadedPacks);
  if (!result.ok) {
    problems.push(...result.errors);
    return;
  }
  resolvedVariants.push(...result.variants);
  for (const variant of result.variants) {
    const marks = [
      `${String(variant.packs.length)} pack(s): ${variant.packs.join(' + ')}`,
      `${String(variant.presets.length)} preset(s)`,
      `default ${variant.defaultPreset.id} -> rank ${variant.defaultPreset.rank}`,
      // Only when there are any: most games will ship none, and a line reading
      // "0 persona(s)" on every variant is noise rather than a report.
      ...(variant.personas.length > 0
        ? [
            `${String(variant.personas.length)} persona(s): ${variant.personas.map((persona) => persona.id).join(', ')}`,
          ]
        : []),
      ...(variant.demonstration ? ['demonstration'] : []),
    ];
    notes.push(`variants/${variant.file}: OK — ${marks.join(', ')}`);
  }
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

  validateVariants();

  // Pass 5. Only over variants that resolved, so a malformed pack is reported as
  // malformed rather than as unplayable.
  const playability = checkPlayability(resolvedVariants);
  notes.push(...playability.notes.map((note) => `playability ${note}`));
  problems.push(...asContentErrors(playability.findings));

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
