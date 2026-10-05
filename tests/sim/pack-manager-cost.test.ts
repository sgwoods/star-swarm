import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkPlayability } from '../../scripts/playability.js';
import { readPackSource } from '../../src/content/fs.js';
import { type LoadedPack, loadPackOrThrow } from '../../src/content/loader.js';
import { createComposer } from '../../src/ui/compose.js';
import { installedPacks, shippedVariants, shippedVariantSources } from '../helpers/variants.js';

/**
 * What the pack manager's judge costs, held in place: **it does not fly a
 * persona**, so a stage only a flight can fault is accepted.
 *
 * `src/ui/compose.ts` runs the playability pass's structural half on every list a
 * player composes and leaves the flown half to the gate, and says why with the
 * measurements. This is the consequence of that choice, made concrete with the
 * fixture's `ledge`: a stage whose one enemy settles where no shot can reach it.
 * It builds, it settles, it has no dive to leave the screen — and nothing can
 * finish it.
 *
 * Both halves are asserted, so the day the editor starts flying personas this is
 * the test that says so, and the day the gate stops refusing `ledge` this stops
 * demonstrating anything. In `tests/sim/` rather than beside the judge's own tests
 * because the second half flies the stage.
 */

const FIXTURE = resolve(import.meta.dirname, '..', 'fixtures', 'unplayable', 'packs', 'unplayable');

function withFixture(): ReadonlyMap<string, LoadedPack> {
  const { source, errors } = readPackSource(FIXTURE);
  if (source === undefined) throw new Error(JSON.stringify(errors));
  return new Map([...installedPacks(), ['unplayable', loadPackOrThrow(source)]]);
}

describe('the pack manager does not fly a persona', () => {
  it('accepts a stage order the gate refuses for being unfinishable', () => {
    const composer = createComposer({
      sources: shippedVariantSources(),
      packs: withFixture(),
      variants: shippedVariants(),
    });
    const { verdict, variant } = composer.compose('classic', {
      packs: ['classic', 'unplayable'],
      stages: ['ledge'],
    });
    expect(verdict.ok).toBe(true);
    expect(variant).toBeDefined();
    if (variant === undefined) return;

    const report = checkPlayability([variant]);
    const checks = new Set(
      report.findings
        .filter((finding) => finding.file === 'stages/ledge.json')
        .map((finding) => finding.check),
    );
    expect(checks).toEqual(new Set(['finishes', 'clearable']));
  }, 120_000);
});
