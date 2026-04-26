import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_STATE,
  loadProfileState,
  setProfile as persistProfile,
  updateSession as persistSession,
  clearSession as persistClearSession,
  startIncident as persistStartIncident,
  updateIncident as persistUpdateIncident,
  clearIncident as persistClearIncident,
  type IncidentAgentReportSlice,
  type IncidentCallSlice,
  type IncidentCoordsSlice,
  type IncidentTriageSlice,
  type IncidentTrigger,
  type IncidentVitalsSlice,
  type ProfilePatch,
  type ProfileState,
  type Session,
  type StartIncidentInitial,
} from '@/src/lib/profile-store';

type IncidentSlicePatch = {
  triage?: IncidentTriageSlice;
  coords?: IncidentCoordsSlice;
  vitals?: IncidentVitalsSlice;
  agentReport?: IncidentAgentReportSlice;
  call?: IncidentCallSlice;
};

type ProfileStoreContextValue = {
  state: ProfileState;
  /** False until the first AsyncStorage read completes. */
  loaded: boolean;
  setProfile: (patch: ProfilePatch) => void;
  updateSession: (patch: Partial<Session>) => void;
  clearSession: () => void;
  /** Start a new pipeline run (rotates the incident id). */
  startIncident: (trigger: IncidentTrigger, initial?: StartIncidentInitial) => Promise<void>;
  /** Patch fields on the active incident. No-op if no active incident. */
  updateIncident: (patch: IncidentSlicePatch) => void;
  /** Drop the active incident (post-call cleanup). */
  clearIncident: () => void;
};

const ProfileStoreContext = createContext<ProfileStoreContextValue | null>(null);

export function ProfileStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadProfileState().then((s) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((patch: ProfilePatch) => {
    void persistProfile(patch).then((next) => setState(next));
  }, []);

  const updateSession = useCallback((patch: Partial<Session>) => {
    void persistSession(patch).then((next) => setState(next));
  }, []);

  const clearSession = useCallback(() => {
    void persistClearSession().then((next) => setState(next));
  }, []);

  const startIncident = useCallback(
    async (trigger: IncidentTrigger, initial?: StartIncidentInitial) => {
      const next = await persistStartIncident(trigger, initial);
      setState(next);
    },
    []
  );

  const updateIncident = useCallback((patch: IncidentSlicePatch) => {
    void persistUpdateIncident(patch).then((next) => setState(next));
  }, []);

  const clearIncident = useCallback(() => {
    void persistClearIncident().then((next) => setState(next));
  }, []);

  const value = useMemo<ProfileStoreContextValue>(
    () => ({
      state,
      loaded,
      setProfile,
      updateSession,
      clearSession,
      startIncident,
      updateIncident,
      clearIncident,
    }),
    [
      state,
      loaded,
      setProfile,
      updateSession,
      clearSession,
      startIncident,
      updateIncident,
      clearIncident,
    ]
  );

  return (
    <ProfileStoreContext.Provider value={value}>
      {children}
    </ProfileStoreContext.Provider>
  );
}

export function useProfileState(): ProfileStoreContextValue {
  const ctx = useContext(ProfileStoreContext);
  if (!ctx) {
    throw new Error(
      'useProfileState must be used inside <ProfileStoreProvider />'
    );
  }
  return ctx;
}
