# Making a web game multiplayer: instructions for coding agents

You are adding online multiplayer to an existing browser game with the Joinable
SDK. The SDK and its hosted relay handle connections, rooms, invite links, host election,
reconnects and late joiners. **Never write server code, WebSocket code or a lobby screen.**
Your job is to choose the right pattern below and connect the game's real state and inputs.

`KEY` below is the project's public key (`pk_…`). The owner's prompt gives it; owners get one at
https://getjoinable.com/app. The SDK is `https://relay.getjoinable.com/sdk.js`, and its script tag
always carries `data-key="KEY"`. Without it, with a key the relay doesn't know, or on a site
the key doesn't allow, the dock says why ("Offline: unknown key", for example) and the game stays
single-player. The game's key works on local sites (localhost, `*.test`, `*.local`) as soon as
it's made, free and never counted, and so do branch previews of a Cloudflare Pages project on the
game's list, so test there freely. Use exactly this address: never a `*.workers.dev` one, which
some countries' networks block.

## 0. Read the game first

Find and note, before changing anything:
1. **The state.** The object the game draws from (often `game`, `state`, `world`). Is it a
   top-level `let`/`const`/`var` in a classic script, inside a module, or inside a class?
2. **The loop.** `requestAnimationFrame` (good), `setInterval`, or an engine's loop (Phaser,
   PixiJS, Three.js all use requestAnimationFrame underneath).
3. **The inputs.** Which handlers change state directly (clicks, taps, key presses that act
   once), and which only record keys for the loop to read (`keys.left = true`).
4. **The genre**, which decides the pattern:

| The game is… | Use |
|---|---|
| A racer, time trial, or anything where each player drives their own car or runner on the same course | **Full rounds, `race`** (below) |
| Any game with a score or a time: arcade, puzzle, endless runner, mini games | **Full rounds, `score`** (below) |
| Board, card, puzzle, word, clicker, idle, builder, drawing; anything where clicks change the world | **Pattern A** |
| Any game with avatars moved by held keys or a joystick in one shared world (platformer, top-down, party) | **Pattern B** |
| Turn-based with clear turns | **Pattern A**, plus the turn check in Pattern C |
| RTS (planned: `lockstep`), fighting games, competitive shooters | Stop and tell the owner: these need lockstep, rollback or a cloud host, which aren't built yet |

**Prefer full rounds whenever they fit.** They give players the whole multiplayer experience
(waiting room, countdown, playing together, one podium, rematch, quick match with strangers)
and they don't touch the game's state at all.

## Full rounds: Joinable runs the session, the game runs the game

Joinable shows the play-online sheet, the waiting room, a synced 3-2-1, live standings,
results and rematch. You add one call that tells Joinable how to start this game and how to
see the other players.

**Load the script with `async`, always.** A plain `<script src>` blocks the page until it
arrives. Some networks don't refuse a blocked domain, they just never answer, and the game
then shows a black screen until the browser gives up. In Ghassan's test from Turkey that
happened. With `async`, the game starts at once whatever happens to Joinable. Add
`data-connect="invite"` so solo players never connect:

```html
<script async src="https://relay.getjoinable.com/sdk.js" data-key="KEY" data-connect="invite"></script>
```

Because it's async, `window.Joinable` may not exist yet when the game's code runs. Queue the
setup instead of calling `Joinable` directly. The queued function runs as soon as Joinable
arrives, before or after the game's scripts, and never if it doesn't, so the game stays
single-player:

