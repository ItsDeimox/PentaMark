interface Window {
  pentaMarkDesktop?: {
    tailscaleStatus(): Promise<{installed:boolean;connected:boolean;configured:boolean;deviceName?:string;address?:string;error?:string}>;
    saveTailscaleKey(key:string): Promise<{installed:boolean;connected:boolean;configured:boolean;deviceName?:string;address?:string;error?:string}>;
    forgetTailscaleKey(): Promise<void>;
    createTailscaleInvite(): Promise<{inviteUrl:string;address:string;deviceName?:string}>;
    openTailscaleSetup(step:'install'|'login'|'keys'):Promise<void>;
    consumeInvitation():Promise<string|null>;
    onInvitation(listener:(url:string)=>void):()=>void;
    openTailscaleInvite(url:string):Promise<void>;
    getUpdateStatus():Promise<import('./platform/updates').UpdateStatus>;
    checkForUpdates():Promise<import('./platform/updates').UpdateStatus>;
    downloadUpdate():Promise<import('./platform/updates').UpdateStatus>;
    installUpdate():Promise<import('./platform/updates').UpdateStatus>;
    getProfile(): Promise<{ name: string; avatar: string }>;
    setProfile(profile: { name: string; avatar: string }): Promise<{ ok: boolean; error?: string }>;
    getVault(): Promise<{ ok: boolean; path?: string; name?: string; custom?: boolean; error?: string }>;
    chooseVault(): Promise<{ ok: boolean; canceled?: boolean; path?: string; restarting?: boolean; error?: string }>;
    showVault(): Promise<{ ok: boolean; error?: string }>;
    openInFolder(kind: "note" | "folder" | "asset", path: string): Promise<{ ok: boolean; error?: string }>;
    resolveItemPath(kind: "note" | "folder" | "asset", path: string): Promise<{ ok: boolean; relative?: string; absolute?: string; error?: string }>;
  };
}
