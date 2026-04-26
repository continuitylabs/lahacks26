# Triage Chat (Zetic intake before PPG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a brief Zetic-driven triage interview between `/report-incident` and `/triage` that persists its transcript into `incident.triage`, with a 3-segment progress bar and an always-available Continue button.

**Architecture:** New Expo Router modal screen `/triage-chat`. Reuses `useZeticChat` (parameterised with a new triage-interview system prompt) and the chat-bubble UI vocabulary already in `app/(tabs)/chat.tsx`. Each assistant turn finalising patches the active incident's `triage` slice via the existing `updateIncident` action — `composeIncidentPayload` already forwards that to the Fetch.ai network, so no downstream wiring changes.

**Tech Stack:** Expo Router · React Native · Zetic Melange (Qwen3-4B on-device) · `useZeticChat` hook · `ProfileStore` (zustand-style provider with `updateIncident`).

**Spec:** `docs/superpowers/specs/2026-04-26-triage-chat-design.md`

**Note on testing:** This repo currently has no test runner configured (no `jest`, no `*.test.*`, no test script in `package.json`). Standing up Jest + React Native Testing Library + Zetic native-module mocks is materially larger than the feature itself and out of scope. Verification in this plan is manual: each task ends with either a TypeScript check (`bun run tsc --noEmit` or `npx tsc --noEmit`) and/or an explicit on-device smoke step. If the project later adds a test runner, return and add unit tests for Task 1 (the pure hook signature change is the easiest test target).

---

## File Structure

**Create:**
- `app/triage-chat.tsx` — the new modal screen (chat UI + progress + Continue + transcript persistence).

**Modify:**
- `hooks/use-zetic-chat.ts` — accept an optional `systemPrompt` argument; keep current SALT prompt as the default so the Guide tab is unchanged.
- `app/report-incident.tsx` — change header text and route the `BEGIN TRIAGE` button to `/triage-chat`.
- `app/_layout.tsx` — register the new `triage-chat` Stack screen with the same modal options as `report-incident`.

**Untouched (verified by reading):**
- `src/lib/profile-store.ts`, `src/lib/profile-store-provider.tsx` — the `IncidentTriageSlice` shape and `updateIncident` action already match what we need.
- `src/lib/compose-incident-payload.ts` — already forwards `triageTranscript`, `triageSummary`, `triageFindings`.
- `app/triage.tsx`, `app/rescue.tsx`, `app/call.tsx` — downstream of the new screen, no changes required.

---

## Task 1: Parameterise the system prompt in `useZeticChat`

**Files:**
- Modify: `hooks/use-zetic-chat.ts:18-32, 104, 184`

The hook currently bakes the SALT prompt into a module-level `SYSTEM_PROMPT` constant and uses it inside `send`. We introduce an options argument with an optional `systemPrompt` override that defaults to the existing SALT prompt. The Guide tab is unaffected because it passes no argument.

- [ ] **Step 1: Rename the existing constant and add the options-aware hook**

In `hooks/use-zetic-chat.ts`, rename `SYSTEM_PROMPT` to `DEFAULT_SYSTEM_PROMPT` (so the new constant we add in Task 4 has a parallel name) and change the hook signature.

Find:

```ts
const SYSTEM_PROMPT = `You are a helpful assistant that helps the user with hiking emergencies in remote locations. ...`;
```

Replace with:

