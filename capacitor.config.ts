import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'studio.hinana.image',
  appName: 'Hinana Studio Image',
  webDir: 'dist',
  backgroundColor: '#151719',
  // CSS env(safe-area-inset-*) owns notch/home-indicator spacing.
  // UIKit scroll insets would apply the same spacing a second time.
  ios: { contentInset: 'never', backgroundColor: '#151719' },
  android: { backgroundColor: '#151719' },
};
export default config;
