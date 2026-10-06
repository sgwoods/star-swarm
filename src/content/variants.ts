/**
 * A **variant** — one game on this platform, declared as data.
 *
 * `docs/DESIGN.md` section 6 says Star Swarm is the first game in an arcade
 * lineage rather than the only one, and the captain's standing direction is that
 * variants are chosen at start-up. The registry above layers packs *within* one
 * game; that is not the same thing. A variant is the thing above it: a display
 * name, the packs it is made of, the rules in force, the difficulty presets a
 * player may pick from, and the autoplay personas the cabinet may play itself as
 * (`./personas.ts`). The Classic game is `variants/classic.json` and is the first
 * entry in that list rather than a case the others work around.
 *
 * Three properties this module exists to keep:
 *
 * - **Adding a variant is adding a file.** Nothing here names a variant, a pack
 *   or a rank. `variants/` is read the same two ways `packs/` is — `./fs.ts` for
 *   the validator and the tests, `./bundle.ts` for the browser — and neither
 *   reader is re-exported from `./index.ts`, for the reasons that file gives.
 * - **A variant is validated the way a pack is**, in the same two passes and with
 *   the same {@link ContentError} shape: the schema first, then the references —
 *   every pack it names must be loaded, every preset's rank must be a rank the
 *   resolved rules declare, and every autoplay persona must have its own id and be
 *   the one a `defaultPersona` names. A variant that fails any of them never
 *   resolves, and the message names the file and the field.
 * - **A variant selects; it never overrides.** There is deliberately no
 *   mechanism here for patching a rules field. Rules are a whole document from a
 *   pack, because a variant that could nudge individual numbers is a difficulty
 *   multiplier with a different name, and section 6 is explicit that rank selects
 *   whole data tables instead. A variant that wants different numbers ships a
 *   pack with a `rules.json` that has them.
 */

import { z } from 'zod';

import type { ContentError } from './errors.js';
import { ContentValidationError, fromZodError } from './errors.js';
import type { LoadedPack } from './loader.js';
import { defaultPersonaOf, type Persona, variantAutoplaySchema } from './personas.js';
import { type ContentRegistry, createRegistry } from './registry.js';
import { idSchema, type Rules } from './schema.js';
import { createStageSource, type StageSource } from './stages.js';

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One player-facing difficulty setting, and the whole of what it does.
 *
 * `docs/DESIGN.md` section 6: the preset lives in the player-settings layer and
 * **chooses the rank**, which the rules layer then resolves into whole data
 * tables — the per-stage difficulty rows *and* the entry-wave script sequence,
 * which plateau at different stages. So a preset is a label and a rank id, and
 * there is nowhere in this shape to put a scalar.
 */
export const difficultyPresetSchema = z.strictObject({
  id: idSchema,
  /** What the settings menu shows. Short: it sits in a row beside its label. */
  label: z.string().min(1),
  /** The rank this preset selects. Must be one the resolved rules declare. */
  rank: idSchema,
  /** A line under the row, for what the rank means. */
  description: z.string().optional(),
});

export type DifficultyPreset = z.infer<typeof difficultyPresetSchema>;

export const variantDifficultySchema = z.strictObject({
  /**
   * The presets offered, in menu order. Empty means **one per rank the rules
   * declare**, which is what keeps a new variant from having to write this block
   * at all — see {@link presetsForRules}.
   */
  presets: z.array(difficultyPresetSchema).default([]),
  /** Which preset a player who has never chosen gets. Must name one above. */
  defaultPreset: idSchema.optional(),
});

/**
 * A variant document: `variants/<id>.json`.
 *
 * Strict, like every other document the platform loads, because the commonest
 * failure in authored content is a misspelt field that silently does nothing.
 */
