# Northstar — Agent Guide

This file is the entry-point context for any AI coding agent working on this
repository. Read it before touching code.

## What we're building

**Northstar** is a backcountry safety companion built for the **UCLA Hackathon
2026**. The pitch in one sentence: *the light that guides you home.*

The scenario: you're hiking or biking alone, take a tumble, sprain an ankle,
and don't know where you are. Northstar is the app that:

1. **Notices the fall before you can speak** — accelerometer + GPS anomaly
   model, on-device, via **Zetic Melange**.
2. **Triages the injury offline** — point the camera at the wound; a quantized
   vision model (also Melange) classifies severity frame-by-frame.
3. **Coordinates rescue the moment any signal returns** — three **Fetch.ai**
   agents (Location Scout, Medical Coordinator, Contact Orchestrator) work in
   parallel against Agentverse to draft a precise rescue script.
4. **Calls dispatch with the user's permission** — **ElevenLabs** voice +
   **Twilio** call. The user picks "Call myself with this script" or "Have
   Northstar call and read it."

### Hackathon track requirements

- **Zetic** — must run a real on-device model via Melange (impact detection +
  vision triage).
- **Fetch.ai** — must have observable agent coordination via Agentverse
  (Scout/Medical/Orchestrator).
- ElevenLabs and Twilio are the wow-moment integrations, not a track
  requirement, but central to the demo.

## Design philosophy

> Technical, but comfortable. Innovative, but rooted in nature. Easy to
> present, but fascinating — with clear emphasis on what counts.

- **The map is the world.** Photorealistic 3D Google Maps fills the screen.
  UI floats above as glass + light.
- **One thing matters at a time.** The home screen has a single primary
  action. Everything else is set dressing or status.
- **Type carries the warmth.** The wordmark is a serif. Telemetry
  (coordinates, status, chips) is monospace. UI labels are sans.
- **Star + nature palette.** Forest greens for ground, near-black for HUD
  surfaces, **amber `#F0B86E`** for the guiding star — the only color that
  draws the eye.
- **Crimson is sacred.** `#E5484D` is reserved for *true* emergency states.
  Don't paint anything red unless someone could be hurt.

## Stack

| Layer            | Choice                                       |
|------------------|----------------------------------------------|
| Runtime          | **Expo SDK 54** (Expo Go compatible so far)  |
| Package manager  | **bun**                                      |
| Routing          | **expo-router 6** (file-based, typed routes) |
| Styling          | **NativeWind v5 + Tailwind v4** (CSS-first)  |
| 3D map           | Photorealistic 3D Tiles via `<gmp-map-3d>` in a `react-native-webview` |
| Animation        | `react-native-reanimated`                    |
| Blur / glass     | `expo-blur`                                  |
| Location         | `expo-location`                              |
| Haptics          | `expo-haptics` (iOS only)                    |

### Important version notes

- NativeWind v5 + Tailwind v4 means **NO `babel.config.js` needed and NO
  `tailwind.config.js`**. All theme is defined inside `@theme {}` in
  `src/global.css`. If a future agent suggests creating either of these files,
  push back — that pattern is from v3/v4-of-NativeWind.
- The CSS wrappers in `src/tw/` are required: bare `react-native` `<View>`
  and `<Text>` will not accept `className`. Always import from `@/src/tw`.
- `package.json` pins `lightningcss@1.30.1` via `resolutions`. Do not remove
  this — newer versions break Tailwind v4's PostCSS pipeline on RN.

## Repo layout — two halves

This repo is two projects in one directory:

| Path | What it is |
|---|---|
| `app/`, `components/`, `src/`, `hooks/` | The **Expo / React Native client** — the app on the user's phone |
| `agents/` | The **Fetch.ai agent network** in Python — the Rescue Coordinator + 3 specialist agents that run on Agentverse |

The two halves don't share code. They communicate via the Chat Protocol:
the app sends a chat message to the Rescue Coordinator on Agentverse, the
agent system fans out and replies. See `agents/README.md` for the full
agent-side guide.

## Running it

**Frontend (Expo):**

```bash
bun install
bunx expo start             # then press `i` for iOS / `a` for Android / `w` for web
```

**Agent network (Python, in a separate terminal):**

```bash
cd agents
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in keys you have; system degrades gracefully without them
python run_all.py
```

Expo Go works for everything currently in the frontend. The moment we add
custom native modules (Zetic Melange likely needs one), switch to
`bunx expo run:ios` or an EAS dev client.

## Environment

`.env.local`:

```
EXPO_PUBLIC_MAPS_KEY=<google-maps-js-api-key-with-maps3d-and-photorealistic-3d-tiles-enabled>
maps_key=<same-key-kept-for-non-Expo-tooling>
```

