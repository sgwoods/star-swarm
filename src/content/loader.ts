/**
 * Pack loading — `docs/DESIGN.md` sections 7 and 8.
 *
 * Two passes, in this order:
 *
 * 1. **Schema.** Every document goes through its schema from `schema.ts`.
 * 2. **References.** Every id one document names must exist: an alien's sprite
 *    and sounds, a wave slot's alien and path, a stage's formation, every stage
 *    in a sequence, every role anything keys by.
 *
 * A pack that fails either pass **never loads** (section 11). That is enforced by
 * the return type: `loadPack` hands back errors or a pack, never both, and there
 * is no partially-loaded intermediate for a caller to reach for.
 *
 * The loader itself is pure — it takes documents that have already been read, so
 * the same code serves a directory on disk (`fs.ts`), a bundled `import.meta.glob`
 * and a test fixture. Nothing here touches the filesystem.
 */

import type { z } from 'zod';

import type { ContentError } from './errors.js';
import { ContentValidationError, fromZodError } from './errors.js';
import { unknownProvenancePaths } from './rules.js';
import type {
  Alien,
  ContentDir,
  Formation,
  MovementPath,
  PackManifest,
  Rules,
  Sound,
  Sprite,
  Stage,
} from './schema.js';
import {
  CONTENT_DIRS,
  CONTENT_KIND_NAMES,
  DOCUMENT_SCHEMAS,
  packManifestSchema,
  rulesSchema,
} from './schema.js';

/** One content file, already parsed from JSON. */
export interface PackDocument {
  readonly kind: ContentDir;
  /** Path relative to the pack root, e.g. `aliens/drone.json`. Used in errors. */
  readonly file: string;
  readonly value: unknown;
}

/** Everything a pack is made of, however it was read. */
export interface PackSource {
  /** The pack directory's name. The manifest's `id` has to match it. */
  readonly name: string;
  /** Where it came from, for diagnostics: a path, or something like `bundled:classic`. */
  readonly origin: string;
  /** The parsed `pack.json`. */
  readonly manifest: unknown;
  /** The parsed `rules.json`, if the pack ships one. */
  readonly rules?: unknown;
  readonly documents: readonly PackDocument[];
}

/** A pack that passed both passes. Every map is keyed by document id. */
export interface LoadedPack {
  readonly id: string;
  readonly origin: string;
  readonly manifest: PackManifest;
  readonly rules: Rules | undefined;
  readonly aliens: ReadonlyMap<string, Alien>;
  readonly paths: ReadonlyMap<string, MovementPath>;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly sprites: ReadonlyMap<string, Sprite>;
  readonly sounds: ReadonlyMap<string, Sound>;
  readonly formations: ReadonlyMap<string, Formation>;
  /** Document id → the file it came from, for error messages downstream. */
  readonly files: ReadonlyMap<string, string>;
}

export type LoadResult =
  | { readonly ok: true; readonly pack: LoadedPack }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

const MANIFEST_FILE = 'pack.json';
const RULES_FILE = 'rules.json';

