# Triage Chat (Zetic intake before PPG) — Design

**Date:** 2026-04-26
**Status:** Approved (awaiting spec review)

## Problem

The Zetic Melange on-device LLM is currently surfaced only via the "Guide" tab, where it acts as a free-form SALT-method assistant. The incident pipeline (Home → Report Incident → Triage [PPG] → Rescue → Call) skips Zetic entirely, so:

1. The Fetch.ai rescue coordinator receives no on-device interview transcript even though the data path (`incident.triage.transcript`) was reserved for one.
2. The user gets no chance to describe what happened in their own words before being asked to hold a fingertip on the camera.
3. The on-device LLM is invisible at the most critical moment — when an incident is reported.

## Goals

- Insert a brief Zetic-driven triage interview between `/report-incident` and `/triage` (PPG).
- Persist the conversation into `incident.triage` so the existing Fetch.ai payload composer forwards it downstream automatically.
- Allow the user to skip ahead at any time without losing the partial transcript.
- Keep the "Guide" tab as the navbar entry point for general-purpose offline Zetic use (unchanged).

## Non-goals

- Keyword extraction from the transcript (`findings`) — left empty for v1.
- On-device severity scoring (`severity`) — left null for v1.
- Voice input on the new screen — text-only for v1; mic can follow.
- Changes to the Fetch.ai agents or rescue coordinator — the existing payload schema already carries `triageTranscript`/`triageSummary`/`triageFindings`.

## High-level flow

```
Home (tabs/index)
  └─ tap Report Incident
      └─ /report-incident  ("The rescue plan." — was "Are you okay?")
          └─ Begin Triage  →  startIncident('manual') + router.replace('/triage-chat')
              └─ /triage-chat   ← NEW
                  ├─ progress = (assistant replies after user msg) / 3
                  ├─ Continue button (always visible, top-right)
                  └─ on 3rd reply OR Continue tap → router.replace('/triage')
                      └─ /triage  (PPG scan, unchanged)
                          └─ /rescue → /call (unchanged)
```

## Components

### 1. `app/triage-chat.tsx` (new)

A modal screen registered alongside `report-incident`, `triage`, `rescue`, `call` in `app/_layout.tsx`.

**Layout:**

- Top bar (single row)
  - ✕ close button on the left (returns to home; matches the ✕ in `report-incident.tsx`)
  - 3-segment progress meter centered (each segment = one assistant reply post-user; opener does not count)
  - "Continue" pill button on the right, enabled from first render
- Body
  - Chat thread, styling lifted from `app/(tabs)/chat.tsx`
  - Streaming bubbles + extended-thinking block UI from `useZeticChat`
- Footer
  - Text input + send button (no mic for v1)

**Lifecycle:**

- On mount: ensure `state.session.incident` exists (fall back to `startIncident('manual')` for deep-link safety, mirroring `triage.tsx`); seed an opener assistant message ("Tell me what happened — short answers are fine.").
- Per finalized assistant reply (excluding opener): increment counter, fill progress bar, patch `incident.triage` (see § Transcript persistence).
- On counter == 3: 800 ms display hold, then `router.replace('/triage')`.
- On Continue tap: abort any in-flight Zetic generation (best effort), commit whatever turns have finalized, `router.replace('/triage')`.
- On unmount: final flush of `incident.triage` to capture any race between finalization and navigation.

### 2. `hooks/use-zetic-chat.ts` (modified)

The hook currently bakes the SALT system prompt internally. Change:

- Accept an optional `systemPrompt` parameter (or options object) on the hook signature.
- Default to the existing SALT prompt so `app/(tabs)/chat.tsx` (Guide tab) is unchanged.
- `triage-chat.tsx` passes a new triage-interview prompt (see § System prompt).

If the hook also exposes the running list of turns and a way to abort an in-flight generation, surface those for the new screen. If abort is not currently exposed, add a `cancel()` method that clears the streaming buffer and short-circuits the response loop.

