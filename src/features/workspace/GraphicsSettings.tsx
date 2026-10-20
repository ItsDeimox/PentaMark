import { useId, type Dispatch, type SetStateAction } from 'react';
import type { Appearance, GraphicsPreset } from '../../domain/types';
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
  return <section className="pm-graphics-settings" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Gráficos e desempenho</h3>
    <p>Controle o custo visual sem mudar seu tema ou sua tipografia. Efeitos desligados liberam seus renderizadores.</p>
    <p>O Flat antigo foi otimizado para o perfil Econômico. Você pode reativar qualquer efeito em Personalizado.</p>
    <label className="pm-graphics-preset">Perfil gráfico
      <select value={appearance.graphicsPreset || 'custom'} onChange={event => {
        const preset = event.target.value as GraphicsPreset;
        if (preset === 'custom') update({});
        else setAppearance(current => applyGraphicsPreset(current, preset));
      }}>{PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select>
    </label>
    <p>{PRESETS.find(preset => preset.id === (appearance.graphicsPreset || 'custom'))?.description}</p>
    <fieldset><legend>Material da interface</legend>
      {(['flat', 'acrylic'] as const).map(mode => <label key={mode}>
        <input type="radio" name={`${id}-material`} checked={appearance.graphicsMode === mode}
          onChange={() => update({ graphicsMode: mode })}/>{mode === 'flat' ? 'Flat' : 'Acrílico'}
      </label>)}
    </fieldset>
    <div className="pm-graphics-toggles">{TOGGLES.map(([key, resolvedKey, label, hint]) => <div key={key}>
      <label><input type="checkbox" checked={resolved[resolvedKey]} aria-describedby={`${id}-${key}`}
        onChange={event => update({ [key]: event.target.checked })}/>{label}</label>
      <small id={`${id}-${key}`}>{hint}</small>
    </div>)}</div>
    <p>Recomendação para este aparelho: <strong>{recommendation === 'economical' ? 'Econômico' : 'Equilibrado'}</strong>. Suas escolhas ficam salvas; a recomendação não é reaplicada automaticamente.</p>
    <button type="button" onClick={() => setAppearance(current => applyGraphicsPreset(current, recommendation))}>Aplicar recomendação</button>
  </section>;
}
