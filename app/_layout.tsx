import '@/src/global.css';

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

/**
 * Root navigation. The whole app lives in dark mode — Northstar's environments
 * are outdoors, often at low light, and the photorealistic map tiles read best
 * against a near-black UI.
 */
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0b0e12' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="report-incident"
          options={{
            presentation: 'modal',
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
