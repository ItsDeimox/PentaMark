import { useId, type Dispatch, type SetStateAction } from 'react';
import type { Appearance, GraphicsPreset } from '../../domain/types';
import { SettingsHeading } from '../../components/dialogs/DialogFrame';
import { applyGraphicsPreset, detectGraphicsCapabilities, recommendGraphicsPreset, resolveGraphics, type GraphicsCapabilities } from './graphics-policy';
import './graphics.css';

const PRESETS: Array<{ id: GraphicsPreset; label: string; description: string }> = [
  { id: 'economical', label: 'Econômico', description: 'Flat, sem efeitos. Menor consumo de bateria e GPU.' },
  { id: 'balanced', label: 'Equilibrado', description: 'Flat com movimentos de interface, sem fundo ou refração.' },
  { id: 'quality', label: 'Qualidade', description: 'Acrílico, fundo animado, reação ao mouse e refração.' },
  { id: 'custom', label: 'Personalizado', description: 'Escolha cada efeito de forma independente.' },
];
const TOGGLES = [
  ['backgroundMotion', 'animated', 'Animações de fundo', 'Circuitos animados continuamente enquanto a janela está ativa.'],
  ['backgroundHover', 'reactive', 'Reação ao mouse', 'Acende o fundo e as superfícies ao mover o ponteiro.'],
  ['interfaceMotion', 'interfaceMotion', 'Movimento de interface', 'Transições, abertura de painéis e efeito ao trocar de nota.'],
  ['refraction', 'refraction', 'Refração', 'Distorção óptica do vidro. É o efeito de maior custo gráfico.'],
] as const;

export function GraphicsSettings({ appearance, setAppearance, capabilities }: {
  appearance: Appearance;
  setAppearance: Dispatch<SetStateAction<Appearance>>;
  capabilities?: GraphicsCapabilities;
}) {
  const id = useId();
  const resolved = resolveGraphics(appearance);
  const recommendation = recommendGraphicsPreset(capabilities ?? detectGraphicsCapabilities());
  const update = (patch: Partial<Appearance>) => setAppearance(current => ({ ...current, ...patch, graphicsPreset: 'custom' }));
  return <section className="pm-graphics-settings" aria-label="Gráficos">
    <label className="pm-graphics-preset">Perfil gráfico
      <select value={appearance.graphicsPreset || 'custom'} onChange={event => {
        const preset = event.target.value as GraphicsPreset;
        if (preset === 'custom') update({});
        else setAppearance(current => applyGraphicsPreset(current, preset));
      }}>{PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select>
    </label>
    <fieldset><legend>Material da interface</legend>
      {(['flat', 'acrylic'] as const).map(mode => <label key={mode}>
        <input type="radio" name={`${id}-material`} checked={appearance.graphicsMode === mode}
          onChange={() => update({ graphicsMode: mode })}/>{mode === 'flat' ? 'Flat' : 'Acrílico'}
      </label>)}
    </fieldset>
    <div className="pm-graphics-toggles">{TOGGLES.map(([key, resolvedKey, label]) => <div key={key}>
      <label><input type="checkbox" checked={resolved[resolvedKey]}
        onChange={event => update({ [key]: event.target.checked })}/>{label}</label>
    </div>)}</div>
    <div className="pm-graphics-recommendation"><p>Recomendado: <strong>{recommendation === 'economical' ? 'Econômico' : 'Equilibrado'}</strong></p>
      <button type="button" onClick={() => setAppearance(current => applyGraphicsPreset(current, recommendation))}>Aplicar recomendação</button>
    </div>
    <SettingsHeading title="Sobre os efeitos" help={<>
      <ul>{PRESETS.map(preset => <li key={preset.id}><strong>{preset.label}:</strong> {preset.description}</li>)}</ul>
      <ul>{TOGGLES.map(([key, , label, hint]) => <li key={key}><strong>{label}:</strong> {hint}</li>)}</ul>
    </>}/>
  </section>;
}