```js
(window.JoinableQ = window.JoinableQ || []).push((Joinable) => {
  onlineButton.hidden = false;         // only offer online play once Joinable is here
  Joinable.game({
  profile: 'race',                     // or 'score'
  name: 'Kart Loop',
  players: { min: 2, max: 8 },
  public: true,                        // strangers can find rooms through Quick match
  options: {                           // optional: chosen by the room's host in the waiting room
    track: { label: 'Track', choices: [{ id: 'oval', label: 'Oval' }, { id: 'wide', label: 'Wide Loop' }] },
    laps: { label: 'Laps', choices: [1, 2, 3], default: 2 },
  },
  countdown: 0,                        // seconds of the game's OWN countdown, if it has one; 0 = Joinable shows 3-2-1

  // Start a round. Same call on every player: same seed, same options. Reset everything.
  // Put the player on the grid / at the start, but don't let them move until go().
  start({ round, seed, options, players, me, at }) { … },
  go() { … },                          // the start signal, at the same moment on every player

  // Your player's state, read 20×/s (race) or 2×/s (score). Flat numbers only, under 1.5 KB.
  // Include vx, vy: prediction uses them, and follows the turn when they rotate.
  // race: { x, y, a, vx, vy, lap, progress }  (progress: laps done as a fraction, e.g. 1.37)
  // score: { score }
  local() { return { … }; },

  // race only: every frame, the other players. Draw each at p.state and collide with p.state.
  remote(players) { … },

  stop() { … },                        // the round is over for this player: back to the menu
  });
});

// Anywhere else, guard the call: Joinable may be missing (offline, blocked).
window.Joinable?.finish({ time: 83.42 });      // race: seconds
window.Joinable?.finish({ score: 1200 });      // score
```

**Use the game's own randomness from `seed`.** Every `Math.random()` that changes the course,
the level or the spawns must come from a seeded generator, so all players get the same game.
Cosmetic randomness (particles, sparks) can stay `Math.random()`.

**Give players a way in.** The dock's button says "Play online". If the game has a menu, add a
button there that calls `Joinable.open()`.

**The game must still work when Joinable doesn't load** (offline, a blocked domain, a slow
network). With the async tag and the queue above it does: the online button stays hidden and
nothing else changes. Write every other call as `window.Joinable?.…`. The relay's tests check
this: a never-answering Joinable must leave the demo playable.

A failed script load still shows one network error in the browser console. Browsers log it
however the tag is written. If the game's own tests treat console errors as failures, make
them ignore failed requests to the Joinable relay's `/sdk.js`.

### Drawing other players and bumping (race)

`remote(players)` gets one entry per other player:

| Field | Use |
|---|---|
| `state` | Where they are now, estimated from their last update and `vx`/`vy`, and eased (never snapped) onto each new update. **Draw them here and collide with them here** |
| `now` | The same object as `state` (kept for older code) |
| `past` | Their exact reported path about 100 ms ago. For trails and replays, not for contact |
| `contact` | 1 = full bumps; lower = softer (high ping); 0 = no contact, draw them translucent |
| `ping` | Round trip between you and them, ms |
| `stale` | No data lately: fade them out |
| `id`, `name`, `color` | For the name tag and colour |

Bumping, in the game's own physics, on every player's device:
- Treat each rival as a solid body at `p.state`: the place you draw it. Colliding anywhere
  else makes players hit cars they can't see.
- On contact, move **only your own car**, by **half** the overlap, and apply **half** the bounce
  to your own velocity, only while the two are closing in. Scale both by `p.contact`. The
  rival's device does the other half; doing the whole push on both sides doubles every bump and
  makes cars that rub side by side shudder.
- Never move the rival: its own device does that.
- Play the hit (sparks, sound) once per contact, not every frame the cars touch.

`public/demo/racer/racer.js` on the relay is a complete example, async loading included (search
for `JOINABLE`).

### Check it yourself

```bash
npx getjoinable test http://localhost:PORT/your-game/
```

The package is `getjoinable`, Joinable's own, on npm. **Never run `npx joinable`:** `joinable` on
npm is an unrelated package that belongs to someone else. If Playwright's Chromium isn't
installed, run `npx playwright-core install chromium` first.

This opens two headless players on the page and checks the whole contract, each failure with a
fix:
- `start` runs on both with the same seed;
- `local` and `remote` carry the other player;
- `finish` gives one result on both;
- rematch starts round 2.

