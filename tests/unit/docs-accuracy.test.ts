import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  anchorsOf,
  checkDoc,
  ciNodeVersion,
  counters,
  declaredLayer,
  type DocProblem,
  type DocWorld,
  markdownDocs,
  readDoc,
  realWorld,
  REPO_ROOT,
  satisfies,
  SINGLETON_LAYERS,
} from './helpers/docs.js';

/**
 * Documentation accuracy.
 *
 * This project has a recorded history of documents that were true when written
 * and false a merge later: a README claiming "no gameplay yet" two milestones
 * after gameplay existed, a plan listing three source files nobody wrote, an
 * architecture document falsified in four statements by the very next merge, a
 * pack README describing shipped content as deliberately absent. Nobody lied in
 * any of those cases — the code moved and the prose did not.
 *
 * So the rule is structural rather than editorial: documents are separated by how
 * fast they change and by whether a machine can check them, and a document that
 * makes a verifiable claim about this repository has to make it in a form this
 * suite reads. `AGENTS.md` states the four layers, the present-tense rule and the
 * marker vocabulary; `tests/unit/helpers/docs.ts` is the checker.
 *
 * Three groups of test below, and the third is the one that matters most:
 *
 *  1. **The real documents** — every Markdown file in the tree, checked.
 *  2. **The structure** — the four layers exist and each is declared once.
 *  3. **The checker itself** — fed a deliberately false claim of every kind, and
 *     required to catch each one. Without that, a suite that silently stopped
 *     checking would read exactly like a suite with nothing to report, which is
 *     the same failure `tests/unit/world.test.ts` pins from both edges for the
 *     replay fingerprint.
 */

const world = realWorld();
const docs = markdownDocs();

function lines(problems: readonly DocProblem[]): string[] {
  return problems.map((problem) => `${problem.doc}:${problem.line} ${problem.message}`);
}

describe('every document in the tree', () => {
  it('finds documents to check at all', () => {
    // A walk that quietly stopped finding files would make every test below pass.
    expect(docs).toContain('README.md');
    expect(docs).toContain('AGENTS.md');
    expect(docs.length).toBeGreaterThan(15);
  });

  it.each(docs)('%s states nothing the repository contradicts', (path) => {
    expect(lines(checkDoc(readDoc(path), world))).toEqual([]);
  });
});

describe('the four layers', () => {
  /**
   * The structural bug this suite was written against: layer 1 (why the project
   * exists) and layer 2 (what the code currently is) shared one file, so a plan
   * nobody was updating carried a file listing that rotted. A layer is declared
   * in the document itself, so the split cannot be undone by a rename.
   */
  const declared = new Map(docs.map((path) => [path, declaredLayer(readDoc(path).text)]));

  it.each(SINGLETON_LAYERS)('has exactly one %s document', (layer) => {
    const found = [...declared].filter(([, declaredAs]) => declaredAs === layer).map(([at]) => at);
    expect(found).toHaveLength(1);
  });

  it('has a state document, and every other document defaults to state', () => {
    const state = [...declared].filter(([, layer]) => layer === 'state').map(([path]) => path);
    expect(state).toContain('docs/ARCHITECTURE.md');
    // An undeclared document is checked as strictly as a declared state one, so
    // the directory READMEs need no marker and get no exemption.
    expect([...declared].some(([, layer]) => layer === undefined)).toBe(true);
  });
});

describe('the getting-started contract', () => {
  it('runs the documented commands on a Node version CI actually installs', () => {
    // Two halves of one claim: the range `package.json` declares, and the version
    // the workflow installs. A floor raised past CI's Node passes every other
    // test in the suite and fails the first `npm ci` in the pipeline.
    expect(satisfies(ciNodeVersion(), world.enginesNode)).toBe(true);
  });

  it('declares a range the documents quote verbatim', () => {
    // The quote itself is checked per-document; this pins the shape, so that a
    // range written in some form `satisfies` cannot parse fails here and not in
    // six months on somebody else's pull request.
    expect(() => satisfies('24.0.0', world.enginesNode)).not.toThrow();
  });
});

