// Joinable's MCP tools, shared by the local server (mcp/server.mjs, `npx getjoinable mcp`) and the
// remote one (site/mcp.js, https://getjoinable.com/mcp). Plain JavaScript with no Node imports, so
// it runs in Node and in a Cloudflare Worker alike. Every answer comes from kit/AGENTS.md: if the
// kit changes, change this file with it.

export const VERSION = '0.2.4';
export const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_RELAY = 'https://relay.getjoinable.com';

// ── Patterns, from the kit's "Read the game first" table ────────────────────────────────────

export const PATTERNS = {
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
    title: 'Not built yet',
    why: 'Fighting games need rollback, competitive shooters need a cloud host. Neither is built yet. Tell the owner rather than forcing another pattern.',
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

export function snippet({ pattern, key, relay = DEFAULT_RELAY, state = 'game' }) {
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

// ── The kit, whole or one section ───────────────────────────────────────────────────────────

/** The kit's "## " headings, for the section list. */
export function kitSections(kit) {
  return [...kit.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

/** One "## " section of the kit (with its "### " subsections), found by a case-insensitive match on its heading. */
export function kitSection(kit, name) {
  const want = String(name).toLowerCase().trim();
  const parts = kit.split(/^(?=## )/m);
  const hit = parts.find((p) => p.startsWith('## ') && p.slice(3, p.indexOf('\n')).toLowerCase().includes(want));
  return hit ? hit.trim() : null;
}

// ── Getting started: what the owner does, from the first prompt to a live game ──────────────

export function gettingStarted(relay = DEFAULT_RELAY) {
  return `Joinable is built for games that run in a web browser: plain canvas, three.js, Phaser and others. It hosts the rooms, so the game needs no server or WebSocket code.

1. Read the game and pick a pattern (joinable_choose_pattern), then get the code (joinable_snippet). The full guide is the agent kit (joinable_kit, or ${relay}/AGENTS.md).
2. Wire the four hooks: start, local, remote, finish. Load the script async and guard every call, so the game still plays solo when Joinable doesn't load.
3. Test on the owner's machine. No key or account is needed on localhost, *.test and *.local. The self-test opens two headless players and says what to fix: npx -y getjoinable test http://localhost:PORT/ (it needs Node and runs locally, so it's in the local MCP server and the command line, not in this remote server).
4. Before the game goes live on a real site, the owner signs in at https://getjoinable.com/app with an email code, adds the game and its site, and puts the free public key in the tag: data-key="pk_…". Public keys aren't secrets: the list of allowed sites protects them.
5. Plans start free (Sandbox). Paid plans and prepaid credit: https://getjoinable.com/pricing. When a plan's hours run out, new online rooms pause and games already playing finish; solo play never stops.

Docs: https://getjoinable.com/docs · Support: hello@getjoinable.com`;
}

// ── Desync reports (lockstep) ───────────────────────────────────────────────────────────────

/** The latest desync reports for a game, as text an agent can act on. */
export async function desyncs({ key, origin } = {}, relay = DEFAULT_RELAY) {
  if (!key && !origin) return { text: 'Give the game\'s public key (key: "pk_…") or, for keyless local play, its page origin (origin: "http://localhost:5173").', isError: true };
  const u = new URL(`${relay}/v1/desyncs`);
  if (key) u.searchParams.set('key', key);
  else u.searchParams.set('origin', origin);
  let body;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    body = await r.json();
    if (!r.ok) return { text: body?.message ?? `The relay said ${r.status}`, isError: true };
  } catch (e) {
    return { text: `Couldn't reach ${relay}: ${e?.message ?? e}`, isError: true };
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

// ── Argument checks ─────────────────────────────────────────────────────────────────────────

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
    if (typeof v === 'string' && p.pattern && !new RegExp(p.pattern).test(v)) return `"${k}" doesn't look right: ${p.description ?? p.pattern}`;
  }
  return null;
}

// ── The read-only tools both servers offer ──────────────────────────────────────────────────

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

/** The read-only tools. `readKit()` returns the kit's text; `relay` is where snippets and reports point. */
export function readTools({ readKit, relay = DEFAULT_RELAY }) {
  return [
    {
      name: 'joinable_kit',
      title: 'Read the Joinable agent kit',
      description: 'Returns Joinable\'s agent kit for making a web game multiplayer: how to pick a pattern for the game\'s genre, what to change in the game, the API that exists today, and how to test. Give `section` (e.g. "Full rounds", "Lockstep", "Pattern A") to get one part; without it, the whole kit (about 10,000 tokens).',
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', maxLength: 80, description: 'Part of a section heading, e.g. "Full rounds", "Pattern B", "Lockstep", "Test". Leave it out for the whole kit.' },
        },
      },
      annotations: { title: 'Read the Joinable agent kit', ...READ, openWorldHint: false },
      run: async ({ section } = {}) => {
        const kit = await readKit();
        if (!section) return { text: kit };
        const part = kitSection(kit, section);
        if (part) return { text: part };
        return { text: `No section matches "${section}". Sections: ${kitSections(kit).join(' · ')}`, isError: true };
      },
    },
    {
      name: 'joinable_choose_pattern',
      title: 'Choose a multiplayer pattern',
      description: 'Picks how to make a web game multiplayer with Joinable, from its genre and how it plays: full rounds for racing and score games, lockstep for strategy and RTS, a shared world for board, card and builder games, avatars for platformers and top-down games, or turns. Returns the pattern, why it fits, and the next step.',
      inputSchema: {
        type: 'object',
        properties: {
          genre: { type: 'string', maxLength: 60, description: 'e.g. racing, arcade, puzzle, board, card, clicker, builder, platformer, top-down, party, turn-based, rts, tower-defense' },
          has_score_or_time: { type: 'boolean', description: 'Each round ends with a score or a time' },
          held_key_avatars: { type: 'boolean', description: 'Players move a character with held keys or a joystick' },
          turn_based: { type: 'boolean', description: 'Players take turns' },
        },
        required: ['genre'],
      },
      annotations: { title: 'Choose a multiplayer pattern', ...READ, openWorldHint: false },
      run: async (a) => {
        const r = choosePattern(a);
        const next = r.pattern === 'none' ? '' : `\n\nNext: joinable_snippet with pattern "${r.pattern}".`;
        return { text: `${r.title}\n\n${r.why}${r.alsoFits ? `\n\nAlso fits: ${r.alsoFits}. The kit prefers full rounds whenever they fit.` : ''}${next}` };
      },
    },
    {
      name: 'joinable_snippet',
      title: 'Get the Joinable snippet',
      description: 'Returns the exact script tag and setup code for one Joinable pattern (race, score, lockstep, A, B or C), with the relay address and the game\'s public key filled in.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', enum: ['race', 'score', 'lockstep', 'A', 'B', 'C'], description: 'From joinable_choose_pattern' },
          key: { type: 'string', maxLength: 64, pattern: '^pk_\\w+$', description: 'The game\'s public key, pk_…, for a real site. Leave it out while the game runs on localhost: no key is needed there.' },
          state: { type: 'string', maxLength: 60, pattern: '^[A-Za-z_$][\\w$.]*$', description: 'Name of the game\'s state object, for patterns A, B and C (default "game")' },
        },
        required: ['pattern'],
      },
      annotations: { title: 'Get the Joinable snippet', ...READ, openWorldHint: false },
      run: async (a) => ({ text: snippet({ ...a, relay }) }),
    },
    {
      name: 'joinable_get_started',
      title: 'How to start with Joinable',
      description: 'Returns the steps from a single-player web game to a live multiplayer one with Joinable: the pattern and snippet, testing on localhost with no key, getting a free public key for the live site, plans, and where the docs are.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'How to start with Joinable', ...READ, openWorldHint: false },
      run: async () => ({ text: gettingStarted(relay) }),
    },
    {
      name: 'joinable_desyncs',
      title: 'Get lockstep desync reports',
      description: 'Returns the latest desync reports for a lockstep game on Joinable, by its public key (or, for keyless local play, its page origin): the first tick where players\' simulations differed, each device\'s fingerprint, browsers and builds, and the orders around that tick, with a hint about what to fix.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', maxLength: 64, pattern: '^pk_\\w+$', description: 'The game\'s public key, pk_…' },
          origin: { type: 'string', maxLength: 200, pattern: '^https?://[^\\s/]+$', description: 'For keyless play on a local site: the page origin, e.g. http://localhost:5173' },
        },
      },
      annotations: { title: 'Get lockstep desync reports', ...READ, idempotentHint: false, openWorldHint: false },
      run: (a) => desyncs(a, relay),
    },
  ];
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────────────────────