export const variantSchema = z.strictObject({
  /** Must equal the file's own name, as a pack's id must equal its directory. */
  id: idSchema,
  /** What the selector shows. The game's name, not the pack's. */
  name: z.string().min(1),
  /** A line under the name on the selector. */
  description: z.string().optional(),
  /**
   * The packs this game is made of, layered in order with later ones winning —
   * the registry's own rule, including for the manifest and the rules
   * (`composeManifest`). The first entry is the base; anything after it is an
   * overlay stating only what it changes.
   */
  packs: z.array(idSchema).min(1),
  /** Sort key on the selector. Equal orders fall back to the id. */
  order: z.number().int().default(0),
  /**
   * True for a variant shipped to demonstrate that the system works, rather than
   * a game anyone has committed to. The selector says so, so that a demonstration
   * cannot quietly become part of the line-up by being forgotten about.
   */
  demonstration: z.boolean().default(false),
  difficulty: variantDifficultySchema.default({ presets: [] }),
  /**
   * The autoplay personas this game offers — how well the cabinet plays itself.
   *
   * Beside `difficulty` rather than in a pack because it is the same kind of
   * thing: a property of the framing of a run rather than content in the game
   * world (`./personas.ts`). Omitted means this game offers no autoplay.
   */
  autoplay: variantAutoplaySchema.default({ personas: [] }),
  /**
   * The combat stages' order, as stage ids, stated after every pack. Omitted
   * means the packs' own sequence at the rank in force.
   *
   * A selection like `packs`, never an override: it chooses an order among the
   * stage documents the packs already hold, and every id must be a combat stage
   * one of them ships. A player's order from the stage-sequence editor is this
   * field of their variation (`src/ui/flow.ts`), which is what keeps a variation,
   * a forged game and a shipped game one kind of document.
   */
  stages: z.array(idSchema).optional(),
  /**
   * The game this one was made from, when a player made it by editing another.
   *
   * **Provenance, never a reference.** The loader does not resolve it and nothing
   * about how the game plays is read from it: a variation is a whole document of
   * its own, so it plays the same whether the game it names changes, is renamed
   * or is no longer installed. The front end reads it to say where a game came
   * from and which game to fall back to when this one will not load.
   */
  derivedFrom: idSchema.optional(),
});

export type Variant = z.infer<typeof variantSchema>;

/** One variant document, already parsed from JSON. */
export interface VariantSource {
  /** Path relative to the variants root, e.g. `classic.json`. Used in errors. */
  readonly file: string;
  readonly value: unknown;
}

/**
 * The group name {@link ContentError.pack} carries for a variant.
 *
 * A variant belongs to no pack, and `formatContentErrors` prints
 * `<pack>/<file>:` — so this makes a failure read `variants/classic.json:`,
 * which is where the author has to go.
 */
export const VARIANTS_GROUP = 'variants';

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A variant with its packs loaded, its rules resolved and its presets settled.
 *
 * This is what the front end is handed: everything needed to start a run, and
 * nothing that needs a file, a bundler or a validator. `src/ui/flow.ts` takes a
 * structural subset of it, so the flow never learns that a pack exists.
 */
export interface ResolvedVariant {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly order: number;
  readonly demonstration: boolean;
  /** The document it came from, for diagnostics. */
  readonly file: string;
  /** The pack ids it layers, in order. What the settings menu shows. */
  readonly packs: readonly string[];
  /**
   * The combat stages' order when the document states one — a player's
   * variation, from the stage-sequence editor — and `undefined` when the packs'
   * own sequence plays.
   */
  readonly stages: readonly string[] | undefined;
  /** The game this one was made from, when it was made by editing one. Provenance only. */
  readonly derivedFrom: string | undefined;
  /** Those packs, composed. */
  readonly registry: ContentRegistry;
  /** The rules in force. Present by construction: a variant without them fails to load. */
  readonly rules: Rules;
  /** The presets offered, declared or derived. Never empty. */
  readonly presets: readonly DifficultyPreset[];
  /** The preset a player who has chosen nothing gets. */
  readonly defaultPreset: DifficultyPreset;
  /**
   * The autoplay personas offered, in menu order. **Empty is the normal case**:
   * a variant that declares none offers no autoplay and the settings row is
   * absent, exactly as the `GAME` row is absent on a one-variant cabinet.
   */
  readonly personas: readonly Persona[];
  /** Which persona the `AUTOPLAY` row lands on first, if the document named one. */
  readonly defaultPersona: Persona | undefined;
  /**
   * What plays as each stage at a given rank.
   *
   * Takes the rank because rank reaches **stage resolution** as well as the
   * difficulty tables: a rank may override either half of the stage sequence
   * (`stageSequenceOverrideSchema`), so a difficulty preset that only reached
   * `createWorld` would silently apply half of what section 6 says a rank does.
   */
  stagesFor: (rank?: string) => StageSource;
}