The key needs:
- **Maps JavaScript API**
- **Map Tiles API** with **Photorealistic 3D Tiles** enabled
- A billing account attached (Google requires it even on free tier)

If the map shows a dark "acquiring terrain…" forever, the key likely lacks
one of those. Check the Cloud Console.

## File map

```
app/
  _layout.tsx                Root stack: tabs + report-incident modal
  report-incident.tsx        Modal — entry to the (future) triage flow
  (tabs)/
    _layout.tsx              Tabs with our custom <TabBar /> component
    index.tsx                Home — map + brand + Report CTA
    profile.tsx              Profile placeholder (emergency contacts, baseline)
    info.tsx                 Info — story, stack, credits

components/
  brand-mark.tsx             NORTHSTAR wordmark with pulsing star glyph
  glass-card.tsx             Frosted-glass surface (BlurView + tinted bg)
  map-3d.tsx                 Photorealistic 3D map WebView, slow auto-revolve
  tab-bar.tsx                Floating glass bottom nav (custom Tabs `tabBar`)

hooks/
  use-current-location.ts    expo-location + UCLA fallback

src/
  global.css                 Tailwind v4 entry + @theme tokens (the palette)
  tw/
    index.tsx                CSS-wrapped View/Text/Pressable/Link/etc.
    image.tsx                CSS-wrapped expo-image with object-fit remap

.env.local                   Maps key (NOT committed)
metro.config.js              `withNativewind` wiring
postcss.config.mjs           @tailwindcss/postcss plugin
```

## Conventions

- **kebab-case** filenames everywhere. `brand-mark.tsx`, not `BrandMark.tsx`.
- **Tailwind classes via the `@/src/tw` wrappers.** Never import `View` from
  `react-native` directly in screen code; always from `@/src/tw`.
- **Path alias is `@/*` → repo root.** So `@/components/brand-mark`,
  `@/src/tw`, `@/hooks/use-current-location`. There is no `src/` alias —
  keep `src/` in the path.
- **Theme tokens are in `src/global.css`**, exposed as `bg-ns-*`,
  `text-ns-*`, `border-ns-*`. Add new colors there, not via inline values.
- **Inline styles for one-offs are fine** (per Expo guidance), but anything
  reused twice should become a Tailwind class via a token in `global.css`.
- **`borderCurve: 'continuous'`** on every rounded surface that isn't a full
  capsule — Apple-style smooth corners.
- **Haptics are iOS-only.** Wrap every `Haptics.*` call in
  `if (Platform.OS === 'ios')`.
- **`process.env.EXPO_OS`** is preferred over `Platform.OS` for build-time
  branching (per Expo guidance), but `Platform.OS` is fine at runtime — both
  appear in the codebase.

## The map

`components/map-3d.tsx` renders Google's Photorealistic 3D Tiles via the
**`<gmp-map-3d>`** web component (Maps JS API, alpha channel) inside a
`react-native-webview`. A simple `requestAnimationFrame` loop nudges the
camera `heading` ~0.04°/frame, completing a full revolution in ~2.5 minutes.

The WebView is `pointerEvents="none"` and `scrollEnabled={false}` so the map
never steals taps from the HUD above. **It is intentional set dressing.** If
a future feature needs an interactive map (e.g., Rescue tab pinning rescue
zones), build a *separate* component — don't unlock this one.

On web, the same HTML is rendered into an `<iframe srcDoc>` since
react-native-webview is mobile-only.

## Color tokens (cheat sheet)

| Token                | Hex / value                  | Use                               |
|----------------------|------------------------------|-----------------------------------|
| `bg-ns-void`         | `#0b0e12`                    | Root background, dark text on amber |
| `bg-ns-forest`       | `#0f1f1a`                    | Atmospheric gradient top          |
| `bg-ns-bark`         | `#1a2620`                    | Subtle surfaces                   |
| `bg-ns-glass`        | `rgba(255,255,255,0.08)`     | Glass card fill (iOS)             |
| `bg-ns-glass-strong` | `rgba(255,255,255,0.14)`     | Glass card fill (Android/web)     |
| `border-ns-glass-edge` | `rgba(255,255,255,0.18)`   | Glass card 1px edge               |
| `bg-ns-star`         | `#F0B86E`                    | Primary CTA, focused tab          |
| `text-ns-star`       | `#F0B86E`                    | Star glyph, chip text             |
| `text-ns-star-soft`  | `#F8D9A6`                    | Hover/glow accents                |
| `text-ns-safe`       | `#6CC28A`                    | Connected / OK status dot         |
| `text-ns-alert`      | `#F0B86E`                    | Locating / pending status         |
| `text-ns-critical`   | `#E5484D`                    | TRUE emergency only               |
| `text-ns-text`       | `#F5EFE4`                    | Primary copy                      |
| `text-ns-text-muted` | `rgba(245,239,228,0.65)`     | Body/secondary                    |
| `text-ns-text-faint` | `rgba(245,239,228,0.4)`      | Inactive / hints / monospace meta |

