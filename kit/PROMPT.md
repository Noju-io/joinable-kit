# The prompt a game owner gives their coding agent

Copy everything in the box into Claude Code, Cursor, Codex or any coding agent, from the
game's folder. It works as it is: no account and no key are needed while the game runs on your
machine. When the game goes on a real site, get a free key at https://getjoinable.com/app?ref=prompt.

```text
Make this web game multiplayer using Joinable. Read
https://getjoinable.com/AGENTS.md first and follow it exactly: it says how
to pick the right pattern for this game's genre, what to change, and how to test
with two browser tabs. Start with the smallest change that works (usually one
script tag), test it with two tabs, and only go further if the doc's checks fail
for this game. Don't write any server code: Joinable's hosted relay does all of
that. No key is needed on localhost. If the doc's self-test applies (full rounds),
run it with `npx getjoinable test <the game's local URL>` until it passes. When
you're done, tell me which pattern you used, what you changed, and anything that
doesn't sync.
```
