import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from 'react-native';

type LoadOptions = {
  personalKey: string;
  name: string;
};

type AcousticMonitoringOptions = {
  personalKey?: string;
  name?: string;
  version?: number;
  scoreThreshold?: number;
  amplitudeThreshold?: number;
};

type ZeticLlmModule = {
  loadModel(options: LoadOptions): Promise<null>;
  generate(prompt: string): Promise<string>;
  stop(): Promise<null>;
  startAcousticMonitoring(options: AcousticMonitoringOptions): Promise<null>;
  stopAcousticMonitoring(): Promise<null>;
};

const Native = NativeModules.ZeticLlm as ZeticLlmModule | undefined;

export const isZeticAvailable = Platform.OS === 'ios' && Native != null;

type EventEmitterArg = ConstructorParameters<typeof NativeEventEmitter>[0];

const emitter =
  isZeticAvailable && Native
    ? new NativeEventEmitter(Native as unknown as EventEmitterArg)
    : null;

export type ZeticEvent =
  | { type: 'download'; progress: number }
  | { type: 'token'; token: string; count: number }
  | { type: 'complete'; text: string; count: number }
  | { type: 'error'; message: string }
  | { type: 'yamnet-download'; progress: number }
  | {
      type: 'yamnet-inference';
      rms: number;
      predictions: {
        index: number;
        label: string;
        score: number;
      }[];
      triggeredLabel: string | null;
      triggeredScore: number | null;
      topLabel: string | null;
      topScore: number | null;
    }
  | {
      type: 'yamnet-detection';
      label: string;
      score: number;
      rms: number;
      topLabel: string;
      topScore: number;
    }
  | { type: 'yamnet-state'; state: 'listening' | 'stopped' }
  | { type: 'yamnet-error'; message: string };

export function subscribe(handler: (e: ZeticEvent) => void): () => void {
  if (!emitter) return () => {};
  const subs: EmitterSubscription[] = [
    emitter.addListener('zetic:download', (b: { progress: number }) =>
      handler({ type: 'download', progress: b.progress })
    ),
    emitter.addListener('zetic:token', (b: { token: string; count: number }) =>
      handler({ type: 'token', token: b.token, count: b.count })
    ),
    emitter.addListener('zetic:complete', (b: { text: string; count: number }) =>
      handler({ type: 'complete', text: b.text, count: b.count })
    ),
    emitter.addListener('zetic:error', (b: { message: string }) =>
      handler({ type: 'error', message: b.message })
    ),
    emitter.addListener('zetic:yamnet-download', (b: { progress: number }) =>
      handler({ type: 'yamnet-download', progress: b.progress })
    ),
    emitter.addListener(
      'zetic:yamnet-inference',
      (b: {
        rms: number;
        predictions: {
          index: number;
          label: string;
          score: number;
        }[];
        triggeredLabel: string | null;
        triggeredScore: number | null;
        topLabel: string | null;
        topScore: number | null;
      }) =>
        handler({
          type: 'yamnet-inference',
          rms: b.rms,
          predictions: b.predictions,
          triggeredLabel: b.triggeredLabel,
          triggeredScore: b.triggeredScore,
          topLabel: b.topLabel,
          topScore: b.topScore,
        })
    ),
    emitter.addListener(
      'zetic:yamnet-detection',
      (b: {
        label: string;
        score: number;
        rms: number;
        topLabel: string;
        topScore: number;
      }) =>
        handler({
          type: 'yamnet-detection',
          label: b.label,
          score: b.score,
          rms: b.rms,
          topLabel: b.topLabel,
          topScore: b.topScore,
        })
    ),
    emitter.addListener('zetic:yamnet-state', (b: { state: 'listening' | 'stopped' }) =>
      handler({ type: 'yamnet-state', state: b.state })
    ),
    emitter.addListener('zetic:yamnet-error', (b: { message: string }) =>
      handler({ type: 'yamnet-error', message: b.message })
    ),
  ];
  return () => subs.forEach((s) => s.remove());
}

export async function loadModel(opts: LoadOptions): Promise<void> {
  if (!Native) throw new Error('ZeticLlm native module unavailable on this platform');
  await Native.loadModel(opts);
}

export async function generate(prompt: string): Promise<string> {
  if (!Native) throw new Error('ZeticLlm native module unavailable on this platform');
  return Native.generate(prompt);
}

export async function stop(): Promise<void> {
  if (!Native) return;
  await Native.stop();
}

export async function startAcousticMonitoring(
  opts: AcousticMonitoringOptions = {}
): Promise<void> {
  if (!Native) throw new Error('ZeticLlm native module unavailable on this platform');
  await Native.startAcousticMonitoring(opts);
}

export async function stopAcousticMonitoring(): Promise<void> {
  if (!Native) return;
  await Native.stopAcousticMonitoring();
}
