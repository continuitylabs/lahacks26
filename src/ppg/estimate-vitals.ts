import * as jpeg from 'jpeg-js';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const standardDeviation = (values: number[]) => {
  const mean = average(values);
  return Math.sqrt(
    average(values.map((value) => (value - mean) ** 2))
  );
};

const movingAverage = (values: number[], radius: number) =>
  values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    return average(values.slice(start, end));
  });

export type PpgFrameSample = {
  capturedAt: number;
  red: number;
  green: number;
  blue: number;
  brightness: number;
  redRatio: number;
  coverage: number;
};

export type EstimatedVitals = {
  heartRate: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  perfusion: number;
  confidence: number;
  samplesUsed: number;
};

export function createPpgFrameSample(
  avgRed: number,
  avgGreen: number,
  avgBlue: number,
  capturedAt: number
): PpgFrameSample {
  const total = avgRed + avgGreen + avgBlue || 1;
  const redRatio = avgRed / total;
  const brightness = total / 3;

  const redDominance = clamp((avgRed - Math.max(avgGreen, avgBlue)) / 90, 0, 1);
  const warmth = clamp((avgRed / Math.max(avgGreen + avgBlue, 1) - 0.55) / 1.25, 0, 1);
  const brightnessBand = clamp((brightness - 28) / 125, 0, 1);
  const coverage = clamp(
    redDominance * 0.48 + warmth * 0.34 + brightnessBand * 0.18,
    0,
    1
  );

  return {
    capturedAt,
    red: avgRed,
    green: avgGreen,
    blue: avgBlue,
    brightness,
    redRatio,
    coverage,
  };
}

function decodeBase64(base64: string) {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is unavailable on this device.');
  }

  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function extractPpgFrameSample(
  base64: string,
  capturedAt: number
): PpgFrameSample {
  const bytes = decodeBase64(base64);
  const decoded = jpeg.decode(bytes, { useTArray: true });
  const centerX = Math.floor(decoded.width / 2);
  const centerY = Math.floor(decoded.height / 2);
  const centerIndex = (centerY * decoded.width + centerX) * 4;

  const red = decoded.data[centerIndex] ?? 0;
  const green = decoded.data[centerIndex + 1] ?? 0;
  const blue = decoded.data[centerIndex + 2] ?? 0;

  return createPpgFrameSample(
    red,
    green,
    blue,
    capturedAt
  );
}

function detectPeaks(signal: number[], timestamps: number[]) {
  const amplitude = signal.map((value) => Math.abs(value));
  const threshold = average(amplitude) + standardDeviation(amplitude) * 0.18;
  const peaks: number[] = [];

  for (let index = 1; index < signal.length - 1; index += 1) {
    const previous = signal[index - 1];
    const current = signal[index];
    const next = signal[index + 1];

    if (
      current > previous &&
      current >= next &&
      current > threshold &&
      (peaks.length === 0 || timestamps[index] - timestamps[peaks[peaks.length - 1]] > 380)
    ) {
      peaks.push(index);
    }
  }

  return peaks;
}

function derivePeakIntervals(timestamps: number[], peaks: number[]) {
  return peaks
    .slice(1)
    .map((peak, index) => timestamps[peak] - timestamps[peaks[index]])
    .filter((interval) => interval > 350 && interval < 1800);
}

export function estimateVitalsFromSamples(
  rawSamples: PpgFrameSample[]
): EstimatedVitals | null {
  const primarySamples = rawSamples.filter((sample) => sample.coverage >= 0.24);
  const samples =
    primarySamples.length >= 12
      ? primarySamples
      : rawSamples.filter((sample) => sample.coverage >= 0.12);

  if (samples.length < 10) {
    return null;
  }

  const timestamps = samples.map((sample) => sample.capturedAt);
  const redNormalized = samples.map(
    (sample) => sample.red / Math.max(sample.green + sample.blue, 1)
  );
  const redRatioSignal = movingAverage(samples.map((sample) => sample.redRatio), 2);
  const blended = redRatioSignal.map(
    (value, index) => value * 0.58 + redNormalized[index] * 0.42
  );
  const baseline = movingAverage(blended, 6);
  const detrended = blended.map((value, index) => value - baseline[index]);
  const peaks = detectPeaks(detrended, timestamps);
  let peakIntervals = derivePeakIntervals(timestamps, peaks);

  if (peakIntervals.length === 0) {
    const invertedPeaks = detectPeaks(detrended.map((value) => -value), timestamps);
    peakIntervals = derivePeakIntervals(timestamps, invertedPeaks);
  }

  const meanInterval =
    peakIntervals.length > 0 ? average(peakIntervals) : Math.max(500, 18000 / samples.length);
  const bpm = clamp(Math.round(60000 / meanInterval), 48, 160);

  const redAcDc = standardDeviation(samples.map((sample) => sample.red)) /
    Math.max(average(samples.map((sample) => sample.red)), 1);
  const greenAcDc = standardDeviation(samples.map((sample) => sample.green)) /
    Math.max(average(samples.map((sample) => sample.green)), 1);
  const ratio = redAcDc / Math.max(greenAcDc, 0.0001);

  const perfusion = clamp(average(samples.map((sample) => sample.coverage)), 0, 1);
  const spo2 = clamp(Math.round(98 - (ratio - 0.9) * 7), 88, 100);

  const intervalVariancePenalty = clamp(
    peakIntervals.length > 1 ? standardDeviation(peakIntervals) / 320 : 0.55,
    0,
    1
  );
  const systolic = clamp(
    Math.round(104 + perfusion * 22 + (bpm - 62) * 0.28 - intervalVariancePenalty * 8),
    94,
    148
  );
  const diastolic = clamp(
    Math.round(64 + perfusion * 14 + (bpm - 62) * 0.18 - intervalVariancePenalty * 6),
    56,
    96
  );

  const confidence = clamp(
    samples.length / 28 * 0.34 +
      perfusion * 0.36 +
      (1 - intervalVariancePenalty) * 0.22 +
      (peakIntervals.length > 0 ? 0.08 : 0),
    0,
    1
  );

  return {
    heartRate: bpm,
    spo2,
    systolic,
    diastolic,
    perfusion,
    confidence,
    samplesUsed: samples.length,
  };
}