```ts
const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that helps the user with hiking emergencies in remote locations. ...`;
```

(Keep the full prompt body verbatim; only the variable name changes.)

Then change:

```ts
export function useZeticChat() {
```

to:

```ts
export type UseZeticChatOptions = {
  /** Override the system prompt. Defaults to the SALT-method emergency prompt. */
  systemPrompt?: string;
};

export function useZeticChat(options?: UseZeticChatOptions) {
  const systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
```

- [ ] **Step 2: Use the resolved prompt inside `send`**

Find inside `send`:

```ts
const prompt = buildPrompt(next, SYSTEM_PROMPT);
```

Replace with:

```ts
const prompt = buildPrompt(next, systemPrompt);
```

- [ ] **Step 3: Add `systemPrompt` to the `send` callback's dependency array**

Find:

```ts
[isGenerating, messages, status.kind],
```

Replace with:

```ts
[isGenerating, messages, status.kind, systemPrompt],
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 5: Smoke-check the Guide tab is unchanged**

Run the dev server (`bun run start` or `npx expo start`) on iOS, open the Guide tab, send "hello", confirm the assistant still replies in SALT-method style. (No new behaviour expected — this is regression-only.)

- [ ] **Step 6: Commit**

```bash
git add hooks/use-zetic-chat.ts
git commit -m "refactor(zetic-chat): allow system prompt override via hook options"
```

---

## Task 2: Register the `/triage-chat` route

**Files:**
- Modify: `app/_layout.tsx:31-71`

The screen is a transparent modal so it can layer over the home screen the same way `report-incident` does.

- [ ] **Step 1: Add the new Stack.Screen entry**

In `app/_layout.tsx`, find the `report-incident` block:

```tsx
<Stack.Screen
  name="report-incident"
  options={{
    presentation: 'modal',
    headerShown: false,
    contentStyle: { backgroundColor: 'transparent' },
  }}
/>
```

Add **immediately after it**:

```tsx
<Stack.Screen
  name="triage-chat"
  options={{
    presentation: 'modal',
    headerShown: false,
    contentStyle: { backgroundColor: 'transparent' },
  }}
/>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Expo Router will not yet have a file at `app/triage-chat.tsx`; this is fine — the route is declared and only resolves at navigation time.)

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(triage-chat): register /triage-chat modal route"
```

---

## Task 3: Update `report-incident.tsx` — header copy + new route target

**Files:**
- Modify: `app/report-incident.tsx:41-44, 98`

- [ ] **Step 1: Change the header text**

Find:

```tsx
Are you okay?
```

Replace with:

```tsx
The rescue plan.
```

- [ ] **Step 2: Repoint `beginTriage` at the new screen**

Find:

```ts
const beginTriage = async () => {
  await startIncident('manual');
  router.replace('/triage');
};
```

Replace with:

```ts
const beginTriage = async () => {
  await startIncident('manual');
  router.replace('/triage-chat');
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke-check**

Open the app, tap Report Incident on Home, verify:
1. The header now reads "The rescue plan."
2. Tapping `BEGIN TRIAGE` no longer goes to PPG (it will currently fail to load the missing `/triage-chat` screen — that is expected and gets fixed in Task 4).

- [ ] **Step 5: Commit**

```bash
git add app/report-incident.tsx
git commit -m "feat(report-incident): retitle header and route to /triage-chat"
```

---

## Task 4: Scaffold `app/triage-chat.tsx` (UI shell + chat thread)

**Files:**
- Create: `app/triage-chat.tsx`

This task gets the screen rendering with: ✕ button, progress meter (static at 0/3 for now), Continue button, an opener message, and the streaming chat thread. Counter logic and persistence come in Tasks 5–7.

- [ ] **Step 1: Write the file**

Create `app/triage-chat.tsx` with the following complete contents:

```tsx
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/components/glass-button';
import { GlassCard } from '@/components/glass-card';
import { useZeticChat } from '@/hooks/use-zetic-chat';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, Text, TextInput, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#2D7A4F',
  starDeep: '#1A5535',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  bubbleAi: 'rgba(255,255,255,0.06)',
  void: '#0b0e12',
};

const TRIAGE_SYSTEM_PROMPT = `You are Northstar's on-device triage assistant. The user just reported an incident on a hike and is about to do a fingertip pulse scan. Gather a brief field history in at most three short exchanges.

Rules:
- Ask exactly one targeted assessment question per reply.
- Prioritise in order: mechanism of injury, pain location and severity, mobility, bleeding, consciousness or orientation, environmental exposure.
- Keep every reply to one or two short sentences.
- If the user asks for help instead of answering, give one or two sentences of practical guidance and then return to assessment.
- Do not claim a diagnosis. Do not mention the SALT method.`;

const OPENER = 'Tell me what happened — short answers are fine.';
const TARGET_REPLIES = 3;

export default function TriageChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, startIncident } = useProfileState();

  const {
    status,
    messages,
    stream,
    thinking,
    isGenerating,
    isThinking,
    thinkingWords,
    load,
    send,
    stop,
    seedAssistant,
  } = useZeticChat({ systemPrompt: TRIAGE_SYSTEM_PROMPT });

  const [input, setInput] = useState('');
  const scrollRef = useRef<RNScrollView | null>(null);

  // Bootstrap an incident if we got here without one (deep link / hot reload).
  useEffect(() => {
    if (!state.session.incident) {
      startIncident('manual');
    }
  }, [state.session.incident, startIncident]);

  // Boot the model and seed the opener.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    seedAssistant(OPENER);
  }, [seedAssistant]);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, stream]);

  const onSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    send(text);
  }, [input, send]);

  const onContinue = useCallback(async () => {
    if (isGenerating) await stop();
    router.replace('/triage');
  }, [isGenerating, router, stop]);

  const onClose = useCallback(async () => {
    if (isGenerating) await stop();
    router.replace('/');
  }, [isGenerating, router]);

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Top bar: ✕ · progress meter · Continue */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 12,
            gap: 12,
          }}
        >
          <GlassButton
            onPress={onClose}
            tintColor={C.star}
            style={{ borderRadius: 18 }}
            pressableStyle={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              selectable={false}
              style={{ color: C.text, fontSize: 18, lineHeight: 18 }}
            >
              ×
            </Text>
          </GlassButton>

          <ProgressMeter filled={0} total={TARGET_REPLIES} />

          <GlassButton
            onPress={onContinue}
            tintColor={C.star}
            style={{ borderRadius: 999 }}
            pressableStyle={{
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text
              selectable={false}
              style={{
                color: C.text,
                fontSize: 13,
                fontWeight: '600',
                letterSpacing: 1.4,
              }}
            >
              CONTINUE
            </Text>
          </GlassButton>
        </View>

        {/* Chat thread */}
        <RNScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {status.kind === 'loading' && (
            <Text style={{ color: C.faint, fontSize: 13 }}>
              Loading on-device model… {Math.round(status.progress * 100)}%
            </Text>
          )}
          {status.kind === 'error' && (
            <Text style={{ color: '#E5484D', fontSize: 13 }}>
              {status.message}
            </Text>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} text={m.text} thinking={m.thinking} />
          ))}

          {isGenerating && (
            <Bubble
              role="assistant"
              text={stream}
              thinking={isThinking ? thinking : undefined}
              streaming
              thinkingWords={thinkingWords}
            />
          )}
        </RNScrollView>

        {/* Composer */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingTop: 8,
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <GlassCard
            style={{
              flex: 1,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Type your reply…"
              placeholderTextColor={C.faint}
              style={{
                color: C.text,
                fontSize: 16,
                minHeight: 24,
                maxHeight: 96,
              }}
              multiline
              editable={status.kind === 'ready' && !isGenerating}
              onSubmitEditing={onSubmit}
              blurOnSubmit
              returnKeyType="send"
            />
          </GlassCard>

          <Pressable
            onPress={onSubmit}
            disabled={status.kind !== 'ready' || isGenerating || !input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: C.star,
              alignItems: 'center',
              justifyContent: 'center',
              opacity:
                status.kind !== 'ready' || isGenerating || !input.trim()
                  ? 0.4
                  : 1,
            }}
          >
            {isGenerating ? (
              <ActivityIndicator color={C.text} />
            ) : (
              <Text
                style={{
                  color: C.text,
                  fontSize: 18,
                  fontFamily: SERIF,
                }}
              >
                ↑
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ProgressMeter({ filled, total }: { filled: number; total: number }) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < filled ? C.star : C.glass,
            borderWidth: 1,
            borderColor: i < filled ? C.starDeep : C.edge,
          }}
        />
      ))}
    </View>
  );
}

