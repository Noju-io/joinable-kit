#!/usr/bin/env node
// Joinable's MCP server: lets a coding agent find Joinable's kit, pick the right pattern for a
// game, get the exact snippet, and run the self-test. Stdio transport, no dependencies.
//   node mcp/server.mjs                         (from getjoinable 0.2.0: npx -y getjoinable mcp)
//   JOINABLE_RELAY=https://relay.getjoinable.com   the relay the snippets and kit come from (default)
// Every answer comes from kit/AGENTS.md: if the kit changes, change this file with it.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const RELAY = (process.env.JOINABLE_RELAY || 'https://relay.getjoinable.com').replace(/\/$/, '');
const VERSION = '0.2.2';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

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

// ── Patterns, from the kit's "Read the game first" table ────────────────────────────────────

const PATTERNS = {
  race: {
    title: 'Full rounds, profile "race"',
    why: 'Each player drives their own car or runner on the same course. Joinable runs the waiting room, countdown, live standings, podium and rematch; the game reports its player 20 times a second and draws the others.',
  },
  score: {
    title: 'Full rounds, profile "score"',
    why: 'The game has a score or a time. Everyone plays the same seeded round; Joinable runs the waiting room, countdown, live scores, results and rematch. The game\'s state isn\'t touched.',
  },
  A: {
    title: 'Pattern A: shared world',
    why: 'Clicks and taps change one shared world. Joinable syncs the game\'s own state object; the input handlers become shared play. Often one script attribute.',
  },
  B: {
    title: 'Pattern B: avatars',
    why: 'Each player moves an avatar with held keys or a joystick in one world. Players send inputs to the host, the host moves everyone, the world syncs with Pattern A. Guests feel about one round trip of input delay.',
  },
  C: {
    title: 'Pattern A with turns (Pattern C)',
    why: 'Turn-based: keep whose turn it is in the synced state and ignore input when it isn\'t yours.',
  },
  lockstep: {
    title: 'Lockstep (profile "lockstep")',
    why: 'Strategy and RTS games, and any game with too much state to send: only players\' orders travel, and every device runs the same deterministic simulation from the same seed. The game must provide a command layer (orders as data, applied in step()), a fixed tick driven by Joinable, one seeded RNG, and hash() (a fingerprint of the simulation). No pause or speed-up online. Check it with the self-test: it compares the battle on Chromium and WebKit, tick by tick.',
  },
  none: {
    title: 'Not supported yet',
    why: 'Fighting games need rollback, competitive shooters need a cloud host. Neither is built. Tell the owner rather than forcing another pattern.',
  },
};

const GENRES = {
  racing: 'race', racer: 'race', 'time-trial': 'race', runner: 'race',
  arcade: 'score', puzzle: 'score', 'endless-runner': 'score', minigame: 'score', 'score-attack': 'score',
  board: 'A', card: 'A', word: 'A', clicker: 'A', idle: 'A', builder: 'A', drawing: 'A', 'casual-coop': 'A',
  platformer: 'B', 'top-down': 'B', party: 'B', avatars: 'B',
  'turn-based': 'C',
  rts: 'lockstep', strategy: 'lockstep', 'real-time-strategy': 'lockstep', 'tower-defense': 'lockstep', 'auto-battler': 'lockstep', simulation: 'lockstep',
  fighting: 'none', shooter: 'none', fps: 'none',
};

export function choosePattern({ genre = '', has_score_or_time, held_key_avatars, turn_based } = {}) {
  const g = String(genre).toLowerCase().trim().replace(/[\s_]+/g, '-');
  let id = GENRES[g];
  if (!id) {
    if (turn_based) id = 'C';
    else if (held_key_avatars) id = 'B';
    else if (has_score_or_time) id = 'score';
    else id = 'A';
  }
  // The kit prefers full rounds whenever they fit: a puzzle or clicker with a score can use them.
  const alsoFits = id === 'A' && has_score_or_time ? 'score' : null;
  return { pattern: id, ...PATTERNS[id], alsoFits: alsoFits && PATTERNS[alsoFits].title };
}

// ── Snippets, copied from the kit ───────────────────────────────────────────────────────────

