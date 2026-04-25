import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
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
import { ScrollView, Text, TextInput, View } from '@/src/tw';

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
  edgeStrong: 'rgba(255,255,255,0.28)',
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

  // Re-sync local fields if the store hydrates after first paint, or if
  // another writer changes them.
  useEffect(() => {
    setName(profile.userName);
    setAge(profile.age == null ? '' : String(profile.age));
  }, [profile.userName, profile.age]);

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
    setProfile({ emergencyContact: { name: next, phone: ec.phone } });
    pulse.trigger();
  };

  const commitPhone = () => {
    const next = sanitizePhone(phone);
    if (next === ec.phone) return;
    setPhone(next);
    setProfile({ emergencyContact: { name: ec.name, phone: next } });
    pulse.trigger();
  };

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