function Bubble({
  role,
  text,
  thinking,
  streaming,
  thinkingWords,
}: {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  streaming?: boolean;
  thinkingWords?: number;
}) {
  const isUser = role === 'user';
  return (
    <View
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        gap: 6,
      }}
    >
      {thinking ? (
        <Text
          style={{
            color: C.faint,
            fontSize: 11,
            fontStyle: 'italic',
            paddingHorizontal: 14,
          }}
        >
          {streaming
            ? `Thinking… ${thinkingWords ?? 0} words`
            : thinking.slice(0, 200)}
        </Text>
      ) : null}
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: isUser ? C.star : C.bubbleAi,
          borderWidth: 1,
          borderColor: isUser ? C.starDeep : C.edge,
        }}
      >
        <Text
          style={{
            color: C.text,
            fontSize: 15,
            lineHeight: 22,
          }}
        >
          {text || (streaming ? '…' : '')}
        </Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Smoke-check the screen renders**

Boot the app on an iOS device, tap Report Incident → Begin Triage. Verify:
1. The screen opens with a dark gradient background.
2. The opener message ("Tell me what happened — short answers are fine.") appears as an assistant bubble.
3. ✕ in the top-left dismisses to home.
4. The Continue button on the top-right navigates to `/triage` (the PPG screen).
5. Typing a message and hitting send produces a streaming assistant reply.
6. The progress meter shows 3 empty segments (filling is wired in Task 5).

- [ ] **Step 4: Commit**

```bash
git add app/triage-chat.tsx
git commit -m "feat(triage-chat): scaffold screen with chat thread, progress meter, continue/close"
```

---

## Task 5: Wire the progress counter and auto-advance

