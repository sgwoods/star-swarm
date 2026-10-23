/**
 * Record a live run: `docs/ROADMAP.md`, "Capturing gameplay video", phase 2.
 *
 *     npm run record                  # serve the record page and open it
 *     npm run record -- --stage 3     # every run starts on stage 3
 *
 * A run is a seed and an input log, so keeping one is keeping a few kilobytes,
 * and `npm run capture` turns it into a clip afterwards at any speed. This
 * command starts a dev server of its own on a free port, opens `record.html` in
 * the browser, and waits. The page plays the game from the keyboard with
 * `recordInput` between the two (`src/ui/lab/record.ts`); each time a run ends it
 * is posted here, **played again in Node** through the real simulation to the
 * fingerprint the page sealed it with, and only then written to
 * `.scratch/record/`, with the `npm run capture` line that renders it. A run that
 * does not replay is refused, on the page and here, rather than written — a log
 * the capture command could not render back is worth nothing.
 *
 * Nothing records unless this command is run and somebody presses start on the
 * page it serves. The route that keeps a run exists only on this command's
 * server: `npm run dev` does not have it, the game does not post to it, and the
 * page is never built into the bundle.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, resolve } from 'node:path';

import type { Plugin } from 'vite';

import {
  createReplaySource,
  parseReplay,
  type Replay,
  serializeReplay,
} from '../src/engine/replay.js';
import { createWorld, fingerprintWorld, stepWorld } from '../src/sim/world.js';
import { RECORD_SINK, type RecordedRun, type RecordReceipt } from '../src/ui/lab/recording.js';
import { freePort, logRequest } from './capture.js';
import { classicStages } from './record-replay.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SCRATCH = join(REPO_ROOT, '.scratch', 'record');

/** A posted run larger than this is refused unread. A ten-minute run is a few kilobytes. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Options                                                                      */
/* -------------------------------------------------------------------------- */

export interface RecordOptions {
  /** The stage every run starts on. Omitted means the rules' own first. */
  readonly stage: number | undefined;
  /** Open the page in the system browser. */
  readonly open: boolean;
}

export const USAGE = `usage: npm run record -- [options]

  --stage <n>   every run starts on stage n (default: the rules' first)
  --no-open     print the page's address instead of opening it

On the page: ENTER starts a run, P holds it, X ends it; a game over ends it too.
Each run that ends is checked and written to .scratch/record/. Ctrl-C stops.`;

export function parseRecordArgs(argv: readonly string[]): RecordOptions {
  let stage: number | undefined;
  let open = true;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--no-open') {
      open = false;
      continue;
    }
    if (flag === '--stage') {
      const value = argv[i + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--stage needs a whole number of at least 1, got ${String(value)}`);
      }
      stage = parsed;
      i += 1;
      continue;
    }
    throw new Error(`unknown option ${String(flag)}\n\n${USAGE}`);
  }
  return { stage, open };
}

/** The page's address on the server, carrying the starting stage when there is one. */
export function recordPagePath(stage: number | undefined): string {
  return stage === undefined ? '/record.html' : `/record.html?stage=${String(stage)}`;
}

/** The line that renders a kept log. */
export function captureCommand(path: string, stage: number | undefined): string {
  const from = stage === undefined ? '' : ` --stage ${String(stage)}`;
  return `npm run capture -- --replay ${path}${from}`;
}

/* -------------------------------------------------------------------------- */
/* Keeping a run                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Play a log through the simulation in Node, on what `npm run capture` would
 * play it on, and return where it lands.
 */
export function replayFingerprint(replay: Replay, stage: number | undefined): string {
  const { rules } = logRequest(replay, stage);
  const world = createWorld({
    seed: replay.seed,
    rules,
    stages: classicStages(),
    ...(stage !== undefined && { stage }),
  });
  const input = createReplaySource(replay, { onOverrun: 'throw' });
  for (let step = 0; step < replay.steps; step += 1) stepWorld(world, input.sample());
  return fingerprintWorld(world);
}

/** Read a posted body as a {@link RecordedRun}, or say what is wrong with it. */
export function readRecordedRun(body: unknown): RecordedRun {
  if (typeof body !== 'object' || body === null) throw new Error('a run is a JSON object');
  const { replay, stage } = body as { replay?: unknown; stage?: unknown };
  if (stage !== undefined && (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1)) {
    throw new Error(`a run's stage is a whole number of at least 1, got ${JSON.stringify(stage)}`);
  }
  if (typeof replay !== 'object' || replay === null) throw new Error('a run carries its log');
  // The engine's own reader: the version, the step rate, and runs that cover the steps.
  const parsed = parseReplay(JSON.stringify(replay));
  if (typeof parsed.seed !== 'string' && typeof parsed.seed !== 'number') {
    throw new Error('a run carries its seed');
  }
  if (typeof parsed.finalState !== 'string') {
    throw new Error('a run is sealed with its final state, and this one is not');
  }
  const frames = parsed.runs.every(
    (run) =>
      Array.isArray(run) &&
      Number.isInteger(run[0]) &&
      run[0] >= 0 &&
      Number.isInteger(run[1]) &&
      run[1] >= 1,
  );
  if (!frames) throw new Error('a run is a list of [frame, count] pairs');
  return { replay: parsed, ...(stage !== undefined && { stage }) };
}

