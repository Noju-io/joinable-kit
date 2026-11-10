---
name: make-web-game-multiplayer
description: Make a browser game multiplayer or online with Joinable. Use when the user asks to add multiplayer, online play, co-op, "play with friends", invites, a lobby, matchmaking or quick match, a waiting room, leaderboards for a round, or rematch to a web game (plain canvas, HTML5, JavaScript or TypeScript, Phaser, three.js, PixiJS, Babylon.js, Godot or Construct web exports), or asks how to do it without writing a server.
---

# Make a web game multiplayer with Joinable

Joinable is a hosted relay for games that run in a web browser. It runs the rooms and the whole
session around play: invites and quick match, a waiting room, a countdown everyone shares, live
standings, one results screen, rematch and reconnecting. The game keeps its own code; it gains a
script tag and four hooks. There is no server for the developer to write or host.

The tools come from this plugin's MCP servers:
- `joinable` (remote, https://getjoinable.com/mcp): `joinable_kit`, `joinable_choose_pattern`,
  `joinable_snippet`, `joinable_get_started`, `joinable_desyncs`.
- `joinable-selftest` (local, `npx getjoinable mcp`): the same tools plus `joinable_selftest`,
  which opens two headless players on the game's local page.

## Steps

1. **Read the game first.** Find its genre, its main loop, where its state lives, how a round
   starts and ends, and whether it has a score or a time.
2. **Pick the pattern** with `joinable_choose_pattern` (genre, plus whether there's a score or
   time, held-key avatars, or turns):
   - racing and score games → full rounds (`race`, `score`): Joinable runs the session;
   - strategy, RTS, tower defense → `lockstep`: only orders travel, every device simulates;
   - board, card, word, clicker, builder → Pattern A: one shared state object;
   - platformers and top-down games with avatars → Pattern B;
   - turn-based → Pattern C.
   If the tool says the genre isn't built yet, tell the user plainly instead of forcing another
   pattern.
3. **Read the kit section for that pattern**: `joinable_kit` with `section` (for example
   "Full rounds", "Lockstep", "Pattern A"). It is the source of truth for the API; use only what
   it documents.
4. **Get the code** with `joinable_snippet` and wire it in. Make the smallest change that works.
5. **Keep solo play working.** Load the script `async`, queue setup through
   `window.JoinableQ`, guard every call (`window.Joinable?.…`), and show the Online button only
   once Joinable has loaded. The game must still play alone when Joinable is blocked or slow.
6. **Test.** Serve the game locally (no key or account is needed on localhost, `*.test` or
   `*.local`) and run `joinable_selftest` with its local URL, or
   `npx -y getjoinable test http://localhost:PORT/`. Fix what it reports and run it again until
   it passes. Then open two browser tabs and play a round.
7. **Report** which pattern you used, what you changed, how you tested, and anything that
   doesn't sync.

## Going live

On a real site the game needs a public key. The owner signs in at https://getjoinable.com/app
with an email code, adds the game and its site, and puts the key in the tag as
`data-key="pk_…"`. Public keys aren't secrets: the list of allowed sites protects them. Plans
start free; `joinable_get_started` has the details. Don't sign up, create keys or choose a plan
for the user: give them the link.

## Lockstep games out of sync

If players' battles drift apart, `joinable_desyncs` (with the game's public key, or its local
origin when there's no key) returns the first tick that differed and the orders around it. The
usual causes are `Math.random`, `Date.now`, unordered iteration, or float maths that browsers
round differently.
