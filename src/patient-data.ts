export type PatientData = {
  collectedAt: string;
  contactTarget: string;
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
