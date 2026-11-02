import { type ChildProcess, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

import { helperPorts, STAR_SWARM } from '../../../scripts/localhost.js';

/**
 * Real processes for the localhost agreement's tests: stand-ins for somebody
 * else's server, and the real `npm run dev` command. Every process here is one
 * this file spawned, and {@link stopAll} kills exactly those and nothing else.
 */

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/**
 * A stand-in for a server that is already running: an HTTP server on one port
 * of the block that either answers `/whoami` as `project` or answers nothing but
 * 404s. It prints every `SIGTERM` it receives, so a test can see whether it was
 * asked to stop at all, and either exits on one or ignores it.
 */
const STAND_IN = `
import { createServer } from 'node:http';
const [mode, project, portsText, onTerm] = process.argv.slice(1);
const ports = portsText === '' ? [] : portsText.split(',').map(Number);
let port = 0;
const server = createServer((req, res) => {
  if (mode === 'whoami' && req.url === '/whoami') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ project, port, pid: process.pid, version: 'stand-in' }));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
process.on('SIGTERM', () => {
  console.log('SIGTERM');
  if (onTerm === 'exit') server.close(() => process.exit(0));
});
// The first of the offered ports it can bind, so two tests never race for one.
function next() {
  const candidate = ports.shift();
  if (candidate === undefined) return console.log('no port');
  server.once('error', next);
  server.listen(candidate, '127.0.0.1', () => {
    port = candidate;
    console.log('ready ' + String(port));
  });
}
if (ports.length === 0) console.log('ready 0');
else next();
setInterval(() => undefined, 1000);
`;

export interface Spawned {
  readonly child: ChildProcess;
  readonly pid: number;
  /** Everything it has printed so far, both streams. */
  output(): string;
  /** Resolves when it exits; already resolved if it has. */
  readonly exited: Promise<void>;
  hasExited(): boolean;
  /** Resolves once its output matches `pattern`, with the match. */
  waitFor(pattern: RegExp, ms?: number): Promise<RegExpMatchArray>;
}

/** Every spawned process still running. */
const spawned = new Set<ChildProcess>();

/**
 * Every process group a dev server was started in. Kept until {@link stopAll},
 * because a group outlives its leader: the tsx CLI can exit and leave its child.
 */
const groups = new Set<number>();

function track(child: ChildProcess, group = false): Spawned {
  spawned.add(child);
  if (group && child.pid !== undefined) groups.add(child.pid);
  let text = '';
  let exited = false;
  const waiters = new Set<() => void>();
  const changed = (): void => {
    for (const waiter of waiters) waiter();
  };
  child.stdout?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    changed();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    changed();
  });
  const exitedPromise = new Promise<void>((resolveExit) => {
    child.once('exit', () => {
      exited = true;
      spawned.delete(child);
      changed();
      resolveExit();
    });
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('the process did not start');
  return {
    child,
    pid,
    output: () => text,
    exited: exitedPromise,
    hasExited: () => exited,
    waitFor(pattern, ms = 30_000) {
      return new Promise((resolveMatch, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`timed out waiting for ${String(pattern)}; output so far:\n${text}`));
        }, ms);
        const check = (): void => {
          const match = pattern.exec(text);
          if (match !== null) {
            clearTimeout(timer);
            waiters.delete(check);
            resolveMatch(match);
          } else if (exited) {
            clearTimeout(timer);
            waiters.delete(check);
            reject(new Error(`exited before ${String(pattern)}; output:\n${text}`));
          }
        };
        waiters.add(check);
        check();
      });
    },
  };
}

/**
 * Start a stand-in on the first free port of the block (the helpers' order), or
 * on no port at all when `listen` is false: a live pid with no server.
 */
export async function standIn(options: {
  readonly mode: 'whoami' | 'silent';
  readonly project?: string;
  readonly listen?: boolean;
  readonly onTerm: 'exit' | 'ignore';
}): Promise<Spawned & { readonly port: number }> {
  const ports = options.listen === false ? [] : helperPorts(STAR_SWARM);
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      STAND_IN,
      options.mode,
      options.project ?? '',
      ports.join(','),
      options.onTerm,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const process_ = track(child);
  const [, port = ''] = await process_.waitFor(/ready (\d+)|no port/);
  if (port === '') throw new Error('no port of 8790-8799 was free for a stand-in');
  return { ...process_, port: Number(port) };
}

/**
 * The real `npm run dev`, as npm runs it — the tsx CLI on `scripts/dev-server.ts`
 * — with `HOME` pointed at a throwaway directory, so the registry and
 * `server.json` it reads and writes are the test's and never the machine's.
 */
export function devServer(home: string, args: readonly string[] = []): Spawned {
  const child = spawn(
    join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
    ['scripts/dev-server.ts', ...args],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home },
      // A piped stdin that stays open: Vite stops a dev server whose stdin ends.
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group: the tsx CLI runs the script in a child process,
      // and killing the CLI alone would leave that child serving.
      detached: true,
    },
  );
  return track(child, true);
}

/** Is `pid` still running? */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signal a dev server's whole process group, as a terminal's Ctrl-C does. */
export function signalGroup(process_: Spawned, signal: NodeJS.Signals): void {
  process.kill(-process_.pid, signal);
}

/** Kill every process this file spawned that is still running, and only those. */
export async function stopAll(): Promise<void> {
  const running = [...spawned];
  for (const group of groups) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // Every member has gone already.
    }
  }
  groups.clear();
  for (const child of running) child.kill('SIGKILL');
  await Promise.all(
    running.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    ),
  );
}