Type families:
- `font-display` → serif (wordmark, big titles)
- `font-mono`    → monospace (telemetry, chips, status)
- system sans is the default for everything else

## The agent network (`agents/`)

The Fetch.ai contribution is a Python package under `agents/`. Four uAgents
in one Bureau (locally) or four agents on Agentverse (production):

| Agent | File | Role |
|---|---|---|
| Rescue Coordinator | `agents/northstar_agents/rescue_coordinator.py` | Chat-Protocol entry. Parses incident → fans out → composes final markdown reply. |
| Location Scout | `agents/northstar_agents/location_scout.py` | OSM Overpass + Open-Meteo → POI + weather + extraction recommendation. |
| Medical Coordinator | `agents/northstar_agents/medical_coordinator.py` | Claude (or heuristic) → severity + actions + monitoring. |
| Contact Orchestrator | `agents/northstar_agents/contact_orchestrator.py` | Claude → script. ElevenLabs → voice. Twilio → call (only if user said `call now`). |

Inter-agent messages are uAgents `Model` classes in
`agents/northstar_agents/schemas.py`. Real tools live under `tools/`.

Conventions for the agent side:
- **Default Claude model is `claude-opus-4-7`.** Override via the
  `CLAUDE_MODEL` env var. Adaptive thinking everywhere; **never** add
  `temperature` / `top_p` / `top_k` / `budget_tokens` — they 400 on Opus 4.7.
- **Every external API is optional.** Each tool returns `None` on missing key
  or failure; the agent that called it falls back to a heuristic or template.
  Don't add hard "raise if missing" checks — the demo must run with zero keys.
- **`place_call` defaults to `False`.** Twilio only fires when the user
  explicitly replies `call now` in the chat protocol. Do not change this
  default. **Never set `TWILIO_TO_NUMBER=911`** for testing.
- **State is in-memory** in `rescue_coordinator.PENDING`. Single-process
  Bureau is sufficient for the hackathon.

Read `agents/README.md` for the demo prompt, deliverables checklist, and
deployment notes.

## What's done vs. what's ahead

**Done (this scaffold):**
- Home page with revolving 3D map, brand mark, Report Incident CTA, glass tab bar
- Profile + Info placeholder pages with on-brand vibe
- Report Incident modal showing the 3-step flow narrative
- Tailwind v4 / NativeWind v5 fully wired
- Theme tokens, animation primitives, location hook, glass primitives
- **Fetch.ai agent network** — Rescue Coordinator (Chat Protocol) + Location
  Scout + Medical Coordinator + Contact Orchestrator, with real tool calls
  to OSM Overpass, Open-Meteo, Claude, ElevenLabs, and Twilio

**Not done (in priority order):**
1. **Triage page** — camera viewfinder + on-device vision model (Zetic Melange).
   This is the highest-impact missing piece for the demo.
2. **Detection background service** — accelerometer + GPS anomaly model,
   "Are you okay?" wake-up prompt.
3. **Frontend ↔ agent bridge** — wire the Report Incident "BEGIN TRIAGE"
   button to send a chat message to the Rescue Coordinator on Agentverse,
   then render the markdown response on a Rescue screen. Agent backend is
   already done (see `agents/`); just need the client glue.
4. **ElevenLabs + Twilio call flow** — script preview + "Call myself / Have
   Northstar call" buttons.
5. **Real Google Cloud project setup** — make sure Photorealistic 3D Tiles
   billing is on before the demo.

## Demo storyline (judges will see this)

The flow you should optimize the experience for:

1. Open app → home screen, map gently revolves around their location, the
   wordmark pulses softly. **(this scaffold)**
2. Tap Report Incident → modal shows the 3-step rescue narrative. **(this
   scaffold)**
3. Begin triage → camera opens, AI overlay highlights the wound and reads
   "moderate laceration, no head trauma." **(TODO)**
4. Connectivity returns → three agent cards animate as Fetch.ai agents work.
   Map zooms to extraction point. **(TODO)**
5. Rescue script appears → user taps "Have Northstar call." ElevenLabs voice
   reads it to dispatch. **(TODO)**

Every screen we build should serve that storyline. If a feature doesn't
appear in those five beats, it's not for the hackathon.

## Things to NOT do

- Don't add `tailwind.config.js` or `babel.config.js` for Tailwind. Tailwind
  v4 + NativeWind v5 is CSS-first.
- Don't import `View`/`Text` from `react-native` in screen code — use
  `@/src/tw`.
- Don't unlock the home-screen map for interaction.
- Don't paint anything red unless it's a true emergency state.
- Don't add a backend until the on-device pieces are real. The whole pitch
  is "it works without you."
