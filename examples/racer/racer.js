// Kart Loop: a small top-down racer, and Joinable's reference for the `race` profile.
// Solo it's a time trial. Online, Joinable runs the waiting room, countdown and results; this
// file only does what the game has to: start a race from the round's seed and options, report
// its own kart, draw the other karts, bump into them, and say when it finished.
// Everything Joinable-specific is marked JOINABLE.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960; // the world: every player's karts share these coordinates, whatever their screen
const H = 640;
const CX = W / 2;
const CY = H / 2;
const R = 13; // kart radius, for bumps
const TRACKS = {
  oval: { name: 'Oval', rx: 360, ry: 220, width: 120 },
  wide: { name: 'Wide Loop', rx: 390, ry: 250, width: 96 },
};

const keys = { up: false, down: false, left: false, right: false };
const touch = { left: false, right: false };

const racer = {
  mode: 'menu', // menu | grid | racing | done
  online: false,
  track: TRACKS.oval,
  laps: 2,
  car: null,
  rivals: [], // JOINABLE: the other players, from remote()
  t0: 0,
  time: 0,
  sparks: [],
  bumps: 0, // bumps felt by this kart (the end-to-end tests read it)
  autopilot: false, // drives itself; for tests and the self-test
  seed: 1,
  cones: [],
};
window.racer = racer;
const hits = {}; // rival id → when we last touched (for one spark burst per contact)

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point on the track's centre line at angle th. */
function centre(th, T = racer.track) {
  return { x: CX + Math.cos(th) * T.rx, y: CY + Math.sin(th) * T.ry };
}

/** How far from the centre line, roughly, in track widths (0 = on it, 0.5 = at the edge). */
function offTrack(x, y, T = racer.track) {
  const dx = (x - CX) / T.rx;
  const dy = (y - CY) / T.ry;
  const d = Math.hypot(dx, dy);
  return Math.abs(d - 1) * ((T.rx + T.ry) / 2) / T.width;
}

function newRace({ seed, track, laps, slot, slots }) {
  racer.seed = seed;
  racer.track = TRACKS[track] ?? TRACKS.oval;
  racer.laps = laps;
  const r = rng(seed);
  racer.cones = Array.from({ length: 10 }, () => {
    const th = r() * Math.PI * 2;
    const side = r() < 0.5 ? -1 : 1;
    const p = centre(th);
    const k = (racer.track.width / 2 + 14) * side;
    return { x: p.x + Math.cos(th) * k * (racer.track.rx / 380), y: p.y + Math.sin(th) * k * (racer.track.ry / 230) };
  });
  // Grid: staggered two by two behind the line, which is at angle -π/2 (top centre).
  const row = Math.floor(slot / 2);
  const lane = slot % 2 === 0 ? -1 : 1;
  const th = -Math.PI / 2 - 0.09 - row * 0.1;
  const p = centre(th);
  const nx = Math.cos(th);
  const ny = Math.sin(th) * (racer.track.rx / racer.track.ry);
  const nl = Math.hypot(nx, ny);
  racer.car = {
    x: p.x + (nx / nl) * lane * 26 * (slots > 1 ? 1 : 0),
    y: p.y + (ny / nl) * lane * 26 * (slots > 1 ? 1 : 0),
    a: 0, // facing right, along the top straight (clockwise)
    vx: 0,
    vy: 0,
    lap: 0,
    progress: 0,
    lastTh: th,
    unwrapped: th,
  };
  racer.time = 0;
  racer.sparks = [];
  racer.bumps = 0;
}

function soloStart() {
  newRace({ seed: (Math.random() * 1e9) | 0, track: 'oval', laps: 2, slot: 0, slots: 1 });
  racer.online = false;
  racer.mode = 'grid';
  setTimeout(() => go(), 900);
}

function go() {
  racer.mode = 'racing';
  racer.t0 = performance.now();
}