/**
 * One preset per rank the rules declare, in declaration order.
 *
 * The fallback when a variant declares no presets, so that a variant document can
 * be four lines long. The rank id is the label, and there is deliberately **no
 * description**: a rank's own `label` is prose written for a reader of the pack
 * (Classic's is "A — easiest, factory default"), and a menu row is 24 characters
 * of a fixed-advance font with no em dash in it. The settings menu's own
 * "RANK <id>" fallback is what a derived preset shows instead — short, drawable,
 * and exactly what the preset does.
 *
 * A variant that wants player-facing names ("ARCADE", "EXPERT") and a sentence
 * under each declares its own presets, which is what `variants/classic.json` does.
 */
export function presetsForRules(rules: Rules): readonly DifficultyPreset[] {
  return Object.keys(rules.difficulty.ranks).map((rank) => ({ id: rank, label: rank, rank }));
}

/** The preset whose rank is the rules' own `defaultRank`, else the first. */
function defaultPresetOf(
  presets: readonly DifficultyPreset[],
  rules: Rules,
  declared: string | undefined,
): DifficultyPreset | undefined {
  if (declared !== undefined) return presets.find((preset) => preset.id === declared);
  return presets.find((preset) => preset.rank === rules.difficulty.defaultRank) ?? presets[0];
}

/**
 * The presets on offer and the one to fall back to.
 *
 * Structural rather than {@link ResolvedVariant} so that `src/ui/` can resolve a
 * preset without importing a registry: the front end holds its own view of a
 * variant (`FlowVariant`), and this is the part of it these two functions need.
 */
export interface PresetChoice {
  readonly presets: readonly DifficultyPreset[];
  readonly defaultPreset: DifficultyPreset;
}

/** The preset with this id, or the variant's default if there is no such preset. */
export function presetOf(variant: PresetChoice, id: string | undefined): DifficultyPreset {
  if (id === undefined) return variant.defaultPreset;
  return variant.presets.find((preset) => preset.id === id) ?? variant.defaultPreset;
}

/**
 * The rank a settings choice resolves to — the one thing a difficulty preset does.
 *
 * A preset id the variant does not offer resolves to the variant's default
 * rather than throwing, because a player who chose "EXPERT" in one variant and
 * switched to another that has no such preset must still get a playable game.
 */
export function rankFor(variant: PresetChoice, preset: string | undefined): string {
  return presetOf(variant, preset).rank;
}

export type VariantLoadResult =
  | { readonly ok: true; readonly variants: readonly ResolvedVariant[] }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/**
 * A pack list and a stage order in place of the ones a document states.
 *
 * Both are the player-settings layer of `docs/DESIGN.md` section 6 — "active
 * packs" — and neither reaches the rules: the pack list chooses which documents
 * are layered, exactly as the variant document's own list does, and the stage
 * order chooses among stage documents those packs already hold. Rules still come
 * whole from the last pack that ships them.
 */
export interface VariantChoice {
  /** Pack ids to layer, in order, instead of the document's own `packs`. */
  readonly packs?: readonly string[] | undefined;
  /**
   * Stage ids to play as the combat stages, in order, cycling once past the end,
   * instead of the document's own `stages`. Challenge stages keep the packs' own
   * sequence and the rules' own cadence.
   */
  readonly stages?: readonly string[] | undefined;
}

export interface ResolveOptions {
  /**
   * Ids the document may not take, because a game this build ships already has
   * them. A player's variation is resolved on its own rather than beside every
   * shipped document, so the duplicate-id rule `loadVariants` applies between
   * documents is applied here against these.
   */
  readonly reserved?: readonly string[];
}

export type VariantResolveResult =
  | { readonly ok: true; readonly variant: ResolvedVariant }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

interface ParsedDocument {
  readonly file: string;
  readonly variant: Variant;
}

