/**
 * The documentation accuracy checker.
 *
 * Every factual claim a document makes about this repository is either checked
 * here or is not a claim this project allows. The split is deliberate:
 *
 * - **{@link checkDoc} is pure.** Document text and a {@link DocWorld} in, a list
 *   of {@link DocProblem}s out. It touches no filesystem, which is the only
 *   reason `tests/unit/docs-accuracy.test.ts` can falsify it: the same function
 *   that scans the real docs is handed synthetic text carrying a deliberately
 *   false claim, and has to report it.
 * - **{@link realWorld} is the impure half.** It reads the tree, `package.json`
 *   and the shipped pack once and hands {@link checkDoc} the answers.
 *
 * Two kinds of check, because the cost to an author differs:
 *
 * 1. **Harvested for free.** Path-like inline code spans, Markdown link and
 *    image targets, their `#anchors`, `npm run …` commands and a quoted
 *    `"node": "…"` range are recognised from the text as written. An author
 *    pays nothing and cannot forget.
 * 2. **Declared with a marker.** Anything needing interpretation — a count, a
 *    deliberate absence, a path in somebody else's repository — carries an HTML
 *    comment the harvest reads. `AGENTS.md` documents the vocabulary; it is
 *    invisible in rendered Markdown, which is what stops it rotting into
 *    something an author routes around.
 *
 * Markers inside a fenced code block are inert, so a document may show one as an
 * example — `AGENTS.md` does — without asserting it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { personaSchema } from '../../../src/content/personas.js';
import type { Formation, Sprite, StageSequence } from '../../../src/content/schema.js';
import {
  ABILITY_TYPES,
  CONTENT_DIRS,
  formationAxes,
  pathSegmentSchema,
  RESERVED_ABILITY_TYPES,
  STAGE_KINDS,
} from '../../../src/content/schema.js';
import { ABILITY_REGISTRY } from '../../../src/sim/abilities/registry.js';
import {
  REVERSE_PIXELS_PER_FRAME,
  SPEED_BYTE_UNIT,
  STAGE_SPEEDS,
  STAR_BANKS,
  TWINKLE_FRAMES,
} from '../../../src/render/starfield.js';
import { SETTINGS_ROW_IDS, settingsNotes } from '../../../src/ui/menus.js';
import { exitConfirmUnderLines } from '../../../src/ui/pause.js';
import { CONTROL_SCHEMES } from '../../../src/ui/settings.js';
import { classicFormation, classicPack, classicRules } from '../../helpers/rules.js';
import { installedPack, shippedVariants } from '../../helpers/variants.js';

/* -------------------------------------------------------------------------- */
/* What a document may declare                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The four documentation layers, plus the one axis that is not a layer.
 *
 * A layer is a contract about *tense*, and only `state` makes assertions about
 * what the code currently is. That is what makes the other three exempt from
 * testing by construction rather than by permission — and it is enforced below:
 * `check:count` is refused outside `state` and `reference`.
 *
 * `reference` is the odd one out. `docs/reference/arcade-reference.md` makes
 * present-tense claims about the *arcade original*, which no test here can
 * reach; its counterweight is `tests/unit/classic-pack.test.ts`.
 */
export const DOC_LAYERS = ['vision', 'state', 'roadmap', 'ideas', 'reference'] as const;

export type DocLayer = (typeof DOC_LAYERS)[number];

/** Layers whose documents may state a count. See {@link DOC_LAYERS}. */
const COUNTING_LAYERS: readonly DocLayer[] = ['state', 'reference'];

/**
 * Layers a document must declare exactly one of, repo-wide. A directory README
 * declares nothing and is treated as `state`, which is the strict default: every
 * claim in it is checked.
 */
export const SINGLETON_LAYERS: readonly DocLayer[] = ['vision', 'roadmap', 'ideas'];

/** The marker verbs. An unrecognised `check:` verb is itself a failure. */
const VERBS = ['path', 'absent', 'foreign', 'count', 'script', 'engines'] as const;

/* -------------------------------------------------------------------------- */
/* Problems                                                                    */
/* -------------------------------------------------------------------------- */

export interface DocProblem {
  /** Repo-relative path of the document, with forward slashes. */
  readonly doc: string;
  /** 1-based line the claim is on, so a failure reads like a compiler error. */
  readonly line: number;
  readonly message: string;
}

