// The MCP server over real stdio: handshake, tool list, and each read-only tool.
//   node --test mcp/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { choosePattern } from './server.mjs';

function start() {
  const child = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', import.meta.url))], {
    env: { ...process.env, JOINABLE_RELAY: 'http://127.0.0.1:9' }, // unreachable: the kit falls back to the local copy
  });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let next = 1;
  const call = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { call, notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), stop: () => child.kill() };
}

test('handshake, tools and answers', async () => {
  const s = start();
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'joinable');
    s.notify('notifications/initialized');

    const { result } = await s.call('tools/list', {});
    assert.deepEqual(result.tools.map((t) => t.name), ['joinable_kit', 'joinable_choose_pattern', 'joinable_snippet', 'joinable_selftest', 'joinable_desyncs']);
    assert.ok(result.tools.every((t) => !('run' in t) && t.inputSchema.type === 'object'));

    const kit = await s.call('tools/call', { name: 'joinable_kit', arguments: {} });
    assert.match(kit.result.content[0].text, /^# Making a web game multiplayer/);

    const pick = await s.call('tools/call', { name: 'joinable_choose_pattern', arguments: { genre: 'Racing' } });
    assert.match(pick.result.content[0].text, /profile "race"/);

    const snip = await s.call('tools/call', { name: 'joinable_snippet', arguments: { pattern: 'race', key: 'TEST_KEY' } });
    assert.match(snip.result.content[0].text, /<script async src="http:\/\/127\.0\.0\.1:9\/sdk\.js" data-key="TEST_KEY" data-connect="invite">/);
    assert.match(snip.result.content[0].text, /profile: 'race'/);

    const keyless = await s.call('tools/call', { name: 'joinable_snippet', arguments: { pattern: 'score' } });
    assert.doesNotMatch(keyless.result.content[0].text, /<script[^>]*data-key/);
    assert.match(keyless.result.content[0].text, /No key is needed while the game runs on a local site/);
    assert.match(keyless.result.content[0].text, /getjoinable\.com\/app\?ref=mcp/);

    const bad = await s.call('tools/call', { name: 'nope', arguments: {} });
    assert.equal(bad.error.code, -32602);
    assert.equal((await s.call('nope/nope', {})).error.code, -32601);
  } finally {
    s.stop();
  }
});

test('patterns follow the kit', () => {
  assert.equal(choosePattern({ genre: 'platformer' }).pattern, 'B');
  assert.equal(choosePattern({ genre: 'board' }).pattern, 'A');
  assert.equal(choosePattern({ genre: 'turn based' }).pattern, 'C');
  assert.equal(choosePattern({ genre: 'RTS' }).pattern, 'lockstep');
  assert.equal(choosePattern({ genre: 'fighting' }).pattern, 'none');
  assert.equal(choosePattern({ genre: 'puzzle' }).pattern, 'score');
  assert.ok(choosePattern({ genre: 'clicker', has_score_or_time: true }).alsoFits);
  assert.equal(choosePattern({ genre: 'something new', held_key_avatars: true }).pattern, 'B');
});

test('lockstep: a snippet with step, hash and command; desync reports need a key or a local origin', async () => {
  const { snippet, desyncs } = await import('./server.mjs');
  const text = snippet({ pattern: 'lockstep' });
  for (const part of ["profile: 'lockstep'", 'step(commands', 'hash()', 'Joinable.command(', 'testCommand(rng)', 'build:']) assert.ok(text.includes(part), part);
  const none = await desyncs({});
  assert.equal(none.isError, true);
});

test('tool calls are checked against their schemas; the self-test round is clamped and capped', async () => {
  const { invalid, roundSeconds, TOOLS } = await import('./server.mjs');
  const schema = TOOLS.find((t) => t.name === 'joinable_selftest').inputSchema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(invalid(schema, { url: 'http://localhost:5173/' }), null);
  assert.equal(invalid(schema, { url: 'http://localhost:5173/', round: 120 }), null);
  assert.match(invalid(schema, { url: 'http://localhost:5173/', round: '120' }), /must be a number/, 'a string round is refused');
  assert.match(invalid(schema, { url: 'http://localhost:5173/', round: -5 }), /between 10 and 600/);
  assert.match(invalid(schema, { url: 'http://localhost:5173/', round: 1e9 }), /between 10 and 600/);
  assert.match(invalid(schema, { url: 'http://localhost:5173/', round: NaN }), /must be a number/);
  assert.match(invalid(schema, { url: 'http://localhost:5173/', round: 12.5 }), /whole number/);
  assert.match(invalid(schema, { url: 'http://localhost:5173/', evil: 1 }), /Unknown argument "evil"/);
  assert.match(invalid(schema, {}), /"url" is required/);
  assert.match(invalid(schema, { url: 5 }), /must be a string/);
  assert.match(invalid(schema, { url: 'http://x/', channel: 'firefox' }), /one of: chrome/);
  assert.match(invalid(schema, [1]), /must be an object/);
  // Even if a bad value got past the schema, the runner clamps it: never hours.
  for (const [v, want] of [['120', 120], [-5, 60], [1e9, 600], [NaN, 60], [undefined, 60], [5, 10], ['abc', 60]]) assert.equal(roundSeconds(v), want, String(v));
  for (const t of TOOLS) assert.equal(t.inputSchema.additionalProperties, false, t.name);
});

test('a bad tools/call gets a clear MCP error, not a run', async () => {
  const { handle } = await import('./server.mjs');
  const r = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'joinable_selftest', arguments: { url: 'http://localhost:5173/', round: '120' } } });
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /Invalid arguments for joinable_selftest: "round" must be a number/);
});
