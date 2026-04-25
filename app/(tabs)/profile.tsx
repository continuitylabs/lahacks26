import { LinearGradient } from 'expo-linear-gradient';
import { Platform } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { GlassCard } from '@/components/glass-card';
import { ScrollView, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO =
  Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  edge: 'rgba(255,255,255,0.18)',
};

export default function Profile() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 80,
          paddingBottom: 160,
          gap: 20,
        }}
      >
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

        <PlaceholderCard
          glyph="◉"
          title="Identity"
          rows={['Name', 'Age', 'Medical baseline']}
        />
        <PlaceholderCard
          glyph="✚"
          title="Emergency contacts"
          rows={['Primary', 'Secondary', 'Trail buddy']}
        />
        <PlaceholderCard
          glyph="✦"
          title="Detection sensitivity"
          rows={['Impact threshold', 'No-movement window', 'Activity profile']}
        />
        <PlaceholderCard
          glyph="◑"
          title="Saved trails"
          rows={['Recent', 'Favorites', 'Offline tiles']}
        />

        <Text
          selectable={false}
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 11,
            letterSpacing: 2.4,
            color: C.faint,
            fontFamily: MONO,
          }}
        >
          PLACEHOLDER  •  WIRE BEFORE DEMO
        </Text>
      </ScrollView>
    </View>
  );
}

function PlaceholderCard({
  glyph,
  title,
  rows,
}: {
  glyph: string;
  title: string;
  rows: string[];
}) {
  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 24, color: C.star }}>{glyph}</Text>
        <Text
          selectable={false}
          style={{
            flex: 1,
            fontFamily: SERIF,
            fontSize: 17,
            color: C.text,
          }}
        >
          {title}
        </Text>
        <Text style={{ color: C.faint, fontSize: 18 }}>›</Text>
      </View>
      <View style={{ marginTop: 12, gap: 8, paddingLeft: 36 }}>
        {rows.map((row) => (
          <View
            key={row}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: C.edge,
              paddingTop: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: C.muted }}>{row}</Text>
            <Text style={{ fontSize: 13, color: C.faint }}>—</Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}
