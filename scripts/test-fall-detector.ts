/**
 * Smoke test for the pure fall-detection helper.
 *
 * Run with: `bun run scripts/test-fall-detector.ts`
 *
 * The phone reports gravity as ~1g at rest, so resting samples should never
 * fire. A 3.5g spike should fire. A second spike inside the cooldown
 * window should NOT fire. After the cooldown expires, the next spike
 * should fire again.
 */

import {
  evaluateSample,
  magnitudeOf,
  type FallDetectionState,
} from '../src/fall-detection/detect-fall';

type Case = {
  label: string;
  sample: { x: number; y: number; z: number };
  nowMs: number;
  expectFire: boolean;
};

const THRESHOLD = 2.5;
const COOLDOWN_MS = 30_000;

const cases: Case[] = [
  { label: 'rest (gravity only)', sample: { x: 0, y: 0, z: 1 }, nowMs: 0, expectFire: false },
  { label: 'mild walking peak (~1.5g)', sample: { x: 0.7, y: 1.0, z: 0.7 }, nowMs: 100, expectFire: false },
  { label: 'impact spike (3.5g)', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 1_000, expectFire: true },
  { label: 'second spike inside cooldown', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 5_000, expectFire: false },
  { label: 'spike after cooldown elapses', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 35_000, expectFire: true },
];

const state: FallDetectionState = { cooldownUntilMs: 0 };
let pass = 0;
let fail = 0;

for (const c of cases) {
  const mag = magnitudeOf(c.sample);
  const result = evaluateSample(c.sample, c.nowMs, state, {
    thresholdG: THRESHOLD,
    cooldownMs: COOLDOWN_MS,
  });
  const ok = result.fire === c.expectFire;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${c.label}  |a|=${mag.toFixed(2)}g  fire=${result.fire}  expect=${c.expectFire}`);
  if (ok) pass++;
  else fail++;
  if (result.fire) state.cooldownUntilMs = c.nowMs + COOLDOWN_MS;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
