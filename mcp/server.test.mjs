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
    assert.deepEqual(result.tools.map((t) => t.name), ['joinable_kit', 'joinable_choose_pattern', 'joinable_snippet', 'joinable_selftest']);
    assert.ok(result.tools.every((t) => !('run' in t) && t.inputSchema.type === 'object'));

    const kit = await s.call('tools/call', { name: 'joinable_kit', arguments: {} });
    assert.match(kit.result.content[0].text, /^# Making a web game multiplayer/);

    const pick = await s.call('tools/call', { name: 'joinable_choose_pattern', arguments: { genre: 'Racing' } });
    assert.match(pick.result.content[0].text, /profile "race"/);

    const snip = await s.call('tools/call', { name: 'joinable_snippet', arguments: { pattern: 'race', key: 'TEST_KEY' } });
    assert.match(snip.result.content[0].text, /<script async src="http:\/\/127\.0\.0\.1:9\/sdk\.js" data-key="TEST_KEY" data-connect="invite">/);
    assert.match(snip.result.content[0].text, /profile: 'race'/);

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
  assert.equal(choosePattern({ genre: 'RTS' }).pattern, 'none');
  assert.equal(choosePattern({ genre: 'puzzle' }).pattern, 'score');
  assert.ok(choosePattern({ genre: 'clicker', has_score_or_time: true }).alsoFits);
  assert.equal(choosePattern({ genre: 'something new', held_key_avatars: true }).pattern, 'B');
});
