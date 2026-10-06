/**
 * The judge behind the pack manager and the player's variations: what a
 * variant document a player made — or is making — turns into, and what the card
 * says about it.
 *
 * `./packs.ts` draws the cards and holds the drafts; this is the content side of
 * them, implementing `PackComposer` over the variants the build loaded. It is
 * handed **documents**: a shipped game's own (`documentOf`), a variation as the
 * settings store kept it, or a draft of either with its pack list or stage order
 * replaced. It holds no rule of its own about what may be kept — every verdict is
 * somebody else's check, run over the document:
 *
 * 1. **Will it load?** `resolveVariant` in `src/content/variants.ts` — the very
 *    two passes `loadVariants` runs at boot and `npm run validate-packs` runs in
 *    CI, over the one document, with the duplicate-id rule held against the
 *    shipped games. A variation is refused for exactly the reasons a document in
 *    `variants/` would be: there is no second, weaker path for player content.
 * 2. **Will it build?** `checkStructure` from `scripts/playability.ts` — the half
 *    of the gate's playability pass that needs no pilot: every combat stage the
 *    mix plays builds its fleet, fills its slots and settles, and every dive stays
 *    on screen from every slot.
 * 3. **What is it coupled to?** `findCouplings` in `src/content/couplings.ts` —
 *    not a refusal, but the things the rules layer will do to this mix that the
 *    packs alone would not lead anyone to expect, said on the card.
 *
 * **What it deliberately does not run is the other half of the gate**: the
 * persona flights (`finishes`, `clearable`, `bullet-wall`, `deterministic`,
 * `ordered`). Measured over the shipped packs under the Classic game, the whole
 * pass takes 7.6 seconds for Classic with Deep Sea and 24 to 27 for the mixes
 * that keep Classic's twenty-one stages — thirty-three flights a stage — where
 * the structural half takes 11 to 128 milliseconds: fast enough to run on every
 * keypress, which is the point of a verdict on the card.
 * So the editor's word for a list it accepts is `LOADS AND BUILDS`, not
 * "playable": a mix whose stages build and settle but that no persona could
 * finish is accepted, and `tests/unit/compose.test.ts` holds that cost in place
 * with the fixture's unreachable stage, so the day the editor starts flying it is
 * the test that says so.
 *
 * **A shipped game's own document is never judged.** It is what the gate flew in
 * CI, and handed back by identity it is the variant the build loaded, unchanged.
 * That is the whole of how a reference game stays one: nothing stored is ever
 * composed over it, so it can only ever play as it ships.
 *
 * Every verdict is memoised per document: a draft is judged once however often
 * the player passes back through it.
 */

import { checkStructure, type Finding } from '../../scripts/playability.js';
import { type Coupling, findCouplings } from '../content/couplings.js';
import type { ContentError } from '../content/errors.js';
import type { LoadedPack } from '../content/loader.js';
import { resolveStageSequence } from '../content/rules.js';
import {
  isVariantDocument,
  listsOf,
  type ResolvedVariant,
  resolveVariant,
  type VariantDocument,
  type VariantSource,
  withPacks,
  withStages,
} from '../content/variants.js';
import type { InstalledPack, PackComposer, StageOption, Verdict } from './packs.js';

/** Every headline and fixed line a verdict may carry. Held to the font by the tests. */
export const VERDICT_TEXT = Object.freeze({
  own: "THE GAME'S OWN",
  ownNote: 'AS THE GAME SHIPS',
  builds: 'LOADS AND BUILDS',
  buildsNote: 'EVERY STAGE BUILDS AND',
  buildsNote2: 'ITS DIVES STAY ON SCREEN',
  wontLoad: 'WILL NOT LOAD',
  unplayable: 'UNPLAYABLE',
  noPacks: 'NO PACK IS SWITCHED ON',
  noRules: 'NO PACK IN IT HAS RULES',
  noRules2: 'SWITCH ON A BASE PACK',
  noStages: 'NO STAGE IS IN THE ORDER',
  notInstalled: 'IS NOT INSTALLED HERE',
  onTwice: 'IS SWITCHED ON TWICE',
  rankNeeded: 'A DIFFICULTY NEEDS IT',
  notInPacks: 'IS NOT IN THESE PACKS',
  isChallenge: 'IS A CHALLENGE STAGE',
  shippedId: 'A SHIPPED GAME HAS ITS ID',
  badDocument: 'IT IS NOT A GAME DOCUMENT',
  clearsStages: 'CLEARS YOUR STAGE ORDER',
  fleet: 'ITS FLEET WILL NOT BUILD',
  settles: 'IT NEVER SETTLES',
  strays: 'ITS ENTRY LEAVES THE SCREEN',
  slots: 'ITS SLOTS GO UNFILLED',
  entry: 'ITS ENTRY FAILS',
  dive: 'IT LEAVES THE SCREEN',
});

