/**
 * The localhost agreement: how this project's web servers share a Mac with the
 * captain's other projects' servers.
 *
 * Every project owns a block of ten ports and a default inside it, and records
 * both in one shared registry, `~/.config/local-ports.tsv`. A server binds
 * `127.0.0.1` only, takes its default or another port in its own block, and
 * never one outside it. Every server answers `GET /whoami` with its project, port,
 * pid and short commit, which is what makes the two dangerous things safe to do:
 * stopping an older copy of this project, and reporting on everybody's.
 *
 * Node-only. `scripts/dev-server.ts` is the command that runs the agreement; the
 * plugin in `vite.config.ts` is what makes every page and server of this project
 * answer for itself. Nothing here reaches a production bundle.
 *
 * **The kill path is the dangerous part**, and {@link retireOlderCopy} is all of
 * it. It signals a process only when four things agree: `server.json` recorded
 * it, it is still alive, the recorded port is inside this block, and the server
 * on that port says through `/whoami` that it is this project *and* that pid. A
 * stale file whose pid now belongs to something else entirely, a server of
 * another project, and a server that does not answer at all are all left alone.
 */

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';

/** One project's place in the agreement. */
export interface Agreement {
  /**
   * The one name the project answers by: its registry line, `/whoami`'s
   * `project`, and its directory under `~/.config/`. A `--status` across every
   * project is worthless if one of them registers under one name and answers
   * under another, so there is exactly one field for it.
   */
  readonly name: string;
  /** What a page's tab says, ahead of the port: `Star Swarm - 8795`. */
  readonly title: string;
  readonly first: number;
  readonly last: number;
  /** The port `npm run dev` takes when it is free. */
  readonly preferred: number;
  readonly repo: string;
}

/** This project's line in the agreement. */
export const STAR_SWARM: Agreement = {
  name: 'star-swarm',
  title: 'Star Swarm',
  first: 8790,
  last: 8799,
  preferred: 8795,
  repo: 'https://github.com/sgwoods/star-swarm',
};

/** The only address any server of this project binds. */
export const HOST = '127.0.0.1';

/** The route every server of every project in the agreement answers. */
export const WHOAMI_PATH = '/whoami';

/* -------------------------------------------------------------------------- */
/* The block                                                                    */
/* -------------------------------------------------------------------------- */

export function inBlock(agreement: Agreement, port: number): boolean {
  return Number.isInteger(port) && port >= agreement.first && port <= agreement.last;
}

/** `8790-8799`: a block as the registry writes it. */
export function blockText(agreement: Pick<Agreement, 'first' | 'last'>): string {
  return `${String(agreement.first)}-${String(agreement.last)}`;
}

/** Every port of the block, lowest first. */
export function blockPorts(agreement: Pick<Agreement, 'first' | 'last'>): number[] {
  return Array.from(
    { length: agreement.last - agreement.first + 1 },
    (_, i) => agreement.first + i,
  );
}

/**
 * The order `npm run dev` tries ports in: the default, then the rest of the
 * block upwards, wrapping round. Every candidate is inside the block, because
 * this is the only list a server is ever offered.
 */
export function serverPorts(agreement: Agreement): number[] {
  const size = agreement.last - agreement.first + 1;
  return Array.from(
    { length: size },
    (_, i) => agreement.first + ((agreement.preferred - agreement.first + i) % size),
  );
}

/**
 * The order a helper server tries ports in — the record page's, a capture's, a
 * preview's: the same ports with the default moved last, so a helper started
 * first does not push the dev server off the port it advertises.
 */
export function helperPorts(agreement: Agreement): number[] {
  const [preferred, ...rest] = serverPorts(agreement);
  return preferred === undefined ? rest : [...rest, preferred];
}

/* -------------------------------------------------------------------------- */
/* Probing a port                                                               */
/* -------------------------------------------------------------------------- */

/** Does anything accept a connection on `host:port`? */
function answers(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolveAnswer) => {
    const socket = connect({ host, port });
    const done = (answer: boolean): void => {
      socket.destroy();
      resolveAnswer(answer);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Could this process bind `127.0.0.1:port` right now? */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolveBind) => {
    const server = createNetServer();
    server.once('error', () => resolveBind(false));
    server.listen({ host: HOST, port, exclusive: true }, () => {
      server.close(() => resolveBind(true));
    });
  });
}

