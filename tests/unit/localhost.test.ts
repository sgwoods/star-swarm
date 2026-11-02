import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { helperServer } from '../../scripts/capture.js';
import {
  type Agreement,
  askWhoami,
  BlockFullError,
  blockPorts,
  ensureRegistry,
  helperPorts,
  IDENTITY_LABEL_ID,
  inBlock,
  isPortFree,
  listenInBlock,
  parseRegistry,
  portHolders,
  readServerRecord,
  REAL_RETIRE_DEPS,
  REGISTRY_HEADER,
  registryLine,
  registryPath,
  removeServerRecord,
  retireOlderCopy,
  type RetireTiming,
  serverPorts,
  serverRecordPath,
  STAR_SWARM,
  stampPage,
  statusReport,
  writeServerRecord,
} from '../../scripts/localhost.js';
import viteConfig, { localIdentity } from '../../vite.config.js';
import { alive, devServer, REPO_ROOT, signalGroup, standIn, stopAll } from './helpers/localhost.js';

/**
 * The localhost agreement (README, "Local ports"; `scripts/localhost.ts`).
 *
 * Three claims are the ones the agreement asked to be tested, and each is held
 * here by real sockets and real processes rather than by a description of them:
 *
 *  1. **No server binds outside 8790-8799** — the dev server's configuration,
 *     the order it tries ports in, the helper servers the record and capture
 *     commands start, and a block with no port left.
 *  2. **Another project's server is never stopped** — nor one that does not
 *     answer `/whoami`, nor a process a stale `server.json` names that is now
 *     something else. Each stand-in prints every `SIGTERM` it gets, so "left
 *     alone" means not even asked.
 *  3. **This project's own older copy is replaced** — asked first, killed only
 *     after the grace period, and its port taken once free.
 *
 * The last block runs the real `npm run dev` through 2 and 3 as well.
 */

const FAST: RetireTiming = { graceMs: 600, portMs: 2000, pollMs: 25 };

let home = '';
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'star-swarm-localhost-'));
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
afterEach(async () => {
  await stopAll();
});

/* -------------------------------------------------------------------------- */
/* 1. Never outside the block                                                   */
/* -------------------------------------------------------------------------- */

