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

type ZeticLlmModule = {
  loadModel(options: LoadOptions): Promise<null>;
  generate(prompt: string): Promise<string>;
  stop(): Promise<null>;
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
  | { type: 'error'; message: string };

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
