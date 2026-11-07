// Tiny Front, online: the same game as solo.js, made multiplayer with Joinable's lockstep
// profile. Everything Joinable-specific is marked JOINABLE. The battle itself (sim.js) is
// untouched: it was already deterministic, with orders as data.
//   - The page no longer runs its own clock: Joinable calls step() 20 times a second, on every
//     device in step, with everyone's orders for that tick.
//   - The player's orders aren't applied here: they go to Joinable.command(), and come back to
//     every device in step(), a moment later.
//   - hash() lets Joinable check every second that both battles are still the same.
'use strict';

let battle = null;
let mySeat = 0;
let seats = []; // player ids in seat order: seat 0 is bottom-left
let solo = null; // the solo battle, until an online one starts

function playSolo() {
  battle = RTS.create(Math.floor(Math.random() * 2 ** 31), 2, [1]);
  mySeat = 0;
  View.show(battle, 0);
  View.note('Solo against the computer. Play online to battle a friend.');
  const queue = [];
  View.onOrder((cmd) => queue.push({ player: 0, cmd }));
  solo = setInterval(() => RTS.step(battle, queue.splice(0)), 50);
}
playSolo();
document.getElementById('again').addEventListener('click', () => {
  if (solo) {
    clearInterval(solo);
    playSolo();
  }
});

// ---------------------------------------------------------------- JOINABLE: the whole contract
(window.JoinableQ = window.JoinableQ || []).push((J) => {
  J.game({
    profile: 'lockstep',
    name: 'Tiny Front',
    build: 'tiny-front-1', // bump it when the simulation changes: old and new never share a battle
    players: { min: 2, max: 2 },
    public: true,
    tick: 50, // ms per simulation step, the same as solo
    start({ seed, players, me }) {
      clearInterval(solo);
      solo = null;
      seats = players.map((p) => p.id);
      mySeat = seats.indexOf(me);
      battle = RTS.create(seed, 2, []);
      View.show(battle, mySeat);
      View.note(mySeat === 0 ? 'You are red, bottom left.' : 'You are teal, top right.');
      View.onOrder((cmd) => J.command(cmd)); // JOINABLE: orders go through the room
    },
    step(commands, { ai }) {
      // Everyone's orders for this tick, in the same order on every device.
      for (const p of ai) battle.players[seats.indexOf(p)].ai = true; // a player gone for good: the computer plays them
      RTS.step(battle, commands.map((c) => ({ player: seats.indexOf(c.player), cmd: c.cmd })));
      if (battle.over && !battle.reported) {
        battle.reported = true;
        J.finish({ place: battle.winner === mySeat ? 1 : 2 });
      }
    },
    hash: () => RTS.hash(battle),
    // For the self-test's determinism check: a random order this player could give.
    testCommand(rng) {
      const mine = battle.units.filter((u) => u.owner === mySeat && u.type === 'tank');
      if (rng() < 0.3 || !mine.length) return { t: 'build' };
      return { t: 'move', ids: mine.map((u) => u.id), x: Math.floor(rng() * RTS.W), y: Math.floor(rng() * RTS.H) };
    },
    stop() {
      playSolo();
    },
  });
});
