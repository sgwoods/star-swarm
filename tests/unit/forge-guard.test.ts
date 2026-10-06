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
 *    prompt the ability registry cannot satisfy. A field the schema *accepts* and
 *    the simulation ignores is the trap: the loader is happy, the gate passes, and
 *    the game does nothing — so a pack that improvised one would be
 *    indistinguishable from a pack that worked, right up to somebody playing it.
 *    Two stage fields and a role the difficulty rows do not name are like that,
 *    and each is asserted here as an *identity* between a world that states the
 *    thing and a world that does not, which is the only form of "silently
 *    nothing" that cannot rot. Every implemented ability is asserted as the
 *    opposite, so the day one stops acting, this says so.
 *
 *    Two ability ids used to be in the first group. `transform` and
 *    `mirrorPlayer` were reserved — accepted with any parameters and read by
 *    nothing — and this file pinned that identity, which is what made `/forge`
 *    refuse a prompt needing either. Both have modules now, so the identity was
 *    turned round deliberately rather than deleted: the reserved list is pinned
 *    empty, the improvisation it used to swallow is pinned as a load error, and
 *    each of the two is pinned as changing the world.
 *
 * `docs/content-guide.md` sections 2 and 9 are the author-facing statement of all
 * of it; this is the machine-checked one.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPackSource, readVariantSources } from '../../src/content/fs.js';
import { loadPackOrThrow, packSourceFromRecord } from '../../src/content/loader.js';
import {
  alienSchema,
  ABILITY_TYPES,
  isImplementedAbility,
  RESERVED_ABILITY_TYPES,
} from '../../src/content/schema.js';
import { resolveStageContent } from '../../src/content/stages.js';
import { ABILITY_REGISTRY } from '../../src/sim/abilities/registry.js';
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

/** A second alien for an ability to put on the field: it can dive, and does nothing else. */
const SHARD_ALIEN = {
  id: 'shard',
  role: 'drone',
  sprite: 'dot',
  score: { base: 10 },
  dive: { paths: ['dive'] },
} as const;

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
      'aliens/shard.json': SHARD_ALIEN,
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

/**
 * One run of a world in which the probe dives, fingerprinted as it goes.
 *
 * {@link fingerprintOf} shoots the probe before it ever leaves its slot, and the
 * two abilities that act only on a dive would pass its identity without having
 * been asked anything. So this holds fire and keeps the fighter moving — sliding
 * one way and then the other, which is what a mirror has to copy — under the
 * shipped rules, whose difficulty rows launch the probe's role, less the return
 * leg the probe pack does not carry.
 */
function divingFingerprintOf(alien: Record<string, unknown>): string {
  const pack = probePack(alien, PLAIN_STAGE);
  const content = resolveStageContent(pack, [...pack.stages.values()][0]!);
  if (content === undefined) throw new Error('the probe stage resolved to nothing');
  // The probe pack carries no return leg, so a diver that misses leaves the field
  // instead of asking for Classic's.
  const rules = structuredClone(classicRules());
  delete rules.enemies.dive.returnPath;
  const world = createWorld({
    seed: 'forge-guard-dive',
    rules,
    stages: { stageFor: () => content },
  });
  const LEFT = 1 << 0;
  const RIGHT = 1 << 1;
  let dived = false;
  const prints: string[] = [];
  for (let step = 0; step < 3_000; step += 1) {
    stepWorld(world, Math.floor(step / 45) % 2 === 0 ? LEFT : RIGHT);
    dived ||= world.fleet.enemies.some((enemy) => enemy.state === 'diving');
    // Sampled through the run, not once at the end: the lone probe clears its
    // stage by leaving it, and ability state is per stage.
    if (step % 10 === 0) prints.push(fingerprintWorld(world));
  }
  // A probe that never dived would make the comparison below say nothing.
  if (!dived) throw new Error('the probe never dived, so a dive-only ability was never asked');
  return prints.join('\n');
}