/** Pass 1: every document against the schema, its file name, and each other. */
function parseDocuments(sources: readonly VariantSource[]): {
  readonly errors: ContentError[];
  readonly parsed: ParsedDocument[];
} {
  const errors: ContentError[] = [];
  const parsed: ParsedDocument[] = [];
  const seen = new Map<string, string>();
  for (const source of [...sources].sort((a, b) => a.file.localeCompare(b.file))) {
    const result = variantSchema.safeParse(source.value);
    if (!result.success) {
      errors.push(...fromZodError(VARIANTS_GROUP, source.file, result.error));
      continue;
    }
    const variant = result.data;
    const expected = source.file.replace(/\.json$/, '');
    if (variant.id !== expected) {
      errors.push({
        pack: VARIANTS_GROUP,
        file: source.file,
        field: 'id',
        message: `"id" is "${variant.id}" but the document is ${source.file}`,
      });
      continue;
    }
    const already = seen.get(variant.id);
    if (already !== undefined) {
      errors.push({
        pack: VARIANTS_GROUP,
        file: source.file,
        field: 'id',
        message: `duplicate variant id "${variant.id}"; already defined in ${already}`,
      });
      continue;
    }
    seen.set(variant.id, source.file);
    parsed.push({ file: source.file, variant });
  }
  return { errors, parsed };
}

/**
 * Pass 2 for one document: its packs, its rules, its stage order if it has one,
 * its presets and its personas. Errors or a variant, never both.
 */
function resolveDocument(
  { file, variant }: ParsedDocument,
  packs: ReadonlyMap<string, LoadedPack>,
): { readonly errors: readonly ContentError[]; readonly variant?: ResolvedVariant } {
  const errors: ContentError[] = [];
  const stages = variant.stages;
  const layered: LoadedPack[] = [];
  let missing = false;
  variant.packs.forEach((id, index) => {
    const pack = packs.get(id);
    if (pack === undefined) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: `packs[${String(index)}]`,
        message: `no pack with id "${id}" is installed`,
      });
      missing = true;
      return;
    }
    if (layered.some((other) => other.id === id)) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: `packs[${String(index)}]`,
        message: `pack "${id}" is listed twice; a pack layers once`,
      });
      missing = true;
      return;
    }
    layered.push(pack);
  });
  if (missing) return { errors };

  // A stated order is the combat half, cycling whole: a player's list is a
  // playlist, and "hold the last row for ever" would be a rule they never chose.
  const registry = createRegistry(
    layered,
    stages === undefined ? {} : { normal: { rows: [...stages], repeatLast: stages.length } },
  );
  const rules = registry.rules;
  if (rules === undefined) {
    errors.push({
      pack: VARIANTS_GROUP,
      file,
      field: 'packs',
      message:
        `no pack in "${variant.packs.join(', ')}" ships a rules.json, so this variant has ` +
        'no rules for the simulation to run on',
    });
    return { errors };
  }

  if (stages !== undefined) {
    if (stages.length === 0) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: 'stages',
        message: 'an empty stage order plays nothing',
      });
    }
    stages.forEach((id, index) => {
      const stage = registry.stages.get(id);
      const field = `stages[${String(index)}]`;
      if (stage === undefined) {
        errors.push({
          pack: VARIANTS_GROUP,
          file,
          field,
          message: `no stage "${id}" is in ${variant.packs.join(' + ')}`,
        });
      } else if (stage.kind === 'challenge') {
        errors.push({
          pack: VARIANTS_GROUP,
          file,
          field,
          message:
            `"${id}" is a challenge stage; this is the order of the combat stages, and the ` +
            "challenge stages keep the packs' own sequence and the rules' own cadence",
        });
      }
    });
    if (errors.length > 0) return { errors };
  }

  const declared = variant.difficulty.presets;
  const presets = declared.length > 0 ? declared : presetsForRules(rules);
  if (presets.length === 0) {
    errors.push({
      pack: VARIANTS_GROUP,
      file,
      field: 'difficulty.presets',
      message: 'no presets are declared and the rules declare no ranks to derive them from',
    });
    return { errors };
  }

  let bad = false;
  const presetIds = new Set<string>();
  declared.forEach((preset, index) => {
    const at = `difficulty.presets[${String(index)}]`;
    if (presetIds.has(preset.id)) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: `${at}.id`,
        message: `duplicate preset id "${preset.id}"`,
      });
      bad = true;
    }
    presetIds.add(preset.id);
    if (!Object.prototype.hasOwnProperty.call(rules.difficulty.ranks, preset.rank)) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: `${at}.rank`,
        message:
          `rank "${preset.rank}" is not one of the ranks the rules declare ` +
          `(${Object.keys(rules.difficulty.ranks).join(', ') || 'none'})`,
      });
      bad = true;
    }
  });

  const defaultPreset = defaultPresetOf(presets, rules, variant.difficulty.defaultPreset);
  if (defaultPreset === undefined) {
    errors.push({
      pack: VARIANTS_GROUP,
      file,
      field: 'difficulty.defaultPreset',
      message: `"${variant.difficulty.defaultPreset ?? ''}" names no preset in this variant`,
    });
    bad = true;
  }

  // Autoplay personas. Nothing outside the block is referenced — a persona
  // describes a player, not the game — so the reference pass here is the ids
  // holding together: one persona per id, and a `defaultPersona` that names one
  // of them. Both are the failures an author actually makes.
  const personas = variant.autoplay.personas;
  const personaIds = new Set<string>();
  personas.forEach((persona, index) => {
    if (personaIds.has(persona.id)) {
      errors.push({
        pack: VARIANTS_GROUP,
        file,
        field: `autoplay.personas[${String(index)}].id`,
        message: `duplicate persona id "${persona.id}"`,
      });
      bad = true;
    }
    personaIds.add(persona.id);
  });

  const declaredDefaultPersona = variant.autoplay.defaultPersona;
  const defaultPersona = defaultPersonaOf(personas, declaredDefaultPersona);
  if (declaredDefaultPersona !== undefined && defaultPersona === undefined) {
    errors.push({
      pack: VARIANTS_GROUP,
      file,
      field: 'autoplay.defaultPersona',
      message:
        `"${declaredDefaultPersona}" names no persona in this variant ` +
        `(${personas.map((persona) => persona.id).join(', ') || 'none are declared'})`,
    });
    bad = true;
  }

  if (bad || defaultPreset === undefined) return { errors };

  return {
    errors,
    variant: {
      id: variant.id,
      name: variant.name,
      description: variant.description,
      order: variant.order,
      demonstration: variant.demonstration,
      file,
      packs: variant.packs,
      stages,
      derivedFrom: variant.derivedFrom,
      registry,
      rules,
      presets,
      defaultPreset,
      personas,
      defaultPersona,
      stagesFor: (rank) => createStageSource(registry, rank === undefined ? {} : { rank }),
    },
  };
}

