#!/usr/bin/env node
// Joinable's self-test: two headless players on your game's page, checking that the
// multiplayer contract works end to end. Made for coding agents: every failure says what to fix.
//   npx getjoinable test http://localhost:5600/       (your game's page, with the Joinable script on it)
// Published on npm as `getjoinable` (never `joinable`, which is someone else's package). From a
// checkout of this repo: node bin/getjoinable.mjs test URL
//   options: --round 90        seconds to wait for a round to finish on its own (default 60)
//            --headed          show the two browsers
//            --channel chrome  use your installed Chrome (with the GPU) instead of the bundled
//                              headless Chromium, which draws WebGL in software: heavy 3D games can
//                              drop to a few frames a second there and look broken when they aren't
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright-core';

const VERSION = '0.2.2'; // the npm package's version (packages/cli/package.json)
const RELAY = (process.env.JOINABLE_RELAY || 'https://relay.getjoinable.com').replace(/\/$/, '');

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

const [cmd, url, ...rest] = process.argv.slice(2);
if (cmd !== 'test' || !url) {
  console.log('Usage: npx getjoinable test <url of your game page> [--round 60] [--headed] [--channel chrome]\n       npx getjoinable mcp   (the MCP server for coding agents)');
  process.exit(cmd ? 1 : 0);
}
const flag = (n, d) => {
  const i = rest.indexOf(`--${n}`);
  return i < 0 ? d : rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true;
};
const roundSec = Number(flag('round', 60)) || 60;

const results = [];
let failed = false;
const pass = (msg) => (results.push(`✓ ${msg}`), console.log(`✓ ${msg}`));
const warn = (msg) => (results.push(`! ${msg}`), console.log(`! ${msg}`));
function fail(msg, hint) {
  failed = true;
  console.log(`✗ ${msg}${hint ? `\n    → ${hint}` : ''}`);
  throw new Error('stop');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const channel = flag('channel', null);
const browser = await chromium.launch({ headless: flag('headed', false) !== true, ...(typeof channel === 'string' ? { channel } : {}) });
const errors = [];
// The determinism doctor's eyes: what the game's step() calls that it mustn't in lockstep.
const WATCH = () => {
  const jd = (window.__jd = { random: 0, date: 0, perf: 0, crypto: 0, where: {} });
  const wrap = (obj, name, key) => {
    const f = obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function (...args) {
      if (window.__joinableStep) {
        jd[key]++;
        if (!jd.where[key]) jd.where[key] = (new Error().stack || '').split('\n').slice(2).find((l) => !/sdk\.js/.test(l))?.trim() ?? '';
      }
      return f.apply(this, args);
    };
  };
  wrap(Math, 'random', 'random');
  wrap(Date, 'now', 'date');
  wrap(performance, 'now', 'perf');
  if (window.crypto) wrap(window.crypto, 'getRandomValues', 'crypto');
};
let other = null; // a second engine for lockstep: WebKit (Safari's), if installed
async function open(u, name, engine = browser) {
  const ctx = await engine.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(WATCH);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(u, { waitUntil: 'domcontentloaded' });
  return page;
}
// Poll on a timer, not on animation frames: a slow game's frames are exactly what's in question.
const waitFor = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);