// ---------------------------------------------------------------- JOINABLE: the whole contract
(window.JoinableQ = window.JoinableQ || []).push((J) => {
  // Runs when Joinable has loaded (it loads async, so a slow network never holds up the game).
  // Joinable's own "Play online" button (top right) is the way in; the menu points at it.
  racer.joinable = true;
  J.game({
    profile: 'race',
    name: 'Kart Loop',
    players: { min: 2, max: 8 },
    public: true,
    options: {
      track: { label: 'Track', choices: [{ id: 'oval', label: 'Oval' }, { id: 'wide', label: 'Wide Loop' }] },
      laps: { label: 'Laps', choices: [1, 2, 3], default: 2 },
    },
    start(round) {
      const slot = round.players.findIndex((p) => p.id === round.me);
      newRace({ seed: round.seed, track: round.options.track, laps: Number(round.options.laps), slot, slots: round.players.length });
      racer.online = true;
      racer.mode = 'grid'; // Joinable shows 3-2-1; we wait for go()
    },
    go,
    local() {
      const c = racer.car;
      if (!c) return null;
      return { x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, lap: Math.min(c.lap + 1, racer.laps), progress: c.progress };
    },
    remote(players) {
      for (const p of players) p.lastHit = hits[p.id];
      racer.rivals = players;
    },
    stop() {
      racer.mode = 'menu';
      racer.online = false;
      racer.rivals = [];
    },
  });
});
// ---------------------------------------------------------------- end of contract

function update(dt) {
  const c = racer.car;
  if (!c || racer.mode === 'menu') return;
  if (racer.mode === 'racing' || racer.mode === 'done') {
    let steer = (keys.right || touch.right ? 1 : 0) - (keys.left || touch.left ? 1 : 0);
    let gas = keys.up || touch.left || touch.right || racer.mode === 'done' ? 1 : 0;
    const brake = keys.down ? 1 : 0;
    if (racer.autopilot || racer.mode === 'done') {
      // aim at a point a little ahead on the centre line
      const th = Math.atan2((c.y - CY) / racer.track.ry, (c.x - CX) / racer.track.rx) + 0.45;
      const t = centre(th);
      let d = Math.atan2(t.y - c.y, t.x - c.x) - c.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      steer = Math.max(-1, Math.min(1, d * 3));
      gas = racer.mode === 'done' ? 0.3 : Math.hypot(c.vx, c.vy) > 230 ? 0 : 1;
    }
    const speed = Math.hypot(c.vx, c.vy);
    c.a += steer * dt * (1.4 + Math.min(speed, 260) / 140);
    const off = offTrack(c.x, c.y) > 0.5;
    const accel = gas * (off ? 160 : 330) - brake * 380;
    c.vx += Math.cos(c.a) * accel * dt;
    c.vy += Math.sin(c.a) * accel * dt;
    // grip: kill sideways speed, then drag
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const fwd = c.vx * fx + c.vy * fy;
    const side = -c.vx * fy + c.vy * fx;
    const keepSide = side * Math.pow(0.02, dt);
    c.vx = fx * fwd - fy * keepSide;
    c.vy = fy * fwd + fx * keepSide;
    const drag = Math.pow(off ? 0.25 : 0.6, dt);
    c.vx *= drag;
    c.vy *= drag;
  }
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.x = Math.max(R, Math.min(W - R, c.x));
  c.y = Math.max(R, Math.min(H - R, c.y));

  // JOINABLE: bump into the other karts. Draw and collide with the same r.state: where Joinable
  // estimates they are now. Each phone resolves its own half of a contact: my phone moves only
  // my kart, by half the overlap and half the bounce; their phone does the other half. Doing the
  // whole push on both sides doubles it and makes karts that rub side by side shudder.
  for (const r of racer.rivals) {
    const p = r.state;
    if (!p || r.stale || r.contact === 0) continue;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d >= R * 2 || d === 0) continue;
    const nx = dx / d;
    const ny = dy / d;
    const overlap = R * 2 - d;
    c.x += nx * overlap * 0.5 * r.contact;
    c.y += ny * overlap * 0.5 * r.contact;
    const rel = (c.vx - (p.vx ?? 0)) * nx + (c.vy - (p.vy ?? 0)) * ny;
    if (rel < 0) {
      const k = ((1 + 0.3) / 2) * r.contact; // restitution 0.3, my half of it
      c.vx -= rel * nx * k;
      c.vy -= rel * ny * k;
    }
    const now = performance.now();
    if (now - (r.lastHit ?? 0) > 200) {
      racer.bumps++;
      for (let i = 0; i < 6; i++) racer.sparks.push({ x: c.x - nx * R, y: c.y - ny * R, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, life: 0.3 });
    }
    hits[r.id] = now;
  }

  // progress: unwrap the angle round the centre; a lap is one full turn clockwise
  const th = Math.atan2((c.y - CY) / racer.track.ry, (c.x - CX) / racer.track.rx);
  let d = th - c.lastTh;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  c.lastTh = th;
  c.unwrapped += d;
  const start = -Math.PI / 2;
  const turns = (c.unwrapped - start) / (Math.PI * 2);
  c.progress = Math.max(0, turns);
  if (racer.mode === 'racing') {
    racer.time = (performance.now() - racer.t0) / 1000;
    c.lap = Math.max(c.lap, Math.floor(turns));
    if (c.lap >= racer.laps) {
      racer.mode = 'done';
      if (racer.online) window.Joinable?.finish({ time: +racer.time.toFixed(2) }); // JOINABLE
    }
  }
  for (let i = racer.sparks.length - 1; i >= 0; i--) {
    const s = racer.sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0) racer.sparks.splice(i, 1);
  }
}

