interface Window {
  pentaMarkDesktop?: {
    getProfile(): Promise<{ name: string; avatar: string }>;
    setProfile(profile: { name: string; avatar: string }): Promise<{ ok: boolean; error?: string }>;
    getVault(): Promise<{ ok: boolean; path?: string; name?: string; custom?: boolean; error?: string }>;
    chooseVault(): Promise<{ ok: boolean; canceled?: boolean; path?: string; restarting?: boolean; error?: string }>;
    showVault(): Promise<{ ok: boolean; error?: string }>;
    openInFolder(kind: "note" | "folder" | "asset", path: string): Promise<{ ok: boolean; error?: string }>;
  };
}