try {
  const a = await open(url, 'player 1');
  if (!(await waitFor(a, () => window.Joinable, null, 10000))) fail('The Joinable script is not on the page', 'Add <script src="RELAY/sdk.js" data-key="KEY"></script> before the game\'s own scripts.');
  if (!(await waitFor(a, () => window.Joinable._test.spec, null, 10000)))
    fail('The game never called Joinable.game({ profile, start, … })', 'Call Joinable.game once the game has loaded. See kit/AGENTS.md, "Full rounds".');
  const spec = await a.evaluate(() => window.Joinable._test.spec);
  pass(`game registered: profile "${spec.profile}", ${spec.min}–${spec.max} players${spec.public ? ', public rooms on' : ''}`);

  const link = await a.evaluate(() => window.Joinable.inviteLink());
  if (!(await waitFor(a, () => window.Joinable.me && window.Joinable.session, null, 15000)))
    fail('Player 1 could not connect to the relay', 'Check data-key and that this page\'s origin is allowed for the key (the console shows the reason), and that the script loads from https://relay.getjoinable.com (or staging.getjoinable.com), not a *.workers.dev address.');
  // Lockstep: player 2 runs on WebKit (Safari's engine) when it's installed, to catch maths that
  // differs between browsers.
  if (spec.profile === 'lockstep') {
    other = await webkit.launch().catch(() => null);
    if (!other) warn('WebKit is not installed, so both players run on Chromium. Run `npx playwright-core install webkit` to also check Safari.');
  }
  const b = await open(link, other ? 'player 2 (WebKit)' : 'player 2', other ?? browser);
  if (!(await waitFor(b, () => window.Joinable?.me && window.Joinable.players.length >= 2, null, 15000))) fail('Player 2 could not join from the invite link', 'Is ?join= being removed from the address bar by the game? Keep it.');
  pass('two players in one room by invite link');

  // The game's look: Joinable's screens must wear the game's colours and fonts, not Joinable's.
  await sleep(1300); // the second look, after the game's fonts and late styles
  const look = await a.evaluate(() => window.Joinable._test.theme);
  const shot = join(tmpdir(), `getjoinable-waiting-room-${Date.now()}.png`);
  await a.screenshot({ path: shot }).catch(() => {});
  if (!look || look.source === 'default')
    warn(`The waiting room uses Joinable's default colours, not the game's: no theme was given and none was found on the page. Set theme in Joinable.game from the game's own CSS (accent, panel, text, font). Screenshot: ${shot}`);
  else pass(`the waiting room wears the game's look (from the ${look.source === 'game' ? "game's theme" : look.source === 'realm' ? 'realm kit tokens' : "page's CSS"}): accent ${look.accent}, panel ${look.panel}, font ${look.font.split(',')[0]}. Compare it with the game's menu: ${shot}`);

  await b.evaluate(() => window.Joinable.ready(true));
  await a.evaluate(() => window.Joinable.ready(true));
  if (!(await waitFor(a, () => ['countdown', 'playing'].includes(window.Joinable.session?.phase), null, 15000))) fail('The round did not start when both were ready');
  const lead = spec.countdown * 1000;
  await sleep(lead + 500);
  const [sa, sb] = [await a.evaluate(() => window.Joinable._test.starts.at(-1)), await b.evaluate(() => window.Joinable._test.starts.at(-1))];
  if (!sa || !sb) fail('start() was not called on both players', 'Joinable calls the start(round) you passed to Joinable.game; check it is a function.');
  if (sa.seed !== sb.seed) fail('The players got different seeds');
  const apart = Math.abs(sa.calledAt - sb.calledAt);
  if (apart > 250) warn(`start() ran ${apart} ms apart on the two players (expected under 250 ms)`);
  else pass(`start() ran on both with seed ${sa.seed}, ${apart} ms apart`);

  // Each player's own picks (car, character…) reach start(), and players have real names.
  const picks = Object.keys(spec.playerOptions ?? {});
  if (picks.length) {
    const missing = sa.players.filter((p) => picks.some((k) => p.picks?.[k] === undefined));
    if (missing.length) fail("start() didn't get every player's picks", `Each player in round.players has picks with ${picks.join(', ')}. Read round.players[i].picks, and draw rivals with remote()'s .picks.`);
    else pass(`each player's ${picks.join(', ')} reaches start(): ${sa.players.map((p) => picks.map((k) => p.picks[k]).join('/')).join(', ')}`);
  }
  const named = await a.evaluate(() => window.Joinable._test.nameFrom);
  if (named === 'auto') warn("Players get made-up names. Pass the player's name from your game: Joinable.game({ me: { name, avatar } }) or Joinable.setMe({ name }). Players can still change it in the waiting room.");

  if (!(await waitFor(a, () => window.Joinable.session?.phase === 'playing', null, 10000))) fail('The countdown never reached "go"');
  if (spec.profile === 'lockstep') await doctor(a, b, spec);
  await sleep(1500);
  const needsLocal = ['race', 'arena', 'score'].includes(spec.profile);
  if (needsLocal) {
    const l1 = await a.evaluate(() => window.Joinable._test.local());
    if (!l1 || typeof l1 !== 'object') fail('local() returned nothing', `For "${spec.profile}", local() returns the player's state, e.g. ${spec.profile === 'score' ? '{ score }' : '{ x, y, a, vx, vy, progress }'}.`);
    const bad = Object.entries(l1).filter(([, v]) => typeof v === 'object' && v !== null);
    if (bad.length) warn(`local() has nested objects (${bad.map(([k]) => k).join(', ')}); keep it flat numbers for smoothing`);
    if (JSON.stringify(l1).length > 1500) fail('local() is too big', 'Keep it under 1.5 KB: positions, velocities, progress or score. Not the whole game state.');
    pass(`local() reports ${Object.keys(l1).join(', ')}`);
  }
  if (['race', 'arena'].includes(spec.profile)) {
    if (!(await waitFor(a, () => window.Joinable.remote().some((r) => r.state), null, 6000))) {
      const fps = await a.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n)); requestAnimationFrame(f); }));
      fail("Player 1 never received player 2's state", fps < 15 && channel !== 'chrome' ? `The page ran at ${fps} frames a second in headless Chromium. Heavy 3D games need the GPU: add --channel chrome.` : 'local() must return an object while the round is on.');
    }
    const calls = await a.evaluate(() => window.Joinable._test.remoteCalls);
    if (!calls) fail('remote(players) was never called', 'Pass remote(players) to Joinable.game, and run the game loop with requestAnimationFrame.');
    const keys = await a.evaluate(() => Object.keys(window.Joinable.remote()[0].state));
    if (!keys.includes('x') || !keys.includes('y')) warn('remote players have no x and y: smoothing and bump prediction work on x, y, z with vx, vy, vz');
    if (!keys.includes('vx')) warn('local() has no vx/vy: remote players are drawn smoothly, but bumps will use slightly old positions');
    pass(`remote(players) is called every frame (${calls} so far) with the other player's ${keys.join(', ')}`);
  }

  // Finish: wait for the game to call Joinable.finish on its own.
  console.log(`  … waiting up to ${roundSec} s for the round to finish on its own`);
  const ended = await waitFor(a, () => window.Joinable.session?.phase === 'results', null, roundSec * 1000);
  if (!ended) {
    const lock = spec.profile === 'lockstep';
    warn(`the round didn't end within ${roundSec} s. Finishing it for the test (use --round to wait longer, or check that the game calls Joinable.finish(${lock ? '{ place }' : '{ time }) or ({ score }'}) when it ends)`);
    for (const [i, p] of [a, b].entries()) await p.evaluate((place) => (place ? window.Joinable.finish({ place }) : window.Joinable.finish({ time: 999, score: 0 })), lock ? i + 1 : 0);
    if (!(await waitFor(a, () => window.Joinable.session?.phase === 'results', null, 5000))) fail('Results never showed after both finished');
  } else pass('the game called Joinable.finish and the round ended');
  const ra = await a.evaluate(() => window.Joinable.session.results);
  const rb = await b.evaluate(() => window.Joinable.session.results);
  if (JSON.stringify(ra) !== JSON.stringify(rb)) fail('The two players see different results');
  pass(`one result on both: ${ra.map((r) => `${r.name} ${r.dnf ? 'DNF' : (r.place !== undefined ? `place ${r.place}` : (r.time ?? r.score))}`).join(', ')}`);

  await a.evaluate(() => window.Joinable._test.rematch());
  await b.evaluate(() => window.Joinable._test.rematch());
  if (!(await waitFor(a, () => window.Joinable.session?.round === 2, null, 10000))) fail('Rematch did not start round 2');
  await sleep(lead + 300);
  const n = await b.evaluate(() => window.Joinable._test.starts.length);
  if (n < 2) fail('start() was not called again for the rematch', 'Make start(round) reset the game fully each time it is called.');
  pass('rematch: start() called again for round 2');
} catch (e) {
  if (e.message !== 'stop') {
    failed = true;
    console.log(`✗ ${e.message}`);
  }
}
/**
 * The determinism doctor: both players play with random orders for a while; their fingerprints
 * must agree on every tick. Says in plain words what isn't deterministic and where.
 */
