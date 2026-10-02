/**
 * What holds forged content to the rules a prompt cannot be allowed to move.
 *
 * Two halves, and they answer two different objections to generating game content
 * from a sentence:
 *
 * 1. **The ground rules are enforced, not hoped for.** `docs/DESIGN.md` section 2
 *    bars the original's art, audio, name and logo, and gives the enemy archetypes
 *    original names. A generator can be argued with; this test cannot. It walks
 *    every installed pack and every variant, so a forged document that slipped the
 *    rule fails the build before anybody reviews it.
 * 2. **Refusing is a required feature, because nothing downstream catches the
 *    alternative.** `docs/DESIGN.md` section 7.5 asks the generator to decline a
 *    prompt the ability registry cannot satisfy. The registry does not exist yet,
 *    and the rest of this file is the reason that matters: the schema *accepts* an
 *    ability, the loader is happy, the gate passes, and the simulation does
 *    nothing — so a pack that improvised one would be indistinguishable from a
 *    pack that worked, right up to somebody playing it. The same is true of two
 *    stage fields and of a role the difficulty rows do not name. Each is asserted
 *    here as an *identity* between a world that states the thing and a world that
 *    does not, which is the only form of "silently nothing" that cannot rot.
 *
 * `docs/content-guide.md` sections 2 and 9 are the author-facing statement of all
 * of it; this is the machine-checked one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPackSource, readVariantSources } from '../../src/content/fs.js';
import { loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import { alienSchema, ABILITY_TYPES } from '../../src/content/schema.js';
import { resolveStageContent } from '../../src/content/stages.js';
import { createFleet } from '../../src/sim/enemies.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { classicRules, quickRunRules } from '../helpers/rules.js';
import { installedPacks } from '../helpers/variants.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/* -------------------------------------------------------------------------- */
/* 1. The ground rules                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Names that belong to the original's publisher.
 *
 * Matched as whole words, case-insensitively, anywhere in any pack or variant
 * document. There is exactly one legitimate use of these in the repository —
 * `docs/reference/arcade-reference.md` and the `provenance` notes that cite it
 * identify a *source*, so a claim about the arcade stays checkable — and
 * {@link PROVENANCE_IS_A_CITATION} is where that exemption lives.
 */
const TRADEMARKED = ['galaga', 'namco', 'bandai'] as const;

/**
 * The arcade's own words for its enemy types.
 *
 * Barred as **ids** rather than as prose: `boss` is one of the three stage kinds
 * the schema admits, so a blanket text scan would fail on a legal stage document.
 * What section 2 actually asks for is that the archetypes carry original names, and
 * an id is where a name is load-bearing.
 */
const ARCADE_ARCHETYPES = ['bee', 'bees', 'butterfly', 'butterflies', 'boss', 'bosses'] as const;

/**
 * The one field whose job is to name somebody else's work.
 *
 * `provenance` in a `rules.json` maps a field path to how far the value may be
 * trusted and why, and "why" is a citation — `AGENTS.md`'s verified/provisional
 * rule is only meaningful if the source can be named. Skipped by path rather than
 * by pattern, so the exemption cannot widen.
 */
const PROVENANCE_IS_A_CITATION = /^provenance(\.|$)/;

interface Found {
  readonly where: string;
  readonly path: string;
  readonly value: string;
}

/** Every string in a parsed document, with the dotted path that reached it. */
function* strings(value: unknown, path = ''): Generator<readonly [string, string]> {
  if (typeof value === 'string') {
    yield [path, value];
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      yield* strings(entry, `${path}[${String(index)}]`);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      yield* strings(entry, path === '' ? key : `${path}.${key}`);
    }
  }
}

