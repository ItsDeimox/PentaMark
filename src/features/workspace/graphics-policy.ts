import { DEFAULT_APPEARANCE } from '../../app/constants';
import type { Appearance, GraphicsPreset } from '../../domain/types';

export type GraphicsCapabilities = {
  android?: boolean;
  coarsePointer?: boolean;
  reducedMotion?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
};
export const APPEARANCE_STORAGE_KEY = 'pentamark:appearance';
type Storage = { getItem(key: string): string | null; setItem?(key: string, value: string): void };
type Preset = Exclude<GraphicsPreset, 'custom'>;
export const GRAPHICS_PRESETS = {
  economical: { graphicsMode: 'flat', backgroundMotion: false, backgroundHover: false, interfaceMotion: false, refraction: false },
  balanced: { graphicsMode: 'flat', backgroundMotion: false, backgroundHover: false, interfaceMotion: true, refraction: false },
  quality: { graphicsMode: 'acrylic', backgroundMotion: true, backgroundHover: true, interfaceMotion: true, refraction: true },
} as const;

/** Cheap capability hints only; never benchmark or silently reapply on reload. */
export function detectGraphicsCapabilities(): GraphicsCapabilities {
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
  const media = (query: string) => typeof matchMedia !== 'undefined' && matchMedia(query).matches;
  return {
    android: /Android/i.test(nav?.userAgent || ''),
    coarsePointer: media('(pointer: coarse)'),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}
export function recommendGraphicsPreset(capabilities: GraphicsCapabilities): Preset {
  const limited = (value: number | undefined) => typeof value === 'number' && value > 0 && value <= 4;
  return capabilities.android || capabilities.coarsePointer || capabilities.reducedMotion || limited(capabilities.deviceMemory) || limited(capabilities.hardwareConcurrency)
    ? 'economical' : 'balanced';
}
export function applyGraphicsPreset(appearance: Appearance, preset: Preset): Appearance {
  return { ...appearance, ...GRAPHICS_PRESETS[preset], graphicsPreset: preset };
}
export function resolveGraphics(appearance: Appearance) {
  const material = appearance.graphicsMode === 'acrylic';
  const refraction = appearance.refraction ?? material;
  return {
    animated: appearance.backgroundMotion ?? material,
    reactive: appearance.backgroundHover ?? material,
    // Explicit custom refraction also works over a Flat base palette.
    acrylic: material || refraction,
    refraction,
    interfaceMotion: appearance.interfaceMotion ?? material,
  };
}
export function loadAppearance(storage: Storage, capabilities: GraphicsCapabilities): Appearance {
  let stored: Partial<Appearance> | undefined;
  try {
    const value: unknown = JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY) || 'null');
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) stored = value as Partial<Appearance>;
  } catch { /* Unavailable or damaged preferences use the same safe first-run path. */ }
  let appearance: Appearance;
  if (stored) {
    appearance = { ...DEFAULT_APPEARANCE, ...stored };
    appearance.graphicsMode = stored.graphicsMode === 'acrylic' ? 'acrylic' : 'flat';
    const legacyDefault = appearance.graphicsMode === 'acrylic';
    for (const key of ['backgroundMotion', 'backgroundHover', 'interfaceMotion', 'refraction'] as const) {
      appearance[key] = typeof stored[key] === 'boolean' ? stored[key] : legacyDefault;
    }
    const validPreset = ['economical', 'balanced', 'quality', 'custom'].includes(stored.graphicsPreset || '');
    appearance.graphicsPreset = validPreset ? stored.graphicsPreset : 'custom';
    if (!validPreset && typeof stored.backgroundHover !== 'boolean' && typeof stored.backgroundMotion === 'boolean') {
      appearance.backgroundHover = stored.backgroundMotion;
    }
    // 2.13.17 saved Flat with background effects enabled by default. Migrate
    // only that legacy generation; a new custom choice is never overwritten.
    if (!validPreset && appearance.graphicsMode === 'flat') appearance = applyGraphicsPreset(appearance, 'economical');
  } else {
    appearance = applyGraphicsPreset(DEFAULT_APPEARANCE, recommendGraphicsPreset(capabilities));
  }
  // Store the initial recommendation/migration once so later devices do not replace it.
  try { storage.setItem?.(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance)); } catch { /* Private/blocked storage still allows this session. */ }
  return appearance;
}