async function doctor(a, b, spec) {
  if (!(await waitFor(a, () => (window.Joinable._test.lockstep?.tick ?? 0) > 40 || typeof window.Joinable.session?.desync === 'number', null, 15000)))
    fail('step() is not running', 'For profile "lockstep", pass step(commands) and hash() to Joinable.game. Joinable calls step() every tick; the game must not run its own simulation loop online.');
  pass(`lockstep: step() runs every ${spec.tick} ms on both players`);
  const drives = await a.evaluate(() => window.Joinable._test.drive(1));
  if (!drives) warn('No testCommand(rng) in Joinable.game, so the check only plays the battle without orders. Add one: it returns a random order this player could give, like { t: "move", ids, x, y }.');
  const secs = Math.min(30, Math.max(12, roundSec / 4));
  for (let i = 0; i < secs * 3; i++) {
    if (drives) await Promise.all([a.evaluate((k) => window.Joinable._test.drive(k), 1000 + i), b.evaluate((k) => window.Joinable._test.drive(k), 5000 + i)]);
    await sleep(333);
    if (await a.evaluate(() => typeof window.Joinable.session?.desync === 'number')) break;
  }
  const [ra, rb] = [await a.evaluate(() => window.Joinable._test.lockstep?.ring ?? []), await b.evaluate(() => window.Joinable._test.lockstep?.ring ?? [])];
  const hb = new Map(rb);
  const common = ra.filter(([k]) => hb.has(k));
  const first = common.find(([k, h]) => hb.get(k) !== h);
  const [wa, wb] = [await a.evaluate(() => window.__jd), await b.evaluate(() => window.__jd)];
  // What step() called that it mustn't: these make each device's battle different.
  const calls = (w) => [['random', 'Math.random()'], ['date', 'Date.now()'], ['perf', 'performance.now()'], ['crypto', 'crypto.getRandomValues()']].filter(([k]) => w?.[k]).map(([k, label]) => `${label} ${w[k]} times${w.where[k] ? ` (first at ${w.where[k].replace(/^at /, '')})` : ''}`);
  const bad = [...new Set([...calls(wa), ...calls(wb)])];
  if (bad.length) warn(`step() calls ${bad.join('; ')}. Inside the simulation use only the round's seed (a seeded generator) and the tick number, never the clock or Math.random.`);
  if (new Set(ra.map(([, h]) => h)).size <= 1 && ra.length > 20) warn("hash() returns the same value every tick, so it can't catch anything. Make it a fingerprint of the battle: e.g. unit ids, positions and health, and each player's money, mixed into one number.");
  if (first) {
    const engines = other ? 'Chromium and WebKit' : 'two Chromium players';
    fail(
      `The two battles differ from tick ${first[0]} (${engines})`,
      bad.length
        ? 'Fix the calls above first: each device gets different numbers from them.'
        : other
          ? 'Nothing obviously random was called, so look at maths that browsers may compute differently (Math.sin, cos, atan2, sqrt, pow on floats): use integers or deterministic versions inside the simulation. Also: iterate in a fixed order (arrays, not Object keys of numbers or Set/Map built from network order), and apply orders only in step().'
          : 'The same browser disagrees with itself: something in the simulation isn\'t from the seed or the orders. Check for orders applied outside step(), the clock, Math.random, and iteration over objects or Sets in insertion order that differs between players.',
    );
  }
  const stopped = await a.evaluate(() => window.Joinable.session?.desync);
  if (typeof stopped === 'number' && bad.length) fail(`The room stopped the battle as out of sync at tick ${stopped}`, 'Fix the calls above: each device gets different numbers from them.');
  if (typeof stopped === 'number') fail(`The room stopped the battle as out of sync at tick ${stopped}`, 'See the report: GET /v1/desyncs?key=YOUR_KEY on the relay, or the joinable_desyncs MCP tool.');
  pass(`the two battles agree on all ${common.length} ticks compared${other ? ', Chromium and WebKit' : ''}${drives ? ', with random orders from both players' : ''}`);
}

const real = errors.filter((e) => !/clipboard|share|favicon/i.test(e));
if (real.length) {
  console.log(`! errors in the page:\n    ${real.slice(0, 8).join('\n    ')}`);
}
await browser.close();
await other?.close();
console.log(failed ? '\nJoinable self-test: FAILED' : '\nJoinable self-test: passed');
await ping({ cmd: 'test', ok: !failed });
process.exit(failed ? 1 : 0);