describe('the engine accepts content it cannot honour, which is why /forge must refuse', () => {
  it('reserves no ability id: the improvisation a reserved id used to swallow is a load error', () => {
    // This used to load an alien declaring `transform` and `mirrorPlayer` with
    // parameters nobody validated, and pass — which was the problem it pinned.
    // Both now have a module and a strict schema of their own, so the same
    // document is refused, and the list of ids that would accept it is empty. An
    // id reserved again fails the first assertion, and is the day `/forge` goes
    // back to refusing a prompt that needs it.
    expect(RESERVED_ABILITY_TYPES).toEqual([]);
    for (const type of ['transform', 'mirrorPlayer']) {
      const improvised = { ...PLAIN_ALIEN, abilities: [{ type, into: 'nothing', count: 99 }] };
      expect([type, alienSchema.safeParse(improvised).success]).toEqual([type, false]);
    }
  });

  it('refuses an implemented ability whose parameters are wrong or lead nowhere', () => {
    // The other half of the line: an implemented id validates its own parameters
    // and its references, so the same improvisation that a reserved id swallows is
    // a load error the gate reports.
    const bad = [
      { type: 'shield' },
      { type: 'splitOnHit', into: 'nothing', count: 2 },
      { type: 'splitOnHit', into: 'probe', count: 2 },
      { type: 'teleport' },
      { type: 'spawnMinions', alien: 'shard' },
      { type: 'captureBeam' },
      { type: 'transform' },
      { type: 'transform', into: 'nothing', afterFrames: 10 },
      { type: 'transform', into: 'probe', afterFrames: 10 },
      { type: 'transform', into: 'shard' },
      { type: 'mirrorPlayer' },
      { type: 'mirrorPlayer', mode: 'sideways', delayFrames: 0, strength: 1 },
      { type: 'mirrorPlayer', mode: 'track', delayFrames: 4, strength: 0 },
      { type: 'mirrorPlayer', mode: 'track', delayFrames: 4, strength: 2 },
    ];
    for (const ability of bad) {
      let refused = false;
      try {
        probePack({ ...PLAIN_ALIEN, abilities: [ability] }, PLAIN_STAGE);
      } catch {
        refused = true;
      }
      // Paired with the entry, so a failure names the one that loaded.
      expect([ability, refused]).toEqual([ability, true]);
    }
  });

  it('registers one module per implemented ability, and none for a reserved one', () => {
    const implemented = ABILITY_TYPES.filter(isImplementedAbility);
    expect(Object.keys(ABILITY_REGISTRY).sort()).toEqual([...implemented].sort());
    expect(implemented.length + RESERVED_ABILITY_TYPES.length).toBe(ABILITY_TYPES.length);

    // One file per ability plus the registry that dispatches to them, and no file
    // for a reserved id — a module nobody registered would be a mechanic that
    // never runs.
    const abilities = resolve(REPO_ROOT, 'src', 'sim', 'abilities');
    const modules = readdirSync(abilities).filter((name) => name.endsWith('.ts'));
    expect(modules.length).toBe(implemented.length + 1);
    expect(modules).toContain('registry.ts');
    const fileOf = (id: string): string =>
      `${id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.ts`;
    for (const reserved of RESERVED_ABILITY_TYPES as readonly string[]) {
      expect(modules).not.toContain(fileOf(reserved));
    }
    for (const id of implemented) expect(modules).toContain(fileOf(id));
  });

  it('plays a world differently when an alien declares `transform` or `mirrorPlayer`', () => {
    // The turned-round identity. While the two were reserved this asserted that
    // declaring either changed nothing at all; now each must change the world,
    // and the same dive with and without it must disagree. If either ever comes
    // out equal, its module has stopped acting and `/forge` would be back to
    // refusing it.
    const plain = divingFingerprintOf(PLAIN_ALIEN);
    for (const ability of [
      { type: 'transform', into: 'shard', afterFrames: 10 },
      { type: 'mirrorPlayer', mode: 'track', delayFrames: 8, strength: 0.25 },
      { type: 'mirrorPlayer', mode: 'opposite', delayFrames: 8, strength: 0.25 },
    ]) {
      const withAbility = divingFingerprintOf({ ...PLAIN_ALIEN, abilities: [ability] });
      expect([ability, withAbility === plain]).toEqual([ability, false]);
    }
  });

  it('plays a world differently when an alien declares an implemented ability', () => {
    // And the converse, which is what makes the line above worth drawing: the same
    // probe, shot dead the same way, with `splitOnHit` switched on puts fragments
    // on the field. If this ever comes out equal, the registry has stopped acting
    // and `/forge` would be back to refusing it.
    const plain = fingerprintOf(PLAIN_ALIEN, PLAIN_STAGE);
    const split = fingerprintOf(
      { ...PLAIN_ALIEN, abilities: [{ type: 'splitOnHit', into: 'shard', count: 2 }] },
      PLAIN_STAGE,
    );
    expect(split).not.toBe(plain);
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
