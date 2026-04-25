import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type Coords = { latitude: number; longitude: number };

// Royce Hall, UCLA — fallback when permission denied or location unavailable.
export const FALLBACK_COORDS: Coords = {
  latitude: 34.0729,
  longitude: -118.4422,
};

export type LocationState =
  | { status: 'pending'; coords: Coords }
  | { status: 'granted'; coords: Coords }
  | { status: 'denied'; coords: Coords };

export function useCurrentLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    status: 'pending',
    coords: FALLBACK_COORDS,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setState({ status: 'denied', coords: FALLBACK_COORDS });
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setState({
          status: 'granted',
          coords: {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          },
        });
      } catch {
        if (!cancelled) {
          setState({ status: 'denied', coords: FALLBACK_COORDS });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
