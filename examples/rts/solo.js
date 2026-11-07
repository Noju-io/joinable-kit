// Tiny Front, solo: you against the computer. The battle runs here, 20 ticks a second; your
// orders wait for the next tick. (online.js is the same game made multiplayer with Joinable.)
'use strict';

const TICK_MS = 50;
let battle = RTS.create(Math.floor(Math.random() * 2 ** 31), 2, [1]); // seat 1: the computer
let queue = [];

View.show(battle, 0);
View.onOrder((cmd) => queue.push({ player: 0, cmd }));
View.note('Drag to select tanks, right-click to send them. B builds a tank.');

setInterval(() => {
  RTS.step(battle, queue.splice(0));
}, TICK_MS);

document.getElementById('again').addEventListener('click', () => {
  battle = RTS.create(Math.floor(Math.random() * 2 ** 31), 2, [1]);
  queue = [];
  View.show(battle, 0);
});