/** Every pack document and every variant document, as parsed JSON. */
function everyDocument(): ReadonlyArray<{ readonly where: string; readonly value: unknown }> {
  const out: Array<{ where: string; value: unknown }> = [];
  const packsRoot = resolve(REPO_ROOT, 'packs');
  for (const name of readdirSync(packsRoot)) {
    const dir = join(packsRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    const { source, errors } = readPackSource(dir);
    if (source === undefined) throw new Error(`${name}: ${JSON.stringify(errors)}`);
    out.push({ where: `packs/${name}/pack.json`, value: source.manifest });
    if (source.rules !== undefined)
      out.push({ where: `packs/${name}/rules.json`, value: source.rules });
    for (const document of source.documents) {
      out.push({ where: `packs/${name}/${document.file}`, value: document.value });
    }
  }
  const { sources, errors } = readVariantSources(resolve(REPO_ROOT, 'variants'));
  if (errors.length > 0) throw new Error(`variants/: ${JSON.stringify(errors)}`);
  for (const source of sources) out.push({ where: `variants/${source.file}`, value: source.value });
  return out;
}

describe('the ground rules are enforced on every pack, however it was authored', () => {
  it('names nothing that belongs to the original’s publisher', () => {
    const banned = new RegExp(`\\b(?:${TRADEMARKED.join('|')})\\b`, 'i');
    const found: Found[] = [];
    for (const { where, value } of everyDocument()) {
      for (const [path, text] of strings(value, '')) {
        if (PROVENANCE_IS_A_CITATION.test(path)) continue;
        if (banned.test(text)) found.push({ where, path, value: text });
      }
    }
    // The failure prints the document and the field, like every other content
    // failure in this project, so a forged pack is one edit away from passing.
    expect(found).toEqual([]);
  });

  it('gives the enemy archetypes original names, not the arcade’s', () => {
    const found: Found[] = [];
    for (const pack of installedPacks().values()) {
      for (const [id, alien] of pack.aliens) {
        for (const [field, text] of [
          ['id', id],
          ['role', alien.role],
        ] as const) {
          if ((ARCADE_ARCHETYPES as readonly string[]).includes(text.toLowerCase())) {
            found.push({ where: `packs/${pack.id}/aliens/${id}.json`, path: field, value: text });
          }
        }
      }
      for (const role of Object.keys(pack.manifest.roles)) {
        if ((ARCADE_ARCHETYPES as readonly string[]).includes(role.toLowerCase())) {
          found.push({ where: `packs/${pack.id}/pack.json`, path: `roles.${role}`, value: role });
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('still allows the reference to cite its source, which is the whole exemption', () => {
    // The rule would be useless if it could not be told apart from a citation, and
    // it would be unfalsifiable if the exemption were not pinned. A provenance note
    // naming the disassembly passes; the same words in the note’s own field path do
    // not get a second exemption, and nothing else in the document does either.
    const banned = new RegExp(`\\b(?:${TRADEMARKED.join('|')})\\b`, 'i');
    const notes = [...strings({ provenance: { 'player.minX': { note: 'MAME galaga.cpp' } } })];
    expect(notes.every(([path]) => PROVENANCE_IS_A_CITATION.test(path))).toBe(true);
    expect([...strings({ name: 'galaga' })].some(([, text]) => banned.test(text))).toBe(true);
    expect(
      [...strings({ name: 'galaga' })].some(([path]) => PROVENANCE_IS_A_CITATION.test(path)),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Why the refusal has to happen at generation time                         */
/* -------------------------------------------------------------------------- */

/** The smallest pack that puts one shootable enemy in a formation. */
function probePack(alien: Record<string, unknown>, stage: Record<string, unknown>) {
  return loadPackOrThrow(
    packSourceFromRecord('probe', 'test:probe', {
      'pack.json': {
        id: 'probe',
        name: 'Probe',
        palette: ['#0000', '#ffffff'],
        roles: { drone: {}, bystander: {} },
        formations: {
          one: {
            id: 'one',
            grid: { originX: 104, originY: 80, columnSpacing: 8, rowSpacing: 8 },
            slots: [
              { row: 0, column: 0, role: 'drone' },
              { row: 0, column: 1, role: 'bystander' },
            ],
          },
        },
      },
      'sprites/dot.json': { id: 'dot', size: 1, palette: ['#0000', '#ffffff'], frames: [['1']] },
      'paths/entry.json': {
        id: 'entry',
        start: [-16, 80],
        segments: [{ type: 'toSlot', speed: 3 }],
      },
      'paths/dive.json': {
        id: 'dive',
        segments: [
          { type: 'aimAtPlayer', speed: 2, duration: 40 },
          { type: 'exitBottom', speed: 2 },
        ],
      },
      'aliens/probe.json': alien,
      'stages/probe.json': stage,
    }),
  );
}

const PLAIN_ALIEN = {
  id: 'probe',
  role: 'drone',
  sprite: 'dot',
  score: { base: 10 },
  dive: { paths: ['dive'] },
} as const;

const PLAIN_STAGE = {
  id: 'probe',
  kind: 'normal',
  formation: 'one',
  waves: [{ at: 0, entryPath: 'entry', slots: [{ alien: 'probe', home: 0 }] }],
} as const;

/**
 * One run of a world over a probe pack, fingerprinted.
 *
 * The rules are {@link quickRunRules}, whose shot window covers the playfield, and
 * the input fires from the first frame — so the enemy is destroyed as soon as it is
 * targetable. That is what makes `splitOnHit` the interesting case: if it were
 * implemented, the kill would put minions on the field and the fingerprint would
 * move.
 */
function fingerprintOf(alien: Record<string, unknown>, stage: Record<string, unknown>): string {
  const pack = probePack(alien, stage);
  const content = resolveStageContent(pack, [...pack.stages.values()][0]!);
  if (content === undefined) throw new Error('the probe stage resolved to nothing');
  const world = createWorld({
    seed: 'forge-guard',
    rules: quickRunRules(),
    stages: { stageFor: () => content },
  });
  const FIRE = 1 << 2;
  for (let step = 0; step < 600; step += 1) stepWorld(world, FIRE);
  return fingerprintWorld(world);
}

describe('the engine accepts content it cannot honour, which is why /forge must refuse', () => {
  it('loads an alien carrying every reserved ability, with parameters nobody validates', () => {
    // `docs/DESIGN.md` section 7.5's registry is reserved in the schema and
    // implemented nowhere, and `abilitySchema` is deliberately loose about
    // parameters until it is. So this passes — which is the problem.
    const parsed = alienSchema.parse({
      ...PLAIN_ALIEN,
      abilities: ABILITY_TYPES.map((type) => ({ type, into: 'nothing', count: 99 })),
    });
    expect(parsed.abilities.map((ability) => ability.type)).toEqual([...ABILITY_TYPES]);
    expect(() => probePack({ ...parsed }, PLAIN_STAGE)).not.toThrow();
  });

  it('holds no ability module, and reads an alien’s `abilities` nowhere', () => {
    const abilities = resolve(REPO_ROOT, 'src', 'sim', 'abilities');
    expect(readdirSync(abilities).filter((name) => name.endsWith('.ts'))).toEqual([]);

    // A textual scan, like `tests/unit/sim-boundary.test.ts`: the claim is that no
    // module *reads* the field, and the only mention of it anywhere under `src/` is
    // the schema that declares it.
    const mentions: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && /\babilities\b/.test(readFileSync(path, 'utf8'))) {
          mentions.push(
            path
              .slice(REPO_ROOT.length + 1)
              .split(/[\\/]/)
              .join('/'),
          );
        }
      }
    };
    walk(resolve(REPO_ROOT, 'src'));
    expect(mentions).toEqual(['src/content/schema.ts']);
  });

  it('plays a world identically whether or not an alien declares an ability', () => {
    // The identity is the whole point: `splitOnHit` on an alien that is shot dead
    // changes nothing at all, so a forged pack that improvised one would look
    // exactly like a forged pack that worked.
    const plain = fingerprintOf(PLAIN_ALIEN, PLAIN_STAGE);
    const withAbility = fingerprintOf(
      { ...PLAIN_ALIEN, abilities: [{ type: 'splitOnHit', into: 'probe', count: 2 }] },
      PLAIN_STAGE,
    );
    expect(withAbility).toBe(plain);
  });

  it('plays a world identically whether or not a stage states `modifiers` or `diveRules`', () => {
    // Both fields are in the schema because `docs/DESIGN.md` section 7.3 sketched
    // them; the attack director reads the rules layer's difficulty row instead, and
    // there is no per-stage multiplier anywhere. A prompt asking for "a stage where
    // the bullets are faster" is therefore a refusal, not a `modifiers` entry.
    const plain = fingerprintOf(PLAIN_ALIEN, PLAIN_STAGE);
    const dressed = fingerprintOf(PLAIN_ALIEN, {
      ...PLAIN_STAGE,
      diveRules: { maxConcurrent: 9, intervalFrames: [1, 2] },
      modifiers: { enemyBulletSpeed: 4, everythingElse: 0.1 },
    });
    expect(dressed).toBe(plain);
  });

  it('never launches a role the difficulty rows do not name', () => {
    // The other silent acceptance, and the one a forged pack hits first: a pack may
    // declare any role it likes, and an alien in a role the rank table says nothing
    // about sits in formation for ever. `docs/content-guide.md` section 7.1.
    const pack = probePack(
      { ...PLAIN_ALIEN, id: 'probe', role: 'bystander' },
      {
        ...PLAIN_STAGE,
        waves: [{ at: 0, entryPath: 'entry', slots: [{ alien: 'probe', home: 1 }] }],
      },
    );
    const content = resolveStageContent(pack, [...pack.stages.values()][0]!);
    if (content === undefined) throw new Error('the probe stage resolved to nothing');
    const rules = classicRules();
    const world = createWorld({ seed: 'forge-guard', rules, stages: { stageFor: () => content } });
    for (let step = 0; step < 2_000; step += 1) stepWorld(world, 0);

    const enemy = world.fleet.enemies[0];
    expect(enemy?.role).toBe('bystander');
    expect(enemy?.state).toBe('home');
    // And the director agrees it is not even in the lottery.
    expect(world.dive.roles).not.toContain('bystander');
    expect(world.dive.roles).toEqual(['drone', 'warden', 'wing']);
  });

  it('builds a fleet that fills the formation, and throws when a role runs out', () => {
    // Not a silent acceptance but the opposite, and worth pinning next to them: a
    // wave with one slot too many for a role fails at run time rather than at load
    // time, which is why `docs/content-guide.md` section 5 tells a generator to
    // count.
    const pack = probePack(PLAIN_ALIEN, {
      ...PLAIN_STAGE,
      waves: [
        {
          at: 0,
          entryPath: 'entry',
          slots: [{ alien: 'probe' }, { alien: 'probe' }],
        },
      ],
    });
    const content = resolveStageContent(pack, [...pack.stages.values()][0]!);
    if (content === undefined) throw new Error('the probe stage resolved to nothing');
    expect(() => createFleet(content, classicRules())).toThrow(
      /no free slot left for role "drone"/,
    );
  });
});
