# Northstar

> *The light that guides you home.*

A backcountry safety companion built for the **UCLA Hackathon 2026**.

You're hiking or biking alone. You take a tumble, sprain your ankle, lose
the trail. Northstar wakes itself up, triages your injury on-device, and —
the moment any signal returns — quietly coordinates a rescue.

- **On-device detection & triage** via [Zetic Melange](https://zetic.ai)
  (accelerometer + GPS anomaly detection, vision triage)
- **Autonomous rescue coordination** via
  [Fetch.ai Agentverse](https://fetch.ai)
  (Location Scout · Medical Coordinator · Contact Orchestrator)
- **Voice-driven dispatch call** via ElevenLabs + Twilio

## Run it

```bash
bun install
bunx expo start          # then press `i`, `a`, or `w`
```

Expo Go works for the current scaffold. Custom dev clients become required
once the on-device ML modules land.

## Configure

Create `.env.local`:

```
EXPO_PUBLIC_MAPS_KEY=<your-google-maps-key>
```

Your Google Cloud project needs the **Maps JavaScript API**, the **Map Tiles
API** with **Photorealistic 3D Tiles** enabled, and a billing account
attached.

## Structure

```
app/                 expo-router routes
components/          BrandMark, GlassCard, Map3D, TabBar
hooks/               use-current-location
src/
  global.css         Tailwind v4 entry + Northstar @theme tokens
  tw/                NativeWind-wrapped View/Text/Pressable/Image/etc.
```

## For coding agents

Read [`AGENTS.md`](./AGENTS.md) before touching this repo. It covers the
pitch, the design philosophy, the stack quirks (NativeWind v5, the
photorealistic map WebView, the lightningcss pin), the color tokens, and
what's done vs. what's ahead.

## Stack

Expo SDK 54 · Expo Router 6 · Reanimated 4 · NativeWind v5 (Tailwind v4) ·
react-native-webview · expo-location · expo-blur · expo-linear-gradient ·
bun.
