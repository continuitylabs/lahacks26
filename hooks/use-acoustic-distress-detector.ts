import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import * as Zetic from '@/src/zetic';

type UseAcousticDistressDetectorOptions = {
  paused: boolean;
  onDistress: () => void;
};

const DEFAULT_PERSONAL_KEY = 'dev_4870cfa9449c4db6953dca3214c06ae8';
const MODEL_NAME = 'google/Sound Classification(YAMNET)';

export function useAcousticDistressDetector(
  options: UseAcousticDistressDetectorOptions
) {
  const { paused, onDistress } = options;
  const onDistressRef = useRef(onDistress);
  onDistressRef.current = onDistress;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !Zetic.isZeticAvailable) {
      return;
    }

    const unsubscribe = Zetic.subscribe((event) => {
      if (event.type === 'yamnet-detection') {
        onDistressRef.current();
      } else if (event.type === 'yamnet-error') {
        console.warn('[NorthstarYamnet]', event.message);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !Zetic.isZeticAvailable) {
      return;
    }

    if (paused) {
      void Zetic.stopAcousticMonitoring().catch((error) => {
        console.warn('[NorthstarYamnet] stop failed', error);
      });
      return;
    }

    void Zetic.startAcousticMonitoring({
      personalKey: process.env.EXPO_PUBLIC_ZETIC_KEY ?? DEFAULT_PERSONAL_KEY,
      name: MODEL_NAME,
      version: 1,
      scoreThreshold: 0.2,
      amplitudeThreshold: 0.012,
    }).catch((error) => {
      console.warn('[NorthstarYamnet] start failed', error);
    });

    return () => {
      void Zetic.stopAcousticMonitoring().catch((error) => {
        console.warn('[NorthstarYamnet] cleanup stop failed', error);
      });
    };
  }, [paused]);
}