/**
 * Is `port` free for a server of ours?
 *
 * Binding alone is not the test. macOS lets a process bind `127.0.0.1:port`
 * while another holds the wildcard address on the same port, and Vite on
 * `localhost` listens on `::1` — so a port is busy if anything answers on either
 * loopback, and only then is binding tried.
 */
export async function isPortFree(port: number): Promise<boolean> {
  const [v4, v6] = await Promise.all([answers(HOST, port), answers('::1', port)]);
  if (v4 || v6) return false;
  return canBind(port);
}

/** A process listening on a port, as `lsof` names it. */
export interface Holder {
  readonly pid: number;
  readonly command: string;
}

/** Who is listening on `port`, or `undefined` when `lsof` cannot say. */
export function portHolders(port: number): Holder[] | undefined {
  let out: string;
  try {
    out = execFileSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpc'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    // lsof exits 1 when nothing matches: that is an answer, and it is "nobody".
    const status = (error as { status?: unknown }).status;
    return status === 1 ? [] : undefined;
  }
  const holders: Holder[] = [];
  let pid: number | undefined;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c') && pid !== undefined) {
      if (!holders.some((holder) => holder.pid === pid))
        holders.push({ pid, command: line.slice(1) });
    }
  }
  return holders;
}

/* -------------------------------------------------------------------------- */
/* /whoami                                                                      */
/* -------------------------------------------------------------------------- */

/** What a server in the agreement says about itself. */
export interface Whoami {
  readonly project: string;
  readonly port: number;
  readonly pid: number;
  readonly version: string;
}

/** The body this process answers `/whoami` with. */
export function whoamiBody(agreement: Agreement, port: number, version: string): Whoami {
  return { project: agreement.name, port, pid: process.pid, version };
}

/**
 * The `/whoami` route, as Connect middleware: the dev server, the preview
 * server and the helpers all mount this one, so they cannot answer differently.
 * The port is the one the request arrived on, which is the one the server really
 * has rather than the one it was configured with.
 */
export function whoamiMiddleware(
  agreement: Agreement,
  version: () => string,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    if (req.url?.split('?')[0] !== WHOAMI_PATH) {
      next();
      return;
    }
    const port = req.socket.localPort ?? 0;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(whoamiBody(agreement, port, version())));
  };
}

/** Read a `/whoami` document, or `undefined` for anything that is not one. */
export function parseWhoami(body: unknown): Whoami | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { project, port, pid, version } = body as Record<string, unknown>;
  if (typeof project !== 'string' || typeof version !== 'string') return undefined;
  if (!Number.isInteger(port) || !Number.isInteger(pid)) return undefined;
  return { project, port: port as number, pid: pid as number, version };
}

