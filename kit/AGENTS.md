# Making a web game multiplayer: instructions for coding agents

You are adding online multiplayer to an existing browser game with the Joinable
SDK. The SDK and its hosted relay handle connections, rooms, invite links, host election,
reconnects and late joiners. **Never write server code, WebSocket code or a lobby screen.**
Your job is to choose the right pattern below and connect the game's real state and inputs.

`KEY` below is the project's public key (`pk_…`). The SDK is `https://relay.getjoinable.com/sdk.js`.
**No key is needed while the game runs on a local site** (localhost, `127.0.0.1`, `*.local`,
`*.test`, `*.localhost`): leave `data-key` out, or keep the placeholder, and it just works, free
and never counted, in rooms of up to 4 players (the free plan's size). To test a bigger game
locally, use the key of a game on a paid plan: its rooms are the plan's size everywhere. A real site needs the project's key in `data-key="KEY"`: the owner's prompt
may give it, and owners get one free at https://getjoinable.com/app?ref=kit. Tell the owner to
get one before the game goes live. With a key the relay doesn't know, or on a site the key
doesn't allow, the dock says why ("Offline: unknown key", for example) and the game stays
single-player. Branch previews of a Cloudflare Pages project on the game's list work with its
key too. Use exactly this address: never a `*.workers.dev` one, which some countries' networks
block.

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
| RTS, strategy, tower defence, auto-battlers, or any game with too much state to send (hundreds of units) | **Lockstep** (below), if the simulation can be made deterministic |
| Fighting games, competitive shooters | Stop and tell the owner: these need rollback or a cloud host, which aren't built yet |

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

  // optional: each player picks their own in the waiting room (car, character, team, colour).
  // image: a path on your site, an https address (or http on localhost while developing); or color: '#hex'.
  // Up to 4 options, 24 choices. avatar: true makes the picked image the player's picture (a driver).
  playerOptions: {
    car: { label: 'Car', choices: [{ id: 'red', label: 'Red Rocket', image: '/cars/red.png' }, { id: 'gold', label: 'Gold', image: '/cars/gold.png' }] },
  },
  unlocked: (option, id) => id !== 'gold' || save.goldUnlocked, // optional: locked choices show a padlock
  me: { name: profile.name, avatar: profile.avatarUrl },         // the player's name and picture from YOUR game
  // Joinable's screens follow the game's look by default (read from its CSS); set this to be
  // exact, from the game's own CSS variables or colours (see "Match the game's look")
  theme: { accent: 'var(--game-accent)', panel: 'var(--game-surface)', text: 'var(--game-ink)', font: 'var(--game-font)' },
  // optional: show the results yourself (your own podium); Joinable then shows only a small
  // Rematch / Change / Leave bar (resultsBar: false hides it: use Joinable.rematch(), .toLobby(), .leave())
  onResults(results, { round, me, players }) { … },

  // Start a round. Same call on every player: same seed, same options. Reset everything.
  // Put the player on the grid / at the start, but don't let them move until go().
  // players: [{ id, name, color, avatar, picks: { car: 'red' } }, …]: draw each with their picks,
  // and tint them with `color` (each player in the room has a different one).
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

**Give players their own names and picks.** If the game knows who the player is (a profile, a
save, a login), pass it as `me: { name, avatar }` or call `Joinable.setMe({ name, avatar })` when
it changes. Otherwise players get a made-up name, and the waiting room asks them to set their own.
Whatever they type there is kept on their device and wins over the game's. Anything a player
should choose for themselves (their car, character) goes in `playerOptions`; sides go in `teams`
(see "Team games and AI seats"). Each player
picks on their own card in the waiting room, and the round's `players[i].picks` and `remote()`'s
`p.picks` say what everyone chose. Picks are a look or a loadout the game applies; if a choice
would be unfair (a faster car), balance it in the game. `unlocked` only greys a choice out on
this player's screen. A player who doesn't pick gets the option's `default`, or else its first
choice. With `default: null`, `picks` leaves that option out until the player chooses, so the
game can pick for them (at random from the round's seed, say).

**Round length:** a round ends after 15 minutes (lockstep: 2 hours), and players who haven't
finished count as not finished. Set `maxMinutes` (1 to 240) in `Joinable.game` for longer or
shorter rounds.

**The address bar:** when a player goes online, Joinable adds `?join=<room>` to the page's
address, so the address bar is the invite link. Everything else in the address stays as it was.
If the game clears its own query after reading it (deep links, say), leave `join` in place:
it's how a reload or a copied address gets back into the room.

**Use the game's own randomness from `seed`.** Every `Math.random()` that changes the course,
the level or the spawns must come from a seeded generator, so all players get the same game.
Cosmetic randomness (particles, sparks) can stay `Math.random()`.

**Match the game's look (required).** Players must see the game's own colours and fonts in
Joinable's dock, waiting room, countdown and results, never Joinable's purple or another game's
look. Joinable reads the look from the page on its own: an explicit `theme`, else the Etheria
realm kit's `--er-*` tokens, else the page's CSS variables (names with accent, primary, brand,
surface, panel, ink, text, font), else its buttons, body and headings. It checks contrast and
keeps the accent for the one main action. Your job:
1. Find the game's palette and fonts in its own CSS (variables on `:root`, its menu's buttons
   and panels, its title font).
2. Pass them as `theme` in `Joinable.game`, by value or as `var(--…)`, so nothing is left to
   guessing. Every profile takes `theme`, lockstep included. `var(--…)` only works for variables
   set on `:root`: Joinable's screens sit outside the game's containers, so a variable set on
   `#shell` or `.app` doesn't reach them. Pass those as values.

   | `theme` key | What | Example |
   |---|---|---|
   | `accent` | the main action (Ready, Start, Rematch), highlights | `'var(--fs-amber)'` |
   | `accentText` | text on the accent (default: black or white, whichever reads) | `'#111'` |
   | `panel` | the sheet's colour | `'var(--fs-plate)'` |
   | `background` | an image or texture behind the sheet (https or a path on the site) | `'/ui/panel.png'` |
   | `text`, `muted` | text, and quieter text | `'var(--fs-paper)'` |
   | `font`, `titleFont` | fonts the page already loads | `"'Inter', sans-serif"` |
   | `titleCase` | `'uppercase'` if the game's titles are | `'uppercase'` |
   | `radius`, `buttonRadius` | corners in px; `0` is square. Cards and tiles never round more than `radius`, and chips follow `buttonRadius` | `0` |
   | `auto` | `false`: don't read the page at all | |

3. **Show it:** open the waiting room (Play online, Invite), take a screenshot next to the
   game's own menu, and show the owner. The self-test also saves one and says where the colours
   came from; "Joinable's defaults" means the game's look wasn't found: set `theme`.

Not themeable yet: sounds (Joinable plays none). `onResults` replaces the results screen with
the game's own.

**Give players a way in.** The dock's button says "Play online". If the game has a menu, add a
button there that calls `Joinable.open()`.
**A game with its own menus and HUD on every screen** (briefings, panels, phone controls): set
`data-ui="off"` and put Play online in the game's own menu. `data-avoid` suits one or two corner
bars. It can't know every button on every screen, and the dock may cover one it doesn't name.

**Hiding the online button:** if the game's CSS resets buttons with `all: unset` (or sets
`display`), the `hidden` attribute stops working: add `button[hidden] { display: none }`.
**Don't start the game on `window.onload`:** an async script that never answers delays the
`load` event too. Start on `DOMContentLoaded` or straight away.

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
installed, run `npx playwright-core install chromium` first. Each run sends Joinable an anonymous usage ping
(command, pass or fail, version; nothing about the game or the machine); set
`JOINABLE_TELEMETRY=0` to turn it off.

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

