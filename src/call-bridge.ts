import Constants from 'expo-constants';

import type { PatientData } from '@/src/patient-data';

type CallResponse = {
  ok: boolean;
  status: 'called' | 'voiced' | 'drafted' | 'failed';
  callSid?: string | null;
  rescueScript?: string;
  notes?: string | null;
  audioUrl?: string | null;
};

function extractHost(candidate?: string | null) {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return null;
    }
  }

  const withoutScheme = trimmed.replace(/^[^:]+:\/\//, '');
  const host = withoutScheme.split('/')[0]?.split(':')[0];
  return host || null;
}

function getBridgeBaseUrl() {
  const explicit = process.env.EXPO_PUBLIC_CALL_BRIDGE_URL;
  if (explicit) {
    console.log('[NorthstarCall] Using explicit bridge URL:', explicit.replace(/\/$/, ''));
    return explicit.replace(/\/$/, '');
  }

  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.linkingUri,
    Constants.experienceUrl,
    Constants.platform?.android?.hostUri,
    Constants.platform?.ios?.hostUri,
  ];

  for (const candidate of candidates) {
    const host = extractHost(candidate);
    if (host) {
      const resolved = `http://${host}:8787`;
      console.log('[NorthstarCall] Resolved bridge URL:', resolved, 'from', candidate);
      return resolved;
    }
  }

  console.warn('[NorthstarCall] Could not resolve a bridge URL from Expo constants.');
  return null;
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out reaching ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestEmergencyCall(patientData: PatientData): Promise<CallResponse> {
  const baseUrl = getBridgeBaseUrl();
  if (!baseUrl) {
    throw new Error('Call bridge URL is not configured.');
  }

  console.log('[NorthstarCall] Starting call request', {
    bridge: baseUrl,
    target: patientData.contactTarget,
    heartRate: patientData.triage.heartRate,
    spo2: patientData.triage.spo2,
    confidence: patientData.triage.confidence,
  });

  const healthResponse = await fetchWithTimeout(`${baseUrl}/health`, undefined, 4000);
  if (!healthResponse.ok) {
    throw new Error(`The call bridge is not healthy. (bridge: ${baseUrl})`);
  }
  console.log('[NorthstarCall] Bridge health check passed:', `${baseUrl}/health`);

  const response = await fetchWithTimeout(`${baseUrl}/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      patientData,
    }),
  });

  const text = await response.text();
  let payload: CallResponse | null = null;

  try {
    payload = text ? (JSON.parse(text) as CallResponse) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.notes || text || 'The call bridge could not place the call.';
    console.error('[NorthstarCall] Call request failed:', detail);
    throw new Error(`${detail} (bridge: ${baseUrl})`);
  }

  if (!payload) {
    throw new Error(`The call bridge returned an invalid response. (bridge: ${baseUrl})`);
  }

  console.log('[NorthstarCall] Call request completed:', payload);
  return payload;
}
