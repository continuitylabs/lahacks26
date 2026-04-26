# Northstar — Fetch.ai Agent Network

Four autonomous Fetch.ai uAgent specialists coordinated by a Rescue
Coordinator that wakes up the moment connectivity returns and composes a
backcountry rescue plan. Reachable from ASI:One via the Chat Protocol.
Built for the **UCLA Hackathon 2026 — Fetch.ai track**.

## The agents

| Agent | Role | Real tools it executes |
|---|---|---|
| **Rescue Coordinator** | Chat-Protocol entrypoint. Parses the user's message (YAML header or free-form) into structured fields, fans out to all 4 specialists in parallel, and composes the final markdown + JSON reply. | Anthropic Claude (incident parsing), PyYAML |
| **Agent A — Location Scout** | Queries POIs around the GPS: nearest ranger station, hospital, helipad, trailhead. Composes a dispatcher-ready paragraph about rescue assets and recommended extraction. | OpenStreetMap Overpass API · Anthropic Claude |
| **Agent B — Weather Analyst** | Fetches current + forecast weather. Reasons about how conditions affect urgency for the specific incident (severity + injury keywords). Outputs `urgency_modifier` ∈ {elevate, maintain, reduce} and a script paragraph. | Open-Meteo · Anthropic Claude |
| **Agent C — Script Composer** | Integrates everything (parsed incident, on-device Zetic LLM transcript, vitals, Location paragraph, Weather paragraph) into the final dispatcher script. Optionally synthesizes voice via ElevenLabs and places the call via Twilio. | Anthropic Claude · ElevenLabs · Twilio |
| **Agent D — Next Steps Planner** | Produces 3-5 structured "what to do right now" cards for the post-call Instructions screen, scaled to severity. | Anthropic Claude (with severity-bucketed templates as fallback) |

The Rescue Coordinator publishes its **chat manifest** to Agentverse, so it
shows up in ASI:One the moment you start it with `AGENTVERSE_API_KEY` set.
**Only the coordinator needs a mailbox claim** — specialists run with
localhost endpoints, so agent→agent routing works without manual setup.

## What the demo looks like

1. From ASI:One, send the Rescue Coordinator a chat message:

   > *"I just took a hard fall mountain biking on the Backbone Trail near
   > mile marker 7.2 (34.0848°N, -118.7798°W). I'm bleeding from my left
   > forearm but conscious. No head trauma."*

2. Within ~5 seconds, the coordinator dispatches Agents A, B, and D in
   parallel; once A and B complete it dispatches C with their outputs.
   You'll see in the logs:

   ```
   [Coordinator] chat from agent1q…  (118 chars, place_call=False)
   [Coordinator] req=… dispatched scout + weather + next_steps
   [Scout]       req=… → replied
   [Weather]     req=… → claude elevate
   [NextSteps]   req=… → claude 4 cards
   [Coordinator] req=… → dispatched script_composer
   [Script]      req=… → status=drafted
   [Coordinator] final reply sent → agent1q…
   ```

3. ASI:One renders a markdown rescue plan with sections for each agent,
   followed by a fenced ```json``` block carrying structured fields the
   Expo app parses: `rescueScript`, `nextSteps`, `weatherUrgencyModifier`,
   `degradedAgents`, etc.

4. Reply with **"call now"** and the Script Composer places the call via
   Twilio (only if the keys are set).

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
| `AGENTVERSE_API_KEY` | Coordinator runs in endpoint mode; not discoverable from ASI:One. App→Coordinator path still works. |
| `ANTHROPIC_API_KEY` | Each agent falls back to its template/heuristic (regex parsing, weather rule table, severity-bucketed cards). |
| `ELEVENLABS_API_KEY` | Returns the script as text only, no MP3. |
| `TWILIO_*` | "Call myself" path still works; "Have Northstar call" returns failed. |

## Running it

```bash
python check_setup.py                    # validate env + print expected addresses
python run_all.py                        # production: each agent in its own process, Coordinator on Agentverse
python run_all.py --local                # offline: single Bureau, no Agentverse
python run_all.py --local --smoke-test   # offline + test client fires a sample chat
python run_all.py --smoke-test           # multiprocess + test client
```

