// Bubble Pop: a plain single-player canvas game, written with no multiplayer in mind.
// Pop bubbles before they float away. Twenty-five escape and it's over.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const game = {
  bubbles: [],
  pops: [],
  score: 0,
  escaped: 0,
  time: 0,
  spawnIn: 0,
  nextId: 1,
  over: false,
};

function spawn() {
  const r = 16 + Math.random() * 26;
  game.bubbles.push({
    id: game.nextId++,
    x: r + Math.random() * (W - 2 * r),
    y: H + r,
    r,
    speed: 50 + Math.random() * 70 + game.time * 0.6,
    hue: Math.floor(Math.random() * 360),
    wobble: Math.random() * 6,
  });
}

function update(dt) {
  if (game.over) return;
  game.time += dt;
  game.spawnIn -= dt;
  if (game.spawnIn <= 0) {
    spawn();
    game.spawnIn = Math.max(0.25, 0.9 - game.time / 120);
  }
  for (let i = game.bubbles.length - 1; i >= 0; i--) {
    const b = game.bubbles[i];
    b.y -= b.speed * dt;
    b.x += Math.sin(game.time * 2 + b.wobble) * 20 * dt;
    if (b.y < -b.r) {
      game.bubbles.splice(i, 1);
      game.escaped++;
      if (game.escaped >= 25) game.over = true;
    }
  }
  for (let i = game.pops.length - 1; i >= 0; i--) {
    game.pops[i].life -= dt;
    if (game.pops[i].life <= 0) game.pops.splice(i, 1);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * W;
  const y = ((e.clientY - rect.top) / rect.height) * H;
  if (game.over) {
    Object.assign(game, { bubbles: [], pops: [], score: 0, escaped: 0, time: 0, spawnIn: 0, over: false });
    return;
  }
  for (let i = game.bubbles.length - 1; i >= 0; i--) {
    const b = game.bubbles[i];
    if (Math.hypot(b.x - x, b.y - y) <= b.r + 6) {
      game.score += Math.round(60 - b.r);
      game.pops.push({ id: game.nextId++, x: b.x, y: b.y, r: b.r, hue: b.hue, life: 0.35 });
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
    ctx.strokeStyle = `hsla(${b.hue}, 100%, 85%, .9)`;
    ctx.lineWidth = 2;
    ctx.stroke();
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
  ctx.fillText(`Score ${game.score}`, 24, 44);
  ctx.textAlign = 'right';
  ctx.fillText(`Escaped ${game.escaped}/25`, W - 24, H - 24);

  if (game.over) {
    ctx.fillStyle = 'rgba(18, 14, 38, .7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#F4F1FF';
    ctx.textAlign = 'center';
    ctx.font = '800 56px ui-rounded, system-ui, sans-serif';
    ctx.fillText('Game over', W / 2, H / 2 - 10);
    ctx.font = '600 24px ui-rounded, system-ui, sans-serif';
    ctx.fillText(`Score ${game.score} · click to play again`, W / 2, H / 2 + 34);
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