// The screen: the world fills it, turned upright on a phone held upright, with room for the
// dock at the top and the lap counter at the bottom. Only drawing changes; the race doesn't.
const view = { dpr: 1, w: 0, h: 0, s: 1, ox: 0, oy: 0, upright: false };
function resize() {
  view.dpr = Math.min(2, devicePixelRatio || 1);
  view.w = innerWidth;
  view.h = innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  view.upright = view.h > view.w * 1.1;
  const [ww, wh] = view.upright ? [H, W] : [W, H];
  const top = 58;
  const bottom = 50;
  view.s = Math.min(view.w / ww, (view.h - top - bottom) / wh);
  view.ox = (view.w - ww * view.s) / 2;
  view.oy = top + (view.h - top - bottom - wh * view.s) / 2;
}
addEventListener('resize', resize);
resize();
function worldSpace() {
  const { dpr, s, ox, oy } = view;
  if (view.upright) ctx.setTransform(0, s * dpr, -s * dpr, 0, (ox + H * s) * dpr, oy * dpr);
  else ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
}
function screenSpace() {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}
/** Where a world point lands on screen, in CSS pixels. */
function toScreen(x, y) {
  return view.upright ? { x: view.ox + (H - y) * view.s, y: view.oy + x * view.s } : { x: view.ox + x * view.s, y: view.oy + y * view.s };
}
const labels = [];

function drawKart(x, y, a, color, label, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-14, -9, 30, 20);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-15, -10, 30, 20, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillRect(2, -6, 7, 12);
  ctx.restore();
  if (label) labels.push({ ...toScreen(x, y), label, color, alpha }); // drawn upright, after the world
}

function drawLabels() {
  for (const { x, y, label, color, alpha } of labels.splice(0)) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "600 11px 'Geist', system-ui, sans-serif";
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 32, w, 17, 8);
    ctx.fill();
    ctx.fillStyle = '#120E26';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 20);
    ctx.restore();
  }
}

const DISPLAY = "780 {px}px 'Bricolage Grotesque', 'Geist', system-ui, sans-serif";
const UI = "600 {px}px 'Geist', system-ui, sans-serif";
const font = (f, px) => f.replace('{px}', String(Math.round(px)));

