# Fetch.ai Agent Network — Design Spec

**Date:** 2026-04-25
**Status:** Approved (pending user review)
**Author:** brainstorming session
**Track:** UCLA Hackathon 2026 — Fetch.ai

## Goal

Replace the current 3-specialist agent network with a 4-specialist network whose
outputs (a) compose one optimized dispatcher script for the emergency call and
(b) produce a structured "next steps" plan for the post-call Instructions
screen. Persist on-device Zetic LLM triage chat so the agent network can
integrate it. Make `python run_all.py` work first-try without manual mailbox
claiming for every agent.

## Background

The current agent network at [agents/](../../../agents/) has four agents
(Rescue Coordinator + Location Scout + Medical Coordinator + Contact
Orchestrator) plus a Phone Agent proxy. Three problems:

1. **`python run_all.py` appears to hang.** Every agent boots in mailbox mode
   when `AGENTVERSE_API_KEY` is set; agent→agent traffic routes through
   Agentverse, which requires manually clicking 5 inspector URLs once to claim
   each mailbox slot. If the user hasn't, all routing silently stalls.
2. **The Zetic LLM triage chat is never persisted.** The Script Composer (today
   the Contact Orchestrator) drafts the dispatch script with no access to what
   the user actually said about their injury during the chat. Severity hints,
   mechanism of injury, and timeline data are all lost.
3. **The Instructions screen is a placeholder.** Three hard-coded cards with
   generic copy. Nothing tailored to the incident.

## Non-goals

- Not changing the Twilio call placement path (`call_bridge.py`).
- Not changing the PPG vitals capture flow (`hooks/use-ppg-vitals.ts`).
- Not adding new third-party providers (no new API keys needed; uses existing
  Anthropic, ElevenLabs, Twilio, OpenStreetMap, Open-Meteo).
- Not redesigning the chat protocol's request/reply contract — we keep the
  same ChatMessage/ChatAcknowledgement flow and embed structured data via JSON
  in the reply body.

## Architecture

```
Expo app ──HTTP /report──► Phone Agent (:8004 REST)
                              │
                              │ ChatMessage (Chat Protocol)
                              ▼
                    Rescue Coordinator (:8000, mailbox) ◄── ASI:One
                              │
                              │ fan-out (parallel)
                ┌─────────────┼──────────────┬─────────────┐
                ▼             ▼              ▼             ▼
       Location Scout   Weather Analyst  NextSteps    (waits)
       (:8001 endpoint) (:8002 endpoint) Planner       │
                │              │         (:8005 ep)    │
                └──────┬───────┘              │        │
                       ▼                      │        │
              Script Composer (:8003 ep)      │        │
                       │                      │        │
                       └──────────┬───────────┘        │
                                  ▼                    ▼
                       all 4 results ──► coordinator ──► markdown + JSON tail
                                                               │
                                                               └► back to phone agent → app
```

### Why this layout

- **One Agentverse mailbox.** Only the Rescue Coordinator publishes its chat
  manifest and runs in mailbox mode. The 4 specialists are internal helpers
  and run with localhost endpoints, so agent→agent routing always works
  without claiming any mailbox slots.
- **Pre-computed Next Steps.** NextSteps fans out alongside Location and
  Weather, not after the call. Result is cached in AsyncStorage before the
  user reaches the Instructions screen — no second round-trip.
- **Script Composer waits on Location + Weather.** It needs both paragraphs
  to compose. NextSteps doesn't need them and can complete on its own track.

## Components

### Agent A — Location Scout

**File:** `agents/northstar_agents/location_scout.py` (existing, slimmed).

