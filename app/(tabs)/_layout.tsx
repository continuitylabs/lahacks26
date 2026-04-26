import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs tintColor="#2D7A4F" minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <Icon sf="house.fill" />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <Icon sf="text.bubble.fill" />
        <Label>Guide</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf="person.crop.circle.fill" />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="info" hidden>
        <Icon sf="info.circle.fill" />
        <Label>Info</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="yamnet" hidden>
        <Icon sf="waveform" />
        <Label>YAMNet</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
