import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { FallAlert } from '@/components/fall-alert';
import { useAcousticDistressDetector } from '@/hooks/use-acoustic-distress-detector';
import { useFallDetector } from '@/hooks/use-fall-detector';

type FallDetectorContextValue = {
  /** Trigger the alert as if a fall had been detected. No-ops if alert is already visible. */
  simulate: () => void;
};

type AlertSource = 'fall' | 'acoustic';

const FallDetectorContext = createContext<FallDetectorContextValue | null>(null);

/** Routes on which the listener should NOT run — the user is already in an incident flow. */
const PAUSED_ROUTES = new Set(['triage', 'rescue', 'report-incident', 'yamnet']);

export function FallDetectorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertSource, setAlertSource] = useState<AlertSource>('fall');

  // Pause when in any incident-flow screen, or while the alert is already up
  // (the alert covers the cooldown window for visible duration).
  const inIncidentFlow = segments.some((s) => PAUSED_ROUTES.has(s));
  const paused = inIncidentFlow || alertVisible;

  const showAlert = useCallback((source: AlertSource) => {
    setAlertSource(source);
    setAlertVisible(true);
  }, []);

  const { simulate: hookSimulate } = useFallDetector({
    paused,
    onFall: () => showAlert('fall'),
  });

  useAcousticDistressDetector({
    paused,
    onDistress: () => showAlert('acoustic'),
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
    // push (not replace) so the underlying (tabs) route stays beneath us in
    // the stack — otherwise the incident flow's Close / Done buttons end up
    // dispatching GO_BACK / POP_TO_TOP on a depth-1 stack and throwing.
    router.push('/triage');
  }, [router]);

  const value = useMemo<FallDetectorContextValue>(() => ({ simulate }), [simulate]);

  return (
    <FallDetectorContext.Provider value={value}>
      {children}
      <FallAlert
        visible={alertVisible}
        source={alertSource}
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
