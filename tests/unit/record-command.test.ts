import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { frameOf, type InputFrame } from '../../src/engine/input.js';
import { parseReplay } from '../../src/engine/replay.js';
import { createWorld, fingerprintWorld, stepWorld } from '../../src/sim/world.js';
import { createRecording, RECORD_SINK, type RecordedRun } from '../../src/ui/lab/recording.js';
import { logRequest, resolveReplay } from '../../scripts/capture.js';
import {
  captureCommand,
  type Kept,
  keepRun,
  parseRecordArgs,
  readRecordedRun,
  recordHandler,
  recordPagePath,
  replayFingerprint,
} from '../../scripts/record.js';
import { classicRules, classicStages } from '../helpers/rules.js';

/**
 * The parts of `npm run record` that need no browser: its flags, and what it does
 * with a run the page posts — check it replays in Node, then write it, or refuse
 * and write nothing. The page itself, and the run coming back through
 * `npm run capture`, are `tests/e2e/record.spec.ts`.
 */

const rules = classicRules();
const stages = classicStages();
const FIRE = frameOf('fire');

/** A run sealed exactly as the record page seals one, over a real world. */
function recordedRun(frames: readonly InputFrame[], stage?: number): RecordedRun {
  const recording = createRecording({
    ...(stage !== undefined && { stage }),
    begin(seed) {
      const world = createWorld({ seed, rules, stages, ...(stage !== undefined && { stage }) });
      return {
        opening: [...world.events],
        step: (frame) => stepWorld(world, frame),
        fingerprint: () => fingerprintWorld(world),
      };
    },
  });
  for (const frame of [frameOf('start'), ...frames, frameOf('exit')]) recording.step(frame);
  const run = recording.last;
  if (run === undefined) throw new Error('the run did not end');
  return run;
}

const sweep: InputFrame[] = [
  ...Array.from({ length: 90 }, () => frameOf('right', 'fire')),
  ...Array.from({ length: 140 }, () => frameOf('left', 'fire')),
  ...Array.from({ length: 30 }, () => FIRE),
];

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'star-swarm-record-'));
}

describe('the record flags', () => {
  it('opens the page from the rules’ first stage unless told otherwise', () => {
    expect(parseRecordArgs([])).toEqual({ stage: undefined, open: true });
    expect(parseRecordArgs(['--stage', '3', '--no-open'])).toEqual({ stage: 3, open: false });
  });

  it.each([
    [['--stage', '0'], /at least 1/],
    [['--stage', 'two'], /whole number/],
    [['--stage'], /whole number/],
    [['--seed', 'x'], /unknown option --seed/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseRecordArgs(argv)).toThrow(message);
  });

  it('carries the stage to the page and to the capture line', () => {
    expect(recordPagePath(undefined)).toBe('/record.html');
    expect(recordPagePath(3)).toBe('/record.html?stage=3');
    expect(captureCommand('.scratch/record/a.replay.json', undefined)).toBe(
      'npm run capture -- --replay .scratch/record/a.replay.json',
    );
    expect(captureCommand('a.replay.json', 3)).toBe(
      'npm run capture -- --replay a.replay.json --stage 3',
    );
  });
});

describe('keeping a run', () => {
  it('writes a run that replays in Node, and says how to render it', () => {
    const dir = scratch();
    try {
      const run = recordedRun(sweep, 2);
      const kept = keepRun(JSON.parse(JSON.stringify(run)), { dir, name: 'first', root: dir });
      expect(kept.receipt).toEqual({
        ok: true,
        path: 'first.replay.json',
        capture: 'npm run capture -- --replay first.replay.json --stage 2',
      });
      const written = parseReplay(readFileSync(join(dir, 'first.replay.json'), 'utf8'));
      expect(written).toEqual(run.replay);
      // And `npm run capture` reads it back as the same request it would have built.
      const { request, golden } = resolveReplay(join(dir, 'first.replay.json'), 2);
      expect(golden).toBe(true);
      expect(request).toEqual(logRequest(run.replay, 2));
      expect(replayFingerprint(written, 2)).toBe(run.replay.finalState);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a run that does not replay to the state it was sealed with, and writes nothing', () => {
    const dir = scratch();
    try {
      const run = recordedRun(sweep);
      const other = recordedRun(sweep.slice(0, 100));
      const tampered = { replay: { ...run.replay, finalState: other.replay.finalState } };
      // The same log said to start somewhere it did not: also a different run.
      const moved = { ...run, stage: 3 };
      for (const body of [tampered, moved]) {
        const kept: Kept = keepRun(body, { dir, name: 'nope', root: dir });
        expect(kept.receipt).toEqual({
          ok: false,
          error: 'NOT KEPT: the run does not replay in Node to the state the page sealed it with',
        });
      }
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['not an object', 7, /a JSON object/],
    ['no log', {}, /carries its log/],
    ['an unsealed log', 'unsealed', /sealed with its final state/],
    ['a stage of zero', 'stage0', /whole number of at least 1/],
    ['runs that do not cover the steps', 'short', /corrupt/],
    ['a frame that is not a mask', 'frame', /\[frame, count\] pairs/],
  ])('reads %s as not a run', (_label, shape, message) => {
    const { replay } = recordedRun(sweep.slice(0, 20));
    const bodies: Record<string, unknown> = {
      unsealed: { replay: { ...replay, finalState: undefined } },
      stage0: { replay, stage: 0 },
      short: { replay: { ...replay, steps: replay.steps + 1 } },
      frame: { replay: { ...replay, runs: [['fire', replay.steps]] } },
    };
    const body = typeof shape === 'string' ? bodies[shape] : shape;
    expect(() => readRecordedRun(body)).toThrow(message);
    const kept = keepRun(body, { dir: join(tmpdir(), 'star-swarm-record-never'), name: 'x' });
    expect(kept.receipt.ok).toBe(false);
    expect(existsSync(join(tmpdir(), 'star-swarm-record-never'))).toBe(false);
  });
});

describe('the route', () => {
  let server: Server;
  let base = '';
  const posted: unknown[] = [];

  beforeAll(async () => {
    const handle = recordHandler((body) => {
      posted.push(body);
      return (body as { good?: boolean }).good === true
        ? { receipt: { ok: true, path: 'p', capture: 'c' }, lines: [] }
        : { receipt: { ok: false, error: 'NOT KEPT: no' }, lines: [] };
    }, 1024);
    server = createServer((req, res) => {
      handle(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });

  const post = (body: string, path = RECORD_SINK) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });

  it('answers a kept run with its receipt, and a refused one with why', async () => {
    const good = await post(JSON.stringify({ good: true }));
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ ok: true, path: 'p', capture: 'c' });
    const bad = await post(JSON.stringify({ good: false }));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ ok: false, error: 'NOT KEPT: no' });
  });

  it('refuses what is not JSON, and what is too large, without asking', async () => {
    const before = posted.length;
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify({ pad: 'x'.repeat(2048) }))).status).toBe(413);
    expect(posted.length).toBe(before);
  });

  it('leaves every other request to the dev server', async () => {
    expect((await fetch(`${base}${RECORD_SINK}`)).status).toBe(404);
    expect((await post('{}', '/elsewhere')).status).toBe(404);
  });
});
