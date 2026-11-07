// Tiny Front's screen: draws the battle as one player sees it (their fog of war), and turns
// clicks and taps into orders. Orders go to `onOrder`; the view never changes the battle itself.
'use strict';

const View = (() => {
  const COLORS = ['#FF5A5F', '#2EC4B6'];
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const fogCanvas = document.createElement('canvas');
  const fx = fogCanvas.getContext('2d');
  let state = null;
  let me = 0;
  let onOrder = () => {};
  let selected = new Set();
  let drag = null; // { x0, y0, x1, y1 } in world units
  let note = '';

  function fit() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }
  addEventListener('resize', fit);
  fit();

  // world ↔ screen: the whole map, letterboxed, under a 52 px bar
  function frame() {
    const dpr = canvas.width / innerWidth;
    const top = 52 * dpr;
    const s = Math.min(canvas.width / RTS.W, (canvas.height - top) / RTS.H);
    return { s, ox: (canvas.width - RTS.W * s) / 2, oy: top + (canvas.height - top - RTS.H * s) / 2, dpr };
  }
  function toWorld(e) {
    const f = frame();
    return { x: Math.round(((e.clientX * f.dpr) - f.ox) / f.s), y: Math.round(((e.clientY * f.dpr) - f.oy) / f.s) };
  }

  function unitAt(x, y, owner) {
    let best = null;
    let bd = 60 * 60;
    for (const u of state.units) {
      if (owner !== undefined && (owner === 'enemy' ? u.owner === me : u.owner !== owner)) continue;
      if (owner === 'enemy' && !RTS.sees(state, me, u.x, u.y)) continue;
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bd) (bd = d), (best = u);
    }
    return best;
  }

  // Mouse: drag to select, right-click to move or attack. Touch: tap a tank to select (tap more
  // to add), tap the ground or an enemy to send them, long-press to select all.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!state || state.over) return;
    const p = toWorld(e);
    press = { ...p, t: performance.now(), button: e.button, touch: e.pointerType !== 'mouse' };
    if (e.button === 0 && !press.touch) drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) Object.assign(drag, { x1: toWorld(e).x, y1: toWorld(e).y });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!state || !press) return;
    const p = toWorld(e);
    if (press.button === 2) send(p);
    else if (press.touch) {
      if (performance.now() - press.t > 500) selectAll();
      else {
        const mine = unitAt(p.x, p.y, me);
        if (mine && mine.type === 'tank') selected.add(mine.id);
        else if (selected.size) send(p);
      }
    } else if (drag) {
      const [x0, x1] = [Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1)];
      const [y0, y1] = [Math.min(drag.y0, drag.y1), Math.max(drag.y0, drag.y1)];
      selected = new Set();
      if (x1 - x0 < 20 && y1 - y0 < 20) {
        const u = unitAt(p.x, p.y, me);
        if (u && u.type === 'tank') selected.add(u.id);
      } else for (const u of state.units) if (u.owner === me && u.type === 'tank' && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) selected.add(u.id);
    }
    drag = null;
    press = null;
  });
  function send(p) {
    if (!selected.size) return;
    const enemy = unitAt(p.x, p.y, 'enemy');
    const ids = [...selected];
    onOrder(enemy ? { t: 'attack', ids, x: enemy.x, y: enemy.y, target: enemy.id } : { t: 'move', ids, x: p.x, y: p.y });
    ping = { x: p.x, y: p.y, at: performance.now(), attack: !!enemy }; // the click is acknowledged at once
  }
  function selectAll() {
    selected = new Set(state.units.filter((u) => u.owner === me && u.type === 'tank').map((u) => u.id));
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'b' || e.key === 'B') onOrder({ t: 'build' });
    if (e.key === 'a' || e.key === 'A') selectAll();
  });
  document.getElementById('build')?.addEventListener('click', () => onOrder({ t: 'build' }));
  let ping = null;

  function draw() {
    requestAnimationFrame(draw);
    if (!state) return;
    for (const id of selected) if (!state.units.some((u) => u.id === id)) selected.delete(id);
    const f = frame();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#120E26';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(f.s, 0, 0, f.s, f.ox, f.oy);
    ctx.fillStyle = '#3B5B3A';
    ctx.fillRect(0, 0, RTS.W, RTS.H);
    // fog: dark everywhere, then cut out what my units can see (overlaps stay clear)
    if (fogCanvas.width !== canvas.width || fogCanvas.height !== canvas.height) Object.assign(fogCanvas, { width: canvas.width, height: canvas.height });
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.globalCompositeOperation = 'source-over';
    fx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    fx.setTransform(f.s, 0, 0, f.s, f.ox, f.oy);
    fx.fillStyle = 'rgba(10, 8, 23, .72)';
    fx.fillRect(0, 0, RTS.W, RTS.H);
    fx.globalCompositeOperation = 'destination-out';
    fx.fillStyle = '#000';
    for (const u of state.units) if (u.owner === me) {
      fx.beginPath();
      fx.arc(u.x, u.y, RTS.SIGHT, 0, Math.PI * 2);
      fx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.setTransform(f.s, 0, 0, f.s, f.ox, f.oy);
    for (const u of state.units) {
      if (u.owner !== me && !RTS.sees(state, me, u.x, u.y)) continue; // fog of war: hidden
      const c = COLORS[u.owner];
      ctx.fillStyle = c;
      if (u.type === 'hq') ctx.fillRect(u.x - 70, u.y - 70, 140, 140);
      else if (u.type === 'factory') ctx.fillRect(u.x - 55, u.y - 40, 110, 80);
      else {
        ctx.beginPath();
        ctx.arc(u.x, u.y, 24, 0, Math.PI * 2);
        ctx.fill();
      }
      if (selected.has(u.id)) {
        ctx.strokeStyle = '#F4F1FF';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(u.x, u.y, 34, 0, Math.PI * 2);
        ctx.stroke();
      }
      const max = RTS.TYPES[u.type].hp;
      if (u.hp < max) {
        ctx.fillStyle = '#120E26';
        ctx.fillRect(u.x - 40, u.y - (u.type === 'tank' ? 44 : 90), 80, 10);
        ctx.fillStyle = '#FFB400';
        ctx.fillRect(u.x - 40, u.y - (u.type === 'tank' ? 44 : 90), (80 * u.hp) / max, 10);
      }
    }
    if (ping && performance.now() - ping.at < 600) {
      ctx.strokeStyle = ping.attack ? '#FF5A5F' : '#F4F1FF';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, 20 + (performance.now() - ping.at) / 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (drag) {
      ctx.strokeStyle = 'rgba(244,241,255,.8)';
      ctx.lineWidth = 4;
      ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0);
    }
    // the bar
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    const pl = state.players[me];
    document.getElementById('money').textContent = `$${pl ? pl.money : 0}`;
    const btn = document.getElementById('build');
    if (btn) btn.disabled = !pl || pl.money < RTS.TYPES.tank.cost || state.over;
    document.getElementById('note').textContent = state.over ? (state.winner === me ? 'Victory' : state.winner < 0 ? 'Draw' : 'Defeat') : note;
  }
  requestAnimationFrame(draw);

  return {
    show(s, player) {
      state = s;
      me = player;
    },
    onOrder(fn) {
      onOrder = fn;
    },
    note(text) {
      note = text;
    },
  };
})();
