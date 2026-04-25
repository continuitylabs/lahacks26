import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_STATE,
  loadProfileState,
  setProfile as persistProfile,
  updateSession as persistSession,
  clearSession as persistClearSession,
  type Profile,
  type ProfileState,
  type Session,
} from '@/src/lib/profile-store';

type ProfileStoreContextValue = {
  state: ProfileState;
  /** False until the first AsyncStorage read completes. */
  loaded: boolean;
  setProfile: (patch: Partial<Profile>) => void;
  updateSession: (patch: Partial<Session>) => void;
  clearSession: () => void;
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

  const setProfile = useCallback((patch: Partial<Profile>) => {
    void persistProfile(patch).then((next) => setState(next));
  }, []);

  const updateSession = useCallback((patch: Partial<Session>) => {
    void persistSession(patch).then((next) => setState(next));
  }, []);

  const clearSession = useCallback(() => {
    void persistClearSession().then((next) => setState(next));
  }, []);

  const value = useMemo<ProfileStoreContextValue>(
    () => ({ state, loaded, setProfile, updateSession, clearSession }),
    [state, loaded, setProfile, updateSession, clearSession]
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
