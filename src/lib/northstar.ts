/**
 * Typed REST client for the Northstar Phone Agent.
 *
 * The Phone Agent is a uAgent running on the user's device (locally for
 * the hackathon, on a Northstar-hosted relay in production). Calling
 * `reportIncident` POSTs the structured payload, the Phone Agent forwards
 * it to the Rescue Coordinator over the Fetch.ai Chat Protocol, and the
 * coordinator's markdown reply comes back here.
 *
 * Override the base URL with `EXPO_PUBLIC_NORTHSTAR_URL` in `.env.local`
 * when the agents are running off-machine (e.g. a physical device on the
 * same WiFi → set it to `http://<mac-lan-ip>:8004`).
 */

const FALLBACK_BASE = 'http://127.0.0.1:8004';

function baseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_NORTHSTAR_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, '');
  return FALLBACK_BASE;
}

export type ReportPayload = {
  userName: string;
  latitude: number;
  longitude: number;
  conditionSummary: string;
  heartRateBpm?: number;
  emergencyContact?: string;
  /** Authorize the agent network to actually place the Twilio call. */
  placeCall?: boolean;
};

export type ReportResult = {
  requestId: string;
  markdown: string;
  timedOut: boolean;
};

export async function reportIncident(p: ReportPayload): Promise<ReportResult> {
  const res = await fetch(`${baseUrl()}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_name: p.userName,
      latitude: p.latitude,
      longitude: p.longitude,
      condition_summary: p.conditionSummary,
      heart_rate_bpm: p.heartRateBpm,
      emergency_contact: p.emergencyContact,
      place_call: p.placeCall ?? false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Northstar /report failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`
    );
  }

  const data = (await res.json()) as {
    request_id: string;
    markdown: string;
    timed_out?: boolean;
  };
  return {
    requestId: data.request_id,
    markdown: data.markdown,
    timedOut: data.timed_out ?? false,
  };
}