/** What {@link checkDoc} is allowed to know about the repository. */
export interface DocWorld {
  /** Does this repo-relative path exist? */
  readonly exists: (path: string) => boolean;
  /** The heading anchors of a document, or `undefined` if there is no such doc. */
  readonly anchors: (path: string) => ReadonlySet<string> | undefined;
  /** The names in `package.json`'s `scripts`. */
  readonly scripts: ReadonlySet<string>;
  /** Named quantities derived from the code and the shipped pack. */
  readonly counters: ReadonlyMap<string, () => number>;
  /** `package.json`'s `engines.node`, verbatim. */
  readonly enginesNode: string;
}

export interface Doc {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  readonly text: string;
}

/* -------------------------------------------------------------------------- */
/* Text shapes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A token that looks like a path *in this repository*: it names one of the
 * directories the repository actually has, so a bare filename — `world.ts`,
 * `rules.json` — is not swept up. Globs and placeholders (`packs/<name>/`,
 * `tests/unit/**`) fail this deliberately: they name no one file.
 */
const REPO_PATH = /^(?:src|tests|packs|docs|scripts|\.github)\/[\w./@-]+$/;

/** An `npm test` / `npm run <script>` in an inline code span. */
const NPM_COMMAND = /`npm (?:run )?([a-z][a-z:-]*)`/g;

/** A quoted engines range, as `package.json` writes it. */
const ENGINES_QUOTE = /"node":\s*"([^"]+)"/g;

/** Inline code spans. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** Markdown links and images, inline form. */
const LINK = /!?\[[^\]]*\]\(([^)\s]+)\)/g;

/** A marker: `<!-- check:verb argument… -->` or `<!-- doc:layer state -->`. */
const MARKER = /<!--\s*(check|doc):([a-z]+)\s*([^>]*?)\s*-->/g;

/** ATX headings, for anchors. */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/gm;

/**
 * Blank out fenced code blocks, keeping every newline so line numbers survive.
 *
 * Everything inside a fence is an example: a JSON document, a directory tree, a
 * marker shown as documentation. None of it is a claim, and a directory tree in
 * a fence is precisely how `docs/DESIGN.md` section 9 came to list three files
 * that do not exist — which is why that listing now lives in the state document
 * where a marker checks it.
 */
