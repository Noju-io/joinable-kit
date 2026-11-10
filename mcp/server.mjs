#!/usr/bin/env node
// Joinable's local MCP server: lets a coding agent find Joinable's kit, pick the right pattern for
// a game, get the exact snippet, and run the self-test. Stdio transport, no dependencies.
//   node mcp/server.mjs                         (from getjoinable 0.2.0: npx -y getjoinable mcp)
//   JOINABLE_RELAY=https://relay.getjoinable.com   the relay the snippets and kit come from (default)
// The read-only tools live in tools.mjs and are shared with the remote server at
// https://getjoinable.com/mcp (site/mcp.js). Only the self-test is local: it reaches the owner's
// dev server and starts browsers.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RELAY, VERSION, readTools, makeHandler, choosePattern, snippet, desyncs as desyncsAt, invalid } from './tools.mjs';

export { choosePattern, snippet, invalid };

const RELAY = (process.env.JOINABLE_RELAY || DEFAULT_RELAY).replace(/\/$/, '');

// An anonymous usage ping to Joinable: the command, the MCP tool, pass or fail, the version and
// whether it's CI. Nothing else: no game URL, no files, no machine or person. It never slows
// anything down. Turn it off with JOINABLE_TELEMETRY=0 (or DO_NOT_TRACK=1).
function ping(data) {
  if (process.env.JOINABLE_TELEMETRY === '0' || process.env.DO_NOT_TRACK === '1') return Promise.resolve();
  return fetch(`${RELAY}/v1/cli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: VERSION, ci: !!process.env.CI, ...data }),
    signal: AbortSignal.timeout(1500),
  }).catch(() => {});
}

// Works from the repo (mcp/, bin/, kit/) and from the npm package, where the CLI, this file
// and a copy of AGENTS.md sit side by side.
const here = (...paths) => paths.map((p) => fileURLToPath(new URL(p, import.meta.url))).find(existsSync);

async function readKit() {
  try {
    const res = await fetch(`${RELAY}/AGENTS.md`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return await res.text();
  } catch {}
  return readFileSync(here('./AGENTS.md', '../kit/AGENTS.md'), 'utf8'); // offline, or the relay is blocked
}

export const desyncs = (a) => desyncsAt(a, RELAY);

/** Seconds a round may take in the self-test: a whole number from 10 to 600, whatever was sent. */
export function roundSeconds(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(600, Math.max(10, n)) : 60;
}
const SELFTEST_MAX_MS = (600 + 120) * 1000; // the hard cap: no input can hold a tool call open longer

export function selftest({ url, round, channel }) {
  // Only web pages: an agent talked into passing a flag or a file:// path gets a plain refusal.
  if (!/^https?:\/\/[^\s]+$/i.test(String(url ?? ''))) return Promise.resolve({ text: 'Give the game page as an http:// or https:// address, e.g. http://localhost:5173/', isError: true });
  const secs = roundSeconds(round);
  return new Promise((resolve) => {
    const args = [here('./getjoinable.mjs', '../bin/getjoinable.mjs'), 'test', url, '--round', String(secs)];
    if (channel === 'chrome') args.push('--channel', 'chrome');
    // Its own process group, so a timeout ends the test and every browser it started.
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, Math.min(SELFTEST_MAX_MS, (secs + 120) * 1000));
    child.on('close', (code) => {
      clearTimeout(timer);
      const head = timedOut ? `FAILED: the self-test didn't finish within ${secs + 120} s and was stopped` : code === 0 ? 'PASSED' : 'FAILED';
      resolve({ text: `${head}\n\n${out.trim()}`, isError: timedOut || code !== 0 });
    });
  });
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL'); // the whole group: node and its browsers
  } catch {
    child.kill('SIGKILL');
  }
}

export const TOOLS = [
  ...readTools({ readKit, relay: RELAY }),
  {
    name: 'joinable_selftest',
    title: 'Run the Joinable self-test',
    description: 'Opens two headless players on the game\'s local page and checks the Joinable integration (same seed on both, players see each other, one result, rematch; for lockstep, the same simulation on Chromium and WebKit). Every failure says what to fix. Needs playwright-core\'s Chromium.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The game page, served locally, e.g. http://localhost:5173/' },
        round: { type: 'integer', minimum: 10, maximum: 600, description: 'Seconds to wait for a round to finish (default 60)' },
        channel: { type: 'string', enum: ['chrome'], description: 'Use the installed Chrome (with the GPU), for heavy 3D games' },
      },
      required: ['url'],
    },
    // It only reads the game page, but it starts browsers and connects them to the relay.
    annotations: { title: 'Run the Joinable self-test', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: selftest,
  },
];

export const handle = makeHandler({
  tools: TOOLS,
  instructions: 'Joinable makes web games multiplayer with a hosted relay. To add multiplayer to a game: joinable_kit (the guide), joinable_choose_pattern, joinable_snippet, change the game, then joinable_selftest until it passes. joinable_get_started covers keys and plans; joinable_desyncs has reports for lockstep games that went out of sync.',
  onInitialize: () => ping({ cmd: 'mcp' }),
  onCall: (tool) => ping({ cmd: 'mcp', tool }),
});

// Serve over stdio. The CLI's `getjoinable mcp` calls this; `node mcp/server.mjs` does too.
export function serve() {
  const send = (m) => m && process.stdout.write(JSON.stringify(m) + '\n');
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    send(await handle(msg));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serve();