describe('the counters', () => {
  /**
   * A counter has to be *derived*. One returning a literal would move the
   * hand-maintained number from a document into a file nobody reads, which is
   * this project's original failure wearing a test's clothes.
   */
  it.each([...counters().keys()])('%s reads a real quantity', (name) => {
    const counter = counters().get(name);
    expect(counter).toBeDefined();
    expect(counter?.()).toBeGreaterThanOrEqual(0);
  });

  it('counts the front end honestly', () => {
    // The phase count is the one that already went wrong, so it is pinned
    // against the source of truth rather than only against whatever a document
    // happens to say today.
    const flow = readFileSync(join(REPO_ROOT, 'src', 'ui', 'flow.ts'), 'utf8');
    const union = /export type GamePhase =([^;]+);/.exec(flow)?.[1] ?? '';
    expect(counters().get('flow.phases')?.()).toBe([...union.matchAll(/'[^']+'/g)].length);
  });
});

/* -------------------------------------------------------------------------- */
/* The checker, falsified                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A repository that exists only in this test: two real paths, one script, one
 * counter. Synthetic rather than the real tree, so a falsified claim is
 * unambiguous and the test does not have to write files into `src/` the way
 * `tests/unit/sim-boundary.test.ts` must.
 */
const fakeWorld: DocWorld = {
  exists: (path) => path === 'src/sim/world.ts' || path === 'docs/ARCHITECTURE.md',
  anchors: (path) => (path === 'docs/ARCHITECTURE.md' ? new Set(['3-the-layers']) : undefined),
  scripts: new Set(['dev', 'test']),
  counters: new Map([['flow.phases', () => 6]]),
  enginesNode: '^22.13.0 || >=24.0.0',
};

function check(text: string, path = 'docs/FAKE.md'): string[] {
  return checkDoc({ path, text }, fakeWorld).map((problem) => problem.message);
}

describe('the checker catches a false claim', () => {
  /**
   * Every row is the same document written twice: once true, once falsified in
   * one place. Both halves are asserted, because a checker that reported
   * everything would pass a test that only looked for failures.
   */
  const cases: ReadonlyArray<{
    readonly what: string;
    readonly true: string;
    readonly false: string;
    readonly says: RegExp;
  }> = [
    {
      what: 'a path named in prose',
      true: 'The world is `src/sim/world.ts`.',
      false: 'Scoring is `src/sim/scoring.ts`.',
      says: /src\/sim\/scoring\.ts.*does not exist/,
    },
    {
      what: 'a path declared absent that has since landed',
      true: '<!-- check:absent src/sim/scoring.ts -->',
      false: '<!-- check:absent src/sim/world.ts -->',
      says: /now exists.*the claim is stale/,
    },
    {
      what: 'a path asserted present with a marker',
      true: '<!-- check:path src/sim/world.ts -->',
      false: '<!-- check:path src/render/crt.ts -->',
      says: /check:path names a path that does not exist/,
    },
    {
      what: 'a stated count',
      true: 'Six phases. <!-- check:count flow.phases 6 -->',
      false: 'Five phases. <!-- check:count flow.phases 5 -->',
      says: /says 5; the repository says 6/,
    },
    {
      what: 'a count of something no counter derives',
      true: '<!-- check:count flow.phases 6 -->',
      false: '<!-- check:count flow.phasez 6 -->',
      says: /names no known quantity/,
    },
    {
      what: 'a misspelt marker verb',
      true: '<!-- check:path src/sim/world.ts -->',
      false: '<!-- check:paths src/sim/world.ts -->',
      says: /unknown marker check:paths/,
    },
    {
      what: 'a getting-started command',
      true: 'Run `npm run dev`.',
      false: 'Run `npm run serve`.',
      says: /npm serve.*not a script/,
    },
    {
      what: 'a link to a document that is not there',
      true: 'See [the layers](ARCHITECTURE.md).',
      false: 'See [the plan](PLAN.md).',
      says: /links to docs\/PLAN\.md, which does not exist/,
    },
    {
      what: 'a missing media file behind an image',
      true: '![the layers](ARCHITECTURE.md)',
      false: '![the game](media/arch-gameplay.gif)',
      says: /links to docs\/media\/arch-gameplay\.gif, which does not exist/,
    },
    {
      what: 'a link to a heading that is not there',
      true: 'See [the layers](ARCHITECTURE.md#3-the-layers).',
      false: 'See [the layers](ARCHITECTURE.md#7-the-layers).',
      says: /not a heading there/,
    },
    {
      what: 'a quoted Node range that has drifted from package.json',
      true: 'It declares `"node": "^22.13.0 || >=24.0.0"`.',
      false: 'It declares `"node": ">=20.0.0"`.',
      says: /quotes "node": ">=20\.0\.0"/,
    },
    {
      what: 'a count in a document whose layer forbids one',
      true: '<!-- doc:layer state -->\n<!-- check:count flow.phases 6 -->',
      false: '<!-- doc:layer roadmap -->\n<!-- check:count flow.phases 6 -->',
      says: /check:count in a roadmap document/,
    },
    {
      what: 'a layer that is not one of the four',
      true: '<!-- doc:layer vision -->',
      false: '<!-- doc:layer plan -->',
      says: /doc:layer names no layer: plan/,
    },
  ];

  it.each(cases)('$what', ({ true: honest, false: stale, says }) => {
    expect(check(honest)).toEqual([]);
    const caught = check(stale);
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatch(says);
  });

  it('reports every stale claim in one run, not just the first', () => {
    // A pull request that falsifies four statements — which is what happened to
    // `docs/ARCHITECTURE.md` — should be told about four.
    expect(
      check(
        'Scoring is `src/sim/scoring.ts` and stages are `src/sim/stages.ts`.\n' +
          'Run `npm run serve`.\n' +
          '<!-- check:count flow.phases 5 -->\n',
      ),
    ).toHaveLength(4);
  });

  it('leaves a marker inside a fenced code block inert', () => {
    // `AGENTS.md` documents the vocabulary by showing it. A fenced example that
    // asserted what it demonstrates would make the convention undocumentable.
    expect(check('```\n<!-- check:count flow.phasez 99 -->\n`src/sim/scoring.ts`\n```\n')).toEqual(
      [],
    );
  });

  it('refuses a marker that would split a paragraph in two', () => {
    // The hazard is invisible in the source: an HTML comment alone on a line
    // interrupts a paragraph, so the text after it renders as a second one.
    const split =
      'The layers are six.\n<!-- check:count flow.phases 6 -->\nAnd the arrows go one way.';
    expect(check(split)[0]).toMatch(/splits that paragraph/);
    // The same claim at the end of the paragraph, and inline after text, are both
    // fine — and so is a marker followed by the next list item.
    expect(
      check('The layers are six.\nAnd one way.\n<!-- check:count flow.phases 6 -->\n'),
    ).toEqual([]);
    expect(check('Six phases. <!-- check:count flow.phases 6 --> One way.')).toEqual([]);
    expect(check('- six\n  <!-- check:count flow.phases 6 -->\n- one way\n')).toEqual([]);
  });

  it('checks a path in every layer, because a dangling reference is never right', () => {
    // The layers exempt *tense*, not references: a vision document naming a file
    // that is not there is as broken as a state document doing it.
    expect(check('<!-- doc:layer vision -->\n\n`src/sim/scoring.ts`')).toHaveLength(1);
  });

  it('exempts a foreign path, and only where it is declared', () => {
    const cited = '`src/mame/namco/galaga.cpp`';
    expect(check(`${cited}\n<!-- check:foreign src/mame/namco/galaga.cpp -->\n`)).toEqual([]);
    expect(check(cited)).toHaveLength(1);
  });

  it('reads a heading anchor the way GitHub does', () => {
    // A `#fragment` is checked against a slug, so the slug rule is worth pinning:
    // punctuation dropped, spaces hyphenated, backticks and section numbers kept.
    expect(anchorsOf('## 4.3 `/lab`\n### What is *not* here yet\n')).toEqual(
      new Set(['43-lab', 'what-is-not-here-yet']),
    );
  });
});

describe('the Node range check', () => {
  it.each([
    ['22.13.0', true],
    ['22.20.4', true],
    ['22.12.0', false],
    ['23.0.0', false],
    ['24.0.0', true],
    ['25.9.0', true],
  ])('%s against the shipped range is %s', (version, expected) => {
    expect(satisfies(version, '^22.13.0 || >=24.0.0')).toBe(expected);
  });

  it('throws on a comparator it does not understand rather than guessing', () => {
    expect(() => satisfies('24.0.0', '~22.13.0')).toThrow(/unsupported comparator/);
  });
});
