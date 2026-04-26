export type PatientData = {
  collectedAt: string;
  contactTarget: string;
  /**
   * Short briefing key minted by the rescue coordinator. The call bridge
   * embeds it in the WhatsApp/SMS so the emergency contact can paste a
   * "case <id>" line into the ASI:One chat to load the briefing.
   */
  caseId?: string;
  /**
   * Optional pre-drafted dispatch script. When set, the call bridge uses it
   * verbatim instead of synthesizing one from `summary`. Populated by the
   * Fetch.ai Script Composer when its parser finds a `Drafted dispatch
   * script:` blockquote in the rescue coordinator's reply.
   */
  rescueScript?: string;
  patient: {
    name: string;
    age: string;
    medicalBaseline: string;
  };
  location: {
    latitude: number;
    longitude: number;
    status: 'pending' | 'granted' | 'denied';
  };
  triage: {
    confidence: number | null;
    signalStrength: number;
    framesAttempted: number;
    samplesCaptured: number;
    heartRate: number | null;
    spo2: number | null;
    respiratoryRate: number | null;
    hrv: number | null;
    perfusionIndex: number | null;
  };
  summary: string[];
};
