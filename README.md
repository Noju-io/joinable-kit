# Joinable

**Make any game joinable.** One line. Everyone's in.

Joinable makes any web game multiplayer. Add one script tag and your game gets invite links,
quick match with strangers, a waiting room, a synced countdown, live standings, results and
rematch. Joinable's hosted relay does the networking: you run no servers.

[Website](https://getjoinable.com) · [Get a free key](https://getjoinable.com/app?ref=github) · [For coding agents](https://getjoinable.com/AGENTS.md) · [llms.txt](https://getjoinable.com/llms.txt)

```diff
   <script src="game.js"></script>
+  <script src="https://relay.getjoinable.com/sdk.js" data-key="pk_…" data-sync="game"></script>
```

That one line made Bubble Pop, a single-player canvas game, multiplayer: compare
[`examples/bubbles/single.html`](examples/bubbles/single.html) with
[`examples/bubbles/index.html`](examples/bubbles/index.html), or play it at
https://relay.getjoinable.com/demo/bubbles/.

## Let your coding agent do it

With MCP (Claude Code shown; Cursor, VS Code and others take the same command):

```bash
claude mcp add joinable -- npx -y getjoinable mcp
```

Then ask: *"Make this game multiplayer with Joinable."* The agent reads the kit, picks the
pattern for your game's genre, wires it, and runs the self-test.

No MCP? Paste the prompt from https://getjoinable.com/prompt into any coding agent.

## Check it works

```bash
npx getjoinable test http://localhost:5173/
```

Two headless players open your game and check the whole round: same seed on both, players see
each other, one result, rematch. Every failure says what to fix.

## Which games it fits

| Your game | Joinable gives you |
|---|---|
| Racer, time trial, runner | Full rounds (`race`): live cars that bump, podium, rematch |
| Anything with a score or a time | Full rounds (`score`): same seeded round, live scores, results |
| Board, card, puzzle, clicker, builder, drawing | A shared world, often with one attribute |
| Platformer, top-down, party game | One avatar per player in a shared world |
| Turn-based | Shared world plus turns |
| RTS and strategy | Lockstep (`lockstep`): only orders travel, every device runs the same simulation, and the self-test checks it stays deterministic |
| Fighting game, competitive shooter | **Not yet.** These need rollback or a trusted server, which aren't built |

## Where it stops working

- **Cheating.** One player's device runs shared worlds, and players report their own scores.
  Fine for friends and casual leaderboards, not for ranked play with prizes.
- **Twitch timing.** Other players are predicted between updates, 20 a second. Right for racing
  and party games, wrong for a 1v1 fighting game.
- **Huge worlds.** Thousands of moving units need lockstep, and lockstep needs a simulation that
  gives the same result on every device: no `Math.random()` or clock in it. The self-test checks.
- **Native builds.** Joinable runs in a browser page.

The full list, per pattern, is in [kit/AGENTS.md](kit/AGENTS.md).

## What's in this repo

| Folder | What |
|---|---|
| `kit/` | The agent kit: what a coding agent reads to wire a game (also at https://getjoinable.com/AGENTS.md) |
| `mcp/` | The MCP server (`npx -y getjoinable mcp`) |
| `bin/getjoinable.mjs` | The self-test (`npx getjoinable test URL`) |
| `examples/` | Kart Loop (full rounds, bumping karts), Bubble Pop (one-line sync, and a score attack), Star Catcher (avatars). Play them live at https://relay.getjoinable.com/demo/racer/ |

The SDK itself is the hosted script, https://relay.getjoinable.com/sdk.js, and the relay runs as
a service. This repo is published from Joinable's main repository on each release, so pull
requests are applied there and come back here with the next release.

## Run the examples locally

No key needed: on localhost the examples connect as they are, free and never counted. To put
a game on a real site, get a free key at https://getjoinable.com/app?ref=github and put it in
place of `pk_…`.

```bash
npm run examples
```

Then open http://localhost:5173/examples/bubbles/ in two windows side by side.

```bash
npm test
```

runs the MCP server's tests.

## Pricing

Free to build: unlimited on localhost, previews and dev sites. Paid plans to launch on your own
domain, billed by player-hour (beta prices): https://getjoinable.com/#pricing

## Found a bug?

Open an issue here. For anything security-related, email hello@getjoinable.com instead; see
[SECURITY.md](SECURITY.md).

MIT licence · made by [NOJU](https://noju.io)