/** Ask the server on `127.0.0.1:port` who it is. Never throws. */
export async function askWhoami(port: number, timeoutMs = 1000): Promise<Whoami | undefined> {
  try {
    const response = await fetch(`http://${HOST}:${String(port)}${WHOAMI_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return undefined;
    return parseWhoami(await response.json());
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* The page says which project it is                                            */
/* -------------------------------------------------------------------------- */

/** What a dev page is stamped with. */
export interface PageIdentity {
  readonly port: number;
  readonly version: string;
}

/** The element id of the label, so a test can find it and a build can lack it. */
export const IDENTITY_LABEL_ID = 'local-identity';

/** The tab icon: a flying saucer, which none of the other three projects is. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<text y='.9em' font-size='90'>\u{1F6F8}</text></svg>",
)}`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/**
 * Stamp a page with the project, port and version it is being served by.
 *
 * The tab title gains the port straight after the project's name — `Star Swarm
 * - 8795`, `Star Swarm - 8795 — /lab` — so it survives a narrow tab. The head
 * gains a favicon and the body a small fixed label at the top-left corner, which
 * on the game page is letterbox, and which takes no pointer events so nothing
 * under it stops working.
 *
 * Only the dev server calls this (`vite.config.ts`, `apply: 'serve'`): a page a
 * build publishes is never stamped, and `tests/unit/lab-dev-only.test.ts` builds
 * one to check.
 */
export function stampPage(html: string, agreement: Agreement, page: PageIdentity): string {
  const port = String(page.port);
  const label = `${agreement.title} · ${port} · ${page.version}`;
  const named = escapeHtml(`${agreement.title} - ${port}`);
  // The page's own words follow: `/lab`, `capture`, `the shelf`. They are the
  // document's HTML already, so they go back as they were.
  const titled = html.replace(/<title>([^<]*)<\/title>/, (_match, title: string) => {
    const rest = title.startsWith(agreement.title)
      ? title.slice(agreement.title.length)
      : ` — ${title}`;
    return `<title>${named}${rest}</title>`;
  });
  const head =
    `<link rel="icon" href="${FAVICON}" />` +
    `<style>#${IDENTITY_LABEL_ID}{position:fixed;top:0;left:0;z-index:2147483647;` +
    'pointer-events:none;padding:1px 6px;border-bottom-right-radius:4px;' +
    'background:rgba(0,0,0,0.7);color:#c8c8d8;' +
    'font:10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}</style>';
  const body = `<div id="${IDENTITY_LABEL_ID}" aria-hidden="true">${escapeHtml(label)}</div>`;
  return titled.replace(/<\/head>/, `${head}</head>`).replace(/<body([^>]*)>/, `<body$1>${body}`);
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                 */
/* -------------------------------------------------------------------------- */

/** The registry's first line, written only by whoever creates the file. */
export const REGISTRY_HEADER = 'name\tports\tdefault\trepo';

/** `~/.config/local-ports.tsv` under `home`. */
export function registryPath(home: string): string {
  return join(home, '.config', 'local-ports.tsv');
}

/** This project's line, exactly. */
export function registryLine(agreement: Agreement): string {
  return [agreement.name, blockText(agreement), String(agreement.preferred), agreement.repo].join(
    '\t',
  );
}

/** One project's line, read back. */
export interface RegistryEntry {
  readonly name: string;
  readonly first: number;
  readonly last: number;
  readonly preferred: number;
  readonly repo: string;
}

/**
 * Every well-formed line of a registry. The header, `#` comments, blank lines and
 * lines this cannot read are skipped rather than rejected: the file is shared,
 * and another project's line in a shape this does not expect is not ours to fail
 * over.
 */
export function parseRegistry(text: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const [name, block, preferred, repo] = line.split('\t');
    const range = /^(\d+)-(\d+)$/.exec(block?.trim() ?? '');
    if (name === undefined || name === 'name' || range === null) continue;
    const first = Number(range[1]);
    const last = Number(range[2]);
    if (first > last) continue;
    entries.push({
      name: name.trim(),
      first,
      last,
      preferred: Number(preferred ?? Number.NaN),
      repo: repo?.trim() ?? '',
    });
  }
  return entries;
}

function overlapping(a: Pick<RegistryEntry, 'first' | 'last'>, b: RegistryEntry): boolean {
  return a.first <= b.last && b.first <= a.last;
}

export interface RegistryResult {
  /** What happened to the file: nothing, or which of three writes. */
  readonly change: 'unchanged' | 'created' | 'appended' | 'replaced';
  /** Other projects whose block overlaps this one's. */
  readonly overlaps: readonly RegistryEntry[];
}

/**
 * Make sure the registry has this project's line, and only touch that line.
 *
 * Three writes, each the smallest that does it. A missing file is created with
 * the header, exclusively, so two projects starting at once cannot both create
 * it. A missing line is appended, which never rewrites anybody else's. Only a
 * line of ours that has drifted is rewritten in place, and then every other
 * line goes back byte for byte.
 */
export function ensureRegistry(path: string, agreement: Agreement): RegistryResult {
  const ours = registryLine(agreement);
  let change: RegistryResult['change'] = 'unchanged';
  let text = readOrUndefined(path);
  if (text === undefined) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, `${REGISTRY_HEADER}\n${ours}\n`, { flag: 'wx' });
      change = 'created';
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    text = readFileSync(path, 'utf8');
  }

  if (change !== 'created') {
    const lines = text.split('\n');
    const mine = lines.filter((line) => line.split('\t')[0]?.trim() === agreement.name);
    if (mine.length === 0) {
      appendFileSync(path, `${text === '' || text.endsWith('\n') ? '' : '\n'}${ours}\n`);
      change = 'appended';
    } else if (mine.length > 1 || mine[0]?.replace(/\r$/, '') !== ours) {
      let placed = false;
      const kept = lines.flatMap((line) => {
        if (line.split('\t')[0]?.trim() !== agreement.name) return [line];
        if (placed) return [];
        placed = true;
        return [ours];
      });
      const temporary = `${path}.${String(process.pid)}.tmp`;
      writeFileSync(temporary, kept.join('\n'));
      renameSync(temporary, path);
      change = 'replaced';
    }
    text = readFileSync(path, 'utf8');
  }

  const overlaps = parseRegistry(text).filter(
    (entry) => entry.name !== agreement.name && overlapping(agreement, entry),
  );
  return { change, overlaps };
}

/* -------------------------------------------------------------------------- */
/* server.json                                                                  */
/* -------------------------------------------------------------------------- */

/** What a running dev server leaves behind so the next one can find it. */
export interface ServerRecord {
  readonly pid: number;
  readonly port: number;
  readonly started: string;
}

/** `~/.config/<name>/server.json` under `home`. */
export function serverRecordPath(home: string, agreement: Agreement): string {
  return join(home, '.config', agreement.name, 'server.json');
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The recorded server, or `undefined` if there is none or it is unreadable. */
export function readServerRecord(path: string): ServerRecord | undefined {
  const text = readOrUndefined(path);
  if (text === undefined) return undefined;
  try {
    const { pid, port, started } = JSON.parse(text) as Record<string, unknown>;
    if (!Number.isInteger(pid) || !Number.isInteger(port) || typeof started !== 'string') {
      return undefined;
    }
    return { pid: pid as number, port: port as number, started };
  } catch {
    return undefined;
  }
}

export function writeServerRecord(path: string, record: ServerRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`);
  renameSync(temporary, path);
}

/**
 * Remove the record, but only while it still names `pid`: a copy shutting down
 * after its replacement has started must not delete the replacement's record.
 */
export function removeServerRecord(path: string, pid: number): void {
  if (readServerRecord(path)?.pid === pid) rmSync(path, { force: true });
}

/* -------------------------------------------------------------------------- */
/* Replacing an older copy                                                      */
/* -------------------------------------------------------------------------- */

/** Everything {@link retireOlderCopy} does to the world, so a test can watch it. */
export interface RetireDeps {
  readonly isAlive: (pid: number) => boolean;
  readonly signal: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  readonly whoami: (port: number) => Promise<Whoami | undefined>;
  readonly isPortFree: (port: number) => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
}

export interface RetireTiming {
  /** How long a copy asked to stop is given before it is killed. */
  readonly graceMs: number;
  /** How long to wait for the port once the copy has gone. */
  readonly portMs: number;
  readonly pollMs: number;
}

export const RETIRE_TIMING: RetireTiming = { graceMs: 3000, portMs: 5000, pollMs: 100 };

export type Retired =
  /** Nothing to replace: no record, or the recorded process has gone. */
  | { readonly outcome: 'none'; readonly reason: string }
  /** A recorded process that is not provably ours, left exactly as it was. */
  | { readonly outcome: 'left-alone'; readonly reason: string }
  /** Our older copy, stopped; `port` is its port if that came free. */
  | { readonly outcome: 'replaced'; readonly killed: boolean; readonly port: number | undefined };

/** `process.kill(pid, 0)`: alive, including alive and somebody else's. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

export const REAL_RETIRE_DEPS: RetireDeps = {
  isAlive: processIsAlive,
  signal: (pid, signal) => {
    process.kill(pid, signal);
  },
  whoami: (port) => askWhoami(port),
  isPortFree,
  sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  log: (line) => {
    console.log(line);
  },
};

async function waitFor(
  test: () => boolean | Promise<boolean>,
  ms: number,
  deps: RetireDeps,
  pollMs: number,
): Promise<boolean> {
  for (let waited = 0; ; waited += pollMs) {
    if (await test()) return true;
    if (waited >= ms) return false;
    await deps.sleep(pollMs);
  }
}

/**
 * Stop the copy of this project `server.json` recorded, if — and only if — it
 * provably is one.
 *
 * Asked first (`SIGTERM`, which a dev server answers by closing and removing its
 * record), killed (`SIGKILL`) only once the grace period has gone by, and then
 * the port is waited for rather than assumed. Everything that can make the
 * record wrong — a dead pid, a pid since reused, a port outside the block, a
 * server of another project, a server that will not say — is a reason to touch
 * nothing.
 */
export async function retireOlderCopy(
  agreement: Agreement,
  record: ServerRecord | undefined,
  deps: RetireDeps = REAL_RETIRE_DEPS,
  timing: RetireTiming = RETIRE_TIMING,
): Promise<Retired> {
  if (record === undefined) return { outcome: 'none', reason: 'no server.json' };
  const { pid, port } = record;
  if (!inBlock(agreement, port)) {
    return {
      outcome: 'left-alone',
      reason: `server.json names port ${String(port)}, outside ${blockText(agreement)}`,
    };
  }
  if (pid <= 1 || pid === process.pid || pid === process.ppid) {
    return { outcome: 'left-alone', reason: `server.json names pid ${String(pid)}` };
  }
  if (!deps.isAlive(pid)) {
    return { outcome: 'none', reason: `pid ${String(pid)} in server.json has exited` };
  }

  const who = await deps.whoami(port);
  if (who === undefined) {
    return {
      outcome: 'left-alone',
      reason: `nothing on port ${String(port)} answers ${WHOAMI_PATH}, so pid ${String(pid)} is not provably ours`,
    };
  }
  if (who.project !== agreement.name) {
    return {
      outcome: 'left-alone',
      reason: `port ${String(port)} answers as ${JSON.stringify(who.project)}, not ${agreement.name}`,
    };
  }
  if (who.pid !== pid || who.port !== port) {
    return {
      outcome: 'left-alone',
      reason:
        `port ${String(port)} is ${agreement.name} pid ${String(who.pid)}, ` +
        `not the pid ${String(pid)} server.json names`,
    };
  }

  deps.log(`${agreement.name}: stopping the older copy (pid ${String(pid)}, port ${String(port)})`);
  deps.signal(pid, 'SIGTERM');
  let killed = false;
  if (!(await waitFor(() => !deps.isAlive(pid), timing.graceMs, deps, timing.pollMs))) {
    deps.log(`${agreement.name}: pid ${String(pid)} did not stop; killing it`);
    deps.signal(pid, 'SIGKILL');
    killed = true;
    await waitFor(() => !deps.isAlive(pid), timing.graceMs, deps, timing.pollMs);
  }
  const freed = await waitFor(() => deps.isPortFree(port), timing.portMs, deps, timing.pollMs);
  return { outcome: 'replaced', killed, port: freed ? port : undefined };
}

/* -------------------------------------------------------------------------- */
/* Listening inside the block                                                   */
/* -------------------------------------------------------------------------- */

/** Every port of the block was taken; the message names who holds each one. */
export class BlockFullError extends Error {
  override readonly name = 'BlockFullError';
}

function addressInUse(error: unknown): boolean {
  if ((error as { code?: unknown }).code === 'EADDRINUSE') return true;
  // Vite's strictPort refusal is a plain Error with this message.
  return error instanceof Error && /already in use/i.test(error.message);
}

/** One line per port: who holds it, as far as `/whoami` and `lsof` can tell. */
export async function describeHolders(ports: readonly number[]): Promise<string[]> {
  return Promise.all(
    ports.map(async (port) => {
      const who = await askWhoami(port, 500);
      const holders = portHolders(port);
      const names =
        holders === undefined
          ? 'a process lsof could not name'
          : holders.length === 0
            ? 'no listener lsof can see'
            : holders.map((h) => `${h.command} (pid ${String(h.pid)})`).join(', ');
      const answer = who === undefined ? '' : ` — answers ${WHOAMI_PATH} as ${who.project}`;
      return `  ${String(port)}  ${names}${answer}`;
    }),
  );
}

/**
 * Start a server on the first free port of `order`, which must lie inside the
 * block — a candidate outside it is a bug, and refused before anything binds.
 * `start` is handed one port and must bind exactly that one (Vite's
 * `strictPort`); a port lost to a race between the probe and the bind is skipped
 * like a busy one. When nothing is free, nothing is started.
 */
export async function listenInBlock<S>(
  agreement: Agreement,
  order: readonly number[],
  start: (port: number) => Promise<S>,
  isFree: (port: number) => Promise<boolean> = isPortFree,
): Promise<{ readonly server: S; readonly port: number }> {
  const outside = order.filter((port) => !inBlock(agreement, port));
  if (outside.length > 0) {
    throw new Error(
      `${agreement.name}: refusing ports outside ${blockText(agreement)}: ${outside.join(', ')}`,
    );
  }
  for (const port of order) {
    if (!(await isFree(port))) continue;
    try {
      return { server: await start(port), port };
    } catch (error) {
      if (addressInUse(error)) continue;
      throw error;
    }
  }
  throw new BlockFullError(
    [
      `${agreement.name}: every port in ${blockText(agreement)} is busy, so nothing was started.`,
      ...(await describeHolders(blockPorts(agreement))),
    ].join('\n'),
  );
}

/* -------------------------------------------------------------------------- */
/* --status                                                                     */
/* -------------------------------------------------------------------------- */

/** What one port of one project's block turned out to hold. */
export interface PortFinding {
  readonly port: number;
  readonly whoami: Whoami | undefined;
  readonly listening: boolean;
  /** Who is listening, for a port that does not say who it is. */
  readonly holders?: readonly Holder[];
}

/**
 * Report on every project in the registry: who is running, on which port, at
 * which version — and anything in somebody's block that is not that somebody.
 * Read-only: `--status` writes nothing and signals nobody.
 */
export async function statusReport(
  home: string,
  probe: (port: number) => Promise<PortFinding> = probePort,
): Promise<string[]> {
  const path = registryPath(home);
  const text = readOrUndefined(path);
  if (text === undefined) {
    return [`no registry at ${path} yet: starting any project's server once creates it`];
  }
  const entries = parseRegistry(text);
  const width = Math.max(0, ...entries.map((entry) => entry.name.length));
  const lines = [`${path}: ${String(entries.length)} project${entries.length === 1 ? '' : 's'}`];
  for (const entry of entries) {
    const findings = await Promise.all(blockPorts(entry).map(probe));
    const own = findings.filter((finding) => finding.whoami?.project === entry.name);
    const head = `  ${entry.name.padEnd(width)}  ${blockText(entry)}`;
    if (own.length === 0) lines.push(`${head}  not running`);
    for (const finding of own) {
      const who = finding.whoami as Whoami;
      lines.push(
        `${head}  running on ${String(finding.port)}  version ${who.version}  pid ${String(who.pid)}`,
      );
    }
    for (const finding of findings) {
      if (finding.whoami?.project === entry.name || !finding.listening) continue;
      const held = (finding.holders ?? [])
        .map((h) => `${h.command} (pid ${String(h.pid)}) `)
        .join('');
      const what =
        finding.whoami === undefined
          ? `${held}busy, and does not answer ${WHOAMI_PATH}`
          : `answers as ${finding.whoami.project}, inside ${entry.name}'s block`;
      lines.push(`  ${' '.repeat(width)}  ${String(finding.port)}: ${what}`);
    }
  }
  return lines;
}

async function probePort(port: number): Promise<PortFinding> {
  const whoami = await askWhoami(port, 800);
  if (whoami !== undefined) return { port, whoami, listening: true };
  const [v4, v6] = await Promise.all([answers(HOST, port), answers('::1', port)]);
  if (!v4 && !v6) return { port, whoami, listening: false };
  return { port, whoami, listening: true, holders: portHolders(port) ?? [] };
}