## Lockstep: strategy and RTS games

Only players' **orders** travel; every device runs the **same simulation** from the same seed,
one fixed tick at a time. Joinable carries the orders, drives the ticks, keeps every device in
step and checks every second that the simulations still agree. Assets and state never travel,
so a heavy game is fine.

**Does the game fit?** Check all five before starting. If one fails, tell the owner what
would have to change; don't force it.
1. **The simulation can run without the screen.** Game logic (units, economy, combat) is
   separate from drawing, or can be separated.
2. **Every random number comes from one seeded generator**, never `Math.random()` (cosmetic
   effects that don't change the simulation may use it).
3. **The simulation never reads the clock**: no `Date.now()`, `performance.now()` or frame
   delta. It advances in whole fixed ticks.
4. **Player actions can become data** ("these units: move to x, y"), applied in one place.
5. **Iteration order is fixed**: arrays, or sorted ids. Not object keys of numbers, and not
   Sets or Maps filled in network order.

**The script tag** is the same as for full rounds: async, with `data-connect="invite"`, and
the setup queued through `JoinableQ` (see "Full rounds"). A finished example to read:
`https://relay.getjoinable.com/demo/rts/` (Tiny Front; its `online.js` marks every Joinable line).

**What the game provides:**

```js
(window.JoinableQ = window.JoinableQ || []).push((Joinable) => {
  Joinable.game({
    profile: 'lockstep',
    name: 'Tiny Front',
    build: 'tiny-front-1',        // bump whenever the simulation changes: other builds never share a battle
    players: { min: 2, max: 2 },
    tick: 50,                     // ms per simulation step (20 a second)
    inputDelay: 300,              // optional: ms from an order to the tick it runs on (default 300; the room raises it for far-away players)
    maxMinutes: 120,              // optional: the longest battle (default 120, up to 240)
    options: { map: { label: 'Map', choices: ['Plains', 'Canyon'] } },             // the host's settings
    playerOptions: { faction: { label: 'Faction', choices: [{ id: 'red', label: 'Red' }] } }, // each player's
    start({ seed, options, players, me }) {
      // Build the battle from `seed`: the same on every device. players[i].id in seat order.
    },
    step(commands, { tick, away, ai }) {
      // commands: [{ player, cmd }, …], in the same order on every device. Apply them, then run
      // exactly ONE tick of the simulation. `ai`: players the game's own AI should play from now
      // on (they left for good); `away`: players whose orders aren't arriving for now.
    },
    hash() { return fingerprint(); },  // one number from ids, positions, health, money… after the tick
    testCommand(rng) { return randomValidOrderForMe(rng); }, // for the self-test: orders to try
    stop() { /* back to the menu */ },
  });
});

// The UI no longer applies orders itself. It sends them; they run on every device in step().
// From start() on (during the 3-2-1 too): orders given before the first step() go out with the first turn.
Joinable.command({ t: 'move', ids: [12, 14], x: 340, y: 220 });
// When the battle ends (every device sees it on the same tick):
window.Joinable?.finish({ place: iWon ? 1 : 2 });
```

**What the values are:**
- In `start({ seed, options, players, me })`: `players` is `[{ id, name, color, avatar, picks }]`
  in seat order (the same order on every device); `me` is this player's `id` (a string);
  `seed` is a 32-bit integer.
- In `step(commands, info)`: each command is `{ player, cmd }`, where `player` is a player's `id`
  (as in `players`) and `cmd` is exactly what that player passed to `Joinable.command()`.
  `info.tick` counts from 0; `info.away` and `info.ai` are arrays of player ids.
- `testCommand(rng)`: `rng()` returns a float in [0, 1), seeded per call; return one order
  (or `null` for none).
- `finish({ place })`: 1 for the winner, 2 for second… A draw: everyone who drew gives the
  same place (both `1`).
- `start()` means an online battle begins (it comes during the 3-2-1, ticks start at "go");
  `stop()` means it's over for this player. Between the two, the game is online.

**Change the game like this:**
- **Online, Joinable drives the clock.** Stop the game's own simulation loop (keep drawing on
  `requestAnimationFrame`); `step()` is the only place the simulation advances.