export function blankFences(text: string): string {
  return text.replace(/^([ \t]*)(```|~~~)[\s\S]*?^\1?\2[ \t]*$/gm, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

/** GitHub's heading-to-anchor slug, which is what a `#fragment` has to match. */
export function anchorSlug(heading: string): string {
  return heading
    .replace(/`/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Every heading anchor in a document. */
export function anchorsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of blankFences(text).matchAll(HEADING)) out.add(anchorSlug(match[2] ?? ''));
  return out;
}

/** The layer a document declares, or `undefined` if it declares none. */
export function declaredLayer(text: string): DocLayer | undefined {
  for (const match of blankFences(text).matchAll(MARKER)) {
    if (match[1] !== 'doc' || match[2] !== 'layer') continue;
    const value = (match[3] ?? '').trim();
    if ((DOC_LAYERS as readonly string[]).includes(value)) return value as DocLayer;
  }
  return undefined;
}

/** Every line with the offset it starts at. */
function textLines(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    out.push([offset, line]);
    offset += line.length + 1;
  }
  return out;
}

/** The line after the one starting at `offset`, or `undefined` at the end. */
function nextLine(text: string, offset: number): string | undefined {
  const start = text.indexOf('\n', offset);
  if (start === -1) return undefined;
  const end = text.indexOf('\n', start + 1);
  return end === -1 ? text.slice(start + 1) : text.slice(start + 1, end);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

/** Resolve a document-relative reference to a repo-relative path. */
function repoPathOf(docPath: string, reference: string): string {
  const docDir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
  const parts: string[] = [];
  for (const part of `${docDir}/${reference}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/* -------------------------------------------------------------------------- */
/* The check                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Check one document. Pure: everything it knows comes from {@link DocWorld}.
 *
 * The order matters in one place only — `check:absent` and `check:foreign` are
 * collected first, because they are what exempts a path from the existence
 * sweep. Everything else is independent, and every problem found is reported
 * rather than the first one thrown, so one run names every stale claim.
 */
export function checkDoc(doc: Doc, world: DocWorld): DocProblem[] {
  const text = blankFences(doc.text);
  const problems: DocProblem[] = [];
  const at = (index: number, message: string): void => {
    problems.push({ doc: doc.path, line: lineOf(doc.text, index), message });
  };

  const layer = declaredLayer(doc.text) ?? 'state';

  // Pass 1: markers. `absent` and `foreign` also build the exemption set the
  // existence sweep below consults, so they are gathered before it runs.
  const exempt = new Set<string>();
  for (const match of text.matchAll(MARKER)) {
    const [kind, verb, rest] = [match[1], match[2] ?? '', (match[3] ?? '').trim()];
    const index = match.index;
    if (kind === 'doc') {
      if (verb !== 'layer') at(index, `unknown marker doc:${verb}`);
      else if (!(DOC_LAYERS as readonly string[]).includes(rest)) {
        at(index, `doc:layer names no layer: ${rest || '(empty)'}`);
      }
      continue;
    }
    if (!(VERBS as readonly string[]).includes(verb)) {
      at(index, `unknown marker check:${verb} — the verbs are ${VERBS.join(', ')}`);
      continue;
    }
    const args = rest.split(/\s+/).filter((part) => part !== '');
    if (args.length === 0) {
      at(index, `check:${verb} was given nothing to check`);
      continue;
    }

    switch (verb) {
      case 'path':
        for (const path of args) {
          if (!world.exists(path))
            at(index, `check:path names a path that does not exist: ${path}`);
        }
        break;
      case 'absent':
        for (const path of args) {
          exempt.add(path);
          if (world.exists(path)) {
            at(index, `check:absent names a path that now exists: ${path} — the claim is stale`);
          }
        }
        break;
      case 'foreign':
        for (const path of args) exempt.add(path);
        break;
      case 'count': {
        if (!COUNTING_LAYERS.includes(layer)) {
          at(
            index,
            `check:count in a ${layer} document — a count is a claim about what the code ` +
              `currently is, so it belongs in a ${COUNTING_LAYERS.join(' or ')} document`,
          );
          break;
        }
        // `name number` pairs, so one sentence stating two counts needs one
        // marker. An odd argument list is an error rather than a silent trailing
        // claim nothing checked.
        if (args.length % 2 !== 0) {
          at(index, `check:count takes name/number pairs; got ${args.length} arguments`);
          break;
        }
        for (let pair = 0; pair < args.length; pair += 2) {
          const name = args[pair] ?? '';
          const stated = args[pair + 1] ?? '';
          const counter = world.counters.get(name);
          if (counter === undefined) {
            at(index, `check:count names no known quantity: ${name}`);
            continue;
          }
          if (!/^\d+$/.test(stated)) {
            at(index, `check:count ${name} needs a whole number, got ${stated}`);
            continue;
          }
          const actual = counter();
          if (actual !== Number(stated)) {
            at(index, `check:count ${name} says ${stated}; the repository says ${actual}`);
          }
        }
        break;
      }
      case 'script':
        for (const name of args) {
          if (!world.scripts.has(name)) {
            at(index, `check:script names no script in package.json: ${name}`);
          }
        }
        break;
      case 'engines': {
        const stated = rest;
        if (stated !== world.enginesNode) {
          at(index, `check:engines says ${stated}; package.json says ${world.enginesNode}`);
        }
        break;
      }
    }
  }

  // Pass 1b: where the marker sits. An HTML comment alone on a line interrupts a
  // paragraph, so one with paragraph text straight after it splits that paragraph
  // in two when rendered — invisible in the source, visible on the page. At the
  // end of a block, or inline after text, it renders as nothing at all. A line
  // that opens a block of its own (the next list item, a heading, a fence) is
  // fine, which is why this looks at what follows rather than banning the shape.
  const CONTINUES_A_PARAGRAPH = /^\s*(?![-*+>|#]|\d+[.)]|```|~~~|<)\S/;
  for (const [offset, line] of textLines(text)) {
    if (!/^\s*<!--\s*(?:check|doc):/.test(line) || !line.trimEnd().endsWith('-->')) continue;
    const next = nextLine(text, offset);
    if (next !== undefined && CONTINUES_A_PARAGRAPH.test(next)) {
      at(
        offset,
        'a marker on its own line with paragraph text straight after it splits that ' +
          'paragraph when rendered — move it to the end of the paragraph, or inline ' +
          'after the text',
      );
    }
  }

  // Pass 2: path-like code spans. Anything naming a directory this repository
  // has must exist, unless the document declared it absent or foreign.
  for (const match of text.matchAll(CODE_SPAN)) {
    const token = (match[1] ?? '').replace(/\/$/, '');
    if (!REPO_PATH.test(token) || exempt.has(token) || exempt.has(`${token}/`)) continue;
    if (!world.exists(token)) {
      at(
        match.index,
        `names \`${token}\`, which does not exist — fix the reference, or declare it: ` +
          `<!-- check:absent ${token} --> if it is deliberately not here yet, ` +
          `<!-- check:foreign ${token} --> if it belongs to another project`,
      );
    }
  }

  // Pass 3: links and images. A local target must resolve, and a `#fragment`
  // must be a heading that is really there — link rot is how a restructure goes
  // wrong quietly.
  for (const match of text.matchAll(LINK)) {
    const target = match[1] ?? '';
    if (/^(?:[a-z]+:|#|\/\/)/.test(target)) {
      if (!target.startsWith('#')) continue;
      const fragment = target.slice(1);
      if (!anchorsOf(doc.text).has(fragment)) {
        at(match.index, `links to #${fragment}, which is not a heading in this document`);
      }
      continue;
    }
    const [reference, fragment] = target.split('#');
    if (reference === undefined || reference === '') continue;
    const path = repoPathOf(doc.path, decodeURI(reference));
    if (exempt.has(path)) continue;
    if (!world.exists(path)) {
      at(match.index, `links to ${path}, which does not exist`);
      continue;
    }
    if (fragment === undefined || !path.endsWith('.md')) continue;
    const anchors = world.anchors(path);
    if (anchors !== undefined && !anchors.has(fragment)) {
      at(match.index, `links to ${path}#${fragment}, which is not a heading there`);
    }
  }

  // Pass 4: the getting-started commands. `npm install` and `npm ci` are npm's
  // own; everything else has to be a script somebody can run.
  for (const match of text.matchAll(NPM_COMMAND)) {
    const name = match[1] ?? '';
    if (name === 'install' || name === 'ci') continue;
    if (!world.scripts.has(name)) {
      at(match.index, `names \`npm ${name}\`, which is not a script in package.json`);
    }
  }

  // Pass 5: a quoted engines range has to be the one that ships.
  for (const match of text.matchAll(ENGINES_QUOTE)) {
    const quoted = match[1] ?? '';
    if (quoted !== world.enginesNode) {
      at(match.index, `quotes "node": "${quoted}"; package.json says "${world.enginesNode}"`);
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/* The impure half                                                             */
/* -------------------------------------------------------------------------- */

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/**
 * Directories with no documentation to check in them: build output, dependencies
 * and the git-excluded scratch space `AGENTS.md` points probes at.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.scratch',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** Every Markdown document in the repository, repo-relative and sorted. */
export function markdownDocs(root = REPO_ROOT): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (name.endsWith('.md')) out.push(relative(root, path).split(/[\\/]/).join('/'));
    }
    return out;
  };
  return walk(root);
}

export function readDoc(path: string, root = REPO_ROOT): Doc {
  return { path, text: readFileSync(join(root, path), 'utf8') };
}

function existsIn(root: string): (path: string) => boolean {
  return (path) => {
    if (path === '' || path.startsWith('..')) return false;
    try {
      statSync(join(root, path));
      return true;
    } catch {
      return false;
    }
  };
}

/** The real repository, read once. */
export function realWorld(root = REPO_ROOT): DocWorld {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    engines: { node: string };
  };
  const anchorCache = new Map<string, ReadonlySet<string> | undefined>();
  const exists = existsIn(root);
  return {
    exists,
    anchors: (path) => {
      if (!anchorCache.has(path)) {
        anchorCache.set(
          path,
          exists(path) ? anchorsOf(readFileSync(join(root, path), 'utf8')) : undefined,
        );
      }
      return anchorCache.get(path);
    },
    scripts: new Set(Object.keys(packageJson.scripts)),
    counters: counters(root),
    enginesNode: packageJson.engines.node,
  };
}

/* -------------------------------------------------------------------------- */
/* Counters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Source files in a directory.
 *
 * `__…__.ts` is excluded, and that is not cosmetic: `tests/unit/sim-boundary.test.ts`
 * writes `src/sim/__boundary_probe__.ts` and deletes it again, and Vitest runs
 * test files in parallel — so counting it makes `sim.modules` 12 or 13 depending
 * on which test file got there first.
 */
function filesIn(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(extension) && !name.startsWith('__'));
  } catch {
    return [];
  }
}

/** The reference, which is the one document whose open items are counted. */
const REFERENCE = 'docs/reference/arcade-reference.md';

/**
 * Top-level numbered items in the section whose heading contains `heading`.
 *
 * Stops at the next heading of the same level or higher, and ignores indented
 * continuation lines, so a nested list inside an item counts once.
 */
function numberedItemsUnder(source: string, heading: string): number {
  const text = blankFences(source);
  const start = [...text.matchAll(/^(#{2,6})\s+(.+)$/gm)].find((match) =>
    (match[2] ?? '').includes(heading),
  );
  if (start?.index === undefined) {
    throw new Error(`no heading containing "${heading}" — has it been renamed?`);
  }
  const level = (start[1] ?? '##').length;
  const body = text.slice(start.index + start[0].length);
  const end = body.search(new RegExp(`^#{1,${String(level)}}\\s`, 'm'));
  const section = end < 0 ? body : body.slice(0, end);
  return [...section.matchAll(/^\d+\.\s/gm)].length;
}

/** The number of quoted strings in a declaration, e.g. a string-union type. */
function quotedIn(source: string, declaration: RegExp, what: string): number {
  const match = declaration.exec(source);
  if (match?.[1] === undefined) throw new Error(`could not find ${what} — has it been rewritten?`);
  return [...match[1].matchAll(/'[^']+'/g)].length;
}

/**
 * The quantities a document may state, each derived rather than written down.
 *
 * The rule for adding one: it has to be computed from the code or the shipped
 * pack. A counter that returns a literal proves nothing — it only moves the
 * hand-maintained number into a file nobody reads.
 */
/**
 * The three persona fields that are *not* axes: what it is called and how it reads
 * on a menu row. Everything else in the schema is something a watcher can see the
 * effect of, which is what `autoplay.axes` counts.
 */
const PERSONA_LABELLING: ReadonlySet<string> = new Set(['id', 'label', 'description']);

/** Every autoplay persona the shipped games declare, through the real loader. */
function shippedPersonas(): readonly { readonly id: string }[] {
  return shippedVariants().flatMap((variant) => variant.personas);
}

/**
 * The personas of one variant.
 *
 * Separate from {@link shippedPersonas} since a second game started declaring its
 * own: "four personas ship with the Classic game" and "the build offers six" are
 * different claims, and one counter answering both would make whichever document
 * stated the other one wrong.
 */
function personasOf(id: string): readonly { readonly id: string }[] {
  const variant = shippedVariants().find((candidate) => candidate.id === id);
  if (variant === undefined) throw new Error(`no variant "${id}" ships`);
  return variant.personas;
}

/** The sprite the shipped pack plays when the fighter in play is destroyed. */
function deathSprite(): Sprite {
  const pack = classicPack();
  const bound = pack.manifest.effects['player-hit'];
  const sprite = bound === undefined ? undefined : pack.sprites.get(bound.sprite);
  if (sprite === undefined) {
    throw new Error('the Classic pack no longer binds an effect to `player-hit`');
  }
  return sprite;
}

/** The forged pack's own formation, by the id its manifest declares. */
function forgedFormation(): Formation {
  const formations = [...installedPack('deep-sea').formations.values()];
  const formation = formations[0];
  if (formation === undefined || formations.length !== 1) {
    throw new Error(
      `packs/deep-sea declares ${String(formations.length)} formations, expected one`,
    );
  }
  return formation;
}

/**
 * The forged pack's own stage sequence.
 *
 * Read off the pack's manifest rather than the composed variant's, because the
 * claim its README makes is about what the pack *states* — the challenge half it
 * leaves empty on purpose is the point of the claim.
 */
function forgedSequence(): StageSequence {
  return installedPack('deep-sea').manifest.stageSequence;
}

export function counters(root = REPO_ROOT): ReadonlyMap<string, () => number> {
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');
  const stagesOfKind = (kind: string): number =>
    [...classicPack().stages.values()].filter((stage) => stage.kind === kind).length;

  return new Map<string, () => number>([
    /* The front end. This is the count that already went wrong once. */
    [
      'flow.phases',
      () => quotedIn(read('src/ui/flow.ts'), /export type GamePhase =([^;]+);/, 'GamePhase'),
    ],
    [
      'vitest.projects',
      () => [...read('vitest.config.ts').matchAll(/^\s*name: '[^']+',$/gm)].length,
    ],

    /**
     * How often a running page asks whether a newer build is being served, in
     * seconds.
     *
     * Read off the cadence `src/main.ts` hands the update watcher, which is
     * written in simulation steps against `STEP_HZ` because every timer in
     * `src/ui/` is. The document states the number a reader cares about and the
     * code keeps the number it needs, and this is what holds the two together.
     */
    [
      'build.pollSeconds',
      () => {
        const match = /everySteps:\s*(\d+)\s*\*\s*STEP_HZ/.exec(read('src/main.ts'));
        if (match?.[1] === undefined) {
          throw new Error('could not find the build-poll cadence in src/main.ts');
        }
        return Number(match[1]);
      },
    ],

    /* The layers, and the modules in them. */
    [
      'src.layers',
      () =>
        readdirSync(join(root, 'src'), { withFileTypes: true }).filter((entry) =>
          entry.isDirectory(),
        ).length,
    ],
    ['sim.modules', () => filesIn(join(root, 'src', 'sim'), '.ts').length],
    ['sim.abilities.modules', () => filesIn(join(root, 'src', 'sim', 'abilities'), '.ts').length],
    /**
     * The abilities the engine implements, read off the registry itself rather
     * than off the file count: the directory also holds the registry, and a module
     * nobody registered is not an ability anything can switch on.
     */
    ['sim.abilities.implemented', () => Object.keys(ABILITY_REGISTRY).length],

    /* What the schema reserves, as against what a pack uses. */
    ['schema.abilityIds', () => ABILITY_TYPES.length],
    ['schema.reservedAbilityIds', () => RESERVED_ABILITY_TYPES.length],
    ['schema.stageKinds', () => STAGE_KINDS.length],
    ['schema.contentDirs', () => CONTENT_DIRS.length],
    ['schema.pathSegments', () => pathSegmentSchema.options.length],

    /**
     * The games this build offers, through the real readers and the real loader.
     *
     * Derived rather than counted by hand for the usual reason, and derived from
     * the *loaded* variants rather than from the file count so that a document
     * which does not load cannot inflate the number a document states.
     */
    ['variants.count', () => shippedVariants().length],
    [
      'variants.demonstrations',
      () => shippedVariants().filter((variant) => variant.demonstration).length,
    ],
    ['ui.controlSchemes', () => CONTROL_SCHEMES.length],
    ['ui.settingsRows', () => SETTINGS_ROW_IDS.length],

    /**
     * The dim lines a card draws to say which key does what.
     *
     * Counted off the list each draw function iterates, so a document claiming a
     * card tells the player how to answer it is held to the card rather than to
     * somebody's memory of it — and a card that quietly loses one, as the
     * settings card did when storage was blocked, fails here.
     */
    [
      'ui.exitCardHelpLines',
      () => exitConfirmUnderLines(0).filter((line) => line.tone === 'help').length,
    ],
    [
      'ui.settingsHelpLines',
      () => settingsNotes('', true).filter((line) => line.tone === 'help').length,
    ],

    /**
     * Autoplay: the personas the shipped game offers, and the axes one declares.
     *
     * Both derived from the real thing rather than counted by hand. The personas
     * come from the loaded variant, so a document that does not load cannot inflate
     * the number — the same reason `variants.count` reads the loader. The axes come
     * from the schema minus the three fields that are not axes at all (`id`, `label`
     * and the optional `description`), because "eight axes" is the claim the design
     * makes and a ninth field that nobody could see the effect of would quietly
     * make it false.
     */
    ['autoplay.personas', () => shippedPersonas().length],
    ['autoplay.classicPersonas', () => personasOf('classic').length],
    ['autoplay.forgedPersonas', () => personasOf('deep-sea').length],
    [
      'autoplay.axes',
      () => Object.keys(personaSchema.shape).filter((key) => !PERSONA_LABELLING.has(key)).length,
    ],

    /* The shipped Classic pack, through the real loader. */
    ['classic.aliens', () => classicPack().aliens.size],
    ['classic.paths', () => classicPack().paths.size],
    ['classic.sprites', () => classicPack().sprites.size],
    ['classic.sounds', () => classicPack().sounds.size],
    ['classic.roles', () => Object.keys(classicPack().manifest.roles).length],
    ['classic.stageBadges', () => classicPack().manifest.stageBadges.length],
    ['classic.stages.normal', () => stagesOfKind('normal')],
    ['classic.stages.challenge', () => stagesOfKind('challenge')],
    ['classic.stages.boss', () => stagesOfKind('boss')],
    ['classic.sequence.normal', () => classicPack().manifest.stageSequence.normal.rows.length],
    [
      'classic.sequence.challenge',
      () => classicPack().manifest.stageSequence.challenge.rows.length,
    ],
    /**
     * What losing a fighter looks like, derived from the pack rather than stated.
     *
     * The death animation is pack data twice over — which event plays it is the
     * manifest's `effects` map, and how long it runs is the referenced sprite's
     * own `frames` × `frameDuration` — so a document that quoted either number by
     * hand would be quoting something two files could move independently. These
     * resolve the binding exactly as `src/render/effects.ts` does, and throw
     * rather than return 0 if the pack stops shipping one, because a silent zero
     * would let a document keep claiming an animation that had gone.
     */
    ['classic.effects', () => Object.keys(classicPack().manifest.effects).length],
    ['classic.death.frames', () => deathSprite().frames.length],
    [
      'classic.death.steps',
      () => {
        const sprite = deathSprite();
        return sprite.frames.length * (sprite.frameDuration ?? 0);
      },
    ],
    ['rules.respawnFrames', () => classicRules().player.respawnFrames],

    ['classic.formation.slots', () => classicFormation().slots.length],
    ['classic.formation.captiveSlots', () => classicFormation().captiveSlots.length],
    [
      'classic.formation.columns',
      () => new Set(classicFormation().slots.map((slot) => slot.column)).size,
    ],
    [
      'classic.formation.rows',
      () => new Set(classicFormation().slots.map((slot) => slot.row)).size,
    ],

    /**
     * The entry waves every normal stage flies. Uniform across the shipped
     * documents, and a document claiming "five waves" means all of them — so a
     * stage that disagreed would make the claim meaningless rather than wrong by
     * one, and this throws instead of averaging.
     */
    [
      'classic.entryWaves',
      () => {
        const counts = new Set(
          [...classicPack().stages.values()]
            .filter((stage) => stage.kind === 'normal')
            .map((stage) => stage.waves.length),
        );
        if (counts.size !== 1) {
          throw new Error(`normal stages fly different wave counts: ${[...counts].join(', ')}`);
        }
        return [...counts][0] ?? 0;
      },
    ],

    /**
     * Arcade questions the reference still lists as unresolved.
     *
     * Counted from the numbered items under its own "Unresolved items" heading,
     * because that section exists to *shrink*: every item in it is one
     * observation away from being closed, and a state document saying "one
     * question is open" after a second one lands is the exact rot this suite is
     * for. Structural rather than textual — the heading and the list markers, not
     * the words — so rewording an item cannot move the number.
     */
    ['reference.openQuestions', () => numberedItemsUnder(read(REFERENCE), 'Unresolved items')],

    /**
     * The starfield's arcade numbers, read off the module that holds them.
     *
     * The conversion from the pack's speed byte to pixels is presentation, so
     * unlike every other verified arcade value these live in `src/render/` rather
     * than in `rules.json` — which means the `provenance` block cannot mark them
     * and these counters are what hold the state document to the code. Imported
     * rather than pattern-matched: `SPEED_BYTE_UNIT` and `TWINKLE_FRAMES` are
     * themselves derived from the accumulator's width and the selector bit, and a
     * regex would read the expression instead of the number.
     */
    ['starfield.speedByteUnit', () => SPEED_BYTE_UNIT],
    ['starfield.stageSpeeds', () => STAGE_SPEEDS.length],
    ['starfield.reversePixels', () => REVERSE_PIXELS_PER_FRAME],
    ['starfield.banks', () => STAR_BANKS],
    ['starfield.twinkleFrames', () => TWINKLE_FRAMES],

    /**
     * The forged pack, read through the real loader exactly as the Classic
     * counters are.
     *
     * A forged pack's README is a state document like any other, so the numbers in
     * it are derived rather than typed — and derived from the *loaded* pack, so a
     * document that stopped loading cannot keep claiming its contents.
     */
    ['deepSea.aliens', () => installedPack('deep-sea').aliens.size],
    ['deepSea.paths', () => installedPack('deep-sea').paths.size],
    ['deepSea.stages', () => installedPack('deep-sea').stages.size],
    ['deepSea.sprites', () => installedPack('deep-sea').sprites.size],
    ['deepSea.sounds', () => installedPack('deep-sea').sounds.size],
    ['deepSea.palette', () => installedPack('deep-sea').manifest.palette.length],
    ['deepSea.sequenceNormal', () => forgedSequence().normal.rows.length],
    ['deepSea.sequenceChallenge', () => forgedSequence().challenge.rows.length],
    ['deepSea.formationSlots', () => forgedFormation().slots.length],
    ['deepSea.formationCaptiveSlots', () => forgedFormation().captiveSlots.length],
    ['deepSea.formationColumns', () => formationAxes(forgedFormation()).columns.length],
    ['deepSea.formationRows', () => formationAxes(forgedFormation()).rows.length],

    /* The rules layer. */
    ['rules.ranks', () => Object.keys(classicRules().difficulty.ranks).length],
    /**
     * How many roles can attack at all under the Classic rules.
     *
     * `resolveLaunchCredit` returns nothing for a role a difficulty row does not
     * name, so this is the vocabulary a pack layered over these rules has to use if
     * its aliens are to dive — a claim `docs/content-guide.md` makes and a forged
     * pack depends on. Unioned across every rank's every row rather than read off
     * one, because a role that appeared in only one rank would still be a role that
     * can attack.
     */
    [
      'rules.launchRoles',
      () =>
        new Set(
          Object.values(classicRules().difficulty.ranks).flatMap((rank) =>
            rank.stageTable.rows.flatMap((row) => Object.keys(row.launchRates)),
          ),
        ).size,
    ],
    ['rules.breatheColumns', () => classicRules().formation.breathe?.columns.length ?? 0],
    ['rules.breatheRows', () => classicRules().formation.breathe?.rows.length ?? 0],
    [
      'rules.difficultyRows',
      () => {
        const rows = new Set(
          Object.values(classicRules().difficulty.ranks).map((rank) => rank.stageTable.rows.length),
        );
        if (rows.size !== 1) {
          throw new Error(`rank tables are different lengths: ${[...rows].join(', ')}`);
        }
        return [...rows][0] ?? 0;
      },
    ],
  ]);
}

/* -------------------------------------------------------------------------- */
/* The Node range                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Does `version` satisfy `range`?
 *
 * Deliberately narrow: `^X.Y.Z` and `>=X[.Y[.Z]]` comparators joined by `||`,
 * which is the whole of what `package.json` uses here. Anything else throws
 * rather than guessing, because a range this test silently misreads is a range
 * it is not checking.
 */
export function satisfies(version: string, range: string): boolean {
  const parse = (text: string): [number, number, number] => {
    const parts = text.split('.').map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part))) throw new Error(`not a version: ${text}`);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const compare = (a: readonly number[], b: readonly number[]): number =>
    (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);

  const actual = parse(version);
  return range.split('||').some((part) => {
    const comparator = part.trim();
    if (comparator.startsWith('^')) {
      const floor = parse(comparator.slice(1));
      return compare(actual, floor) >= 0 && actual[0] === floor[0];
    }
    if (comparator.startsWith('>=')) return compare(actual, parse(comparator.slice(2).trim())) >= 0;
    throw new Error(`unsupported comparator in engines range: ${comparator}`);
  });
}

/** The `node-version` the CI workflow installs. */
export function ciNodeVersion(root = REPO_ROOT): string {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const match = /node-version:\s*'?([\d.]+)'?/.exec(workflow);
  if (match?.[1] === undefined) throw new Error('could not find node-version in the CI workflow');
  return match[1];
}
