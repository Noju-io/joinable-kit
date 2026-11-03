// Bubble Pop, score attack: Joinable's reference for the `score` profile. Everyone gets the same
// bubbles (same seed) for 30 seconds, live scores show in the strip, and the best score wins.
// The changes from the single-player game are a seeded random and the hooks marked JOINABLE.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const ROUND = 30;

const game = { bubbles: [], pops: [], score: 0, time: 0, spawnIn: 0, nextId: 1, mode: 'menu', online: false };
window.game = game;
let random = Math.random;

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reset(seed) {
  random = seeded(seed);
  Object.assign(game, { bubbles: [], pops: [], score: 0, time: 0, spawnIn: 0, nextId: 1 });
}

function spawn() {
  const r = 18 + random() * 26;
  game.bubbles.push({ id: game.nextId++, x: r + random() * (W - 2 * r), y: H + r, r, speed: 60 + random() * 80 + game.time * 2, hue: Math.floor(random() * 360), wobble: random() * 6 });
}

// JOINABLE: the whole contract for a score game
(window.JoinableQ = window.JoinableQ || []).push((J) =>
  J.game({
    profile: 'score',
    name: 'Bubble Pop',
    players: { min: 2, max: 16 },
    public: true,
    start(round) {
      reset(round.seed);
      game.online = true;
      game.mode = 'ready';
    },
    go() {
      game.mode = 'playing';
    },
    local() {
      return { score: game.score };
    },
    stop() {
      game.mode = 'menu';
      game.online = false;
    },
  }),
);

function update(dt) {
  if (game.mode !== 'playing') return;
  game.time += dt;
  game.spawnIn -= dt;
  if (game.spawnIn <= 0) {
    spawn();
    game.spawnIn = Math.max(0.22, 0.7 - game.time / 60);
  }
  for (let i = game.bubbles.length - 1; i >= 0; i--) {
    const b = game.bubbles[i];
    b.y -= b.speed * dt;
    b.x += Math.sin(game.time * 2 + b.wobble) * 20 * dt;
    if (b.y < -b.r) game.bubbles.splice(i, 1);
  }
  for (let i = game.pops.length - 1; i >= 0; i--) {
    game.pops[i].life -= dt;
    if (game.pops[i].life <= 0) game.pops.splice(i, 1);
  }
  if (game.time >= ROUND) {
    game.mode = 'over';
    if (game.online) window.Joinable?.finish({ score: game.score }); // JOINABLE
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.mode === 'menu' || (game.mode === 'over' && !game.online)) {
    reset((Math.random() * 1e9) | 0);
    game.mode = 'playing';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * W;
  const y = ((e.clientY - rect.top) / rect.height) * H;
  for (let i = game.bubbles.length - 1; i >= 0; i--) {
    const b = game.bubbles[i];
    if (Math.hypot(b.x - x, b.y - y) <= b.r + 6) {
      game.score += Math.round(60 - b.r);
      game.pops.push({ x: b.x, y: b.y, r: b.r, hue: b.hue, life: 0.35 });
      game.bubbles.splice(i, 1);
      return;
    }
  }
});

function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1B1446');
  sky.addColorStop(1, '#3B1F6E');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const b of game.bubbles) {
    const g = ctx.createRadialGradient(b.x - b.r / 3, b.y - b.r / 3, b.r / 6, b.x, b.y, b.r);
    g.addColorStop(0, `hsla(${b.hue}, 100%, 92%, .95)`);
    g.addColorStop(1, `hsla(${b.hue}, 90%, 60%, .55)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of game.pops) {
    const k = 1 - p.life / 0.35;
    ctx.strokeStyle = `hsla(${p.hue}, 100%, 80%, ${1 - k})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#F4F1FF';
  ctx.font = '700 28px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${game.score}`, 24, H - 28);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.max(0, ROUND - game.time).toFixed(0)} s`, W - 24, H - 28);
  if (game.mode === 'menu' || (game.mode === 'over' && !game.online)) {
    ctx.fillStyle = 'rgba(18, 14, 38, .7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#F4F1FF';
    ctx.textAlign = 'center';
    ctx.font = '800 52px ui-rounded, system-ui, sans-serif';
    ctx.fillText(game.mode === 'over' ? `Score ${game.score}` : 'Bubble Pop: 30 seconds', W / 2, H / 2 - 10);
    ctx.font = '600 22px ui-rounded, system-ui, sans-serif';
    ctx.fillText('Tap to play solo, or Play online', W / 2, H / 2 + 34);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
