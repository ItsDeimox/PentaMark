import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pentagory.pentamark',
  appName: 'PentaMark',
  webDir: 'local-dist',
  server: { androidScheme: 'https', errorPath: 'webview-required.html' },
  android: { backgroundColor: '#101718', allowMixedContent: false, minWebViewVersion: 119 },
};

export default config;
