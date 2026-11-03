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
const VERSION = '0.2.1';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

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
  none: {
    title: 'Not supported yet',
    why: 'RTS needs lockstep (planned), fighting games need rollback, competitive shooters need a cloud host. None is built. Tell the owner rather than forcing another pattern.',
  },
};

const GENRES = {
  racing: 'race', racer: 'race', 'time-trial': 'race', runner: 'race',
  arcade: 'score', puzzle: 'score', 'endless-runner': 'score', minigame: 'score', 'score-attack': 'score',
  board: 'A', card: 'A', word: 'A', clicker: 'A', idle: 'A', builder: 'A', drawing: 'A', 'casual-coop': 'A',
  platformer: 'B', 'top-down': 'B', party: 'B', avatars: 'B',
  'turn-based': 'C',
  rts: 'none', strategy: 'none', fighting: 'none', shooter: 'none', fps: 'none',
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

export function snippet({ pattern, key = 'KEY', relay = RELAY, state = 'game' }) {
  const tag = (extra) => `<script async src="${relay}/sdk.js" data-key="${key}"${extra}></script>`;
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
Full details: ${relay}/AGENTS.md ("Full rounds").`;
  }
  if (pattern === 'A' || pattern === 'C') {
    return `If \`${state}\` is a top-level variable in a classic (non-module) script, add after the game's scripts:

${'```'}html
<script src="${relay}/sdk.js" data-key="${key}" data-sync="${state}" data-local="keys,mouse"></script>
${'```'}

Otherwise (modules, classes, strict CSP), add the tag without data-sync and call, once the state exists:

${'```'}js
Joinable.sync(${state}, { local: ['keys', 'mouse'] });
${'```'}

Give entities in arrays a unique \`id\`. Keep per-device things (pressed keys, mouse, camera, UI) under a \`local\` key.${pattern === 'C' ? `

Turns: keep \`${state}.turn = playerId\` in the synced state and ignore input when \`${state}.turn !== Joinable.me?.id\`. The host assigns turns in \`Joinable.on('players', …)\`.` : ''}
Full details: ${relay}/AGENTS.md ("Pattern A"${pattern === 'C' ? ', "Pattern C"' : ''}).`;
  }
  if (pattern === 'B') {
    return `Pattern B changes the game's loop, so follow the kit's step-by-step code rather than a snippet: ${relay}/AGENTS.md ("Pattern B: avatars").

The script tag:

${'```'}html
<script src="${relay}/sdk.js" data-key="${key}"></script>
${'```'}

Then: \`${state}.players = {}\` keyed by player id; \`Joinable.sync(${state}, { local: ['keys'] })\`; every player sends their input to the host with \`Joinable.send({ input }, Joinable.hostId)\`; only the host simulates.`;
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

function selftest({ url, round, channel }) {
  // Only web pages: an agent talked into passing a flag or a file:// path gets a plain refusal.
  if (!/^https?:\/\/[^\s]+$/i.test(String(url ?? ''))) return Promise.resolve({ text: 'Give the game page as an http:// or https:// address, e.g. http://localhost:5173/', isError: true });
  return new Promise((resolve) => {
    const args = [here('./getjoinable.mjs', '../bin/getjoinable.mjs'), 'test', url];
    if (round) args.push('--round', String(round));
    if (channel) args.push('--channel', channel);
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), ((round || 60) + 90) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ text: `${code === 0 ? 'PASSED' : 'FAILED'}\n\n${out.trim()}`, isError: code !== 0 });
    });
  });
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
    description: 'Picks how to make this web game multiplayer with Joinable, from its genre: full rounds ("race" or "score"), Pattern A (shared world), B (avatars), C (turns), or not supported yet (RTS, fighting, shooters).',
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
        pattern: { type: 'string', enum: ['race', 'score', 'A', 'B', 'C'] },
        key: { type: 'string', description: 'The project\'s public key, pk_…. Ask the owner if you don\'t have it.' },
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
        round: { type: 'number', description: 'Seconds to wait for a round to finish (default 60)' },
        channel: { type: 'string', enum: ['chrome'], description: 'Use the installed Chrome (with the GPU), for heavy 3D games' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: selftest,
  },
];

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────────────────────

export async function handle(msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null; // notifications (initialized, cancelled) need no answer
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'joinable', title: 'Joinable', version: VERSION },
        instructions: 'Joinable makes web games multiplayer with a hosted relay. To add multiplayer to a game: call joinable_kit and read it, joinable_choose_pattern, joinable_snippet, change the game, then joinable_selftest until it passes. Never write server or WebSocket code.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
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