/**
 * A JSON-RPC handler over a list of tools. `onCall(name)` runs before each tool call (the local
 * server's anonymous usage ping); `instructions` is the server's summary for the client.
 */
export function makeHandler({ tools, instructions, onInitialize = () => {}, onCall = () => {} }) {
  for (const t of tools) t.inputSchema.additionalProperties = false; // advertised, and enforced by invalid()
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    const { id, method, params = {} } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (id === undefined) return null; // notifications (initialized, cancelled) need no answer
    switch (method) {
      case 'initialize':
        onInitialize();
        return reply({
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'joinable', title: 'Joinable', version: VERSION, websiteUrl: 'https://getjoinable.com' },
          instructions,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: tools.map(({ run, ...t }) => t) });
      case 'tools/call': {
        const tool = tools.find((t) => t.name === params?.name);
        if (!tool) return error(-32602, `Unknown tool: ${params?.name}. Tools: ${tools.map((t) => t.name).join(', ')}`);
        onCall(tool.name);
        const bad = invalid(tool.inputSchema, params.arguments);
        if (bad) return error(-32602, `Invalid arguments for ${tool.name}: ${bad}`);
        try {
          const { text, isError } = await tool.run(params.arguments ?? {});
          return reply({ content: [{ type: 'text', text }], isError: !!isError });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: `${tool.name} failed: ${e?.message ?? e}` }], isError: true });
        }
      }
      default:
        return error(-32601, `Method not found: ${method}`);
    }
  };
}
