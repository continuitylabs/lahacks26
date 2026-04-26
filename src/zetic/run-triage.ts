/**
 * On-device triage via the loaded Zetic LLM. Builds a triage prompt from the
 * user's free-text description, runs the model, and returns a structured
 * slice the rest of the pipeline can consume.
 *
 * The model load lifecycle is owned elsewhere (see `useZeticChat`); this
 * helper assumes the model is already loaded. Callers should check
 * `isZeticAvailable` before invoking.
 */

import { generate, isZeticAvailable } from '@/src/zetic';
import type { IncidentTriageSlice } from '@/src/lib/profile-store';

const SEVERITY_KEYWORDS = [
  'bleeding',
  'fracture',
  'broken',
  'sprain',
  'laceration',
  'concussion',
  'unconscious',
  'head',
  'spine',
  'ankle',
  'wrist',
  'knee',
  'shoulder',
  'burn',
  'puncture',
  'dislocation',
  'cut',
  'bruise',
  'bite',
  'sting',
  'allergic',
] as const;

const TRIAGE_SYSTEM = `You are Northstar's on-device wilderness triage model.
Given a brief description of an injury, you produce a single concise paragraph (<=80 words) for an emergency dispatcher.
Do not invent facts. State known severity, suspected mechanism, immediate first-aid, and what the dispatcher should ask.`;

function buildPrompt(injuryText: string): string {
  return (
    `<|im_start|>system\n${TRIAGE_SYSTEM}<|im_end|>\n` +
    `<|im_start|>user\nIncident: ${injuryText}<|im_end|>\n` +
    `<|im_start|>assistant<think>I will write a single concise dispatcher-ready summary.</think>\n`
  );
}

function stripModelChrome(raw: string): string {
  // Drop any think block; keep what comes after.
  const closeThink = raw.indexOf('</think>');
  const body = closeThink >= 0 ? raw.slice(closeThink + '</think>'.length) : raw;
  return body
    .replace(/<\|im_(?:start|end)\|>/g, '')
    .replace(/^assistant\s*/i, '')
    .trim();
}

function extractFindings(text: string): string[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  for (const k of SEVERITY_KEYWORDS) {
    if (lower.includes(k)) seen.add(k);
  }
  return Array.from(seen);
}

function classifySeverity(
  text: string,
  findings: string[]
): IncidentTriageSlice['severity'] {
  const t = text.toLowerCase();
  if (
    t.includes('unconscious') ||
    t.includes('not breathing') ||
    t.includes('massive bleed') ||
    t.includes('cardiac') ||
    findings.includes('spine')
  ) {
    return 'critical';
  }
  if (
    findings.includes('fracture') ||
    findings.includes('broken') ||
    findings.includes('concussion') ||
    findings.includes('head') ||
    findings.includes('puncture') ||
    t.includes('severe')
  ) {
    return 'severe';
  }
  if (findings.length > 0) return 'moderate';
  if (text.trim().length === 0) return null;
  return 'minor';
}

export type TriageResult = IncidentTriageSlice & {
  /** True when this came from the LLM, false when it came from the heuristic fallback. */
  modelUsed: boolean;
};

/**
 * Produce a triage summary from free-form injury text. Tries the Zetic model
 * first; falls back to a heuristic if the model is unavailable or errors out
 * — the rest of the pipeline never blocks on this.
 */
export async function runOnDeviceTriage(
  injuryText: string,
  opts: { timeoutMs?: number } = {}
): Promise<TriageResult> {
  const trimmed = injuryText.trim();
  if (!trimmed) {
    return {
      summary: 'No incident description captured.',
      rawText: '',
      findings: [],
      severity: null,
      capturedAt: Date.now(),
      modelUsed: false,
    };
  }

  const findings = extractFindings(trimmed);
  const fallback: TriageResult = {
    summary: trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed,
    rawText: trimmed,
    findings,
    severity: classifySeverity(trimmed, findings),
    capturedAt: Date.now(),
    modelUsed: false,
  };

  if (!isZeticAvailable) return fallback;

  try {
    const generation = generate(buildPrompt(trimmed));
    const timeoutMs = opts.timeoutMs ?? 12000;
    const raced = await Promise.race<[string, 'ok'] | [null, 'timeout']>([
      generation.then((r): [string, 'ok'] => [r, 'ok']),
      new Promise<[null, 'timeout']>((resolve) =>
        setTimeout(() => resolve([null, 'timeout']), timeoutMs)
      ),
    ]);
    const [raw, status] = raced;
    if (status === 'timeout' || !raw) return fallback;

    const summary = stripModelChrome(raw);
    if (!summary) return fallback;

    const enrichedFindings = Array.from(
      new Set([...findings, ...extractFindings(summary)])
    );
    return {
      summary,
      rawText: raw,
      findings: enrichedFindings,
      severity: classifySeverity(summary, enrichedFindings),
      capturedAt: Date.now(),
      modelUsed: true,
    };
  } catch {
    return fallback;
  }
}