Rounds that only end when someone plays are finished for the test, with a note. Heavy 3D games
can crawl in the bundled headless Chromium (it draws WebGL in software); add `--channel chrome`
to use the installed Chrome with its GPU. Run it until it
passes, then tell the owner to try one real round on two devices.

## Pattern A: shared world (usually one line)

If the state is a top-level variable in a classic (non-module) script, add one tag after the
game's scripts:

```html
<script src="https://relay.getjoinable.com/sdk.js" data-key="KEY" data-sync="game"></script>
```

Otherwise (modules, classes, strict CSP), add the plain tag and call `sync` once the state exists:

```html
<script src="https://relay.getjoinable.com/sdk.js" data-key="KEY"></script>
```
```js
Joinable.sync(game, { local: ['keys', 'mouse'] });
```

How it behaves, so you can predict problems:
- One player (the host) runs the real simulation. Everyone else runs a local prediction that
  is undone after every frame.
- What a player's **input handlers** change between frames is sent to the host. Numbers are
  sent as amounts to add (two players scoring at once both count).
- Arrays of objects that each have a unique `id` are matched by id. **Give entities ids** if
  they don't have them (`id: game.nextId++`); without ids, removals from shifting arrays can hit
  the wrong item.
- Not synced: functions, DOM nodes, canvases, images, Maps, Sets, typed arrays, keys starting
  with `_`, and keys listed in `local` / `data-local="keys,mouse"`. Put per-device things
  (pressed keys, mouse position, camera, UI open/closed, audio) under one of those.
- Class instances are synced by their fields. Entities created on a guest arrive at the host
  as plain objects: if the game calls methods on entities, create them with plain data plus
  standalone functions, or ask the owner before restructuring.

## Pattern B: avatars (host-authoritative input)

Each player sends their inputs to the host; the host moves everyone's avatar in its own
simulation; the world (all avatars included) syncs with Pattern A.

1. Turn the single `player` into a map keyed by player id, kept in the synced state:
   `game.players = {}`. Drawing code loops over `Object.values(game.players)`. Draw each with
   its `color` so players can tell each other apart.
2. Keep pressed keys out of the synced state (`local: ['keys']`).
3. In the loop, **only the host simulates**. Every player sends their own input:

```js
Joinable.sync(game, { local: ['keys'] });

// every frame, every player: send your input to the host if it changed
const inputs = {}; // host only: latest input per player id
let lastSent = '';
function sendInput() {
  const me = Joinable.me;
  if (!me) return;
  const mine = { left: keys.left, right: keys.right, jump: keys.jump };
  if (Joinable.isHost) inputs[me.id] = mine;
  else if (JSON.stringify(mine) !== lastSent) {
    lastSent = JSON.stringify(mine);
    Joinable.send({ input: mine }, Joinable.hostId);
  }
}
Joinable.on('message', (data, from) => { if (data?.input) inputs[from] = data.input; });

// host only: make sure every player has an avatar, and drop players who left
Joinable.on('players', (players) => {
  if (!Joinable.isHost) return;
  for (const p of players) game.players[p.id] ??= { id: p.id, x: 100, y: 100, color: p.color, name: p.name };
  for (const id of Object.keys(game.players)) if (!players.some((p) => p.id === id)) delete game.players[id];
});

function update(dt) {
  sendInput();
  if (Joinable.me && !Joinable.isHost) return; // guests: the host's world arrives by itself
  for (const [id, p] of Object.entries(game.players)) movePlayer(p, inputs[id] ?? {}, dt);
  // …the rest of the original update (enemies, spawns, scoring)
}
```

4. The host can change hands (it leaves, or switches tabs). Write the host code so any player
   can take over at any frame: everything the simulation needs must be in the synced state,
   except `inputs`, which refills within a frame.
5. Solo play must still work: before connecting (`Joinable.me` is null) the player is the
   only one and plays normally.