**Files:**
- Modify: `app/triage-chat.tsx` (add reply-counting state + auto-advance effect; pass live count to `<ProgressMeter>`)

The opener does **not** count. The counter increments only when an assistant message finalises *after* the user has sent at least one message. At 3, hold 800 ms then `router.replace('/triage')`.

- [ ] **Step 1: Track the assistant-reply count**

Add this hook block immediately after the existing `useEffect` chain (after the `useEffect(() => { scrollRef.current?.scrollToEnd ... })`):

```tsx
// Count assistant replies that follow at least one user message. The seeded
// opener is ignored (no preceding user turn). Whenever this count finalises
// at TARGET_REPLIES, hold briefly so the user sees the meter fill, then
// advance.
const assistantRepliesAfterUser = (() => {
  let userSeen = false;
  let count = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      userSeen = true;
    } else if (m.role === 'assistant' && userSeen) {
      count += 1;
    }
  }
  return count;
})();

useEffect(() => {
  if (assistantRepliesAfterUser < TARGET_REPLIES) return;
  const t = setTimeout(() => {
    router.replace('/triage');
  }, 800);
  return () => clearTimeout(t);
}, [assistantRepliesAfterUser, router]);
```

- [ ] **Step 2: Pass the live count to `<ProgressMeter>`**

Find:

```tsx
<ProgressMeter filled={0} total={TARGET_REPLIES} />
```

Replace with:

