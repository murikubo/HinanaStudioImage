import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'studio.hinana.image',
  appName: 'Hinana Studio Image',
  webDir: 'dist',
  backgroundColor: '#151719',
  ios: { contentInset: 'automatic', backgroundColor: '#151719' },
  android: { backgroundColor: '#151719' },
};
export default config;