- **Tools:** OpenStreetMap Overpass.
- **Inputs:** `LocationScoutRequest { request_id, latitude, longitude, search_radius_km }`
- **Behavior:** queries POIs (ranger station, hospital, helipad, trailhead).
  Then runs a Claude pass to write a single paragraph for the dispatcher
  script ("There's a ranger station 2.3 km NE; the closest hospital is
  X 18 km away; helipad available within 4 km, accessible to standard SAR
  helicopters.").
- **Outputs:** `LocationScoutResponse` adds `script_paragraph: str` to the
  existing fields.
- **Fallback (no Claude / Overpass timeout):** deterministic paragraph
  composed from the raw POI tuples.

The weather lookup is removed from this agent.

### Agent B — Weather Analyst (NEW; replaces Medical Coordinator)

**File:** `agents/northstar_agents/weather_analyst.py` (new; replaces
`medical_coordinator.py`).

- **Tools:** Open-Meteo (current + 6h forecast) + Claude.
- **Inputs:** `WeatherAnalystRequest { request_id, latitude, longitude,
  severity_hint, injury_keywords }`
- **Behavior:** fetches weather, then runs Claude with the severity hint and
  injury keywords to produce:
  - A `urgency_modifier`: `"elevate"`, `"maintain"`, or `"reduce"` based on
    how the weather changes the timeline (e.g. open laceration + cold rain →
    `"elevate"`; dry sunny conditions + minor sprain → `"maintain"`).
  - A `script_paragraph` for the dispatcher (1-2 sentences explaining
    weather and its impact).
- **Outputs:** `WeatherAnalystResponse { request_id, snapshot, urgency_modifier,
  script_paragraph, summary }`.
- **Fallback (no Claude / Open-Meteo timeout):** deterministic rule table:
  `wind > 50 km/h or thunderstorm code or temp < -10°C → "elevate"`,
  otherwise `"maintain"`. Paragraph templated from raw snapshot.

### Agent C — Script Composer (existing Contact Orchestrator, expanded)

**File:** `agents/northstar_agents/script_composer.py` (renamed from
`contact_orchestrator.py`).

- **Tools:** Claude + ElevenLabs + Twilio (only Twilio when `place_call=True`).
- **Inputs:** `ScriptComposerRequest { request_id, user_name, latitude,
  longitude, severity, location_summary, location_paragraph, weather_paragraph,
  weather_urgency_modifier, triage_transcript, triage_summary, vitals,
  emergency_contact, place_call }`
- **Behavior:** single Claude call with all inputs in the prompt. Composes
  the optimized dispatcher script integrating Location paragraph, Weather
  paragraph, vitals, transcript context, and severity. Optionally
  synthesizes voice via ElevenLabs and places call via Twilio (gated on
  `place_call`).
- **Outputs:** `ScriptComposerResponse` (same shape as today's
  `ContactOrchestratorResponse` plus `script_text` field for clarity).
- **Fallback (no Claude key):** existing template script is reused, but
  prepended with the Location + Weather paragraphs verbatim and a 1-line
  transcript excerpt.

### Agent D — Next Steps Planner (NEW)

**File:** `agents/northstar_agents/next_steps_planner.py` (new).

- **Tools:** Claude.
- **Inputs:** `NextStepsPlannerRequest { request_id, severity, injury_keywords,
  triage_transcript, vitals, location_summary }`
- **Behavior:** Claude composes a structured plan: a single header sentence
  (e.g. "Stay still and conserve warmth — help is on the way.") plus 3-5
  cards `{ title: str, body: str }` covering immediate first-aid, warmth/
  battery/signal conservation, and when to escalate.
- **Outputs:** `NextStepsPlannerResponse { request_id, header, cards }`.
- **Fallback (no Claude key):** static severity-bucketed templates. Three
  buckets (`minor` / `moderate` / `severe-or-critical`), each with 3 cards.
  Severity comes from the coordinator's parser, so this always renders
  something.

### Rescue Coordinator (existing, fan-out updated)

**File:** `agents/northstar_agents/rescue_coordinator.py` (existing).

- Parses incident from incoming ChatMessage (Claude or regex fallback).
- Reads `triage_transcript` and `triage_summary` from the structured prompt
  the Phone Agent embeds. Falls back to chat text if unavailable.
- Fans out to Location, Weather, NextSteps in parallel.
- When Location + Weather both return, dispatches Script Composer.
- When all 4 return (or 20s elapse), composes the markdown reply with a
  fenced ```json``` block at the end carrying structured fields.
- 20s soft timeout: if any specialist hasn't replied, build reply with
  `null` fields for them and a `degradedAgents` array in the JSON tail.

### Phone Agent (existing, prompt format updated)

**File:** `agents/northstar_agents/phone_agent.py` (existing).

- New REST request fields: `triage_transcript: list[{role, text}]`,
  `triage_summary: str`, `vitals: { heart_rate_bpm, spo2, confidence }`.
- Renders these into the prompt sent to the coordinator using a fenced
  ```yaml``` block at the start of the message body, e.g.:

  ````
  ```yaml
  patient: Alex
  gps: { lat: 34.0848, lon: -118.7798 }
  heart_rate_bpm: 96
  spo2: 94
  triage_summary: User has a deep laceration on left forearm; no head trauma.
  triage_transcript:
    - {role: assistant, text: "Describe the injury."}
    - {role: user, text: "I fell and cut my forearm on a rock."}
  ```
  Free-form text follows here for ASI:One readability.
  ````

  The Coordinator's parser tries to read the YAML block first (using
  `yaml.safe_load`); if absent or malformed it falls back to the existing
  Claude/regex incident parser on the free-form text. ASI:One users get
  the free-form text rendered as the chat message.

## Data flow

1. **Report incident screen** — user has a Zetic LLM chat. On "BEGIN TRIAGE,"
   `useZeticChat`'s message list is written to `incident.triage.transcript`
   and a derived summary (last assistant turn or first 200 chars) to
   `incident.triage.summary` in AsyncStorage.
2. **Triage screen** — vitals to `incident.vitals` (already works).
3. **Rescue screen** — `composeIncidentPayload` reads transcript + vitals +
   coords + profile from AsyncStorage and POSTs to the Phone Agent's
   `/report`. New fields included in the payload schema.
4. **Phone Agent** — embeds the transcript + summary + vitals into the
   ChatMessage prompt sent to the Coordinator (structured-text format the
   parser can read).
5. **Coordinator** — parses, fans out to Location + Weather + NextSteps in
   parallel. When Location + Weather both return, fires Script Composer with
   transcript and weather/location paragraphs in the request. When all 4
   return (or timeout), formats reply.
