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
import { chromium } from 'playwright-core';

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
async function open(u, name) {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
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
  const b = await open(link, 'player 2');
  if (!(await waitFor(b, () => window.Joinable?.me && window.Joinable.players.length >= 2, null, 15000))) fail('Player 2 could not join from the invite link', 'Is ?join= being removed from the address bar by the game? Keep it.');
  pass('two players in one room by invite link');

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

  if (!(await waitFor(a, () => window.Joinable.session?.phase === 'playing', null, 10000))) fail('The countdown never reached "go"');
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
    warn(`the round didn't end within ${roundSec} s. Finishing it for the test (use --round to wait longer, or check that the game calls Joinable.finish({ time }) or ({ score }))`);
    for (const p of [a, b]) await p.evaluate(() => window.Joinable.finish({ time: 999, score: 0 }));
    if (!(await waitFor(a, () => window.Joinable.session?.phase === 'results', null, 5000))) fail('Results never showed after both finished');
  } else pass('the game called Joinable.finish and the round ended');
  const ra = await a.evaluate(() => window.Joinable.session.results);
  const rb = await b.evaluate(() => window.Joinable.session.results);
  if (JSON.stringify(ra) !== JSON.stringify(rb)) fail('The two players see different results');
  pass(`one result on both: ${ra.map((r) => `${r.name} ${r.dnf ? 'DNF' : (r.time ?? r.score)}`).join(', ')}`);

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
const real = errors.filter((e) => !/clipboard|share|favicon/i.test(e));
if (real.length) {
  console.log(`! errors in the page:\n    ${real.slice(0, 8).join('\n    ')}`);
}
await browser.close();
console.log(failed ? '\nJoinable self-test: FAILED' : '\nJoinable self-test: passed');
process.exit(failed ? 1 : 0);
