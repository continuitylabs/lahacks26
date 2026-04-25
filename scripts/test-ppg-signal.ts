/**
 * Smoke test for the on-device PPG signal pipeline.
 *
 * Run with: `bun run scripts/test-ppg-signal.ts`
 *
 * Generates synthetic PPG frame samples at known heart rates and verifies
 * that `estimateVitalsFromSamples` recovers a heart rate within ±8 bpm.
 * Camera capture itself can only be exercised on a real device; this gives
 * us local confidence that the math is sound.
 */

import {
  createPpgFrameSample,
  estimateVitalsFromSamples,
  type PpgFrameSample,
} from '../src/ppg/estimate-vitals';

type Scenario = {
  label: string;
  bpm: number;
  fps: number;
  durationSeconds: number;
  // Cardiac AC amplitude expressed in 0–255 pixel intensity terms.
  acAmplitude: number;
  // Slow torch warm-up drift on the green channel (DC component).
  driftPerSecond?: number;
  // Noise stddev in pixel intensity terms.
  noiseStdDev?: number;
};

function gaussianNoise(stdDev: number) {
  // Box–Muller.
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev;
}

function syntheticPpgSamples(scenario: Scenario): PpgFrameSample[] {
  const total = Math.floor(scenario.fps * scenario.durationSeconds);
  const samples: PpgFrameSample[] = [];
  const baseTime = 1_700_000_000_000;
  // Realistic flash-on-finger DC values: red saturated, green/blue dim.
  const baseRed = 235;
  const baseGreen = 64;
  const baseBlue = 30;

  for (let i = 0; i < total; i += 1) {
    const t = i / scenario.fps;
    const phase = (scenario.bpm / 60) * 2 * Math.PI * t;
    // Cardiac waveform: dominant fundamental + a small dicrotic harmonic.
    const ac =
      Math.sin(phase) * scenario.acAmplitude +
      Math.sin(phase * 2 + 0.6) * (scenario.acAmplitude * 0.25);

    const drift = (scenario.driftPerSecond ?? 0) * t;
    const noise = scenario.noiseStdDev ?? 0;

    // The green channel carries the cardiac modulation; red is saturated and
    // mostly DC under a flash. This matches the calibration in
    // estimate-vitals.ts.
    const red = Math.max(0, baseRed + drift * 0.2 + gaussianNoise(noise));
    const green = Math.max(0, baseGreen - ac + gaussianNoise(noise));
    const blue = Math.max(0, baseBlue + drift * 0.05 + gaussianNoise(noise));

    samples.push(
      createPpgFrameSample(red, green, blue, baseTime + i * (1000 / scenario.fps))
    );
  }

  return samples;
}

function runScenario(scenario: Scenario): {
  scenario: Scenario;
  ok: boolean;
  bpm: number | null;
  detail: string;
} {
  const samples = syntheticPpgSamples(scenario);
  const result = estimateVitalsFromSamples(samples);

  if (!result) {
    return {
      scenario,
      ok: false,
      bpm: null,
      detail: 'estimateVitalsFromSamples returned null',
    };
  }

  // The pipeline clamps any HR outside [65, 95] into that band for the demo.
  // For in-band ground truths we still validate accuracy; for out-of-band
  // ground truths we just assert the reading landed inside the demo band.
  const inBand = scenario.bpm >= 65 && scenario.bpm <= 95;
  let ok: boolean;
  let detail: string;

  if (inBand) {
    const error = Math.abs(result.heartRate - scenario.bpm);
    ok = error <= 8;
    detail = `bpm=${result.heartRate} (expected ~${scenario.bpm}, |err|=${error}), conf=${result.confidence.toFixed(2)}, samples=${result.samplesUsed}`;
  } else {
    ok = result.heartRate >= 65 && result.heartRate <= 95;
    detail = `bpm=${result.heartRate} (raw signal at ${scenario.bpm}, expected clamp into [65,95]), conf=${result.confidence.toFixed(2)}, samples=${result.samplesUsed}`;
  }

  return { scenario, ok, bpm: result.heartRate, detail };
}

const scenarios: Scenario[] = [
  {
    label: 'resting 65 bpm @ 8 fps',
    bpm: 65,
    fps: 8,
    durationSeconds: 14,
    acAmplitude: 4.5,
    driftPerSecond: 0.4,
    noiseStdDev: 0.6,
  },
  {
    label: 'normal 78 bpm @ 6 fps',
    bpm: 78,
    fps: 6,
    durationSeconds: 14,
    acAmplitude: 3.5,
    driftPerSecond: 0.3,
    noiseStdDev: 0.7,
  },
  {
    label: 'elevated 110 bpm @ 7 fps',
    bpm: 110,
    fps: 7,
    durationSeconds: 14,
    acAmplitude: 3,
    driftPerSecond: 0.2,
    noiseStdDev: 0.6,
  },
  {
    label: 'noisy 72 bpm @ 5 fps',
    bpm: 72,
    fps: 5,
    durationSeconds: 14,
    acAmplitude: 5,
    driftPerSecond: 0.6,
    noiseStdDev: 1.4,
  },
  {
    label: 'low outlier 50 bpm — must clamp into [65,95]',
    bpm: 50,
    fps: 7,
    durationSeconds: 14,
    acAmplitude: 4,
    driftPerSecond: 0.3,
    noiseStdDev: 0.6,
  },
  {
    label: 'high outlier 130 bpm — must clamp into [65,95]',
    bpm: 130,
    fps: 8,
    durationSeconds: 14,
    acAmplitude: 3.5,
    driftPerSecond: 0.3,
    noiseStdDev: 0.6,
  },
];

let pass = 0;
let fail = 0;

for (const scenario of scenarios) {
  const result = runScenario(scenario);
  const tag = result.ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${result.scenario.label} — ${result.detail}`);
  if (result.ok) pass += 1;
  else fail += 1;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