function draw() {
  const T = racer.track;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2F6B4F';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  worldSpace();
  // track
  ctx.lineWidth = T.width + 12;
  ctx.strokeStyle = '#E8E2D0';
  ctx.beginPath();
  ctx.ellipse(CX, CY, T.rx, T.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = T.width;
  ctx.strokeStyle = '#3B3F4A';
  ctx.stroke();
  ctx.setLineDash([18, 16]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.stroke();
  ctx.setLineDash([]);
  // start line
  const s0 = centre(-Math.PI / 2);
  for (let i = -T.width / 2; i < T.width / 2; i += 10) {
    ctx.fillStyle = (i / 10) % 2 === 0 ? '#fff' : '#120E26';
    ctx.fillRect(s0.x - 5, s0.y + i, 10, 10);
  }
  for (const k of racer.cones) {
    ctx.fillStyle = '#FF8A3D';
    ctx.beginPath();
    ctx.arc(k.x, k.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // JOINABLE: the other karts, drawn exactly where we collide with them
  for (const r of racer.rivals) {
    const s = r.state;
    if (!s) continue;
    drawKart(s.x, s.y, s.a, r.color, r.name.toUpperCase(), r.stale ? 0.25 : r.contact === 0 ? 0.5 : 1);
  }
  const c = racer.car;
  if (c) drawKart(c.x, c.y, c.a, window.Joinable?.me?.color ?? '#FF5A5F', null);
  for (const s of racer.sparks) {
    ctx.fillStyle = `rgba(255, 200, 80, ${s.life / 0.3})`;
    ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
  }
  // Screen: names, lap counter, menu
  screenSpace();
  drawLabels();
  const { w: vw, h: vh } = view;
  const k = Math.min(1, vw / 640); // smaller type on a phone
  if (c) {
    const text = `LAP ${Math.min(c.lap + 1, racer.laps)}/${racer.laps}   ${racer.time.toFixed(1)}s`;
    ctx.font = "500 14px 'Geist Mono', ui-monospace, Menlo, monospace";
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(18,14,38,.78)';
    ctx.beginPath();
    ctx.roundRect(12, vh - 44, tw + 24, 32, 999);
    ctx.fill();
    ctx.fillStyle = '#F4F1FF';
    ctx.textAlign = 'left';
    ctx.fillText(text, 24, vh - 23);
  }
  if (racer.mode === 'menu' || (racer.mode === 'done' && !racer.online)) {
    if (racer.mode === 'menu') {
      ctx.fillStyle = 'rgba(18,14,38,.8)';
      ctx.fillRect(0, 0, vw, vh);
    }
    ctx.fillStyle = '#F4F1FF';
    ctx.textAlign = 'center';
    const y = vh / 2;
    if (racer.mode === 'menu') {
      ctx.font = font(DISPLAY, 64 * k);
      ctx.fillText('Kart Loop', vw / 2, y - 40 * k);
      ctx.font = font(UI, 17 * k + 2);
      ctx.fillText(matchMedia('(pointer: coarse)').matches ? 'Tap to race the clock · tap left or right to steer' : 'Space to race the clock · arrow keys to steer', vw / 2, y + 6);
      if (racer.joinable) {
        ctx.fillStyle = '#FF5A5F';
        ctx.font = font(UI, 15 * k + 2);
        ctx.fillText('Race a friend: press Play online, top right', vw / 2, y + 36);
      }
    } else {
      ctx.font = font(DISPLAY, 48 * k);
      ctx.fillText(`${racer.time.toFixed(2)} s`, vw / 2, y);
      ctx.font = font(UI, 15 * k + 2);
      ctx.fillText(matchMedia('(pointer: coarse)').matches ? 'Tap for another go' : 'Space for another go', vw / 2, y + 32);
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  document.body.classList.toggle('racing', racer.mode !== 'menu');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', (e) => {
  if (map[e.code]) {
    keys[map[e.code]] = true;
    e.preventDefault();
  }
  if (e.code === 'Space' && (racer.mode === 'menu' || (racer.mode === 'done' && !racer.online))) soloStart();
});
addEventListener('keyup', (e) => {
  if (map[e.code]) keys[map[e.code]] = false;
});
canvas.addEventListener('pointerdown', (e) => {
  if (racer.mode === 'menu' || (racer.mode === 'done' && !racer.online)) return soloStart();
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left + r.width / 2) touch.left = true;
  else touch.right = true;
});
addEventListener('pointerup', () => {
  touch.left = touch.right = false;
});
