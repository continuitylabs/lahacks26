import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { FallAlert } from '@/components/fall-alert';
import { useFallDetector } from '@/hooks/use-fall-detector';

type FallDetectorContextValue = {
  /** Trigger the alert as if a fall had been detected. No-ops if alert is already visible. */
  simulate: () => void;
};

const FallDetectorContext = createContext<FallDetectorContextValue | null>(null);

/** Routes on which the listener should NOT run — the user is already in an incident flow. */
const PAUSED_ROUTES = new Set(['triage', 'rescue', 'report-incident']);

export function FallDetectorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const [alertVisible, setAlertVisible] = useState(false);

  // Pause when in any incident-flow screen, or while the alert is already up
  // (the alert covers the cooldown window for visible duration).
  const inIncidentFlow = segments.some((s) => PAUSED_ROUTES.has(s));
  const paused = inIncidentFlow || alertVisible;

  const handleFall = useCallback(() => {
    setAlertVisible(true);
  }, []);

  const { simulate: hookSimulate } = useFallDetector({
    paused,
    onFall: handleFall,
  });

  const simulate = useCallback(() => {
    if (alertVisible || inIncidentFlow) return;
    hookSimulate();
  }, [alertVisible, inIncidentFlow, hookSimulate]);

  const handleDismiss = useCallback(() => {
    setAlertVisible(false);
  }, []);

  const handleConfirm = useCallback(() => {
    setAlertVisible(false);
    router.replace('/triage');
  }, [router]);

  const value = useMemo<FallDetectorContextValue>(() => ({ simulate }), [simulate]);

  return (
    <FallDetectorContext.Provider value={value}>
      {children}
      <FallAlert
        visible={alertVisible}
        onDismiss={handleDismiss}
        onConfirm={handleConfirm}
      />
    </FallDetectorContext.Provider>
  );
}

export function useFallDetectorContext(): FallDetectorContextValue {
  const ctx = useContext(FallDetectorContext);
  if (!ctx) {
    throw new Error('useFallDetectorContext must be used inside <FallDetectorProvider />');
  }
  return ctx;
}