**Default (multiprocess) mode** spawns each agent as its own subprocess on
its own port (8000–8005). Only the Rescue Coordinator runs in mailbox mode
when `AGENTVERSE_API_KEY` is set. uAgents prints **one** inspector URL (the
coordinator's) — click it once while logged into Agentverse to register the
mailbox slot. After that, ASI:One can route messages.

> **Why coordinator-only mailbox?** Agentverse-routed agent→agent
> communication requires every recipient to have a claimed mailbox slot.
> By keeping specialists on localhost endpoints, the network works
> first-try without any manual setup beyond the single coordinator claim.

**`--local` mode** runs all six agents in a single Bureau, in one process,
with no Agentverse routing. The smoke-test client lives here.

## Testing just the Agentverse layer

You don't need Anthropic, ElevenLabs, or Twilio keys to verify that the
chat-protocol + Agentverse plumbing works. With only `AGENTVERSE_API_KEY`
set:

**1. Static check.** `python check_setup.py` reads your env, prints the
deterministic addresses your seeds map to, and shows the Agentverse profile
URLs. No network calls.

**2. Multiprocess + inspector flow.** `python run_all.py` spawns each
agent as its own subprocess. Click the coordinator's inspector URL once
to register its mailbox slot. After that, the agents stay registered
across runs; you don't have to click again. Once the coordinator is claimed,
you can chat with it from [asi1.ai](https://asi1.ai).

**3. End-to-end offline smoke test.** `python run_all.py --local --smoke-test`
spins up the network plus an in-process test client that fires this prompt
at the Rescue Coordinator on startup:

> *"I just took a hard fall mountain biking on the Backbone Trail near
> mile marker 7.2 (34.0848°N, -118.7798°W). I'm bleeding from my left
> forearm but conscious. No head trauma. My name is Jake."*

Within a few seconds you'll see the coordinator dispatching all 4
specialists, their replies, the script composer firing once Location +
Weather complete, and the final markdown + JSON tail reply. Pass a
different prompt with `--prompt "..."`. Smoke-test mode runs fully
in-process and skips Agentverse entirely — useful when you don't have
internet or want to verify the agent logic without touching ASI:One.

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

- **Reasoning** — every specialist reasons. Location Scout composes a
  dispatcher-ready paragraph from raw POI tuples. Weather Analyst maps
  current conditions + injury context to an `urgency_modifier`. Script
  Composer integrates 7+ signals into one optimized voice script. Next
  Steps Planner generates severity-tailored first-aid cards.
- **Tool execution** — Overpass (real OSM queries), Open-Meteo (real
  weather), Claude (real LLM reasoning), ElevenLabs (real voice),
  Twilio (real outbound calls).
- **Coordination** — five independent agents (Coordinator + 4 specialists)
  on the Fetch.ai bus, each with its own address and (for the
  coordinator) a published chat-protocol manifest, talking to each
  other through uAgent messages. The coordinator fans out, conditionally
  dispatches the script composer once Location + Weather are in, and
  settles to a final markdown + JSON reply when all 4 specialists return
  (or 20s elapse).

## Layout

```
agents/
├── run_all.py                           # Multiprocess + Bureau entrypoint
├── run_one.py                           # Subprocess launcher
├── requirements.txt
├── .env.example
└── northstar_agents/
    ├── schemas.py                       # uAgents Models for inter-agent messages
    ├── config.py                        # env loading + address registry
    ├── rescue_coordinator.py            # Chat Protocol + fan-out + JSON tail reply
    ├── location_scout.py                # Agent A
    ├── weather_analyst.py               # Agent B
    ├── script_composer.py               # Agent C
    ├── next_steps_planner.py            # Agent D
    ├── phone_agent.py                   # User's-device proxy (REST → Chat Protocol)
    ├── test_client.py                   # In-process smoke-test client
    └── tools/
        ├── overpass.py                  # OSM POI lookup
        ├── weather.py                   # Open-Meteo
        ├── claude.py                    # Anthropic SDK wrappers (5 call sites)
        ├── elevenlabs.py                # voice synthesis
        └── twilio.py                    # outbound calls
```

## Notes

- **State is in-memory** in `rescue_coordinator.PENDING`. Single-process
  Bureau is fine for the hackathon. Move to Redis if multiple coordinator
  replicas ever run.
- **Coordinator settles after 20s** even if a specialist is silent — the
  reply's `degradedAgents` array names which agents timed out, so the
  Expo app can degrade the UX gracefully.
- **Twilio safety rail:** `place_call` defaults to `False`; the user must
  reply "call now" to authorize. **Never set `TWILIO_TO_NUMBER=911`** for
  testing — use your own phone.