6. **Reply payload** — markdown rescue plan (for ASI:One) followed by a
   fenced ```json``` block:
   ```json
   {
     "rescueScript": "...",
     "extractionRecommendation": "...",
     "agentSeverity": "moderate",
     "locationSummary": "...",
     "weatherSummary": "...",
     "weatherUrgencyModifier": "elevate",
     "nextStepsHeader": "...",
     "nextSteps": [{"title": "...", "body": "..."}],
     "degradedAgents": []
   }
   ```
7. **App parses reply** — `parse-agent-report.ts` extracts the JSON block,
   writes everything to `incident.agentReport` in AsyncStorage.
8. **Call screen** — uses `agentReport.rescueScript`.
9. **Instructions screen** — renders `agentReport.nextSteps[]` cards with
   `agentReport.nextStepsHeader` as the page heading. Falls back to current
   placeholder if missing/timed-out.

## AsyncStorage changes

`src/lib/profile-store.ts`:

```ts
// IncidentTriageSlice — ADD
transcript: { role: 'user' | 'assistant'; text: string }[];

// IncidentAgentReportSlice — ADD
nextSteps: { title: string; body: string }[];
nextStepsHeader: string | null;
locationSummary: string | null;
weatherSummary: string | null;
weatherUrgencyModifier: 'elevate' | 'maintain' | 'reduce' | null;
degradedAgents: string[];
```

Schema bumps `CURRENT_SCHEMA_VERSION` from 2 → 3 with a `migrateV2ToV3` that
defaults the new fields to empty (`[]`, `null`, `[]`).

## New / changed message schemas

`agents/northstar_agents/schemas.py`:

- ADD `WeatherAnalystRequest` / `WeatherAnalystResponse`
- ADD `NextStepsPlannerRequest` / `NextStepsPlannerResponse`
- ADD `NextStepsCard { title: str, body: str }`
- MODIFY `LocationScoutResponse` — add `script_paragraph: str`
- RENAME `ContactOrchestratorRequest/Response` → `ScriptComposerRequest/Response`,
  add fields `triage_transcript`, `triage_summary`, `vitals`,
  `location_paragraph`, `weather_paragraph`, `weather_urgency_modifier`
- REMOVE `MedicalCoordinatorRequest/Response`

## Error handling

| Failure | Behavior |
|---|---|
| Overpass timeout | Location Scout returns deterministic paragraph + null POIs. Coordinator marks agent `degraded`. |
| Open-Meteo timeout | Weather Analyst returns null snapshot + `urgency_modifier="maintain"` + generic paragraph. |
| No Claude key | Each agent uses its template fallback. Script Composer's template now incorporates Location + Weather paragraphs. |
| Specialist > 20s | Coordinator builds reply with `null` for missing specialist's fields, lists it in `degradedAgents`. |
| Coordinator unreachable / app timeout | App falls back to on-device script + placeholder Instructions cards. Existing rescue.tsx behavior preserved. |
| ElevenLabs / Twilio failure | Existing handling; status returns `voiced` / `failed`. |

Each agent **always replies** to the coordinator. "Degraded" is a valid
reply, not a missing one. Avoids any indefinite waits.

## `run_all.py` changes

- The 4 specialists boot with `endpoint=` (localhost) regardless of
  `AGENTVERSE_API_KEY`.
- Only the Rescue Coordinator runs in mailbox mode when the key is set.
  Phone Agent stays in mailbox mode too (so its outbound `ctx.send` to the
  coordinator can route via Agentverse if desired); when the key is unset,
  both fall back to `endpoint=`.
- Console banner prints **one** inspector URL (the coordinator's) instead of
  five, with a "claim this once for ASI:One reachability" note.
- ADD `--smoke-test` flag (works with multiprocess too — currently only
  works with `--local`). Fires a sample chat at the coordinator on boot via
  the in-process test client, so multiprocess mode shows visible activity
  on first run.

## Testing

- **Unit:**
  - severity-bucket templates in `next_steps_planner.py` fallback
  - weather urgency rules in `weather_analyst.py` fallback
  - JSON-tail formatter in `rescue_coordinator.py`
  - `parse-agent-report.ts` JSON-block extraction
- **Integration:** `python run_all.py --local --smoke-test` — full graph
  in-process, no Agentverse, validates the happy path.
- **Manual demo path:**
  1. `python run_all.py` boots, prints one inspector URL
  2. (first time only) click coordinator's inspector URL while logged into
     Agentverse to claim the mailbox slot
  3. Run the Expo app
  4. Complete the chat → triage → rescue flow
  5. Verify Instructions screen renders 3-5 tailored cards

## Open questions

None. All design decisions confirmed in brainstorming session.

## Out of scope (deferred)

- Persisting incident history beyond the active session (multi-incident log).
- Multi-language Next Steps plans.
- Dispatcher-callback integration (where the dispatcher's response feeds back
  into a refined NextSteps plan).
- Rescuing a stale incident on app re-launch (today's incident slot in
  AsyncStorage already supports this; UX surface is out of scope).