export interface KeepOptions {
  /** Directory the log is written to. */
  readonly dir: string;
  /** File name, without the `.replay.json`. */
  readonly name: string;
  /** What the printed path and capture line are relative to. */
  readonly root?: string;
}

export interface Kept {
  readonly receipt: RecordReceipt;
  /** For the terminal: what was kept, or why not. */
  readonly lines: readonly string[];
}

/**
 * Check a posted run replays, and write it. Nothing is written for a run that
 * does not: the page is told why and the terminal says so.
 */
export function keepRun(body: unknown, options: KeepOptions): Kept {
  const { dir, name, root = REPO_ROOT } = options;
  let run: RecordedRun;
  try {
    run = readRecordedRun(body);
  } catch (error) {
    const message = `NOT KEPT: ${error instanceof Error ? error.message : String(error)}`;
    return { receipt: { ok: false, error: message }, lines: [message] };
  }
  const { replay, stage } = run;
  const landed = replayFingerprint(replay, stage);
  if (landed !== replay.finalState) {
    const message =
      'NOT KEPT: the run does not replay in Node to the state the page sealed it with';
    return { receipt: { ok: false, error: message }, lines: [message] };
  }

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.replay.json`);
  const text = serializeReplay(replay);
  writeFileSync(file, text);
  const path = relative(root, file);
  const capture = captureCommand(path, stage);
  const size = Buffer.byteLength(text);
  return {
    receipt: { ok: true, path, capture },
    lines: [
      `kept     ${String(replay.seed)}: ${String(replay.steps)} steps in ${String(replay.runs.length)} ` +
        `runs, ${size < 1024 ? `${String(size)} B` : `${(size / 1024).toFixed(1)} KiB`}, ` +
        'replayed in Node to the state the page sealed it with',
      `wrote    ${path}`,
      `render   ${capture}`,
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* The route                                                                    */
/* -------------------------------------------------------------------------- */

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit the rest is read and dropped rather than the socket cut, so
    // the page still gets an answer saying why.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) reject(new Error(`a run is at most ${String(limit)} bytes`));
      else resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function respond(res: ServerResponse, status: number, receipt: RecordReceipt): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(receipt));
}

/**
 * Answer a POST to {@link RECORD_SINK} with `keep`, and pass anything else on.
 * Exported so the test can mount it on a plain Node server.
 */
export function recordHandler(
  keep: (body: unknown) => Kept,
  limit: number = MAX_BODY_BYTES,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    if (req.url?.split('?')[0] !== RECORD_SINK || req.method !== 'POST') {
      next();
      return;
    }
    readBody(req, limit).then(
      (text) => {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          respond(res, 400, { ok: false, error: 'NOT KEPT: the run is not JSON' });
          return;
        }
        const kept = keep(body);
        for (const line of kept.lines) console.log(line);
        respond(res, kept.receipt.ok ? 200 : 422, kept.receipt);
      },
      (error: unknown) => {
        const message = `NOT KEPT: ${error instanceof Error ? error.message : String(error)}`;
        console.log(message);
        respond(res, 413, { ok: false, error: message });
      },
    );
  };
}

/** The route, on this command's dev server only. */
function recordRoute(keep: (body: unknown) => Kept): Plugin {
  return {
    name: 'star-swarm:record-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(recordHandler(keep));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The command                                                                  */
/* -------------------------------------------------------------------------- */

/** `20261023-170102`: the command's start, so two sessions never share a name. */
function sessionStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function main(): Promise<void> {
  const options = parseRecordArgs(process.argv.slice(2));
  const stamp = sessionStamp(new Date());
  let kept = 0;
  const keep = (body: unknown): Kept => {
    const result = keepRun(body, { dir: SCRATCH, name: `run-${stamp}-${String(kept + 1)}` });
    if (result.receipt.ok) kept += 1;
    return result;
  };

  const { createServer } = await import('vite');
  const port = await freePort();
  const page = recordPagePath(options.stage);
  const server = await createServer({
    root: REPO_ROOT,
    logLevel: 'error',
    plugins: [recordRoute(keep)],
    // No hot reload: an edit to a source file would reload the page and throw
    // away the run being played.
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, open: options.open && page },
  });
  await server.listen();

  console.log(`record   http://127.0.0.1:${String(port)}${page}`);
  console.log('         ENTER starts a run, P holds it, X ends it; Ctrl-C stops this command');
  process.on('SIGINT', () => {
    void server.close().then(() => {
      console.log(`\nstopped  ${String(kept)} run${kept === 1 ? '' : 's'} kept`);
      process.exit(0);
    });
  });
}

// Importing this module (the test does) must not start a server; only running
// it as a script does.
if (process.argv[1]?.endsWith('record.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