export interface ComposerOptions {
  /** Every variant document, as `loadVariants` was handed them. */
  readonly sources: readonly VariantSource[];
  /** Every pack that loaded, keyed by id. */
  readonly packs: ReadonlyMap<string, LoadedPack>;
  /** The variants as the build loaded them: the bases a choice is made over. */
  readonly variants: readonly ResolvedVariant[];
}

export interface Composer extends PackComposer<ResolvedVariant> {
  /**
   * The resolved variant behind one the flow is running, when this composer — or
   * the build's own load — produced it, else `undefined`. By identity: a variant
   * nobody here made is not one whose sprites anybody here can build.
   */
  resolvedOf: (variant: object) => ResolvedVariant | undefined;
}

/** `"deep-sea"` out of a loader message, for a line that names what is wrong. */
function quoted(message: string): string {
  return /"([^"]+)"/.exec(message)?.[1] ?? '';
}

/** What a list that will not load says, from the loader's first error. */
function refusalOf(errors: readonly ContentError[]): Verdict {
  const first = errors[0];
  const field = first?.field ?? '';
  const message = first?.message ?? '';
  let details: string[];
  if (field === 'packs') {
    details = /empty/.test(message)
      ? [VERDICT_TEXT.noPacks]
      : [VERDICT_TEXT.noRules, VERDICT_TEXT.noRules2];
  } else if (/^packs\[\d+\]$/.test(field)) {
    // The id on a line of its own: an id is a document's, and a card is
    // twenty-five characters wide.
    details = [
      `PACK ${quoted(message)}`,
      /twice/.test(message) ? VERDICT_TEXT.onTwice : VERDICT_TEXT.notInstalled,
    ];
  } else if (/^difficulty\.presets\[\d+\]\.rank$/.test(field)) {
    details = [`ITS RULES LACK RANK ${quoted(message)}`, VERDICT_TEXT.rankNeeded];
  } else if (field === 'stages') {
    details = [VERDICT_TEXT.noStages];
  } else if (/^stages\[\d+\]$/.test(field)) {
    details = [
      `STAGE ${quoted(message)}`,
      /challenge/.test(message) ? VERDICT_TEXT.isChallenge : VERDICT_TEXT.notInPacks,
    ];
  } else if (field === 'id' && /shipped/.test(message)) {
    details = [`ID ${quoted(message)}`, VERDICT_TEXT.shippedId];
  } else {
    details = [field, message];
  }
  if (details.length < 2 && errors.length > 1) {
    details.push(`+${String(errors.length - 1)} MORE`);
  }
  return { ok: false, headline: VERDICT_TEXT.wontLoad, details };
}