- **Every player action becomes a command**: unit orders, building, the build queue,
  upgrades, powers. Refer to units by id, not by object.
- **Acknowledge clicks at once** (a marker, a sound), as RTS games do: the order itself runs
  about 0.3 s later on every device.
- **No pause or speed-up online**, and don't pause when the tab is hidden: Joinable keeps hidden
  tabs in step.
- **Fog of war**: each device draws only what its own player's units see, from the shared
  simulation.

**What Joinable does:** the waiting room (host settings, each player's picks), seed and start,
waiting for late orders ("Waiting for Sam…"), drops (after 3 s the battle carries on and their
units keep their last orders; back within a minute, their device catches up from the room's log;
after a minute `step()` lists them in `ai` and the game's AI plays them), one result and rematch.
Players on different `build`s never meet.

**Timing:** from Start to the first `step()` is about 4 s: 1 s for the start to reach every
device, then the 3-2-1 (or your own `countdown`, in seconds, instead). `start()` runs on every
device at the beginning of that, so keep it quick: a slow `start()` holds up the first tick.

**Your own end screen:** pass `onResults(results, round)` to `Joinable.game` (as for full
rounds) and Joinable shows only a small Rematch / Change / Leave bar over the game's own
Victory / Defeat card, or nothing with `resultsBar: false`. **Your own Start button:** the host
can call `Joinable.start()` from the waiting room (it returns false for anyone else).

**Out of sync.** If the fingerprints ever differ, the battle stops on every device ("This
battle went out of sync. It won't count.") and the room keeps a **desync report**: the first tick
whose fingerprints differ, each device's browser and build, and the orders around it. Fetch it
with the MCP tool `joinable_desyncs` (the game's key, or `origin` for keyless local play), or
`GET https://relay.getjoinable.com/v1/desyncs?key=pk_…` (on the relay the game's script loads
from).

**Test it by hand:** two browser windows side by side, both on the local URL. Press Play online
in one, Invite, and open the link in the other; Ready in the second, Start in the first. After
the 3-2-1, give orders in each window: both battles must show them, and stay the same.

### Team games and AI seats

Joinable runs the sides for any profile, lockstep included. AI seats are for lockstep games,
where every device runs the same simulation. The waiting room shows them as
columns, and players join one. The host can **Balance** or **Shuffle** them, and the results
name the winning side.

```js
Joinable.game({
  profile: 'lockstep', players: { min: 2, max: 8 },
  teams: [{ name: 'Allies', color: '#3366ff' }, { name: 'Axis', color: '#ff3333' }], // or teams: 2
  bots: true, // the game has its own AI: the host can fill empty seats with it
  start(round) {
    // round.players[i].team: 0, 1… (round.teams[i] has the name and colour)
    // round.players[i].bot: true for a seat the game's AI plays. Play it the same way on every
    // device (from round.seed and the tick); Joinable never hears from it
  },
  // …step, hash
});
// When the battle ends, each device reports its own player: the winning side's players take place 1
Joinable.finish({ place: myTeam === winner ? 1 : 2 });
```

- `teams`: `2` to `4` sides, or a list of `{ name, color }`, or `{ count, size, names, colors }`.
  `size` is how many play on each side; it defaults to max ÷ sides, so 8 players make 4 against 4.
  Newcomers join the smaller side.
- From code: `Joinable.team(side)`, and for the host `Joinable.teams('balance' | 'shuffle')` and
  `Joinable.fill(true)`.
- **AI seats** (`bots: true`, lockstep only): with **Fill empty seats with AI** on, the round has every seat
  filled, up to `size` on each side, or up to `players.max` without teams. They're in
  `round.players` with `bot: true` and names like "AI 1". The round ends when the people have
  finished; AI players never call `finish`.
- **Room sizes:** a game's rooms are its plan's size, on live sites and while testing locally:
  4 on Sandbox (and with no key), 8 on Starter and Pro, and 16 on Studio. The next player gets
  "This room is full". So a 4-against-4 game tested on a free key or with no key fills at 4:
  test two against two, and use **Fill empty seats with AI** for the rest.
  AI seats don't count as players. Lockstep has been tested at 8: the room sets the input delay
  from the two slowest players' pings (400 ms with one player 500 ms away). It carries about 90
  messages a second at 8 players.

**Then the self-test** (getjoinable **0.2.2 or later** for the lockstep checks; `npx
getjoinable@latest test …` makes sure): `npx getjoinable test <local URL>` plays the battle on Chromium and WebKit
(Safari's engine) with random orders from `testCommand`, compares the fingerprints tick by tick,
and names what isn't deterministic: `Math.random()` or clock calls inside `step()` (with the
file and line), or maths that differs between browsers. It needs WebKit once:
`npx playwright-core install webkit`.

**Can't run `npx`?** (Some agents' permissions don't allow it.) Open the game with
`?joinable-check` added to its URL, in two windows; play online. A panel shows the same checks:
the round starting, ticks run, fingerprint checks passed, any `Math.random()` or clock call
inside `step()` with where, and where the screens' look came from. **Copy report** gives the
owner text to paste back to their agent. It works for full rounds too.

**By engine:**
- **Plain canvas or DOM:** the usual case: split the update function into `step()` and keep
  drawing as it is.
- **Phaser:** run the simulation outside Phaser's `update()` (Joinable calls `step()`); keep
  scenes for drawing. Don't use Arcade physics for the simulation online: its timing follows the
  frame rate.
- **Three.js, Babylon.js, PixiJS:** the renderer only draws; keep game objects' logic in plain
  data that `step()` updates.
- **Physics engines (Matter, Cannon, Rapier, Box2D):** only deterministic if stepped with a fixed
  delta and the same build on every device; Rapier has a cross-platform deterministic build.
  Floats may still differ between browsers: check with the self-test.
- **Unity, Godot web exports:** the same rules apply inside the engine; Joinable's script calls
  into the export from the page.

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

Lockstep: `Joinable.game({ profile: 'lockstep', tick, inputDelay, build, start, step, hash, testCommand })`, `Joinable.command(order)`, `Joinable.finish({ place })`. Teams (any profile) and AI seats (lockstep): `teams`, `bots` in `Joinable.game`, `Joinable.team(side)`, `Joinable.teams('balance' | 'shuffle')`, `Joinable.fill(on)`. Reports: MCP `joinable_desyncs`, `GET /v1/desyncs?key=`.

Full rounds: `Joinable.game(def)` (with optional `playerOptions`, `unlocked(option, id)`, `me: { name, avatar }`, `theme` (see "Match the game's look"), `onResults(results, round)` and `resultsBar`), `Joinable.setMe({ name, avatar })`, `Joinable.rematch()`, `Joinable.toLobby()`, `Joinable.finish({ time | score })`, `Joinable.quit()` (leave a
round from your pause menu), `Joinable.open()` (the play-online sheet), `Joinable.quickMatch()`,
`Joinable.ready(true|false)`, `Joinable.leave()`, `Joinable.online()` (→ `{ players, rooms }`),
`Joinable.now()` (the room's clock, ms), `Joinable.remote()` (the same list `remote()` gets),
`Joinable.session` (the room's session state: `phase`, `round`, `options`, `results`…). Events:
`'session'`, `'round'`, `'results'`. Profiles `arena`, `coop` and `turns` are planned: Joinable
accepts them but doesn't carry their state yet. (`lockstep` is built: see "Lockstep".)

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
default the page path), `data-ui="off"` (hide the dock, e.g. to build your own; the waiting room, countdown and results
still show), `data-ui="none"` (hide every Joinable screen: then the game draws its own and calls
`Joinable.open()`, `ready()`, `start()` and so on), `data-name`,
`data-connect="invite"` (stay offline until the player invites someone or opens an invite
link; use it on sites where most visits are solo), `data-position` (dock corner: `top-right`
by default, `top-left`, `bottom-right`, `bottom-left`), `data-cursors="off"` (no live cursors of the other players; they're already off for games
with full rounds), `data-avoid` (a CSS selector for the
game's own corner buttons, top bars and side bars; the dock moves below them when they overlap,
or sideways past a bar that runs down the side. Buttons placed outside their bar's own box
count too. If the dock still covers something, add that element to the selector, e.g.
`data-avoid=".realm-bar, #pause"`) and `data-inset` (`"12"` or `"12 70"`: px
from the side, then from the top or bottom edge). If the dock covers the game's own buttons,
move it with these rather than changing the game's layout.

## Testing (do this, don't skip it)

(This section is for Pattern A and B. Full rounds and lockstep have their own checks above,
and with `data-connect="invite"` nothing connects until the player presses Play online.)

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