### 3. `app/report-incident.tsx` (modified)

- Header text: `"Are you okay?"` → `"The rescue plan."`
- Subtitle unchanged: `"Tell Northstar what happened."`
- `beginTriage` callback changes its terminal `router.replace('/triage')` to `router.replace('/triage-chat')`. The `startIncident('manual')` call stays.

### 4. `app/_layout.tsx` (modified)

- Register `triage-chat` as a stack screen with the same modal/animation options as `triage`.

## System prompt

New, tighter than the SALT prompt used by the Guide tab. Approximate shape:

> You are Northstar's on-device triage assistant. The user just reported an incident on a hike and is about to do a fingertip pulse scan. Your job is to gather a brief field history in **at most 3 short exchanges**.
>
> Rules:
> - Ask **one** targeted assessment question per reply.
> - Prioritise: mechanism of injury → pain location/severity → mobility → bleeding → consciousness/orientation → environmental exposure.
> - Reply in ≤ 2 sentences.
> - If the user asks for help instead of answering, give 1–2 sentences of practical guidance, then return to assessment.
> - Do not claim certainty about diagnosis. Do not mention the SALT method.

Final wording is implementation-time; the hook owner can tune.

## Progress mechanics

- Counter starts at 0.
- The screen seeds an assistant opener (no user message exists yet) — this does **not** increment the counter.
- After the user sends a message and the assistant's reply finalizes, increment by 1. Update the progress bar to `count/3`.
- At `count === 3`: progress bar shows full, hold 800 ms (so the user sees it complete), then navigate.
- At any time, Continue tap → navigate immediately.

## Transcript persistence

After each finalized assistant turn **and** each user send, patch the active incident:

```ts
updateIncident({
  triage: {
    transcript,                       // running TranscriptTurn[]
    summary: latestAssistantText,     // most recent assistant reply
    rawText: assistantTextConcatenated,
    findings: [],                     // v1: empty
    severity: null,                   // v1: null
    capturedAt: Date.now(),
  },
});
```

Why both events:
- Patching on user send means a ragequit before the assistant replies still preserves what the user said.
- Patching on assistant finalize keeps `summary` fresh.
- Final unmount flush handles the navigation race.

The store already exposes `updateIncident` and the slice shape; no store changes required.

## Navbar

No changes. The "Guide" tab continues to be the Zetic Melange entry point for general/offline use. Confirmed by inspection: it already wraps `useZeticChat` with the SALT prompt.

## Edge cases

- **No incident slot on mount:** call `startIncident('manual')` (mirrors `triage.tsx` — deep link / hot reload safety).
- **Zetic model not yet loaded:** show the hook's existing loading state; the Continue button is still tappable, so the user is never blocked. If the user continues before any assistant reply, transcript may be empty — that is acceptable; `composeIncidentPayload` already handles empty transcripts.
- **Mid-stream Continue:** abort the current generation, commit current turns (in-flight assistant text up to last finalized token is included only if the hook's "finalize on cancel" path commits it; otherwise the partial is dropped). Acceptable for v1.
- **User sends rapid-fire messages:** the underlying hook's queue already serialises; no new behaviour required.
- **Back-button:** both transitions use `router.replace` to match the existing report-incident → triage convention (back from PPG already returns to home, not the previous step). With chained replace, the stack is `home → triage-chat` then `home → triage`, so hardware back from `/triage-chat` returns to home. The on-screen ✕ button (lifted from `report-incident.tsx`) is the explicit cancel; we add it to the top-left of `/triage-chat` for symmetry.

## Open questions for implementer

- Exact wording of the opener line.
- Final wording of the system prompt.
- Whether `useZeticChat` already exposes a `cancel`/abort affordance or one must be added.

## Out of scope (explicit)

- Voice input on the new screen.
- Findings / severity extraction.
- Mic affordance, copy-to-clipboard of transcript, retry button.
- Any change to Guide tab, PPG screen, rescue screen, call screen, or Fetch.ai agents.
