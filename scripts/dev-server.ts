/**
 * `npm run dev`: the Vite dev server, run under the localhost agreement
 * (`scripts/localhost.ts`, and the README's "Local ports" section).
 *
 *     npm run dev                 the dev server, replacing an older copy of itself
 *     npm run dev -- --status     every registered project: running, where, which version
 *     npm run preview             the built bundle, on a free port of the block
 *
 * In order, the dev server: makes sure the shared registry has this project's
 * line and warns about any block overlapping it; stops the older copy
 * `~/.config/star-swarm/server.json` names, if `/whoami` proves it is one;
 * binds `127.0.0.1` on the default port or the next free one inside the block,
 * through Vite's own `port` and `strictPort`; records itself in `server.json`;
 * and prints one line saying where it is. It removes that record on a clean exit.
 *
 * Only `npm run dev` replaces anything. A preview, the record page, a capture and
 * Playwright's own server each take a free port of the block and leave every
 * other server alone — a test run that stopped somebody's dev server would be a
 * test run nobody could start safely.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { PreviewServer, ViteDevServer } from 'vite';

import {
  ensureRegistry,
  helperPorts,
  HOST,
  listenInBlock,
  readServerRecord,
  registryPath,
  removeServerRecord,
  retireOlderCopy,
  serverPorts,
  serverRecordPath,
  STAR_SWARM,
  statusReport,
  writeServerRecord,
} from './localhost.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

export const USAGE = `usage: npm run dev [-- --status]
       npm run preview

  (none)     start the dev server on 127.0.0.1, inside ports 8790-8799
  --status   report every project in ~/.config/local-ports.tsv, then exit
  --preview  serve the built bundle in dist/ instead (what npm run preview runs)`;

export type DevCommand = 'dev' | 'status' | 'preview';

export function parseDevArgs(argv: readonly string[]): DevCommand {
  if (argv.length === 0) return 'dev';
  if (argv.length === 1 && argv[0] === '--status') return 'status';
  if (argv.length === 1 && argv[0] === '--preview') return 'preview';
  throw new Error(`unexpected arguments: ${argv.join(' ')}\n\n${USAGE}`);
}

/** The one line the agreement asks every project to print at startup. */
export function runningLine(port: number): string {
  return `${STAR_SWARM.name} running at http://${HOST}:${String(port)}/`;
}

async function startDev(port: number): Promise<ViteDevServer> {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: REPO_ROOT,
    server: { host: HOST, port, strictPort: true },
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  return server;
}

async function startPreview(port: number): Promise<PreviewServer> {
  const { preview } = await import('vite');
  return preview({ root: REPO_ROOT, preview: { host: HOST, port, strictPort: true } });
}

/** Warn rather than refuse: a registry that cannot be written stops no server. */
function warnUnless(what: string, write: () => void): void {
  try {
    write();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`${STAR_SWARM.name}: warning: could not ${what}: ${reason}`);
  }
}

function registryWarnings(home: string): void {
  let overlaps: ReturnType<typeof ensureRegistry>['overlaps'] = [];
  warnUnless(`update ${registryPath(home)}`, () => {
    overlaps = ensureRegistry(registryPath(home), STAR_SWARM).overlaps;
  });
  for (const other of overlaps) {
    console.warn(
      `${STAR_SWARM.name}: warning: ports ${String(STAR_SWARM.first)}-${String(STAR_SWARM.last)} ` +
        `overlap ${other.name} (${String(other.first)}-${String(other.last)}) in ${registryPath(home)}`,
    );
  }
}

/**
 * Close the server on the first signal and leave. The record goes first, before
 * the port is released, so a replacement that sees the port come free never
 * finds the old record still there to delete its own.
 */
function closeOnSignal(close: () => Promise<void>, onExit: () => void): void {
  process.on('exit', onExit);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      onExit();
      void close().finally(() => process.exit(0));
    });
  }
}

async function dev(home: string): Promise<void> {
  registryWarnings(home);

  const recordPath = serverRecordPath(home, STAR_SWARM);
  const retired = await retireOlderCopy(STAR_SWARM, readServerRecord(recordPath));
  if (retired.outcome === 'left-alone') {
    console.warn(`${STAR_SWARM.name}: left the recorded server alone: ${retired.reason}`);
  }
  const reclaimed = retired.outcome === 'replaced' ? retired.port : undefined;
  const order = serverPorts(STAR_SWARM);
  const { server, port } = await listenInBlock(
    STAR_SWARM,
    reclaimed === undefined ? order : [reclaimed, ...order.filter((p) => p !== reclaimed)],
    startDev,
  );

  warnUnless(`write ${recordPath}`, () => {
    writeServerRecord(recordPath, { pid: process.pid, port, started: new Date().toISOString() });
  });
  closeOnSignal(
    () => server.close(),
    () => {
      removeServerRecord(recordPath, process.pid);
    },
  );
  // Vite's own keys — r restarts, q quits — without its banner: the line below
  // is the one line the agreement asks for.
  server.bindCLIShortcuts({ print: false });
  console.log(runningLine(port));
}

async function previewBuild(home: string): Promise<void> {
  registryWarnings(home);
  const { server, port } = await listenInBlock(STAR_SWARM, helperPorts(STAR_SWARM), startPreview);
  closeOnSignal(
    () => server.close(),
    () => undefined,
  );
  console.log(`${runningLine(port)} (preview of dist/)`);
}

async function main(): Promise<void> {
  const command = parseDevArgs(process.argv.slice(2));
  const home = homedir();
  if (command === 'status') {
    for (const line of await statusReport(home)) console.log(line);
    return;
  }
  if (command === 'preview') await previewBuild(home);
  else await dev(home);
}

// Importing this module (a test does) must not start a server; only running it
// as a script does.
if (process.argv[1]?.endsWith('dev-server.ts') === true) {
  main().catch((error: unknown) => {
    // A full block is an answer, not a crash: its message is the whole report,
    // naming who holds each port, so no stack trace follows it.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
