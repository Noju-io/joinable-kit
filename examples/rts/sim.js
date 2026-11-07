// Tiny Front: a two-player RTS simulation, deterministic by design. Integers only (no floats,
// no Math.sin or Math.sqrt), one seeded random generator in the state, units in a fixed order,
// and orders as plain data. The same orders on the same seed give the same battle on any
// browser. It knows nothing about networking or drawing: the page owns those.
'use strict';

const RTS = (() => {
  const W = 2400; // world size in units
  const H = 1600;
  const SIGHT = 360;
  const TYPES = {
    hq: { hp: 600, speed: 0, range: 0, damage: 0 },
    factory: { hp: 400, speed: 0, range: 0, damage: 0 },
    tank: { hp: 60, speed: 7, range: 230, damage: 9, cooldown: 18, cost: 100 },
  };

  function rng(state) {
    // mulberry32 on an integer kept in the state
    state.seed = (state.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  function isqrt(n) {
    if (n < 2) return n;
    let x = n;
    let y = Math.floor((x + 1) / 2);
    while (y < x) {
      x = y;
      y = Math.floor((x + Math.floor(n / x)) / 2);
    }
    return x;
  }

  function add(state, owner, type, x, y) {
    const u = { id: state.nextId++, owner, type, x, y, hp: TYPES[type].hp, tx: x, ty: y, target: 0, cool: 0, idle: true };
    state.units.push(u);
    return u;
  }

  /** A new battle: player 0 bottom-left, player 1 top-right. `ai` lists the seats the computer plays. */
  function create(seed, players = 2, ai = []) {
    const state = { tick: 0, seed: seed | 0, nextId: 1, units: [], players: [], over: false, winner: -1 };
    const corners = [[260, H - 260], [W - 260, 260]];
    for (let p = 0; p < players; p++) {
      const [x, y] = corners[p];
      const hq = add(state, p, 'hq', x, y);
      const dir = p === 0 ? 1 : -1;
      add(state, p, 'factory', x + 200 * dir, y);
      for (let i = 0; i < 3; i++) add(state, p, 'tank', x + (120 + 60 * i) * dir, y - 160 * dir);
      state.players.push({ money: 200, hq: hq.id, alive: true, ai: ai.includes(p) });
    }
    return state;
  }

  const byId = (state, id) => state.units.find((u) => u.id === id);

  /** One order from player p. Orders that don't make sense (not their unit, no money) do nothing. */
  function order(state, p, cmd) {
    if (!cmd || state.over) return;
    const pl = state.players[p];
    if (!pl || !pl.alive) return;
    if (cmd.t === 'build') {
      const f = state.units.find((u) => u.owner === p && u.type === 'factory');
      if (!f || pl.money < TYPES.tank.cost) return;
      pl.money -= TYPES.tank.cost;
      const dir = p === 0 ? 1 : -1;
      add(state, p, 'tank', f.x + 90 * dir + (rng(state) % 80) - 40, f.y - 90 * dir + (rng(state) % 80) - 40);
    } else if (cmd.t === 'move' || cmd.t === 'attack') {
      const x = clamp(cmd.x | 0, 0, W);
      const y = clamp(cmd.y | 0, 0, H);
      const ids = Array.isArray(cmd.ids) ? cmd.ids.slice(0, 60) : [];
      ids.forEach((id, i) => {
        const u = byId(state, id);
        if (!u || u.owner !== p || u.type !== 'tank') return;
        // spread a group around the point, in a fixed pattern
        u.tx = clamp(x + ((i % 5) - 2) * 44, 0, W);
        u.ty = clamp(y + (((i / 5) | 0) - 1) * 44, 0, H);
        u.target = cmd.t === 'attack' ? cmd.target | 0 : 0;
        u.idle = false;
      });
    }
  }

  /** One tick: orders first (in the order given), then the AI, then movement, fire, damage. */
  function step(state, orders = []) {
    if (state.over) return;
    for (const o of orders) order(state, o.player, o.cmd);
    for (let p = 0; p < state.players.length; p++) if (state.players[p].ai) think(state, p);
    if (state.tick % 4 === 0) for (const pl of state.players) if (pl.alive) pl.money += 1;
    for (const u of state.units) {
      const T = TYPES[u.type];
      if (!T.speed) continue;
      // the target: the given one if it still exists, else the nearest enemy in range
      let target = u.target ? byId(state, u.target) : null;
      if (!target) {
        u.target = 0;
        let best = T.range * T.range + 1;
        for (const v of state.units) {
          if (v.owner === u.owner) continue;
          const d = sq(v.x - u.x) + sq(v.y - u.y);
          if (d < best) (best = d), (target = v);
        }
      }
      const inRange = target && sq(target.x - u.x) + sq(target.y - u.y) <= T.range * T.range;
      if (inRange) {
        if (u.cool <= 0) {
          target.hp -= T.damage;
          u.cool = T.cooldown;
        }
      } else {
        const gx = target && u.target ? target.x : u.tx;
        const gy = target && u.target ? target.y : u.ty;
        const dx = gx - u.x;
        const dy = gy - u.y;
        const d = isqrt(dx * dx + dy * dy);
        if (d > T.speed) {
          u.x += Math.trunc((dx * T.speed) / d);
          u.y += Math.trunc((dy * T.speed) / d);
        } else {
          u.x = gx;
          u.y = gy;
          if (!u.target) u.idle = true;
        }
      }
      if (u.cool > 0) u.cool--;
    }
    state.units = state.units.filter((u) => u.hp > 0);
    for (let p = 0; p < state.players.length; p++) {
      const pl = state.players[p];
      if (pl.alive && !byId(state, pl.hq)) {
        pl.alive = false;
        for (const u of state.units) if (u.owner === p) u.hp = 0;
        state.units = state.units.filter((u) => u.hp > 0);
      }
    }
    const alive = state.players.map((pl, i) => (pl.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length <= 1) {
      state.over = true;
      state.winner = alive[0] ?? -1;
    }
    state.tick++;
  }

  /** The computer player: builds when it can, and attacks the other base in waves. */
  function think(state, p) {
    const pl = state.players[p];
    if (!pl.alive) return;
    if (state.tick % 40 === 7 && pl.money >= TYPES.tank.cost) order(state, p, { t: 'build' });
    if (state.tick % 200 === 100) {
      const enemyHq = state.units.find((u) => u.type === 'hq' && u.owner !== p);
      const idle = state.units.filter((u) => u.owner === p && u.type === 'tank' && u.idle);
      if (enemyHq && idle.length >= 4) order(state, p, { t: 'attack', ids: idle.map((u) => u.id), x: enemyHq.x, y: enemyHq.y, target: enemyHq.id });
    }
  }

  /** A fingerprint of the battle: positions, health and money, as one 32-bit number. */
  function hash(state) {
    let h = (state.tick * 2654435761) >>> 0;
    const mix = (v) => (h = (Math.imul(h ^ (v | 0), 16777619) + 0x9e3779b9) >>> 0);
    for (const u of state.units) {
      mix(u.id);
      mix(u.x);
      mix(u.y);
      mix(u.hp);
    }
    for (const pl of state.players) mix(pl.money);
    mix(state.seed);
    return h;
  }

  /** Can player p see point (x, y)? Fog of war: within sight of one of p's units. For drawing only. */
  function sees(state, p, x, y) {
    for (const u of state.units) if (u.owner === p && sq(u.x - x) + sq(u.y - y) <= SIGHT * SIGHT) return true;
    return false;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function sq(v) {
    return v * v;
  }

  return { W, H, SIGHT, TYPES, create, step, hash, sees, think };
})();