/** The id a finding blames, from its file: `stages/crowded.json` → `crowded`. */
function blamed(finding: Finding): string {
  return finding.file.replace(/^.*\//, '').replace(/\.json$/, '');
}

/** What a list whose stages will not build says, from the structural pass's first finding. */
function unplayableOf(findings: readonly Finding[]): Verdict {
  const first = findings[0];
  if (first === undefined) return { ok: false, headline: VERDICT_TEXT.unplayable, details: [] };
  if (first.check === 'dive') {
    return {
      ok: false,
      headline: VERDICT_TEXT.unplayable,
      details: [`DIVE ${blamed(first)}`, VERDICT_TEXT.dive],
    };
  }
  const { message } = first;
  const why = /could not be built|failed at step/.test(message)
    ? VERDICT_TEXT.fleet
    : /never settled/.test(message)
      ? VERDICT_TEXT.settles
      : /strays/.test(message)
        ? VERDICT_TEXT.strays
        : /not in a slot|share/.test(message)
          ? VERDICT_TEXT.slots
          : VERDICT_TEXT.entry;
  return {
    ok: false,
    headline: VERDICT_TEXT.unplayable,
    details: [`STAGE ${blamed(first)}`, why],
  };
}

/**
 * One coupling as a line or two a player can read: the first line stands on its
 * own, and the second — when there is room for it — says what it is measured
 * against.
 */
export function couplingLines(coupling: Coupling): readonly string[] {
  switch (coupling.kind) {
    case 'silent-role':
      return [`${coupling.label} NEVER ATTACKS`];
    case 'breathe':
      return [
        `UNEVEN BREATHE: ${coupling.formation}`,
        coupling.columns === coupling.tableColumns
          ? `${String(coupling.rows)} ROWS, TABLE HAS ${String(coupling.tableRows)}`
          : `${String(coupling.columns)} COLUMNS, TABLE HAS ${String(coupling.tableColumns)}`,
      ];
    case 'continuous-bombing': {
      const at =
        coupling.min === coupling.max
          ? String(coupling.max)
          : `${String(coupling.min)}-${String(coupling.max)}`;
      return [
        `BOMBS GO NONSTOP AT ${at}`,
        `LEFT OF ${String(coupling.fleet)}, NOT OF ${String(coupling.reference)}`,
      ];
    }
    case 'no-capture':
      return [`NO CAPTURE IN ${coupling.formation}`, 'IT HAS NO CAPTIVE SLOTS'];
  }
}

/**
 * The two detail lines for a list that may be kept: one coupling in full, or
 * the first line of each when there are more, or what was checked when there
 * are none.
 */
function acceptedDetails(couplings: readonly Coupling[]): string[] {
  const [only] = couplings;
  if (only === undefined) return [VERDICT_TEXT.buildsNote, VERDICT_TEXT.buildsNote2];
  if (couplings.length === 1) return [...couplingLines(only)];
  const firsts = couplings.map((coupling) => couplingLines(coupling)[0] ?? '');
  if (firsts.length <= 2) return firsts;
  return [firsts[0] ?? '', `+${String(firsts.length - 1)} MORE COUPLINGS`];
}

/** Ids compared as a person would sort them: `script-2` before `script-10`. */
const naturally = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Build the judge over what this build loaded. */
export function createComposer(options: ComposerOptions): Composer {
  const { sources, packs, variants } = options;
  const made = new WeakSet<object>(variants);
  const bases = new Map(variants.map((variant) => [variant.id, variant]));
  const reserved = variants.map((variant) => variant.id);
  /** Each shipped game's own document, by id, and the variant it loaded as, by document. */
  const documents = new Map<string, VariantDocument>();
  const shipped = new Map<VariantDocument, ResolvedVariant>();
  for (const variant of variants) {
    const value = sources.find((source) => source.file === variant.file)?.value;
    if (!isVariantDocument(value)) continue;
    documents.set(variant.id, value);
    shipped.set(value, variant);
  }
  const memo = new Map<
    string,
    { readonly verdict: Verdict; readonly variant: ResolvedVariant | undefined }
  >();

  const installed: readonly InstalledPack[] = [...packs.values()].map((pack) => ({
    id: pack.id,
    name: pack.manifest.name,
    rules: pack.rules !== undefined,
    stages: pack.stages.size,
  }));

  /**
   * Judge one document. `reserve` holds its id to the duplicate rule against the
   * shipped games, which is what every document a player keeps is held to; it is
   * off only for a draft taken straight from a shipped game's own document, which
   * carries that game's id because it is that game being edited, not a second one
   * claiming the id.
   */
  const judge = (
    document: VariantDocument,
    reserve: boolean,
  ): { readonly verdict: Verdict; readonly variant: ResolvedVariant | undefined } => {
    // A shipped game's own document is what the gate flew in CI, so there is
    // nothing to check: it is the variant the build loaded.
    const base = shipped.get(document);
    if (base !== undefined) {
      const couplings = findCouplings(base.registry, base.rules);
      return {
        verdict: {
          ok: true,
          headline: VERDICT_TEXT.own,
          details: couplings.length === 0 ? [VERDICT_TEXT.ownNote] : acceptedDetails(couplings),
        },
        variant: base,
      };
    }
    const key = `${reserve ? 'kept' : 'draft'}:${JSON.stringify(document)}`;
    const known = memo.get(key);
    if (known !== undefined) return known;

    // The file a document in `variants/` would be, so a failure reads the way the
    // gate's would. An id that is not a string fails the schema before this matters.
    const id = typeof document.id === 'string' ? document.id : 'variation';
    const source: VariantSource = { file: `${id}.json`, value: document };
    let result: { readonly verdict: Verdict; readonly variant: ResolvedVariant | undefined };
    const resolved = resolveVariant(source, packs, {}, reserve ? { reserved } : {});
    if (!resolved.ok) {
      result = { verdict: refusalOf(resolved.errors), variant: undefined };
    } else {
      const findings = checkStructure(resolved.variant);
      if (findings.length > 0) {
        result = { verdict: unplayableOf(findings), variant: undefined };
      } else {
        made.add(resolved.variant);
        result = {
          verdict: {
            ok: true,
            headline: VERDICT_TEXT.builds,
            details: acceptedDetails(
              findCouplings(resolved.variant.registry, resolved.variant.rules),
            ),
          },
          variant: resolved.variant,
        };
      }
    }
    memo.set(key, result);
    return result;
  };

  const compose = (
    document: VariantDocument,
  ): { readonly verdict: Verdict; readonly variant: ResolvedVariant | undefined } =>
    judge(document, true);

  /** Judge a draft made from `document`: held to the duplicate rule unless `document` shipped. */
  const draft = (
    document: VariantDocument,
    changed: VariantDocument,
  ): { readonly verdict: Verdict; readonly variant: ResolvedVariant | undefined } =>
    judge(changed, !shipped.has(document));

  /** The shipped game a document came from — itself, or the one it names — if installed. */
  const referenceOf = (document: VariantDocument): ResolvedVariant | undefined =>
    shipped.get(document) ??
    (typeof document.derivedFrom === 'string' ? bases.get(document.derivedFrom) : undefined) ??
    (typeof document.id === 'string' ? bases.get(document.id) : undefined);

  /**
   * What a document composes to over a pack list with no stage order, else the
   * game it came from — so a card over a document that will not load still lists
   * what can be played.
   */
  const overPacks = (
    document: VariantDocument,
    list: readonly string[],
  ): ResolvedVariant | undefined => {
    const own = listsOf(document);
    const over =
      own.stages === undefined && sameIds(own.packs, list)
        ? compose(document)
        : draft(document, withStages(withPacks(document, list), undefined));
    return over.variant ?? referenceOf(document);
  };

  return {
    installed,
    documentOf: (id) => documents.get(id),
    compose,
    judgePacks: (document, list) => {
      const own = listsOf(document);
      if (sameIds(own.packs, list)) return compose(document).verdict;
      const whole = draft(document, withPacks(document, list));
      if (whole.verdict.ok || own.stages === undefined) return whole.verdict;
      // The stored order may be all that is wrong: a pack it named is the one
      // being switched off. The list can still be kept — and the card says, before
      // `ENTER`, that the order goes with it.
      const alone = draft(document, withStages(withPacks(document, list), undefined)).verdict;
      if (!alone.ok) return alone;
      return {
        ...alone,
        details: [VERDICT_TEXT.clearsStages, ...alone.details].slice(0, 2),
        clearsStages: true,
      };
    },
    judgeStages: (document, stages) => {
      const own = listsOf(document).stages;
      const same =
        own === undefined || stages === undefined ? own === stages : sameIds(own, stages);
      return (same ? compose(document) : draft(document, withStages(document, stages))).verdict;
    },
    stageOptions: (document, list): readonly StageOption[] => {
      const variant = overPacks(document, list);
      if (variant === undefined) return [];
      const layer = new Map(variant.registry.packs.map((pack, index) => [pack.id, index]));
      const options = [...variant.registry.stages.values()]
        .filter((stage) => stage.kind !== 'challenge')
        .map((stage) => {
          const from = variant.registry.sourceOf('stages', stage.id)?.packId ?? '';
          return {
            id: stage.id,
            from,
            pack: packs.get(from)?.manifest.name ?? from,
          };
        });
      options.sort(
        (a, b) => (layer.get(a.from) ?? 0) - (layer.get(b.from) ?? 0) || naturally(a.id, b.id),
      );
      return options.map(({ id, pack }) => ({ id, pack }));
    },
    ownStages: (document, list, rank) => {
      const variant = overPacks(document, list);
      if (variant === undefined) return [];
      return resolveStageSequence(variant.registry.manifest, variant.rules, rank).normal.rows;
    },
    resolvedOf: (variant) => (made.has(variant) ? (variant as ResolvedVariant) : undefined),
  };
}

/** Whether two id lists are the same ids in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}
