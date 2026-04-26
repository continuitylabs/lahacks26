import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import Animated, {
  type AnimatedStyle,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { TextStyle } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { GlassCard } from '@/components/glass-card';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, ScrollView, Text, TextInput, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  edge: 'rgba(255,255,255,0.18)',
  bad: 'rgba(229,72,77,0.6)',
};

const PHONE_MIN_DIGITS = 10;

const sanitizePhone = (raw: string) => {
  // Keep a single leading + (if present) and digits only.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
};

const phoneDigitCount = (raw: string) => raw.replace(/\D/g, '').length;

const clampAge = (raw: string): { value: number | null; display: string } => {
  if (raw.trim() === '') return { value: null, display: '' };
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return { value: null, display: '' };
  const clamped = Math.max(0, Math.min(120, n));
  return { value: clamped, display: String(clamped) };
};

const formatRelative = (ts: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
};

const formatCoord = (n: number, axis: 'lat' | 'lon'): string => {
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : n >= 0 ? 'E' : 'W';
  return `${Math.abs(n).toFixed(4)}°${dir}`;
};

export default function Profile() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 80,
            paddingBottom: 160,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Header />
          <IdentityCard />
          <EmergencyContactCard />
          <MedicalNotesCard />
          <LastBeaconCard />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header() {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <BrandMark size="sm" />
      <Text
        selectable={false}
        style={{
          marginTop: 12,
          fontFamily: SERIF,
          color: C.text,
          fontSize: 30,
          letterSpacing: 1,
        }}
      >
        Your beacon
      </Text>
      <Text
        selectable={false}
        style={{
          textAlign: 'center',
          fontSize: 14,
          color: C.muted,
          lineHeight: 20,
        }}
      >
        What rescue teams will know about you when seconds matter.
      </Text>
    </View>
  );
}

/**
 * Brief amber pulse next to the section title after a write commits.
 */
function useSavedPulse() {
  const opacity = useSharedValue(0);
  const trigger = () => {
    opacity.value = withSequence(
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 800, easing: Easing.in(Easing.quad) })
    );
  };
  const style = useAnimatedStyle<TextStyle>(() => ({ opacity: opacity.value }));
  return { trigger, style };
}

function SectionHeader({
  glyph,
  title,
  pulseStyle,
}: {
  glyph: string;
  title: string;
  pulseStyle: AnimatedStyle<TextStyle>;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontSize: 24, color: C.star }}>{glyph}</Text>
      <Text
        selectable={false}
        style={{ flex: 1, fontFamily: SERIF, fontSize: 17, color: C.text }}
      >
        {title}
      </Text>
      <Animated.Text
        style={[
          pulseStyle,
          {
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: 2.4,
            color: C.star,
          },
        ]}
      >
        SAVED
      </Animated.Text>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      selectable={false}
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 2,
        color: C.faint,
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor="rgba(245,239,228,0.3)"
      keyboardAppearance={Platform.OS === 'ios' ? 'dark' : undefined}
      selectionColor={C.star}
      {...rest}
      style={[
        {
          color: C.text,
          fontSize: 15,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: invalid ? C.bad : C.edge,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.03)',
        },
        style,
      ]}
    />
  );
}

function IdentityCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { profile } = state;
  const pulse = useSavedPulse();

  const [name, setName] = useState(profile.userName);
  const [age, setAge] = useState(profile.age == null ? '' : String(profile.age));
  const [phone, setPhone] = useState(profile.personalPhone ?? '');

  // Re-sync local fields if the store hydrates after first paint, or if
  // another writer changes them.
  useEffect(() => {
    setName(profile.userName);
    setAge(profile.age == null ? '' : String(profile.age));
    setPhone(profile.personalPhone ?? '');
  }, [profile.userName, profile.age, profile.personalPhone]);

  const commitName = () => {
    const next = name.trim();
    if (next === profile.userName) return;
    setProfile({ userName: next });
    pulse.trigger();
  };

  const commitAge = () => {
    const { value, display } = clampAge(age);
    if (value === profile.age) return;
    setAge(display);
    setProfile({ age: value });
    pulse.trigger();
  };

  const commitPhone = () => {
    const next = sanitizePhone(phone);
    if (next === profile.personalPhone) return;
    setPhone(next);
    setProfile({ personalPhone: next });
    pulse.trigger();
  };

  // Latest-closure ref ladder: the unmount effect's empty-deps cleanup
  // must call the *current* commit closures (so it sees the latest input
  // values), not the ones captured at first render. Each commit function
  // is idempotent on no-op (early-return when value is unchanged), so
  // strict-mode double-invoke and tab-change cleanups stay quiet.
  const commitNameRef = useRef(commitName);
  const commitAgeRef = useRef(commitAge);
  const commitPhoneRef = useRef(commitPhone);
  commitNameRef.current = commitName;
  commitAgeRef.current = commitAge;
  commitPhoneRef.current = commitPhone;
  useEffect(
    () => () => {
      commitNameRef.current();
      commitAgeRef.current();
      commitPhoneRef.current();
    },
    []
  );

  const phoneInvalid = phone.length > 0 && phoneDigitCount(phone) < PHONE_MIN_DIGITS;

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="◉" title="Identity" pulseStyle={pulse.style} />
      <View>
        <FieldLabel>NAME</FieldLabel>
        <Input
          value={name}
          onChangeText={setName}
          onBlur={commitName}
          placeholder="Your full name"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View>
        <FieldLabel>AGE</FieldLabel>
        <Input
          value={age}
          onChangeText={setAge}
          onBlur={commitAge}
          placeholder="—"
          keyboardType="number-pad"
          maxLength={3}
        />
      </View>
      <View>
        <FieldLabel>YOUR PHONE NUMBER</FieldLabel>
        <Input
          value={phone}
          onChangeText={setPhone}
          onBlur={commitPhone}
          placeholder="+1 555 555 5555"
          keyboardType="phone-pad"
          invalid={phoneInvalid}
        />
      </View>
    </GlassCard>
  );
}

function EmergencyContactCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { emergencyContact: ec } = state.profile;
  const pulse = useSavedPulse();

  const [name, setName] = useState(ec.name);
  const [phone, setPhone] = useState(ec.phone);

  useEffect(() => {
    setName(ec.name);
    setPhone(ec.phone);
  }, [ec.name, ec.phone]);

  const commitName = () => {
    const next = name.trim();
    if (next === ec.name) return;
    setProfile({ emergencyContact: { name: next } });
    pulse.trigger();
  };

  const commitPhone = () => {
    const next = sanitizePhone(phone);
    if (next === ec.phone) return;
    setPhone(next);
    setProfile({ emergencyContact: { phone: next } });
    pulse.trigger();
  };

  const commitNameRef = useRef(commitName);
  const commitPhoneRef = useRef(commitPhone);
  commitNameRef.current = commitName;
  commitPhoneRef.current = commitPhone;
  useEffect(
    () => () => {
      commitNameRef.current();
      commitPhoneRef.current();
    },
    []
  );

  const phoneInvalid = phone.length > 0 && phoneDigitCount(phone) < PHONE_MIN_DIGITS;

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="✚" title="Emergency contact" pulseStyle={pulse.style} />
      <View>
        <FieldLabel>NAME</FieldLabel>
        <Input
          value={name}
          onChangeText={setName}
          onBlur={commitName}
          placeholder="Who to call"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View>
        <FieldLabel>PHONE</FieldLabel>
        <Input
          value={phone}
          onChangeText={setPhone}
          onBlur={commitPhone}
          placeholder="+1 555 555 5555"
          keyboardType="phone-pad"
          invalid={phoneInvalid}
        />
      </View>
    </GlassCard>
  );
}

function MedicalNotesCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { medicalNotes } = state.profile;
  const pulse = useSavedPulse();

  const [notes, setNotes] = useState(medicalNotes);
  useEffect(() => {
    setNotes(medicalNotes);
  }, [medicalNotes]);

  const commit = () => {
    const next = notes.trim();
    if (next === medicalNotes) return;
    setProfile({ medicalNotes: next });
    pulse.trigger();
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(
    () => () => {
      commitRef.current();
    },
    []
  );

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="✦" title="Medical baseline" pulseStyle={pulse.style} />
      <Input
        value={notes}
        onChangeText={setNotes}
        onBlur={commit}
        placeholder="Allergies, conditions, blood type — anything dispatch should know."
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={{ minHeight: 96, paddingTop: 12 }}
      />
    </GlassCard>
  );
}

function LastBeaconCard() {
  const { state, loaded, clearSession } = useProfileState();
  const { session } = state;

  if (!loaded) return <SkeletonCard />;

  const hasAnything =
    session.lastCoords ||
    session.lastVitals ||
    session.lastTriageReport ||
    session.lastReportMarkdown;

  return (
    <GlassCard
      style={{
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 12,
        borderColor: 'rgba(240,184,110,0.25)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 24, color: C.star }}>◑</Text>
        <Text
          selectable={false}
          style={{ flex: 1, fontFamily: SERIF, fontSize: 17, color: C.text }}
        >
          Last beacon
        </Text>
      </View>

      {!hasAnything ? (
        <Text
          selectable={false}
          style={{ color: C.faint, fontSize: 13, lineHeight: 20 }}
        >
          No readings yet. Northstar will fill this in as you use the app.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {session.lastCoords ? (
            <BeaconRow
              label="LOCATION"
              value={`${formatCoord(session.lastCoords.latitude, 'lat')}  •  ${formatCoord(session.lastCoords.longitude, 'lon')}`}
              meta={formatRelative(session.lastCoords.capturedAt)}
            />
          ) : null}
          {session.lastVitals ? (
            <BeaconRow
              label="VITALS"
              value={`${session.lastVitals.heartRate} BPM  •  ${session.lastVitals.spo2}% SpO2`}
              meta={formatRelative(session.lastVitals.capturedAt)}
            />
          ) : null}
          {session.lastTriageReport ? (
            <BeaconRow
              label="TRIAGE"
              value={session.lastTriageReport.summary}
              meta={formatRelative(session.lastTriageReport.capturedAt)}
            />
          ) : null}
        </View>
      )}

      {hasAnything ? (
        <Pressable
          onPress={clearSession}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginTop: 4,
            paddingVertical: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            selectable={false}
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: 2.4,
              color: C.muted,
            }}
          >
            CLEAR SESSION DATA
          </Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

function BeaconRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
        paddingTop: 8,
        gap: 4,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 2,
            color: C.faint,
          }}
        >
          {label}
        </Text>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.4,
            color: C.faint,
          }}
        >
          {meta}
        </Text>
      </View>
      <Text
        selectable
        style={{ color: C.text, fontSize: 13, lineHeight: 18 }}
      >
        {value}
      </Text>
    </View>
  );
}

function SkeletonCard() {
  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 28 }}>
      <View
        style={{
          height: 12,
          width: '40%',
          borderRadius: 6,
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      />
    </GlassCard>
  );
}
