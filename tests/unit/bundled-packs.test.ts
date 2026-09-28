import { basename, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bundledPackSources, bundledVariantSources } from '../../src/content/bundle.js';
import { listPackDirs, readPackSource, readVariantSources } from '../../src/content/fs.js';
import { loadPack } from '../../src/content/loader.js';
import type { LoadedPack, PackSource } from '../../src/content/loader.js';
import { loadVariants } from '../../src/content/variants.js';

/**
 * The bundler and the filesystem must see the same packs.
 *
 * `src/content/fs.ts` reads a pack off disk for the validator and for tests;
 * `src/content/bundle.ts` reads the same tree through Vite's `import.meta.glob`
 * for the browser. Everything else — `npm run validate-packs`, every unit test,
 * `tests/e2e/` — goes through one or the other, so the two drifting apart is a
 * blind spot no other test in the suite can see.
 *
 * It is not hypothetical. The bundled source was once a literal list naming
 * `pack.json` and `rules.json`; when `pack.json` gained a `sounds` map, the
 * loader's reference pass could not resolve the ids, `loadPackOrThrow` threw
 * before the first frame and the game would not boot — while every from-disk
 * test still passed and `npm run validate-packs` still said OK. Only the five
 * Playwright smoke tests noticed, and only by the whole page being blank.
 *
 * So this compares the two readers directly rather than checking for today's
 * file types: a document that exists on disk and is missing from the bundle
 * fails here whatever kind it is, including kinds that do not exist yet.
 *
 * `variants/` is read the same two ways for the same reason, and is held to the
 * same standard at the bottom of this file. A variant that is on disk but not in
 * the bundle is a game the validator passes and the browser cannot offer.
 */

const PACKS_ROOT = resolve(import.meta.dirname, '..', '..', 'packs');
const VARIANTS_ROOT = resolve(import.meta.dirname, '..', '..', 'variants');

/** Pack-relative paths of every content document, in a stable order. */
function documentFiles(source: PackSource): string[] {
  return source.documents.map((document) => document.file).sort();
}

const onDisk = new Map(
  listPackDirs(PACKS_ROOT).map((dir) => {
    const { source, errors } = readPackSource(dir);
    expect(errors).toEqual([]);
    if (source === undefined) throw new Error(`could not read pack at ${dir}`);
    return [basename(dir), source] as const;
  }),
);

const bundled = bundledPackSources();

describe('the bundled packs and the packs on disk', () => {
  it('finds packs at all, so nothing below passes vacuously', () => {
    expect(onDisk.size).toBeGreaterThan(0);
    expect([...onDisk.keys()]).toContain('classic');
  });

  it('are the same set of packs', () => {
    expect([...bundled.keys()].sort()).toEqual([...onDisk.keys()].sort());
  });

  it.each([...onDisk.keys()])('%s bundles every document that exists on disk', (name) => {
    const disk = onDisk.get(name);
    const bundle = bundled.get(name);
    expect(bundle).toBeDefined();
    if (disk === undefined || bundle === undefined) return;

    // The assertion that matters: a file added under packs/<name>/<kind>/ is in
    // the bundle without anyone remembering to list it.
    expect(documentFiles(bundle)).toEqual(documentFiles(disk));

    expect(bundle.manifest === undefined).toBe(disk.manifest === undefined);
    expect(bundle.rules === undefined).toBe(disk.rules === undefined);
  });

  it.each([...onDisk.keys()])('%s bundles the same content, not just the same names', (name) => {
    // A path that is bundled but stale, or bundled from the wrong file, would
    // pass the name check above and still fly the wrong choreography.
    const disk = onDisk.get(name);
    const bundle = bundled.get(name);
    if (disk === undefined || bundle === undefined) throw new Error(`missing pack ${name}`);

    expect(bundle.manifest).toEqual(disk.manifest);
    expect(bundle.rules).toEqual(disk.rules);

    const byFile = new Map(bundle.documents.map((document) => [document.file, document]));
    for (const document of disk.documents) {
      const other = byFile.get(document.file);
      expect(other?.kind).toBe(document.kind);
      expect(other?.value).toEqual(document.value);
    }
  });

  it.each([...onDisk.keys()])('%s loads from the bundle, not only from disk', (name) => {
    // The end of the story the header tells: the game calls `loadPackOrThrow` on
    // exactly this source before its first frame, so if the reference pass fails
    // here the page is blank.
    const bundle = bundled.get(name);
    if (bundle === undefined) throw new Error(`pack ${name} is not bundled`);
    const result = loadPack(bundle);
    if (!result.ok) {
      throw new Error(
        `bundled pack "${name}" failed to load:\n${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    expect(result.pack.id).toBe(name);
  });
});

describe('the bundled variants and the variants on disk', () => {
  const onDiskVariants = readVariantSources(VARIANTS_ROOT);
  const bundledVariants = bundledVariantSources();

  it('finds variants at all, so nothing below passes vacuously', () => {
    expect(onDiskVariants.errors).toEqual([]);
    expect(onDiskVariants.sources.length).toBeGreaterThan(0);
  });

  it('are the same set of documents', () => {
    expect(bundledVariants.map((source) => source.file).sort()).toEqual(
      onDiskVariants.sources.map((source) => source.file).sort(),
    );
  });

  it('are the same documents, not just the same names', () => {
    const byFile = new Map(bundledVariants.map((source) => [source.file, source.value]));
    for (const source of onDiskVariants.sources) {
      expect(byFile.get(source.file)).toEqual(source.value);
    }
  });

  it('load from the bundle against the bundled packs, not only from disk', () => {
    // The end of the story: `src/main.ts` runs exactly this pairing before its
    // first frame, so a failure here is a page that will not boot.
    const packs = new Map<string, LoadedPack>();
    for (const [name, source] of bundled) {
      const result = loadPack(source);
      if (!result.ok) throw new Error(`bundled pack "${name}" failed to load`);
      packs.set(name, result.pack);
    }
    const result = loadVariants(bundledVariants, packs);
    if (!result.ok) {
      throw new Error(
        `bundled variants failed to load:\n${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    expect(result.variants.length).toBe(bundledVariants.length);
  });
});
