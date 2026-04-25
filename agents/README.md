# Northstar — Fetch.ai Agent Network

Three autonomous Fetch.ai uAgents that wake up the moment connectivity returns
and coordinate a backcountry rescue. Reachable from ASI:One via the Chat
Protocol. Built for the **UCLA Hackathon 2026 — Fetch.ai track**.

## The agents

| Agent | Role | Real tools it executes |
|---|---|---|
| **Rescue Coordinator** | Chat-Protocol entrypoint. Parses the user's message into structured fields, fans out to the specialists in parallel, and composes the final dispatch plan. | Anthropic Claude (incident parsing) |
| **Agent A — Location Scout** | Queries POIs around the GPS: nearest ranger station, hospital, helipad, trailhead. Pulls weather and reasons about whether helicopter extraction is feasible. | OpenStreetMap Overpass API · Open-Meteo |
| **Agent B — Medical Coordinator** | Reasons about severity from the on-device triage findings. Outputs an ESI-like urgency score, immediate actions, and what to monitor for. | Anthropic Claude (with a keyword-heuristic fallback in `severity.py`) |
| **Agent C — Contact Orchestrator** | Drafts the dispatcher script (Claude), synthesizes the voice (ElevenLabs), and — only if the user explicitly asks — places the call (Twilio). | Anthropic Claude · ElevenLabs · Twilio |

The Rescue Coordinator publishes its **chat manifest** to Agentverse, so it
shows up in ASI:One the moment you start it with `AGENTVERSE_API_KEY` set.

## What the demo looks like

1. From ASI:One, send the Rescue Coordinator a chat message:

   > *"I just took a hard fall mountain biking on the Backbone Trail near
   > mile marker 7.2 (34.0848°N, -118.7798°W). I'm bleeding from my left
   > forearm but conscious. No head trauma."*

2. Within ~5 seconds, the coordinator dispatches Agents A and B in parallel.
   You'll see in the logs:

   ```
   [Coordinator] chat from agent1q…  (118 chars, place_call=False)
   [Coordinator] req=… dispatched to scout + medical
   [Scout]       req=… → replied
   [Medical]     req=… → moderate (ESI 3)
   [Contact]     req=… → status=voiced
   [Coordinator] final reply sent → agent1q…
   ```

3. ASI:One renders the markdown rescue plan: location summary with the
   recommended extraction path, severity assessment, and the drafted
   dispatcher script.

4. Reply with **"call now"** and the Contact Orchestrator places the call
   via Twilio (only if the keys are set).

## Setup

```bash
cd agents
python -m venv .venv && source .venv/bin/activate     # or pyenv / uv / pipx
pip install -r requirements.txt
```

Env vars are loaded from **two places** in this order — first writer wins:

1. `agents/.env` (Python-side config)
2. `.env.local` at the repo root (shared with the Expo app)

Either is fine. **Every key is optional** — the system degrades gracefully:

| Missing | Effect |
|---|---|
| `AGENTVERSE_API_KEY` | Agents only run locally; not discoverable from ASI:One |
| `ANTHROPIC_API_KEY` | Falls back to regex parsing + keyword severity heuristic |
| `ELEVENLABS_API_KEY` | Returns the script as text only, no MP3 |
| `TWILIO_*` | "Call myself" path still works; "Have Northstar call" returns failed |

## Running it

```bash
python check_setup.py                    # validate env + print expected addresses
python run_all.py                        # production: each agent in its own process, Agentverse-routed
python run_all.py --local                # offline: single Bureau, no Agentverse
python run_all.py --local --smoke-test   # offline + test client fires a sample chat
```

**Default (multiprocess) mode** spawns each agent as its own subprocess on
its own port (8000–8003). uAgents prints an inspector URL for each agent
on startup; click each one once (while logged into Agentverse) to register
that agent's mailbox slot. After that, ASI:One can route messages.

> **Why not Bureau for the Agentverse path?** The Agentverse inspector
> doesn't support Bureaus — it expects one agent per HTTP server. Our
> default multiprocess layout matches what the inspector expects.

**`--local` mode** runs all four agents in a single Bureau, in one process,
with no Agentverse routing. The smoke-test client lives here.

## Testing just the Agentverse layer

You don't need Anthropic, ElevenLabs, or Twilio keys to verify that the
chat-protocol + Agentverse plumbing works. With only `AGENTVERSE_API_KEY`
set:

**1. Static check.** `python check_setup.py` reads your env, prints the
deterministic addresses your seeds map to, and shows the Agentverse profile
URLs. No network calls.

