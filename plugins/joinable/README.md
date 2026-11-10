# Joinable for Claude

Make a web game multiplayer from one conversation. Ask Claude to "make this game multiplayer"
or "add online play", and it reads the game, picks the right pattern for its genre, wires
[Joinable](https://getjoinable.com)'s hosted rooms into it, and tests it with two headless
players until it passes.

Joinable is built for games that run in a web browser: plain canvas, HTML5, Phaser, three.js and
others. It runs the rooms and everything around play: invites and quick match, a waiting room, a
countdown everyone shares, live standings, results, rematch and reconnecting. There is no server
to write or host.

## What's inside

- **Skill `make-web-game-multiplayer`:** when to use Joinable and the steps from reading the game
  to a passing self-test.
- **MCP server `joinable` (remote):** `https://getjoinable.com/mcp`. Read-only tools: the agent
  kit (`joinable_kit`), choosing a pattern (`joinable_choose_pattern`), the exact snippet
  (`joinable_snippet`), getting started (`joinable_get_started`) and lockstep desync reports
  (`joinable_desyncs`). Works in Claude chat, Cowork and Claude Code.
- **MCP server `joinable-selftest` (local, Claude Code and Cowork on your computer):** runs
  `npx -y getjoinable@0.2.4 mcp`, the same tools plus `joinable_selftest`, which opens two
  headless Chromium players on your game's local page. It needs Node 20 or later, and the first
  run downloads the `getjoinable` package and its `playwright-core` dependency from npm.

## Use it

In Claude Code, from the game's folder:

```text
Make this game multiplayer with Joinable, and run the self-test until it passes.
```

No account and no key are needed while the game runs on localhost. When it goes live on a real
site, sign in at https://getjoinable.com/app, add the game and its site, and put its free public
key in the script tag. Plans start free: https://getjoinable.com/pricing.

## Data

- The remote server receives only the tool calls Claude makes: a genre, a pattern name, a public
  game key or a local origin. It reads Joinable's agent kit and, for `joinable_desyncs`, the
  game's desync reports. It stores nothing from the calls; it counts which tool was used and the
  kind of client.
- The local server fetches the kit from `relay.getjoinable.com`, and the self-test opens your
  local game page and connects two test players to Joinable's relay. It sends an anonymous usage
  ping (the command, the tool, pass or fail, the version): no game URL, files or personal data.
  Turn it off with `JOINABLE_TELEMETRY=0` or `DO_NOT_TRACK=1`.
- The game itself talks to Joinable's relay only once you add the script tag.

Privacy policy: https://getjoinable.com/privacy · Support: hello@getjoinable.com

## License

MIT. Joinable's hosted relay is a service with its own terms: https://getjoinable.com/terms
