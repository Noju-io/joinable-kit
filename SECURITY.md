# Reporting a bug or a security problem

Thank you for looking closely. Reports from people who use Joinable are how it gets better.

## Where to report

- **Security problems** (anything that could let someone read, change or abuse another
  person's game, room, account or key; anything that could run code on someone's machine):
  email **hello@getjoinable.com** with "Security" in the subject. Please don't open a public issue for these.
- **Everything else** (a bug in the MCP server, the self-test, the kit or an example):
  open an issue in this repo, with the self-test's output if you have it.

Useful in a report: what you ran, what you expected, what happened, and the version
(`npm ls getjoinable`, or `version` in the package's `package.json`).

## What happens next

- We reply within **three working days** to say we've got it.
- We tell you what we found and what we'll do, and we fix confirmed security problems before
  talking about them publicly.
- When the fix ships, it's in the npm package's changelog
  ([getjoinable on npm](https://www.npmjs.com/package/getjoinable)). With your permission, we
  thank you there by name.

## What's in scope

This repo (the agent kit, the MCP server, the self-test and the examples), the `getjoinable`
npm package, the hosted SDK at `relay.getjoinable.com/sdk.js`, the relay, and
getjoinable.com.

Public project keys (`pk_…`) aren't secrets: they appear in every game's page, and the list of
sites allowed to use each key is what protects it. A key showing up in a page is not a bug; a
key working on a site it doesn't allow is.

Please don't test against other people's games or rooms, and don't run load tests against the
relay. Local sites (localhost) need no key, so you can test everything on your own machine.
