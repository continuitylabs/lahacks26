/**
 * Parser for the rescue coordinator's response. Prefers a fenced ```json```
 * block at the end of the markdown (the Coordinator emits one); falls back
 * to scraping the legacy "Drafted dispatch script:" blockquote when only the
 * markdown is present.
 *
 * Failures are silent — every field is independently optional, callers fall
 * back to the on-device script when extraction fails.
 */

export type ParsedNextStepCard = { title: string; body: string };

export type ParsedAgentReport = {
  /** Short hex ID assigned by the rescue coordinator. Used as the briefing
   *  key for emergency-contact Q&A on ASI:One. */
  caseId: string | null;
  rescueScript: string | null;
  extractionRecommendation: string | null;
  agentSeverity: string | null;
  locationSummary: string | null;
  weatherSummary: string | null;
  weatherUrgencyModifier: 'elevate' | 'maintain' | 'reduce' | null;
  nextStepsHeader: string | null;
  nextSteps: ParsedNextStepCard[];
  degradedAgents: string[];
};

const EMPTY: ParsedAgentReport = {
  caseId: null,
  rescueScript: null,
  extractionRecommendation: null,
  agentSeverity: null,
  locationSummary: null,
  weatherSummary: null,
  weatherUrgencyModifier: null,
  nextStepsHeader: null,
  nextSteps: [],
  degradedAgents: [],
};

const JSON_BLOCK_RE = /```json\s*\n([\s\S]+?)```/g;
const SEVERITY_RE = /\*\*Severity:\*\*\s*([^\n(]+)/i;
const EXTRACTION_RE = /\*\*Extraction:\*\*\s*([^\n]+)/i;

function tryParseJsonBlock(markdown: string): Partial<ParsedAgentReport> | null {
  // Take the LAST json block (the JSON tail), since ASI:One renders are
  // permitted to contain other code blocks earlier.
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  JSON_BLOCK_RE.lastIndex = 0;
  while ((match = JSON_BLOCK_RE.exec(markdown)) !== null) {
    last = match;
  }
  if (!last) return null;
  try {
    const obj = JSON.parse(last[1]) as Record<string, unknown>;
    return {
      caseId: typeof obj.caseId === 'string' ? obj.caseId : null,
      rescueScript: typeof obj.rescueScript === 'string' ? obj.rescueScript : null,
      extractionRecommendation:
        typeof obj.extractionRecommendation === 'string' ? obj.extractionRecommendation : null,
      agentSeverity: typeof obj.agentSeverity === 'string' ? obj.agentSeverity : null,
      locationSummary:
        typeof obj.locationSummary === 'string' ? obj.locationSummary : null,
      weatherSummary:
        typeof obj.weatherSummary === 'string' ? obj.weatherSummary : null,
      weatherUrgencyModifier:
        obj.weatherUrgencyModifier === 'elevate' ||
        obj.weatherUrgencyModifier === 'maintain' ||
        obj.weatherUrgencyModifier === 'reduce'
          ? obj.weatherUrgencyModifier
          : null,
      nextStepsHeader:
        typeof obj.nextStepsHeader === 'string' ? obj.nextStepsHeader : null,
      nextSteps: Array.isArray(obj.nextSteps)
        ? obj.nextSteps
            .filter(
              (c): c is { title: string; body: string } =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as Record<string, unknown>).title === 'string' &&
                typeof (c as Record<string, unknown>).body === 'string'
            )
            .map((c) => ({ title: c.title, body: c.body }))
        : [],
      degradedAgents: Array.isArray(obj.degradedAgents)
        ? obj.degradedAgents.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function legacyScrape(markdown: string): Partial<ParsedAgentReport> {
  const severityMatch = markdown.match(SEVERITY_RE);
  const extractionMatch = markdown.match(EXTRACTION_RE);

  let rescueScript: string | null = null;
  const lines = markdown.split('\n');
  const scriptIdx = lines.findIndex((l) =>
    /\*\*Drafted dispatch script:\*\*/i.test(l)
  );
  if (scriptIdx >= 0) {
    const collected: string[] = [];
    for (let i = scriptIdx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('> ')) {
        collected.push(line.slice(2));
      } else if (line.startsWith('>')) {
        collected.push(line.slice(1).trim());
      } else if (collected.length > 0) {
        break;
      } else if (line.trim() === '') {
        continue;
      } else {
        break;
      }
    }
    if (collected.length > 0) {
      rescueScript = collected.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  return {
    rescueScript,
    extractionRecommendation: extractionMatch?.[1]?.trim() ?? null,
    agentSeverity: severityMatch?.[1]?.trim() ?? null,
  };
}

export function parseAgentReport(markdown: string): ParsedAgentReport {
  if (!markdown) return EMPTY;

  const fromJson = tryParseJsonBlock(markdown);
  const fromLegacy = legacyScrape(markdown);

  // Merge, preferring JSON values.
  return { ...EMPTY, ...fromLegacy, ...(fromJson ?? {}) };
}
