// Star Catcher: single-player. Move with the arrow keys or WASD and catch the stars.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const keys = {};

let game = {
  player: { x: W / 2, y: H / 2, score: 0, color: '#FF5A5F' },
  stars: [],
  nextId: 1,
  spawnIn: 0,
};

addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

function input() {
  return {
    x: (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0),
    y: (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0),
  };
}

function movePlayer(p, i, dt) {
  p.x = Math.max(20, Math.min(W - 20, p.x + i.x * 280 * dt));
  p.y = Math.max(20, Math.min(H - 20, p.y + i.y * 280 * dt));
}

function update(dt) {
  movePlayer(game.player, input(), dt);
  game.spawnIn -= dt;
  if (game.spawnIn <= 0 && game.stars.length < 8) {
    game.stars.push({ id: game.nextId++, x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) });
    game.spawnIn = 0.7;
  }
  for (let i = game.stars.length - 1; i >= 0; i--) {
    const s = game.stars[i];
    if (Math.hypot(s.x - game.player.x, s.y - game.player.y) < 34) {
      game.player.score++;
      game.stars.splice(i, 1);
    }
  }
}

function drawStar(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

function drawPlayer(p) {
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#120E26';
  ctx.fillRect(p.x - 8, p.y - 6, 5, 7);
  ctx.fillRect(p.x + 3, p.y - 6, 5, 7);
}

function draw() {
  ctx.fillStyle = '#0F1B33';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFD43B';
  for (const s of game.stars) drawStar(s.x, s.y, 14);
  drawPlayer(game.player);
  ctx.fillStyle = '#F4F1FF';
  ctx.font = '700 26px ui-rounded, system-ui, sans-serif';
  ctx.fillText(`Stars ${game.player.score}`, 20, 40);
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
