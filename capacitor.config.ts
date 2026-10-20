import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pentagory.pentamark',
  appName: 'PentaMark',
  webDir: 'local-dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#101718', allowMixedContent: false },
};

export default config;
