import { Capacitor, registerPlugin } from '@capacitor/core';
import { version } from '../../package.json';

export type UpdateStatus = {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'current';
  currentVersion: string;
  version?: string;
  progress?: number;
  error?: string;
  permissionRequired?: boolean;
};

interface DesktopUpdates {
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
}
interface AndroidUpdates {
  getStatus(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  install(): Promise<UpdateStatus>;
  openPermissionSettings(): Promise<void>;
}

const android = registerPlugin<AndroidUpdates>('AppUpdate');
const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
// Older desktop builds can expose a bridge without the updater methods.
const desktop = typeof window === 'undefined' ? undefined
  : (window as unknown as { pentaMarkDesktop?: Partial<DesktopUpdates> }).pentaMarkDesktop;
export const isUpdateSupported = Boolean(desktop) || nativeAndroid;

function unsupported(): never {
  throw new Error('Atualize o aplicativo no dispositivo que hospeda este cofre.');
}

async function desktopCall(method: keyof DesktopUpdates): Promise<UpdateStatus> {
  const call = desktop?.[method];
  if (!call) throw new Error('O atualizador não está disponível nesta versão do aplicativo.');
  return call.call(desktop);
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (desktop) return desktopCall('getUpdateStatus');
  if (nativeAndroid) return android.getStatus();
  return { phase: 'idle', currentVersion: version };
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (desktop) return desktopCall('checkForUpdates');
  if (nativeAndroid) return android.check();
  return unsupported();
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (desktop) return desktopCall('downloadUpdate');
  if (nativeAndroid) return android.download();
  return unsupported();
}

export async function installUpdate(): Promise<UpdateStatus> {
  if (desktop) return desktopCall('installUpdate');
  if (nativeAndroid) return android.install();
  return unsupported();
}

export async function openUpdatePermissionSettings(): Promise<void> {
  if (nativeAndroid && !desktop) await android.openPermissionSettings();
}