```tsx
<ProgressMeter
  filled={Math.min(assistantRepliesAfterUser, TARGET_REPLIES)}
  total={TARGET_REPLIES}
/>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke-check**

On device:
1. Open Report Incident → Begin Triage.
2. Send 3 messages, waiting for each assistant reply.
3. Verify the progress meter fills 1/3 → 2/3 → 3/3.
4. After the 3rd reply finalises, ~800 ms later the screen replaces with `/triage` (PPG).

- [ ] **Step 5: Commit**

```bash
git add app/triage-chat.tsx
git commit -m "feat(triage-chat): wire progress meter and auto-advance after 3 replies"
```

---

## Task 6: Verify Continue handles mid-stream correctly

**Files:** None — this task is verification of behaviour already implemented in Task 4 (`onContinue` already calls `stop()` then `router.replace`).

- [ ] **Step 1: Smoke-check mid-stream Continue**

On device:
1. Open Report Incident → Begin Triage.
2. Send one message.
3. **While the assistant is still streaming**, tap Continue.
4. Verify: the screen transitions to `/triage` immediately, the streaming model call is aborted (no errors in Metro logs), and no orphaned async work crashes the app.

- [ ] **Step 2: Smoke-check Continue with no messages sent**

On device:
1. Open Report Incident → Begin Triage.
2. Without sending any message, tap Continue immediately.
3. Verify: navigates to `/triage`. (Transcript will be empty plus the seeded opener — handled in Task 7.)

No code changes; no commit.

---

## Task 7: Persist the transcript into `incident.triage`

**Files:**
- Modify: `app/triage-chat.tsx` (add a persistence effect + unmount flush)

Every time `messages` changes, patch the active incident's `triage` slice. This ensures both early-skip and unmount paths preserve whatever the user has said so far. The hook's existing `seedAssistant` writes the opener into `messages`; we include it in the transcript so downstream agents see the system's first prompt as context.

- [ ] **Step 1: Pull `updateIncident` from the store**

Find:

```ts
const { state, startIncident } = useProfileState();
```

Replace with:

```ts
const { state, startIncident, updateIncident } = useProfileState();
```

- [ ] **Step 2: Add the persistence effect**

Add this effect immediately after the auto-advance effect from Task 5:

```tsx
// Persist transcript on every change. Runs both when the user sends a
// message and when an assistant reply finalises, so an early Continue tap
// always finds a fresh incident.triage slice. Skips while the opener is
// the only message (nothing meaningful to forward yet).
useEffect(() => {
  if (!state.session.incident) return;
  if (messages.length === 0) return;

  const transcript = messages.map((m) => ({ role: m.role, text: m.text }));
  const assistantTurns = messages.filter((m) => m.role === 'assistant');
  const summary = assistantTurns.length
    ? assistantTurns[assistantTurns.length - 1].text
    : '';
  const rawText = assistantTurns.map((m) => m.text).join('\n\n');

  updateIncident({
    triage: {
      transcript,
      summary,
      rawText,
      findings: [],
      severity: null,
      capturedAt: Date.now(),
    },
  });
}, [messages, state.session.incident, updateIncident]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke-check transcript reaches the incident store**

Add a temporary debug log inside `app/rescue.tsx` (or `app/triage.tsx`) to print the incident's transcript on mount:

```ts
useEffect(() => {
  console.log(
    '[debug] incident.triage on mount:',
    JSON.stringify(state.session.incident?.triage, null, 2),
  );
}, []);
```

(Place it near the existing `useEffect`s. Remove after verification.)

On device:
1. Open Report Incident → Begin Triage.
2. Send 1 message, then tap Continue mid-stream (before the assistant finalises).
3. PPG screen mounts. Check Metro logs: `incident.triage.transcript` should contain the opener + the user's message. (May or may not contain a partial assistant turn depending on whether the stream finalised — this is acceptable.)
4. Re-run, this time wait for all 3 replies and let auto-advance fire. Confirm transcript has 7 turns (1 opener + 3 user + 3 assistant).
5. Remove the debug log.

- [ ] **Step 5: Commit**

```bash
git add app/triage-chat.tsx
git commit -m "feat(triage-chat): persist conversation into incident.triage on every turn"
```

---

## Task 8: End-to-end smoke test of the full pipeline

**Files:** None — full-flow verification only.

- [ ] **Step 1: Walk the happy path**

On a physical iPhone (Zetic requires it):

1. Launch the app.
2. From Home, tap Report Incident.
3. Verify header reads "The rescue plan."
4. Tap BEGIN TRIAGE.
5. The Triage Chat screen opens with the opener line.
6. Send "I slipped on a wet rock and my ankle hurts."
7. Wait for the assistant reply; progress meter shows 1/3.
8. Reply to its question; wait for reply; progress meter shows 2/3.
9. Reply once more; wait for reply; progress meter shows 3/3.
10. ~800 ms later, the screen auto-advances to `/triage` (PPG).
11. Complete the PPG scan as normal.
12. Continue through Rescue → Call.
13. On the Call screen, verify the rescue script reflects the triage interview content (look for keywords from your conversation in the report markdown that the agents return).

- [ ] **Step 2: Walk the early-Continue path**

1. Launch the app.
2. Report Incident → Begin Triage.
3. Send 1 message.
4. While the assistant is replying, tap Continue.
5. PPG screen opens; complete scan; continue through Rescue → Call.
6. Confirm the Rescue agents still received the partial transcript (Metro logs print the payload).

- [ ] **Step 3: Walk the cancel path**

1. Launch the app.
2. Report Incident → Begin Triage.
3. Tap ✕.
4. Verify return to Home with no crash.

- [ ] **Step 4: Final commit if any tweaks were needed**

If smoke testing surfaced minor copy/layout fixes, commit them now:

```bash
git add -p
git commit -m "polish(triage-chat): smoke-test fixes"
```

If the smoke test passed clean, no commit needed.

---

## Self-Review

**Spec coverage check (against `docs/superpowers/specs/2026-04-26-triage-chat-design.md`):**

| Spec section | Implemented in |
|---|---|
| §1 New route `/triage-chat` | Task 2 |
| §1 Header retitle + repoint button | Task 3 |
| §1 `router.replace` chain | Tasks 3 + 4 (`onContinue`/auto-advance) |
| §2 Top bar ✕ · meter · Continue | Task 4 |
| §2 Reused chat-bubble vocabulary | Task 4 (lifted from `app/(tabs)/chat.tsx`) |
| §2 Opener seeded, doesn't count | Tasks 4 + 5 |
| §3 New triage system prompt | Task 1 (parameterise) + Task 4 (constant) |
| §3 Counter mechanics + 800 ms hold | Task 5 |
| §3 Continue mid-stream → stop + navigate | Task 4 (`onContinue`) + Task 6 (verify) |
| §3 `useZeticChat` hook tweak | Task 1 |
| §4 Persist transcript per turn | Task 7 |
| §4 `findings: []`, `severity: null` for v1 | Task 7 |
| §4 No downstream agent changes | Verified in plan header (composer already forwards) |
| §5 Navbar unchanged | No task — explicit non-change |
| §Edge: deep-link bootstrap | Task 4 (`startIncident('manual')` fallback) |
| §Edge: model not loaded ⇒ Continue still works | Task 4 (Continue not gated on `status`) |
| §Edge: mid-stream Continue | Task 4 + Task 6 |

No gaps. No `TBD`/`later`/`appropriate`/etc. tokens left in the plan. Type names and method signatures (`useZeticChat({ systemPrompt })`, `updateIncident({ triage: ... })`, `TranscriptTurn`, `IncidentTriageSlice` field names) are consistent with what's defined in `hooks/use-zetic-chat.ts` and `src/lib/profile-store.ts`.
