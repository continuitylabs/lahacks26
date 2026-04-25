/**
 * Dummy vitals + identity used while the on-device pieces are stubbed out.
 *
 * Each field below is marked with the source that will eventually replace
 * the dummy value. When that source comes online, swap the call site that
 * uses `getMockVitals()` to read from the real source — the shape of
 * `Vitals` is the contract the rest of the app depends on.
 */

export type Vitals = {
  /** TODO: load from a profile store (SecureStore-backed) once Profile is wired up. */
  userName: string;

  /** TODO: stream from Apple Health / Health Connect via a native module. */
  heartRateBpm: number;

  /**
   * TODO: produced by the on-device triage step (Zetic Melange vision
   * model on the camera frame). For now it's a hardcoded plausible
   * scenario that exercises the whole agent chain.
   */
  conditionSummary: string;

  /** TODO: read from the profile store. */
  emergencyContact: string;
};

export function getMockVitals(): Vitals {
  return {
    userName: 'Jake',
    heartRateBpm: 118,
    conditionSummary:
      'Hard fall mountain biking. Bleeding from a laceration on the left forearm. Conscious, no head trauma reported. Some pain in the right ankle.',
    emergencyContact: 'Sam Rivera (+1-310-555-0142)',
  };
}
