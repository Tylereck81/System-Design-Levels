// js/engine/chat.js: connections, delivery, delay, memory and presence load, worked out by hand.
// Constants: 2,000,000 online, 10 KB a connection, 800,000 connections and 20,000 msgs/s (WS) or 50,000 req/s a server.
import { test } from 'node:test';
import { chatOutcome } from '../../js/engine/chat.js';
import { fields } from './near.mjs';

const cfg = (o) => ({ protocol: 'ws', servers: 3, discovery: true, heartbeat: true, push: true, ...o });
// Presence with no tunnel: 2,000,000 / (30 × 60) × 2 = 2,222.2 changes/s, × 100 friends = 222,222.2.
const BASE_PRESENCE = 2e6 / 1800 * 2 * 100;

test('WebSocket within capacity: everyone connected, every message delivered', () => {
  // 3 × 800,000 = 2,400,000 ≥ 2,000,000 connected; 30,000 msgs ≤ 3 × 20,000. Memory 2,000,000 / 3 × 10 KB = 6.667 GB.
  // Heartbeat adds 2,000,000 / 5 = 400,000 events/s.
  fields(chatOutcome(cfg(), { msgs: 30000 }), {
    served: 1, delay: 0.1, memoryGB: 2e6 / 3 * 10 / 1e6, notified: 1, offline: 0.3,
    presenceLoad: BASE_PRESENCE + 400000, flips: 0,
  });
});

test('WebSocket short of connections and CPU: both shares multiply', () => {
  // 2 servers hold 1,600,000 of 2,000,000 → 0.8; 50,000 msgs on 40,000 capacity → 0.8; 0.8 × 0.8 = 0.64.
  // Memory 1,600,000 / 2 × 10 KB = 8 GB.
  fields(chatOutcome(cfg({ servers: 2 }), { msgs: 50000 }), { served: 0.64, memoryGB: 8 });
});

test('polling: no held connections, but every user asks every 5 s', () => {
  // Requests 10,000 + 2,000,000 / 5 = 410,000 on 2 × 50,000 = 100,000 → 100,000 / 410,000. Delay 5 / 2 = 2.5 s.
  fields(chatOutcome(cfg({ protocol: 'poll', servers: 2 }), { msgs: 10000 }), { served: 100000 / 410000, delay: 2.5, memoryGB: 0 });
});

test('long polling: a message waits for the open poll on most servers', () => {
  // Requests 10,000 + 2,000,000 / 30 = 76,666.7 ≤ 150,000 → served 1. Delay (0.1 + 2 × 30 / 2) / 3 = 10.033 s.
  fields(chatOutcome(cfg({ protocol: 'long', servers: 3 }), { msgs: 10000 }), { served: 1, delay: 30.1 / 3 });
});

test('a server dies: its users are stranded without service discovery', () => {
  // 4 servers, 1 dies: 2,000,000 / 4 = 500,000 stranded; 1,500,000 connected of 2,000,000 → 0.75. No messages → CPU 1.
  // Memory 1,500,000 / 3 × 10 KB = 5 GB.
  fields(chatOutcome(cfg({ servers: 4, discovery: false }), { msgs: 0, dies: true }), { served: 0.75, memoryGB: 5 });
  // With discovery they reconnect: 3 × 800,000 = 2,400,000 ≥ 2,000,000.
  fields(chatOutcome(cfg({ servers: 4 }), { msgs: 0, dies: true }), { served: 1 });
});

test('the only server dies: nothing connected, long polling waits the full timeout', () => {
  fields(chatOutcome(cfg({ protocol: 'long', servers: 1 }), { msgs: 100, dies: true }), { served: 0, delay: 30, memoryGB: 0 });
});

test('a train through tunnels: flips and presence load without a heartbeat', () => {
  // Drops: 2,000,000 × 0.05 × 6 / 60 × 2 = 20,000 changes/s extra; (2,222.2 + 20,000) × 100. Flips 2 × 6 = 12 a minute.
  fields(chatOutcome(cfg({ heartbeat: false }), { msgs: 0, tunnel: true }), { presenceLoad: BASE_PRESENCE + 2e6, flips: 12 });
  // The heartbeat rides the drops out: base changes plus 400,000 heartbeats, no flips.
  fields(chatOutcome(cfg(), { msgs: 0, tunnel: true }), { presenceLoad: BASE_PRESENCE + 400000, flips: 0 });
});

test('night doubles offline recipients; without push none are told at once', () => {
  fields(chatOutcome(cfg({ push: false }), { msgs: 0, night: true }), { offline: 0.6, notified: 0 });
});
