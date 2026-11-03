// Star Catcher, made multiplayer by following kit/AGENTS.md, Pattern B (avatars).
// Changes from single.js are marked "MP:". Everything else is the original game.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const keys = {};

let game = {
  players: { solo: { id: 'solo', x: W / 2, y: H / 2, score: 0, color: '#FF5A5F', name: 'You' } }, // MP: one avatar per player
  stars: [],
  nextId: 1,
  spawnIn: 0,
};

// MP: sync the world; inputs go to the host, which moves everyone.
Joinable.sync(game);
const inputs = {};
let lastSent = '';
Joinable.on('message', (data, from) => {
  if (data?.input) inputs[from] = data.input;
});
Joinable.on('players', (players) => {
  if (!Joinable.isHost) return;
  for (const p of players) {
    game.players[p.id] ??= { id: p.id, x: 60 + Math.random() * (W - 120), y: 60 + Math.random() * (H - 120), score: 0, color: p.color, name: p.name };
  }
  for (const id of Object.keys(game.players)) if (!players.some((p) => p.id === id)) delete game.players[id];
});

addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

function input() {
  return {
    x: (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0),
    y: (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0),
  };
}

// MP: every player sends their input to the host when it changes.
function sendInput() {
  const me = Joinable.me;
  const mine = input();
  if (!me || Joinable.isHost) {
    inputs[me ? me.id : 'solo'] = mine;
  } else if (JSON.stringify(mine) !== lastSent) {
    lastSent = JSON.stringify(mine);
    Joinable.send({ input: mine }, Joinable.hostId);
  }
}

function movePlayer(p, i, dt) {
  p.x = Math.max(20, Math.min(W - 20, p.x + i.x * 280 * dt));
  p.y = Math.max(20, Math.min(H - 20, p.y + i.y * 280 * dt));
}

function update(dt) {
  sendInput(); // MP
  if (Joinable.me && !Joinable.isHost) return; // MP: guests get the host's world
  for (const [id, p] of Object.entries(game.players)) movePlayer(p, inputs[id] ?? { x: 0, y: 0 }, dt); // MP: every avatar
  game.spawnIn -= dt;
  if (game.spawnIn <= 0 && game.stars.length < 8) {
    game.stars.push({ id: game.nextId++, x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) });
    game.spawnIn = 0.7;
  }
  for (let i = game.stars.length - 1; i >= 0; i--) {
    const s = game.stars[i];
    const catcher = Object.values(game.players).find((p) => Math.hypot(s.x - p.x, s.y - p.y) < 34); // MP
    if (catcher) {
      catcher.score++;
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
  const players = Object.values(game.players); // MP
  for (const p of players) drawPlayer(p);
  ctx.fillStyle = '#F4F1FF';
  ctx.font = '700 22px ui-rounded, system-ui, sans-serif';
  players.forEach((p, i) => ctx.fillText(`${p.id === Joinable.me?.id ? 'You' : p.name} ${p.score}`, 20, 36 + i * 28)); // MP
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
