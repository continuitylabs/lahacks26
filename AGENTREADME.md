# Northstar Rescue Coordinator

Public chat entrypoint for the **Northstar** wilderness emergency-response
network. Northstar is an on-device safety system for hikers and mountain
bikers: when a fall or medical event is detected, the user's phone captures
vitals + location + a short triage transcript and sends an incident report
here. This agent fans the report out to four specialist agents, composes a
single dispatcher-ready rescue plan, and routes a synthesized voice call +
SMS briefing to the user's emergency contact.

After the alert fires, this agent doubles as the **Q&A surface for the
emergency contact** — they can chat here to ask follow-up questions about
the incident without re-triggering the rescue pipeline.

```
Address: agent1qww33mncvj0f0ewujh38t8yhny08pxf6v8tee9658x47knw6hf9hum7f8sq
Protocol: Fetch.ai Chat Protocol
Reachable from: ASI:One, any uAgent
```

---

## Two modes, one agent

### 1. New incident report (the patient's device → coordinator)

When a structured message arrives — typically with a fenced YAML header
containing GPS, vitals, and triage transcript — the coordinator:

1. **Parses** the incident (YAML when present, Claude or regex fallback).
2. **Fans out** to four specialists in parallel:
   - **Location Scout** — pulls nearby ranger stations, hospitals,
     helipads, and trailheads from OpenStreetMap; recommends an
     extraction approach.
   - **Weather Analyst** — pulls Open-Meteo conditions, asks Claude
     whether weather *elevates*, *maintains*, or *reduces* the urgency
     given the injury profile.
   - **Script Composer** — drafts the dispatcher-ready voice script that
     ElevenLabs reads on the actual emergency call.
   - **Next Steps Planner** — generates 3-5 action cards for the patient
     to follow while waiting for help (first aid, stabilization,
     conservation of warmth/battery).
3. **Settles** when all four specialists reply, or 20s elapses (whichever
   comes first; partial replies are still returned).
4. **Returns markdown** with sections per specialist plus a fenced JSON
   tail the patient's device parses for structured fields.

The reply ends the chat session — this side of the protocol is one-shot
incident → plan.

### 2. Emergency-contact follow-up Q&A (contact → coordinator, via ASI:One)

After the rescue pipeline finishes, the coordinator stashes the briefing
under a short hex case ID and includes that ID in the SMS that goes to
the patient's emergency contact. The SMS reads roughly:

```
NORTHSTAR EMERGENCY ALERT

Patient: Alex Bonev
Location: 34.08400, -118.78000 (Topanga ridge)
Vitals: HR 110 bpm, SpO2 94%
Severity: SEVERE

Talk to the rescue coordinator agent
https://agentverse.ai/agents/details/agent1qww33mn.../profile

Paste this as your first message to load the briefing:
Status update on Alex Bonev (case a3f8c2)
```

The contact opens the agent profile, taps Chat, pastes that line. The
coordinator regex-matches `case <id>`, loads the stored briefing, and
replies with the full rescue plan plus an "Ask me anything" intro. This
session **stays open** — the contact can ask follow-up questions and
the coordinator answers each one with Claude, using the briefing as the
sole source of truth.

---

## What you can ask in Q&A mode

The coordinator can answer factually about anything in the briefing:

- **Vitals** — heart rate, SpO2, blood pressure at the moment of report,
  vitals confidence
- **Location** — GPS coordinates, nearby rescue assets, recommended
  extraction point
- **Weather** — current conditions, urgency modifier, helicopter
  flyability
- **Injury** — triage findings, what the patient described, severity hint
- **Dispatch** — the exact script that was read to dispatch / your
  emergency contact, what number was called
- **Next steps** — the action cards generated for the patient

What it explicitly **cannot** tell you, and will say so plainly:

- Live vital updates after the incident report
- Whether rescue has arrived
- Current location after the report (no live GPS)
- Anything not captured in the briefing

If the case ID can't be found (e.g. the coordinator was restarted since
the alert), it asks the contact to paste the original incident details
and works from those.

---

## Example interactions

### New incident (structured, from the patient's device)

```yaml
patient: Alex Bonev
gps: { lat: 34.084, lon: -118.78 }
heart_rate_bpm: 112
spo2: 93
triage_summary: Fell on a ridge trail. Suspected ankle fracture, alert.
triage_findings: [fracture, ankle]
emergency_contact: "Sara (+1-408-555-0100)"
place_call: true
```

Reply: full markdown rescue plan with sections per specialist, plus a
fenced JSON tail for structured parsing. Session ends.

### Follow-up Q&A (from the emergency contact, after the SMS)

> **Contact:** Status update on Alex Bonev (case a3f8c2)
>
> **Coordinator:** Loaded the briefing for **Alex Bonev** (case `a3f8c2`).
> This reflects the incident at the moment it was reported — I don't have
> live updates. Ask me anything about vitals, location, weather, next
> steps, or what dispatch was told.
>
> *[full rescue plan markdown follows]*
>
> **Contact:** What was her heart rate?
>
> **Coordinator:** 112 bpm at the time of the report, SpO2 93%. The
> on-device confidence on those readings was 78%.
>
> **Contact:** How far is the nearest helipad?
>
> **Coordinator:** The closest helipad in the briefing is Topanga
> Helistop, 2.3 km west. Conditions were marked helo-flyable, and the
> Weather Analyst rated the urgency as "elevate" because of an
> incoming high-pressure window narrowing within ~90 minutes.
>
> **Contact:** Has someone arrived yet?
>
> **Coordinator:** I don't have live updates on rescue arrival — the
> briefing reflects only the moment of the report. The dispatch script
> was sent to your emergency contact number and to the configured
> services; reach out to the dispatcher directly for ETA.

---

## Technical contract

- **Protocol:** Fetch.ai Chat Protocol (`chat_protocol_spec`)
- **Acknowledgement:** every inbound `ChatMessage` is acked immediately
- **New-incident reply:** single `ChatMessage` with markdown text +
  `EndSessionContent`
- **Q&A reply:** single `ChatMessage` with markdown text, **no**
  `EndSessionContent` (session stays open for follow-ups)
- **Briefing key format:** 6 hex chars (`[0-9a-f]{6}`), regex pattern
  `\bcase\s+([0-9a-f]{6})\b`
- **Briefing TTL:** in-memory only, lifetime of the coordinator process
- **Fan-out timeout:** 20s before partial-reply

Specialist agents run with localhost endpoints and are not directly
addressable from ASI:One — they are coordinator-internal.

---

## Privacy & limitations

- Briefings are stored in-process on the coordinator host, not on
  Agentverse. Restarting the agent wipes them.
- The coordinator's Claude calls send the patient briefing to
  Anthropic for Q&A reasoning. Don't include data you wouldn't want
  to flow through that path.
- This agent is a coordination layer, not a replacement for emergency
  services. Real dispatch goes through the configured Twilio +
  ElevenLabs path on the patient's device, not through this chat.
- Severity hints, urgency modifiers, and next-steps cards are
  best-effort guidance from a language model. Treat them as a
  *briefing*, not a clinical assessment.

---

## Related agents

- **Location Scout** — OSM Overpass + nearest-asset selection
- **Weather Analyst** — Open-Meteo + Claude urgency assessment
- **Script Composer** — Claude → dispatch script + ElevenLabs voice
- **Next Steps Planner** — Claude → action cards for the post-call screen
- **Phone Agent** — on-device proxy that routes the patient app's
  REST calls into the Chat Protocol

Built for LA Hacks 2026.