export function snippet({ pattern, key, relay = RELAY, state = 'game' }) {
  // No key is needed on local sites (decision 0024); a real site needs the project's key.
  const k = key ? ` data-key="${key}"` : '';
  const tag = (extra) => `<script async src="${relay}/sdk.js"${k}${extra}></script>`;
  const keyNote = key ? '' : `\n\nNo key is needed while the game runs on a local site (localhost, *.test, *.local). Before it goes live on a real site, the owner gets a free key at https://getjoinable.com/app?ref=mcp and adds data-key="pk_…" to the tag.`;
  if (pattern === 'race' || pattern === 'score') {
    const race = pattern === 'race';
    return `Load the script async, so the game starts even if Joinable never arrives:

${'```'}html
${tag(' data-connect="invite"')}
${'```'}

Queue the setup (Joinable may load before or after the game's scripts, or not at all):

${'```'}js
(window.JoinableQ = window.JoinableQ || []).push((Joinable) => {
  onlineButton.hidden = false;           // only offer online play once Joinable is here
  Joinable.game({
    profile: '${pattern}',
    name: 'My Game',
    players: { min: 2, max: 8 },
    public: true,                        // strangers can find rooms through Quick match
    countdown: 0,                        // 0 = Joinable shows 3-2-1
    start({ round, seed, options, players, me, at }) { /* reset; same seed on every player */ },
    go() { /* the start signal */ },
    local() { return ${race ? '{ x, y, a, vx, vy, lap, progress }' : '{ score }'}; },${race ? `
    remote(players) { /* every frame: draw each p at p.state, collide with p.state, scale bumps by p.contact */ },` : ''}
    stop() { /* back to the menu */ },
  });
});

// When this player is done (guarded: Joinable may be missing):
window.Joinable?.finish(${race ? '{ time: seconds }' : '{ score }'});
${'```'}

Use \`seed\` for every random number that changes the course, level or spawns. Then run the self-test.
Full details: ${relay}/AGENTS.md ("Full rounds").${keyNote}`;
  }
  if (pattern === 'A' || pattern === 'C') {
    return `If \`${state}\` is a top-level variable in a classic (non-module) script, add after the game's scripts:

${'```'}html
<script src="${relay}/sdk.js"${k} data-sync="${state}" data-local="keys,mouse"></script>
${'```'}

Otherwise (modules, classes, strict CSP), add the tag without data-sync and call, once the state exists:

${'```'}js
Joinable.sync(${state}, { local: ['keys', 'mouse'] });
${'```'}

Give entities in arrays a unique \`id\`. Keep per-device things (pressed keys, mouse, camera, UI) under a \`local\` key.${pattern === 'C' ? `

Turns: keep \`${state}.turn = playerId\` in the synced state and ignore input when \`${state}.turn !== Joinable.me?.id\`. The host assigns turns in \`Joinable.on('players', …)\`.` : ''}
Full details: ${relay}/AGENTS.md ("Pattern A"${pattern === 'C' ? ', "Pattern C"' : ''}).${keyNote}`;
  }
  if (pattern === 'lockstep') {
    return `Load the script async (the game stays solo if Joinable never arrives):

${'```'}html
${tag(' data-connect="invite"')}
${'```'}

Then, from the game's code (Joinable may load after it, so queue the setup):

${'```'}js
(window.JoinableQ = window.JoinableQ || []).push((Joinable) => {
  Joinable.game({
    profile: 'lockstep',
    name: 'Your Game',
    build: '1',            // bump when the simulation changes: old and new builds never meet
    players: { min: 2, max: 2 },
    tick: 50,              // ms per simulation step
    start({ seed, players, me }) { /* build the battle from seed; players[i].id in seat order */ },
    step(commands, { ai }) {
      // apply each { player, cmd } in order, then run ONE tick of the simulation
    },
    hash() { return fingerprintOfTheBattle(); }, // e.g. ids, positions, health, money mixed into one number
    testCommand(rng) { return aRandomValidOrderForMe(rng); }, // for the self-test
  });
});
// The UI no longer applies orders: it sends them, and they come back to everyone in step().
Joinable.command({ t: 'move', ids: [12, 14], x: 340, y: 220 });
${'```'}

Inside step(): no Math.random (use a generator seeded from \`seed\`), no Date.now or performance.now, iterate in a fixed order, and avoid float maths that browsers may round differently. When the battle ends, Joinable.finish({ place }) on each device. Then run the self-test: it plays the battle on Chromium and WebKit and names anything that isn't deterministic.
Full details: ${relay}/AGENTS.md ("Lockstep").${keyNote}`;
  }
  if (pattern === 'B') {
    return `Pattern B changes the game's loop, so follow the kit's step-by-step code rather than a snippet: ${relay}/AGENTS.md ("Pattern B: avatars").

The script tag:

${'```'}html
<script src="${relay}/sdk.js"${k}></script>
${'```'}

Then: \`${state}.players = {}\` keyed by player id; \`Joinable.sync(${state}, { local: ['keys'] })\`; every player sends their input to the host with \`Joinable.send({ input }, Joinable.hostId)\`; only the host simulates.${keyNote}`;
  }
  return `There's no snippet for this game yet: ${PATTERNS.none.why}`;
}

// ── Tools ───────────────────────────────────────────────────────────────────────────────────

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

/**
 * Checks a tool's arguments against its inputSchema: an object, only known keys, required ones
 * present, the right types, enums and integer ranges. Returns a message for the agent, or null.
 */
export function invalid(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be an object';
  const props = schema.properties ?? {};
  for (const k of Object.keys(args)) if (!(k in props)) return `Unknown argument "${k}". Known: ${Object.keys(props).join(', ') || 'none'}`;
  for (const k of schema.required ?? []) if (args[k] === undefined || args[k] === null || args[k] === '') return `"${k}" is required`;
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (v === undefined) continue;
    const t = p.type;
    if (t === 'string' && typeof v !== 'string') return `"${k}" must be a string`;
    if (t === 'boolean' && typeof v !== 'boolean') return `"${k}" must be true or false`;
    if ((t === 'number' || t === 'integer') && (typeof v !== 'number' || !Number.isFinite(v))) return `"${k}" must be a number`;
    if (t === 'integer' && !Number.isInteger(v)) return `"${k}" must be a whole number`;
    if (typeof v === 'number' && ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum))) return `"${k}" must be between ${p.minimum} and ${p.maximum}`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of: ${p.enum.join(', ')}`;
    if (typeof v === 'string' && v.length > (p.maxLength ?? 500)) return `"${k}" is too long`;
  }
  return null;
}

export const TOOLS = [
  {
    name: 'joinable_kit',
    title: 'Read the Joinable agent kit',
    description: 'Make a web game multiplayer with Joinable: returns the agent kit (how to pick a pattern for the game\'s genre, what to change, the API that exists today, how to test). Read it before changing a game. Joinable provides hosted rooms, invites, quick match, waiting room, countdown, results and rematch: never write server or WebSocket code.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async () => ({ text: await readKit() }),
  },
  {
    name: 'joinable_choose_pattern',
    title: 'Choose a multiplayer pattern',
    description: 'Picks how to make this web game multiplayer with Joinable, from its genre: full rounds ("race" or "score"), lockstep (RTS and strategy), Pattern A (shared world), B (avatars), C (turns), or not supported yet (fighting, shooters).',
    inputSchema: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'e.g. racing, arcade, puzzle, board, card, clicker, builder, platformer, top-down, party, turn-based, rts, fighting, shooter' },
        has_score_or_time: { type: 'boolean', description: 'Each round ends with a score or a time' },
        held_key_avatars: { type: 'boolean', description: 'Players move a character with held keys or a joystick' },
        turn_based: { type: 'boolean' },
      },
      required: ['genre'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const r = choosePattern(a);
      return { text: `${r.title}\n\n${r.why}${r.alsoFits ? `\n\nAlso fits: ${r.alsoFits}. The kit prefers full rounds whenever they fit.` : ''}\n\nNext: joinable_snippet with pattern "${r.pattern}".` };
    },
  },
  {
    name: 'joinable_snippet',
    title: 'Get the Joinable snippet',
    description: 'Returns the exact script tag and setup code for a Joinable pattern, with the relay and the project key filled in.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', enum: ['race', 'score', 'lockstep', 'A', 'B', 'C'] },
        key: { type: 'string', description: 'The project\'s public key, pk_…, for a real site. Leave it out while the game runs on localhost: no key is needed there.' },
        state: { type: 'string', description: 'Name of the game\'s state object, for patterns A, B and C (default "game")' },
      },
      required: ['pattern'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => ({ text: snippet(a) }),
  },
  {
    name: 'joinable_selftest',
    title: 'Run the Joinable self-test',
    description: 'Opens two headless players on the game\'s local page and checks the full-rounds contract (same seed on both, players see each other, one result, rematch). Every failure says what to fix. Run until it passes. Needs playwright-core\'s Chromium.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The game page, served locally, e.g. http://localhost:5173/' },
        round: { type: 'integer', minimum: 10, maximum: 600, description: 'Seconds to wait for a round to finish (default 60)' },
        channel: { type: 'string', enum: ['chrome'], description: 'Use the installed Chrome (with the GPU), for heavy 3D games' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: selftest,
  },
  {
    name: 'joinable_desyncs',
    title: 'Get lockstep desync reports',
    description: "When a lockstep game's players went out of sync, Joinable keeps a report: the first tick where the devices' simulations differed, each device's fingerprint, the browsers and builds, and the orders around that tick. Fetch the latest reports for a game by its public key (or, for keyless local play, its page origin), then fix what isn't deterministic in the simulation.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: "The game's public key, pk_…" },
        origin: { type: 'string', description: 'For keyless play on a local site: the page origin, e.g. http://localhost:5173' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: desyncs,
  },
];

for (const t of TOOLS) t.inputSchema.additionalProperties = false; // advertised, and enforced by invalid()

/** The latest desync reports for a game, as text an agent can act on. */
export async function desyncs({ key, origin } = {}) {
  if (!key && !origin) return { text: 'Give the game\'s public key (key: "pk_…") or, for keyless local play, its page origin (origin: "http://localhost:5173").', isError: true };
  const u = new URL(`${RELAY}/v1/desyncs`);
  if (key) u.searchParams.set('key', key);
  else u.searchParams.set('origin', origin);
  let body;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    body = await r.json();
    if (!r.ok) return { text: body?.message ?? `The relay said ${r.status}`, isError: true };
  } catch (e) {
    return { text: `Couldn't reach ${RELAY}: ${e?.message ?? e}`, isError: true };
  }
  const reports = body.reports ?? [];
  if (!reports.length) return { text: 'No desync reports for this game. Its battles have stayed in sync (or none has been played online yet).' };
  const one = (r) => {
    const players = r.players.map((p) => `${p.id} on ${p.browser || 'an unknown browser'}${p.build ? `, build ${p.build}` : ''}: fingerprint ${r.hashes?.[p.id] ?? '?'}`).join('\n  ');
    const orders = r.orders.map(([id, n, c]) => `turn ${n} (runs at tick ${(n + r.delayTurns) * r.turnTicks}), ${id}: ${JSON.stringify(c)}`).join('\n  ');
    return `${r.at}, room ${r.room}, round ${r.round}: first differing tick ${r.tick} (found at the check after tick ${r.checkedTick})\n  ${players}\n Orders around it:\n  ${orders || '(none: the simulation differed without orders)'}`;
  };
  const engines = new Set(reports[0].players.map((p) => p.browser.split(' ')[0]));
  const hint = engines.size > 1
    ? 'The devices used different browsers: look first at float maths (Math.sin, cos, atan2, sqrt, pow) in the simulation; use integers or deterministic versions.'
    : 'Same browser on every device: something in the simulation is not from the seed or the orders (Math.random, Date.now, performance.now, iteration order of objects or Sets, an order applied outside step()).';
  return { text: `${reports.length} desync report${reports.length > 1 ? 's' : ''}, newest first.\n\n${reports.map(one).join('\n\n')}\n\n${hint} Reproduce it with the self-test: npx getjoinable test <the game's local URL>.` };
}

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────────────────────

export async function handle(msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null; // notifications (initialized, cancelled) need no answer
  switch (method) {
    case 'initialize':
      ping({ cmd: 'mcp' });
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'joinable', title: 'Joinable', version: VERSION },
        instructions: 'Joinable makes web games multiplayer with a hosted relay. To add multiplayer to a game: call joinable_kit and read it, joinable_choose_pattern, joinable_snippet, change the game, then joinable_selftest until it passes. For lockstep games that went out of sync, joinable_desyncs has the reports. Never write server or WebSocket code.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
      ping({ cmd: 'mcp', tool: tool.name });
      const bad = invalid(tool.inputSchema, params.arguments);
      if (bad) return error(-32602, `Invalid arguments for ${tool.name}: ${bad}`);
      try {
        const { text, isError } = await tool.run(params.arguments ?? {});
        return reply({ content: [{ type: 'text', text }], isError: !!isError });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true });
      }
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

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