describe('the server never binds outside its block', () => {
  it('is the block the agreement gives this project', () => {
    expect(STAR_SWARM).toMatchObject({
      name: 'star-swarm',
      first: 8790,
      last: 8799,
      preferred: 8795,
    });
  });

  it('configures Vite on 127.0.0.1 and the default port, and never lets it walk out', () => {
    // `strictPort` is the half that matters: without it Vite tries the next port
    // up from a busy one, and 8799 + 1 is aurora's neighbour's.
    for (const options of [viteConfig.server, viteConfig.preview]) {
      expect(options).toMatchObject({ host: '127.0.0.1', port: 8795, strictPort: true });
    }
  });

  it('tries the default first and then only the other nine', () => {
    expect(serverPorts(STAR_SWARM)).toEqual([
      8795, 8796, 8797, 8798, 8799, 8790, 8791, 8792, 8793, 8794,
    ]);
    // A helper leaves the default to the dev server, but has nowhere else to go.
    expect(helperPorts(STAR_SWARM)).toEqual([
      8796, 8797, 8798, 8799, 8790, 8791, 8792, 8793, 8794, 8795,
    ]);
    expect(blockPorts(STAR_SWARM)).toEqual([...serverPorts(STAR_SWARM)].sort((a, b) => a - b));
  });

  it('refuses a candidate outside the block before binding anything', async () => {
    let started = 0;
    const start = (port: number): Promise<number> => {
      started += 1;
      return Promise.resolve(port);
    };
    await expect(listenInBlock(STAR_SWARM, [8795, 8800], start)).rejects.toThrow(
      /refusing ports outside 8790-8799: 8800/,
    );
    await expect(listenInBlock(STAR_SWARM, [5173], start)).rejects.toThrow(/5173/);
    expect(started).toBe(0);
  });

  describe('with real sockets on a block of its own', () => {
    // A ten-port block found free right now, so this never fights a dev server
    // on the machine for the real one.
    let block: Agreement;
    const held: Server[] = [];

    beforeAll(async () => {
      for (let base = 41000; base < 60000; base += 10) {
        const ports = Array.from({ length: 10 }, (_, i) => base + i);
        const free = await Promise.all(ports.map((port) => canHold(port)));
        if (free.every(Boolean)) {
          block = { ...STAR_SWARM, first: base, last: base + 9, preferred: base + 5 };
          return;
        }
      }
      throw new Error('no free ten-port range to test with');
    });

    afterEach(async () => {
      await Promise.all(held.splice(0).map((server) => closeServer(server)));
    });

    it('starts nothing, and names who holds each port, when every port is taken', async () => {
      for (const port of blockPorts(block)) held.push(await hold(port));
      const started: number[] = [];
      const error = await listenInBlock(block, serverPorts(block), (port) => {
        started.push(port);
        return Promise.resolve(port);
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BlockFullError);
      expect(started).toEqual([]);
      const message = (error as Error).message;
      expect(message).toMatch(`every port in ${String(block.first)}-${String(block.last)} is busy`);
      for (const port of blockPorts(block)) {
        expect(message).toMatch(new RegExp(`^  ${String(port)}  `, 'm'));
      }
      // Named by lsof where the machine has it — every Mac, and CI's Ubuntu.
      if (portHolders(block.first) !== undefined) {
        expect(message).toMatch(`(pid ${String(process.pid)})`);
      }
    });

    it('takes the one port left, and only that one', async () => {
      const left = block.first + 2;
      for (const port of blockPorts(block)) if (port !== left) held.push(await hold(port));
      const { server, port } = await listenInBlock(block, serverPorts(block), (candidate) =>
        hold(candidate),
      );
      held.push(server);
      expect(port).toBe(left);
    });
  });

  it('puts the record and capture commands’ own server inside the block', async () => {
    // They used to take whatever port the OS handed out.
    const { server, port } = await helperServer({ root: REPO_ROOT, logLevel: 'silent' });
    try {
      expect(inBlock(STAR_SWARM, port)).toBe(true);
      expect(await askWhoami(port)).toMatchObject({
        project: 'star-swarm',
        port,
        pid: process.pid,
      });
    } finally {
      await server.close();
    }
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* 2. Never another project's server                                            */
/* -------------------------------------------------------------------------- */

describe('the server never stops another project’s server', () => {
  async function leftAlone(record: { pid: number; port: number }): Promise<string> {
    const result = await retireOlderCopy(
      STAR_SWARM,
      { ...record, started: '2026-11-02T00:00:00.000Z' },
      { ...REAL_RETIRE_DEPS, log: () => undefined },
      FAST,
    );
    expect(result.outcome).not.toBe('replaced');
    // A signal sent and not waited on reaches the stand-in, and its output
    // reaches this process, a moment after the call returns. Without this pause
    // "never asked to stop" would be checked before a stray SIGTERM could show.
    await settle();
    return result.outcome === 'replaced' ? '' : result.reason;
  }

  it('leaves a server that answers as another project alone', async () => {
    const other = await standIn({ mode: 'whoami', project: 'aurora', onTerm: 'exit' });
    expect(await leftAlone(other)).toMatch('answers as "aurora"');
    expect(alive(other.pid)).toBe(true);
    expect(other.output()).not.toMatch('SIGTERM');
  });

  it('leaves a server that does not answer /whoami alone', async () => {
    const silent = await standIn({ mode: 'silent', onTerm: 'exit' });
    expect(await leftAlone(silent)).toMatch('answers /whoami');
    expect(alive(silent.pid)).toBe(true);
    expect(silent.output()).not.toMatch('SIGTERM');
  });

  it('leaves a stale record’s pid alone when it is now some other process', async () => {
    // The case the kill path exists to get right: the recorded copy died, its pid
    // went to an unrelated process, and the recorded port now answers as nothing.
    const unrelated = await standIn({ mode: 'silent', listen: false, onTerm: 'exit' });
    const port = await quietPort();
    expect(await leftAlone({ pid: unrelated.pid, port })).toMatch('answers /whoami');
    expect(alive(unrelated.pid)).toBe(true);
    expect(unrelated.output()).not.toMatch('SIGTERM');
  });

  it('leaves it alone even when a copy of this project now holds the port', async () => {
    // Same stale pid, but the recorded port is now some other star-swarm server
    // (another checkout's, a Playwright run's): neither is what the record named.
    const unrelated = await standIn({ mode: 'silent', listen: false, onTerm: 'exit' });
    const ours = await standIn({ mode: 'whoami', project: 'star-swarm', onTerm: 'exit' });
    expect(await leftAlone({ pid: unrelated.pid, port: ours.port })).toMatch(
      `is star-swarm pid ${String(ours.pid)}, not the pid ${String(unrelated.pid)}`,
    );
    for (const process_ of [unrelated, ours]) {
      expect(alive(process_.pid)).toBe(true);
      expect(process_.output()).not.toMatch('SIGTERM');
    }
  });

  it('touches nothing a record places outside the block', async () => {
    const outside = await standIn({
      mode: 'whoami',
      project: 'star-swarm',
      listen: false,
      onTerm: 'exit',
    });
    expect(await leftAlone({ pid: outside.pid, port: 8800 })).toMatch('outside 8790-8799');
    expect(outside.output()).not.toMatch('SIGTERM');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Replacing its own older copy                                              */
/* -------------------------------------------------------------------------- */

describe('the server replaces its own older copy', () => {
  async function retire(record: { pid: number; port: number }): ReturnType<typeof retireOlderCopy> {
    return retireOlderCopy(
      STAR_SWARM,
      { ...record, started: '2026-11-02T00:00:00.000Z' },
      { ...REAL_RETIRE_DEPS, log: () => undefined },
      FAST,
    );
  }

  it('asks it to stop, and takes its port once it is free', async () => {
    const older = await standIn({ mode: 'whoami', project: 'star-swarm', onTerm: 'exit' });
    expect(await retire(older)).toEqual({ outcome: 'replaced', killed: false, port: older.port });
    expect(older.output()).toMatch('SIGTERM');
    expect(older.hasExited()).toBe(true);
  });

  it('kills it only after the grace period, if asking did not work', async () => {
    const stubborn = await standIn({ mode: 'whoami', project: 'star-swarm', onTerm: 'ignore' });
    const asked = Date.now();
    expect(await retire(stubborn)).toEqual({
      outcome: 'replaced',
      killed: true,
      port: stubborn.port,
    });
    expect(Date.now() - asked).toBeGreaterThanOrEqual(FAST.graceMs);
    expect(stubborn.output()).toMatch('SIGTERM');
    await stubborn.exited;
    expect(stubborn.child.signalCode).toBe('SIGKILL');
  });

  it('has nothing to do when the recorded copy has already gone', async () => {
    const gone = await standIn({ mode: 'whoami', project: 'star-swarm', onTerm: 'exit' });
    gone.child.kill('SIGKILL');
    await gone.exited;
    expect((await retire(gone)).outcome).toBe('none');
  });
});

/* -------------------------------------------------------------------------- */
/* The real command                                                             */
/* -------------------------------------------------------------------------- */

const RUNNING = /star-swarm running at http:\/\/127\.0\.0\.1:(\d+)\/\n/;

describe('npm run dev, run for real', () => {
  // `HOME` is a throwaway directory for every launch, so the registry and the
  // record these read and write are the test's own, never the machine's.
  it('replaces its own older copy on the same port, and --status sees it', async () => {
    const devHome = mkdtempSync(join(tmpdir(), 'star-swarm-dev-'));
    const recordPath = serverRecordPath(devHome, STAR_SWARM);

    const first = devServer(devHome);
    const [, portText = ''] = await first.waitFor(RUNNING);
    const port = Number(portText);
    expect(inBlock(STAR_SWARM, port)).toBe(true);
    const older = readServerRecord(recordPath);
    expect(older?.port).toBe(port);
    expect((await askWhoami(port))?.pid).toBe(older?.pid);
    expect(readFileSync(registryPath(devHome), 'utf8')).toBe(
      `${REGISTRY_HEADER}\n${registryLine(STAR_SWARM)}\n`,
    );

    const status = devServer(devHome, ['--status']);
    await status.exited;
    expect(status.output()).toMatch(
      new RegExp(
        `star-swarm  8790-8799  running on ${portText}  version \\w+  pid ${String(older?.pid)}`,
      ),
    );

    const second = devServer(devHome);
    await second.waitFor(RUNNING);
    expect(second.output()).toMatch(
      `stopping the older copy (pid ${String(older?.pid)}, port ${portText})`,
    );
    expect(RUNNING.exec(second.output())?.[1]).toBe(portText);
    await first.exited;
    expect(alive(older?.pid ?? 0)).toBe(false);
    const newer = readServerRecord(recordPath);
    expect(newer?.pid).not.toBe(older?.pid);
    expect(await askWhoami(port)).toMatchObject({ project: 'star-swarm', port, pid: newer?.pid });

    // Ctrl-C is a clean exit, and a clean exit takes the record with it.
    signalGroup(second, 'SIGINT');
    await second.exited;
    expect(readServerRecord(recordPath)).toBeUndefined();
    rmSync(devHome, { recursive: true, force: true });
  }, 90_000);

  it('never stops another project’s server that server.json names', async () => {
    const devHome = mkdtempSync(join(tmpdir(), 'star-swarm-dev-'));
    const other = await standIn({ mode: 'whoami', project: 'aurora', onTerm: 'exit' });
    writeServerRecord(serverRecordPath(devHome, STAR_SWARM), {
      pid: other.pid,
      port: other.port,
      started: '2026-11-02T00:00:00.000Z',
    });

    const dev = devServer(devHome);
    const [, portText = ''] = await dev.waitFor(RUNNING);
    expect(dev.output()).toMatch(
      `left the recorded server alone: port ${String(other.port)} answers as "aurora"`,
    );
    expect(Number(portText)).not.toBe(other.port);
    expect(inBlock(STAR_SWARM, Number(portText))).toBe(true);
    expect(alive(other.pid)).toBe(true);
    expect(other.output()).not.toMatch('SIGTERM');
    signalGroup(dev, 'SIGTERM');
    await dev.exited;
    rmSync(devHome, { recursive: true, force: true });
  }, 90_000);
});

/* -------------------------------------------------------------------------- */
/* The registry, the record and --status                                        */
/* -------------------------------------------------------------------------- */

describe('the shared registry', () => {
  const ours = 'star-swarm\t8790-8799\t8795\thttps://github.com/sgwoods/star-swarm';
  const others =
    '# kept as written\n' +
    'virtual-bookshelf\t8760-8769\t8765\t/somewhere/vb\n' +
    'news-pipeline\t8770-8779\t8775\tx\n' +
    'an odd line nobody can read\n';

  function registry(name: string, text?: string): string {
    const path = registryPath(join(home, name));
    if (text !== undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    return path;
  }

  it('is one line per project: name, block, default, repo', () => {
    expect(registryLine(STAR_SWARM)).toBe(ours);
    expect(registryPath('/Users/x')).toBe('/Users/x/.config/local-ports.tsv');
    expect(serverRecordPath('/Users/x', STAR_SWARM)).toBe(
      '/Users/x/.config/star-swarm/server.json',
    );
  });

  it('creates a missing file with a header and this project’s line', () => {
    const path = registry('created');
    expect(ensureRegistry(path, STAR_SWARM).change).toBe('created');
    expect(readFileSync(path, 'utf8')).toBe(`${REGISTRY_HEADER}\n${ours}\n`);
    expect(ensureRegistry(path, STAR_SWARM).change).toBe('unchanged');
  });

  it('appends its line and leaves every other line exactly as it was', () => {
    const path = registry('appended', `${REGISTRY_HEADER}\n${others.trimEnd()}`);
    expect(ensureRegistry(path, STAR_SWARM).change).toBe('appended');
    expect(readFileSync(path, 'utf8')).toBe(`${REGISTRY_HEADER}\n${others}${ours}\n`);
  });

  it('rewrites only its own line when that line has drifted', () => {
    const before = `${REGISTRY_HEADER}\nstar-swarm\t5173-5173\t5173\told\n${others}star-swarm\tdup\n`;
    const path = registry('replaced', before);
    expect(ensureRegistry(path, STAR_SWARM).change).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe(`${REGISTRY_HEADER}\n${ours}\n${others}`);
  });

  it('warns about a block that overlaps this one', () => {
    const path = registry('overlap', `${REGISTRY_HEADER}\nsquatter\t8798-8805\t8800\tx\n${others}`);
    expect(ensureRegistry(path, STAR_SWARM).overlaps.map((entry) => entry.name)).toEqual([
      'squatter',
    ]);
  });

  it('reads past the header, comments and lines it cannot parse', () => {
    expect(parseRegistry(`${REGISTRY_HEADER}\n${others}`).map((entry) => entry.name)).toEqual([
      'virtual-bookshelf',
      'news-pipeline',
    ]);
  });
});

describe('server.json', () => {
  it('is removed on exit only while it still names this copy', () => {
    const path = serverRecordPath(join(home, 'record'), STAR_SWARM);
    writeServerRecord(path, { pid: 1234, port: 8795, started: 'now' });
    removeServerRecord(path, 999);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      pid: 1234,
      port: 8795,
      started: 'now',
    });
    removeServerRecord(path, 1234);
    expect(() => readFileSync(path)).toThrow(/ENOENT/);
  });
});

describe('--status', () => {
  it('reports every project in the registry, running or not, and what squats', async () => {
    const statusHome = join(home, 'status');
    const path = registryPath(statusHome);
    ensureRegistry(path, STAR_SWARM);
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}virtual-bookshelf\t8760-8769\t8765\tx\naurora\t8780-8789\t8785\tx\n`,
    );
    const running = (project: string, port: number, pid: number) => ({
      port,
      listening: true,
      whoami: { project, port, pid, version: `v${String(pid)}` },
    });
    const lines = await statusReport(statusHome, (port) =>
      Promise.resolve(
        port === 8795
          ? running('star-swarm', port, 7)
          : port === 8760
            ? running('virtual-bookshelf', port, 8)
            : port === 8787
              ? { port, listening: true, whoami: undefined, holders: [{ pid: 9, command: 'php' }] }
              : port === 8788
                ? running('virtual-bookshelf', port, 10)
                : { port, listening: false, whoami: undefined },
      ),
    );
    expect(lines).toEqual([
      `${path}: 3 projects`,
      '  star-swarm         8790-8799  running on 8795  version v7  pid 7',
      '  virtual-bookshelf  8760-8769  running on 8760  version v8  pid 8',
      '  aurora             8780-8789  not running',
      '                     8787: php (pid 9) busy, and does not answer /whoami',
      "                     8788: answers as virtual-bookshelf, inside aurora's block",
    ]);
  });

  it('says so when there is no registry yet, and writes nothing', async () => {
    const empty = join(home, 'no-registry');
    expect(await statusReport(empty)).toEqual([
      `no registry at ${registryPath(empty)} yet: starting any project's server once creates it`,
    ]);
    expect(() => readFileSync(registryPath(empty))).toThrow(/ENOENT/);
  });
});

/* -------------------------------------------------------------------------- */
/* The page says which project it is — in development only                      */
/* -------------------------------------------------------------------------- */

describe('the identity stamp', () => {
  const page =
    '<html><head><title>Star Swarm</title></head><body class="x"><div></div></body></html>';

  it('puts the port in the tab title, a favicon in the head and a label in the body', () => {
    const stamped = stampPage(page, STAR_SWARM, { port: 8795, version: 'cc463a0' });
    expect(stamped).toMatch('<title>Star Swarm - 8795</title>');
    expect(stamped).toMatch(/<link rel="icon" href="data:image\/svg\+xml,[^"]+" \/>/);
    expect(stamped).toMatch(
      `<body class="x"><div id="${IDENTITY_LABEL_ID}" aria-hidden="true">Star Swarm · 8795 · cc463a0</div>`,
    );
  });

  it('keeps a page’s own words after the port', () => {
    const lab = page.replace('Star Swarm', 'Star Swarm — /lab');
    expect(stampPage(lab, STAR_SWARM, { port: 8796, version: 'x' })).toMatch(
      '<title>Star Swarm - 8796 — /lab</title>',
    );
  });

  it('is applied by a plugin that only exists while serving', () => {
    const plugin = localIdentity();
    expect(plugin.apply).toBe('serve');
    const hook = plugin.transformIndexHtml as (
      html: string,
      context: { server: { httpServer: { address: () => { port: number } } } },
    ) => string;
    const stamped = hook(page, { server: { httpServer: { address: () => ({ port: 8797 }) } } });
    expect(stamped).toMatch('<title>Star Swarm - 8797</title>');
  });
});

/* -------------------------------------------------------------------------- */

/** Long enough for a signal to land and the stand-in's answer to come back. */
function settle(): Promise<void> {
  return new Promise((resolveSettle) => setTimeout(resolveSettle, 400));
}

/** A port of the block nothing is listening on right now. */
async function quietPort(): Promise<number> {
  for (const port of helperPorts(STAR_SWARM)) if (await isPortFree(port)) return port;
  throw new Error('every port of 8790-8799 is busy');
}

/**
 * Hold a port: listening, so it is busy, and dropping every connection at once,
 * so a probe or a `/whoami` asked of it is answered by a hang-up rather than
 * kept open.
 */
function hold(port: number): Promise<Server> {
  return new Promise((resolveHold, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveHold(server));
  });
}

async function canHold(port: number): Promise<boolean> {
  try {
    await closeServer(await hold(port));
    return true;
  } catch {
    return false;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}