**2. Multiprocess + inspector flow.** `python run_all.py` spawns each
agent as its own subprocess. Each one prints its own inspector URL. While
logged into Agentverse, click each URL once to register the corresponding
mailbox slot. After that, the agents stay registered across runs; you don't
have to click again. Once all four are claimed, you can chat with the
rescue coordinator from [asi1.ai](https://asi1.ai).

**3. End-to-end offline smoke test.** `python run_all.py --local --smoke-test`
spins up the network plus an in-process test client that fires this prompt
at the Rescue Coordinator on startup:

> *"I just took a hard fall mountain biking on the Backbone Trail near
> mile marker 7.2 (34.0848°N, -118.7798°W). I'm bleeding from my left
> forearm but conscious. No head trauma. My name is Jake."*

Within a few seconds you'll see:

```
[SmokeTest] sending sample chat to coordinator…
[Coordinator] chat from agent1q…  (218 chars, place_call=False)
[Coordinator] req=… dispatched to scout + medical
[Scout]       req=… → replied
[Medical]     req=… → moderate (ESI 3)        # heuristic fallback if no Claude
[Contact]     req=… → status=drafted          # template script if no Claude
[Coordinator] final reply sent → agent1q…

═══════════════════════════════════════════════════════════════
  ✓  Coordinator replied — chat protocol round-trip succeeded
═══════════════════════════════════════════════════════════════
# 🌟 Northstar Rescue Coordination
…
```

Pass a different prompt with `--prompt "..."`. Smoke-test mode runs
fully in-process and skips Agentverse entirely — useful when you don't
have internet or want to verify the agent logic without touching ASI:One.

## Deliverables checklist

- [ ] **Agent on Agentverse** — the Rescue Coordinator's address (printed at
  startup) registered via Mailbox by setting `AGENTVERSE_API_KEY`.
- [ ] **ASI:One Chat session URL** — open ASI:One, find your agent, send
  the demo prompt above, copy the share URL.
- [ ] **GitHub repo + Devpost video** — the full project lives at the repo
  root; this `agents/` directory is the Fetch.ai contribution.

## What's actually agentic about this?

The Fetch.ai track asks for "reasoning, tool execution, and a real-world
problem solved." Concretely:

- **Reasoning** — the Medical Coordinator runs Claude with adaptive thinking
  to map free-form triage findings to an ESI urgency score with rationale
  and actions. The Rescue Coordinator parses arbitrary natural-language
  incident reports into structured GPS + injury data.
- **Tool execution** — the Location Scout makes real, observable calls to
  OpenStreetMap (Overpass) and Open-Meteo, then composes their results into
  an extraction recommendation. The Contact Orchestrator chains Claude →
  ElevenLabs → Twilio in a single agentic flow.
- **Coordination** — three independent agents on Agentverse, each with its
  own address and chat protocol manifest, talking to each other through
  uAgent messages. The coordinator fans out, waits on parallel responses,
  then dispatches the third stage. None of it is hard-coded — every agent
  acts on its own data and tools.

## Layout

```
agents/
├── run_all.py                           # Bureau entrypoint
├── requirements.txt
├── .env.example
└── northstar_agents/
    ├── schemas.py                       # uAgents Models for inter-agent messages
    ├── config.py                        # env loading + address registry
    ├── severity.py                      # heuristic medical classifier (fallback)
    ├── rescue_coordinator.py            # Chat Protocol + fan-out
    ├── location_scout.py                # Agent A
    ├── medical_coordinator.py           # Agent B
    ├── contact_orchestrator.py          # Agent C
    └── tools/
        ├── overpass.py                  # OSM POI lookup
        ├── weather.py                   # Open-Meteo
        ├── claude.py                    # Anthropic SDK wrappers
        ├── elevenlabs.py                # voice synthesis
        └── twilio.py                    # outbound calls
```

## Notes for future agents

- **State is in-memory** in `rescue_coordinator.PENDING`. Single-process
  Bureau is fine for the hackathon. Move to Redis if multiple coordinator
  replicas ever run.
- **`set_address()` runs at agent startup**, so the coordinator can't fan
  out before all four agents have booted. The Bureau guarantees that order.
- **The TwiML in `tools/twilio.py` uses `<Say>`** with the text directly.
  Playing the ElevenLabs MP3 over Twilio requires hosting the file at a
  public URL (S3 / Cloudflare R2 / ngrok); add a `<Play>` block then.
- **Twilio safety rail:** `place_call` defaults to `False`; the user must
  reply "call now" to authorize. **Never set `TWILIO_TO_NUMBER=911`** for
  testing — use your own phone.
