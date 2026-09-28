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
  const errors: ContentError[] = [];
  const parsed: Array<{ readonly file: string; readonly variant: Variant }> = [];

  /* -- pass 1: schemas ---------------------------------------------------- */

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

  /* -- pass 2: references -------------------------------------------------- */

  const resolved: ResolvedVariant[] = [];
  for (const { file, variant } of parsed) {
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
    if (missing) continue;

    const registry = createRegistry(layered);
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
      continue;
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
      continue;
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

    if (bad || defaultPreset === undefined) continue;

    resolved.push({
      id: variant.id,
      name: variant.name,
      description: variant.description,
      order: variant.order,
      demonstration: variant.demonstration,
      file,
      packs: variant.packs,
      registry,
      rules,
      presets,
      defaultPreset,
      personas,
      defaultPersona,
      stagesFor: (rank) => createStageSource(registry, rank === undefined ? {} : { rank }),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, variants: sortVariants(resolved) };
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