/** Build a `PackSource` from a flat record of pack-relative path → parsed JSON. */
export function packSourceFromRecord(
  name: string,
  origin: string,
  files: Readonly<Record<string, unknown>>,
): PackSource {
  const documents: PackDocument[] = [];
  let manifest: unknown;
  let rules: unknown;

  for (const [file, value] of Object.entries(files)) {
    const normalised = file.replace(/^\.\//, '');
    if (normalised === MANIFEST_FILE) {
      manifest = value;
      continue;
    }
    if (normalised === RULES_FILE) {
      rules = value;
      continue;
    }
    const kind = CONTENT_DIRS.find((dir) => normalised.startsWith(`${dir}/`));
    if (kind !== undefined) documents.push({ kind, file: normalised, value });
  }

  return rules === undefined
    ? { name, origin, manifest, documents }
    : { name, origin, manifest, rules, documents };
}

/**
 * Validate and resolve a pack. On failure the errors name the file and field;
 * on success nothing partial escapes.
 */
export function loadPack(source: PackSource): LoadResult {
  const errors: ContentError[] = [];
  const pack = source.name;

  /* -- pass 1: schemas ---------------------------------------------------- */

  const manifestResult = packManifestSchema.safeParse(source.manifest);
  if (!manifestResult.success) {
    errors.push(...fromZodError(pack, MANIFEST_FILE, manifestResult.error));
  }

  let rules: Rules | undefined;
  if (source.rules !== undefined) {
    const rulesResult = rulesSchema.safeParse(source.rules);
    if (rulesResult.success) rules = rulesResult.data;
    else errors.push(...fromZodError(pack, RULES_FILE, rulesResult.error));
  }

  const documents: Record<ContentDir, Map<string, unknown>> = {
    aliens: new Map(),
    paths: new Map(),
    stages: new Map(),
    sprites: new Map(),
    sounds: new Map(),
  };
  const files = new Map<string, string>();

  for (const document of source.documents) {
    const schema = DOCUMENT_SCHEMAS[document.kind] as z.ZodType;
    const result = schema.safeParse(document.value);
    if (!result.success) {
      errors.push(...fromZodError(pack, document.file, result.error));
      continue;
    }
    const parsed = result.data as { id: string };
    const bucket = documents[document.kind];
    if (bucket.has(parsed.id)) {
      errors.push({
        pack,
        file: document.file,
        field: 'id',
        message: `duplicate ${CONTENT_KIND_NAMES[document.kind]} id "${parsed.id}"; already defined in ${files.get(`${document.kind}:${parsed.id}`) ?? 'another file'}`,
      });
      continue;
    }
    bucket.set(parsed.id, parsed);
    files.set(`${document.kind}:${parsed.id}`, document.file);
  }

  // A schema failure makes reference checking meaningless — the shapes are not
  // there to walk. Report what we have rather than inventing follow-on errors.
  if (errors.length > 0 || !manifestResult.success) {
    return { ok: false, errors };
  }

  const manifest = manifestResult.data;
  if (manifest.id !== source.name) {
    errors.push({
      pack,
      file: MANIFEST_FILE,
      field: 'id',
      message: `"id" is "${manifest.id}" but the pack directory is "${source.name}"`,
    });
  }

  /* -- pass 2: references -------------------------------------------------- */

  const aliens = documents.aliens as Map<string, Alien>;
  const paths = documents.paths as Map<string, MovementPath>;
  const stages = documents.stages as Map<string, Stage>;
  const sprites = documents.sprites as Map<string, Sprite>;
  const sounds = documents.sounds as Map<string, Sound>;

  const fileOf = (kind: ContentDir, id: string): string =>
    files.get(`${kind}:${id}`) ?? `${kind}/${id}.json`;

  const missing = (file: string, field: string, kind: string, id: string): void => {
    errors.push({ pack, file, field, message: `no ${kind} with id "${id}" in this pack` });
  };

  const requireRef = (file: string, field: string, kind: ContentDir, id: string): void => {
    if (!documents[kind].has(id)) missing(file, field, CONTENT_KIND_NAMES[kind], id);
  };

  const requireRole = (file: string, field: string, role: string): void => {
    if (!Object.prototype.hasOwnProperty.call(manifest.roles, role)) {
      errors.push({
        pack,
        file,
        field,
        message: `role "${role}" is not declared in ${MANIFEST_FILE} "roles"`,
      });
    }
  };

  // Formations live in the manifest, keyed by id (see schema.ts for why).
  const formations = new Map<string, Formation>();
  for (const [key, formation] of Object.entries(manifest.formations)) {
    if (formation.id !== key) {
      errors.push({
        pack,
        file: MANIFEST_FILE,
        field: `formations.${key}.id`,
        message: `"id" is "${formation.id}" but the key is "${key}"`,
      });
    }
    formation.slots.forEach((slot, index) => {
      requireRole(MANIFEST_FILE, `formations.${key}.slots[${String(index)}].role`, slot.role);
    });
    formation.captiveSlots.forEach((slot, index) => {
      if (slot.captor >= formation.slots.length) {
        errors.push({
          pack,
          file: MANIFEST_FILE,
          field: `formations.${key}.captiveSlots[${String(index)}].captor`,
          message: `captor ${String(slot.captor)} is out of range; "slots" has ${String(formation.slots.length)} entries`,
        });
      }
    });
    formations.set(key, formation);
  }

  manifest.stageBadges.forEach((badge, index) => {
    requireRef(MANIFEST_FILE, `stageBadges[${String(index)}].sprite`, 'sprites', badge.sprite);
  });

  for (const [id, alien] of aliens) {
    const file = fileOf('aliens', id);
    requireRole(file, 'role', alien.role);
    requireRef(file, 'sprite', 'sprites', alien.sprite);
    alien.hitSprites.forEach((sprite, index) => {
      requireRef(file, `hitSprites[${String(index)}]`, 'sprites', sprite);
    });
    for (const [event, sound] of Object.entries(alien.sounds)) {
      requireRef(file, `sounds.${event}`, 'sounds', sound);
    }
    alien.dive?.paths.forEach((path, index) => {
      requireRef(file, `dive.paths[${String(index)}]`, 'paths', path);
    });
  }

  for (const [id, path] of paths) {
    const file = fileOf('paths', id);
    path.segments.forEach((segment, index) => {
      if (segment.type === 'fire' && segment.sound !== undefined) {
        requireRef(file, `segments[${String(index)}].sound`, 'sounds', segment.sound);
      }
    });
  }

  for (const [id, stage] of stages) {
    const file = fileOf('stages', id);
    const formation = formations.get(stage.formation);
    if (formation === undefined) {
      missing(file, 'formation', `formation declared in ${MANIFEST_FILE}`, stage.formation);
    }
    stage.waves.forEach((wave, waveIndex) => {
      if (wave.entryPath !== undefined) {
        requireRef(file, `waves[${String(waveIndex)}].entryPath`, 'paths', wave.entryPath);
      }
      wave.slots.forEach((slot, slotIndex) => {
        const at = `waves[${String(waveIndex)}].slots[${String(slotIndex)}]`;
        requireRef(file, `${at}.alien`, 'aliens', slot.alien);
        if (slot.path !== undefined) requireRef(file, `${at}.path`, 'paths', slot.path);
        if (
          slot.home !== undefined &&
          formation !== undefined &&
          slot.home >= formation.slots.length
        ) {
          errors.push({
            pack,
            file,
            field: `${at}.home`,
            message: `slot ${String(slot.home)} is out of range; formation "${stage.formation}" has ${String(formation.slots.length)} slots`,
          });
        }
      });
    });
  }

  const checkStageSequence = (
    file: string,
    field: string,
    sequence: {
      readonly normal?:
        { readonly rows: readonly string[]; readonly repeatLast: number } | undefined;
      readonly challenge?:
        { readonly rows: readonly string[]; readonly repeatLast: number } | undefined;
    },
  ): void => {
    const half = (
      table: { readonly rows: readonly string[]; readonly repeatLast: number } | undefined,
      half: 'normal' | 'challenge',
    ): void => {
      if (table === undefined) return;
      if (table.rows.length > 0 && table.repeatLast > table.rows.length) {
        errors.push({
          pack,
          file,
          field: `${field}.${half}.repeatLast`,
          message: `cannot cycle the last ${String(table.repeatLast)} of ${String(table.rows.length)} entr(ies)`,
        });
      }
      table.rows.forEach((id, index) => {
        const at = `${field}.${half}.rows[${String(index)}]`;
        const stage = stages.get(id);
        if (stage === undefined) {
          missing(file, at, 'stage', id);
        } else if (half === 'challenge' ? stage.kind !== 'challenge' : stage.kind === 'challenge') {
          errors.push({
            pack,
            file,
            field: at,
            message: `stage "${id}" has kind "${stage.kind}" but is listed in the ${half} sequence`,
          });
        }
      });
    };
    half(sequence.normal, 'normal');
    half(sequence.challenge, 'challenge');
  };

  checkStageSequence(MANIFEST_FILE, 'stageSequence', manifest.stageSequence);

  // The event → sound bindings the audio layer reads. Checked here so a
  // misspelt sound id is a load failure rather than an event that plays nothing.
  for (const [event, sound] of Object.entries(manifest.sounds)) {
    requireRef(MANIFEST_FILE, `sounds.${event}`, 'sounds', sound);
  }

  for (const [key, formation] of formations) {
    if (formation.slots.length === 0 && stages.size > 0) {
      errors.push({
        pack,
        file: MANIFEST_FILE,
        field: `formations.${key}.slots`,
        message: 'formation has no slots, so no stage using it can place anything',
      });
    }
  }

  if (rules !== undefined) {
    for (const role of Object.keys(rules.enemies.bomberReadyTimers)) {
      requireRole(RULES_FILE, `enemies.bomberReadyTimers.${role}`, role);
    }
    // A provenance key that names nothing is how a verified marking quietly
    // becomes an unmarked value during a rename, so it is an error rather than
    // a shrug.
    for (const path of unknownProvenancePaths(rules)) {
      errors.push({
        pack,
        file: RULES_FILE,
        field: `provenance.${path}`,
        message: `"${path}" does not name a field in ${RULES_FILE}`,
      });
    }
    if (rules.enemies.dive.returnPath !== undefined) {
      requireRef(RULES_FILE, 'enemies.dive.returnPath', 'paths', rules.enemies.dive.returnPath);
    }
    if (rules.transform !== undefined) {
      rules.transform.types.forEach((id, index) => {
        requireRef(RULES_FILE, `transform.types[${String(index)}]`, 'aliens', id);
      });
      rules.transform.fromRoles.forEach((role, index) => {
        requireRole(RULES_FILE, `transform.fromRoles[${String(index)}]`, role);
      });
    }
    const rankIds = Object.keys(rules.difficulty.ranks);
    if (!rankIds.includes(rules.difficulty.defaultRank)) {
      errors.push({
        pack,
        file: RULES_FILE,
        field: 'difficulty.defaultRank',
        message: `"${rules.difficulty.defaultRank}" is not one of the declared ranks (${rankIds.join(', ') || 'none'})`,
      });
    }
    for (const [rankId, rank] of Object.entries(rules.difficulty.ranks)) {
      const field = `difficulty.ranks.${rankId}`;
      if (
        rank.stageTable.rows.length > 0 &&
        rank.stageTable.repeatLast > rank.stageTable.rows.length
      ) {
        errors.push({
          pack,
          file: RULES_FILE,
          field: `${field}.stageTable.repeatLast`,
          message: `cannot cycle the last ${String(rank.stageTable.repeatLast)} of ${String(rank.stageTable.rows.length)} row(s)`,
        });
      }
      rank.stageTable.rows.forEach((row, index) => {
        for (const role of Object.keys(row.launchRates)) {
          requireRole(
            RULES_FILE,
            `${field}.stageTable.rows[${String(index)}].launchRates.${role}`,
            role,
          );
        }
      });
      if (rank.stageSequence !== undefined) {
        checkStageSequence(RULES_FILE, `${field}.stageSequence`, rank.stageSequence);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    pack: {
      id: manifest.id,
      origin: source.origin,
      manifest,
      rules,
      aliens,
      paths,
      stages,
      sprites,
      sounds,
      formations,
      files: new Map([...files].map(([key, file]) => [key, file])),
    },
  };
}

/** `loadPack`, for callers that would rather have an exception than a result. */
export function loadPackOrThrow(source: PackSource): LoadedPack {
  const result = loadPack(source);
  if (!result.ok) throw new ContentValidationError(result.errors);
  return result.pack;
}