/**
 * Validate and resolve every variant document, against the packs that loaded.
 *
 * Two passes, as `loadPack` has: the schema, then the references. Nothing
 * partial escapes — the result is errors or variants, never both — and a
 * document that fails is reported alongside the others rather than hiding them.
 *
 * `packs` is keyed by pack id, which is also the directory name (`loadPack`
 * holds those two together), so a variant names a directory and this resolves it.
 */
export function loadVariants(
  sources: readonly VariantSource[],
  packs: ReadonlyMap<string, LoadedPack>,
): VariantLoadResult {
  const { errors, parsed } = parseDocuments(sources);
  const resolved: ResolvedVariant[] = [];
  for (const document of parsed) {
    const result = resolveDocument(document, packs);
    errors.push(...result.errors);
    if (result.variant !== undefined) resolved.push(result.variant);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, variants: sortVariants(resolved) };
}

/**
 * Resolve one variant document on its own — a player's variation, or a shipped
 * document **as a player chose it**, with a different pack list, an order for its
 * combat stages, or both.
 *
 * The same two passes {@link loadVariants} runs, over the same document with
 * `packs` and `stages` replaced when the choice states them — so a list a player
 * composes is refused for exactly the reasons a variant document naming it would
 * be, and the editor and the gate cannot disagree about what loads. The stage
 * order is checked against the packs it will play over: every id a combat stage
 * those packs hold.
 *
 * Nothing here decides what a refusal *does*; `src/ui/compose.ts` turns the
 * errors into a reason a player can read.
 */
export function resolveVariant(
  source: VariantSource,
  packs: ReadonlyMap<string, LoadedPack>,
  choice: VariantChoice = {},
  options: ResolveOptions = {},
): VariantResolveResult {
  const { errors, parsed } = parseDocuments([source]);
  const document = parsed[0];
  if (errors.length > 0 || document === undefined) return { ok: false, errors };
  const taken = options.reserved ?? [];
  if (taken.includes(document.variant.id)) {
    return {
      ok: false,
      errors: [
        {
          pack: VARIANTS_GROUP,
          file: document.file,
          field: 'id',
          message: `duplicate variant id "${document.variant.id}"; a shipped game already has it`,
        },
      ],
    };
  }
  if (choice.packs !== undefined && choice.packs.length === 0) {
    return {
      ok: false,
      errors: [
        {
          pack: VARIANTS_GROUP,
          file: document.file,
          field: 'packs',
          message: 'an empty pack list layers nothing',
        },
      ],
    };
  }
  const chosen: ParsedDocument = {
    file: document.file,
    variant: {
      ...document.variant,
      ...(choice.packs === undefined ? {} : { packs: [...choice.packs] }),
      ...(choice.stages === undefined ? {} : { stages: [...choice.stages] }),
    },
  };
  const result = resolveDocument(chosen, packs);
  if (result.variant === undefined) return { ok: false, errors: result.errors };
  return { ok: true, variant: result.variant };
}