Guests feel about one round trip of input delay. Fine for casual and party games. If the
owner needs instant movement for each player's own avatar, tell them that client-owned
avatars are on the SDK's roadmap.

## Pattern C: turns

Keep whose turn it is in the synced state (`game.turn = playerId`). In input handlers, ignore
input when `game.turn !== Joinable.me?.id`. The host assigns turns when players join or leave
(`Joinable.on('players', …)` as in Pattern B).

## API reference (what exists today)

Full rounds: `Joinable.game(def)`, `Joinable.finish({ time | score })`, `Joinable.quit()` (leave a
round from your pause menu), `Joinable.open()` (the play-online sheet), `Joinable.quickMatch()`,
`Joinable.ready(true|false)`, `Joinable.leave()`, `Joinable.online()` (→ `{ players, rooms }`),
`Joinable.now()` (the room's clock, ms), `Joinable.remote()` (the same list `remote()` gets),
`Joinable.session` (the room's session state: `phase`, `round`, `options`, `results`…). Events:
`'session'`, `'round'`, `'results'`. Profiles `arena`, `coop`, `turns` and `lockstep` are
planned: Joinable accepts them but doesn't carry their state yet.

Everything else:

| | |
|---|---|
| `Joinable.sync(state, { local })` | Sync this object. Once per page. Returns the same object |
| `Joinable.me` | `{ id, name, color }` or `null` before connecting |
| `Joinable.players` | Everyone in the room, including you, in join order |
| `Joinable.isHost`, `Joinable.hostId` | Who runs the simulation now |
| `Joinable.send(data, toId?)` | Your own JSON message to one player, or everyone else |
| `Joinable.on(event, fn)` | `'players'`, `'host'`, `'message'` `(data, fromId)`, `'chat'`, `'connected'`, `'disconnected'`, `'error'` `(code, message)`. Returns an unsubscribe function |
| `Joinable.inviteLink()`, `copyInvite()`, `room` | The room link (also in the address bar as `?join=`). Both connect first if needed. `room` is `null` until connected with `data-connect="invite"` |
| `Joinable.connect()` | Join the room now (starting one if needed). For your own "Play with a friend" button with `data-connect="invite"` |

Script attributes: `data-key` (required), `data-sync`, `data-local`, `data-room` (fixed room), `data-game` (namespace,
default the page path), `data-ui="off"` (hide the dock, e.g. to build your own), `data-name`,
`data-connect="invite"` (stay offline until the player invites someone or opens an invite
link; use it on sites where most visits are solo), `data-position` (dock corner: `top-right`
by default, `top-left`, `bottom-right`, `bottom-left`) and `data-inset` (`"12"` or `"12 70"`: px
from the side, then from the top or bottom edge). If the dock covers the game's own buttons,
move it with these rather than changing the game's layout.

## Testing (do this, don't skip it)

1. Serve the game locally and open it. The dock (top right) should say "Just you · invite a
   friend" and the URL should gain `?join=…`.
2. Open the same URL (with `?join=…`) in a second **window** next to the first, both visible.
   Background tabs are throttled by browsers and will hand the host role over, which is
   correct but confusing while testing.
3. Check, and report each to the owner:
   - Both windows show the same world.
   - An action in the guest window shows up in the host window, and the reverse.
   - Scores and counters add up when both players act.
   - Close the host window: the other one keeps playing.
   - Open a third window late: it gets the current world.
4. Check the browser console of both windows for `[joinable]` warnings.
5. If something doesn't sync, the usual causes, in order: the state isn't the object the game
   draws from; entities without ids; state changed in the loop that should be per-player
   (use Pattern B); a `setInterval` loop.

## Rules

- Change as little of the game as possible, and keep single-player working.
- Never call the relay directly, add WebSocket code, or build a lobby: the SDK does it.
- Don't put secrets, personal data or auth tokens in synced state: everyone in the room can read it.
