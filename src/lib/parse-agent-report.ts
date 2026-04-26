/**
 * Best-effort parser for the rescue coordinator's markdown response. Pulls
 * out the rescue script (the blockquote under "Drafted dispatch script:")
 * and a few field-style lines.
 *
 * Failures are silent — every field is independently optional, callers fall
 * back to the on-device script when extraction fails.
 */

export type ParsedAgentReport = {
  rescueScript: string | null;
  extractionRecommendation: string | null;
  agentSeverity: string | null;
};

const SEVERITY_RE = /\*\*Severity:\*\*\s*([^\n(]+)/i;
const EXTRACTION_RE = /\*\*Extraction:\*\*\s*([^\n]+)/i;

export function parseAgentReport(markdown: string): ParsedAgentReport {
  if (!markdown) {
    return { rescueScript: null, extractionRecommendation: null, agentSeverity: null };
  }

  const severityMatch = markdown.match(SEVERITY_RE);
  const extractionMatch = markdown.match(EXTRACTION_RE);

  // The dispatch script is rendered as a multi-line blockquote. We collect
  // contiguous "> "-prefixed lines that follow "Drafted dispatch script:".
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