/* -------------------------------------------------------------------------- */
/* Documents a player makes                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A variant document as JSON holds it, before the schema has read it.
 *
 * What the front end keeps for a player's variation, because a stored document
 * outlives the build that wrote it: it is validated when it is played, never
 * coerced when it is read, so one that stops loading is kept as written rather
 * than repaired.
 */
export type VariantDocument = Readonly<Record<string, unknown>>;

/** Is this value an object a document can be read from? Arrays are not. */
export function isVariantDocument(value: unknown): value is VariantDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string array out of a document field, or `undefined` when it is not one. */
function idsOf(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === 'string');
}

/**
 * The pack list and stage order a document states, read leniently — what the
 * pack manager opens on. Nothing here validates: a document that names a pack
 * this build lacks reads back that pack, so the card can show it as missing.
 */
export function listsOf(document: VariantDocument): {
  readonly packs: readonly string[];
  readonly stages: readonly string[] | undefined;
} {
  return { packs: idsOf(document.packs) ?? [], stages: idsOf(document.stages) };
}

/** The same document with its pack list replaced. */
export function withPacks(document: VariantDocument, packs: readonly string[]): VariantDocument {
  return { ...document, packs: [...packs] };
}

/** The same document with its stage order replaced, or removed for `undefined`. */
export function withStages(
  document: VariantDocument,
  stages: readonly string[] | undefined,
): VariantDocument {
  const { stages: _dropped, ...rest } = document;
  return stages === undefined ? rest : { ...rest, stages: [...stages] };
}

export interface DeriveOptions {
  /** The new document's id. The caller chooses one no game has. */
  readonly id: string;
  /** What the selector shows. */
  readonly name: string;
  /** The id of the game it is made from. Recorded as `derivedFrom`. */
  readonly from: string;
  readonly packs: readonly string[];
  /** The combat stages' order, or `undefined` for the packs' own. */
  readonly stages?: readonly string[] | undefined;
}

/**
 * A new variant document made from another: what a player's edit to a shipped
 * game becomes.
 *
 * **A copy, not a delta.** Everything the base states comes across — its
 * difficulty presets and its autoplay personas included — so the result is a
 * whole document that loads on its own, passes exactly the checks any variant
 * passes, and could be dropped into `variants/` as it is. Four fields are the
 * new game's own: the `id` and `name` it is given, `derivedFrom` naming the base,
 * and the pack list and stage order the player chose. Three are not copied,
 * because each is a claim about the base rather than about the copy: its
 * `description`, its selector `order` and its `demonstration` mark.
 *
 * `base` is the base's document as JSON holds it, or `undefined` when the base is
 * not in this build — a settings document can outlive the game it was written
 * against — in which case the copy is the four fields alone and its presets come
 * from the ranks its rules declare.
 */
export function deriveVariant(
  base: VariantDocument | undefined,
  options: DeriveOptions,
): VariantDocument {
  const {
    description: _description,
    order: _order,
    demonstration: _demonstration,
    stages: _stages,
    ...kept
  } = base ?? {};
  return {
    ...kept,
    id: options.id,
    name: options.name,
    derivedFrom: options.from,
    packs: [...options.packs],
    ...(options.stages === undefined ? {} : { stages: [...options.stages] }),
  };
}

/** Selector order: the declared `order`, then the id, so it is never arbitrary. */
export function sortVariants(variants: readonly ResolvedVariant[]): ResolvedVariant[] {
  return [...variants].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** `loadVariants`, for callers that would rather have an exception than a result. */
export function loadVariantsOrThrow(
  sources: readonly VariantSource[],
  packs: ReadonlyMap<string, LoadedPack>,
): readonly ResolvedVariant[] {
  const result = loadVariants(sources, packs);
  if (!result.ok) throw new ContentValidationError(result.errors);
  return result.variants;
}
