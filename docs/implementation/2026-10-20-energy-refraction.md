# Malha energética e refração — etapa gráfica

Base: release 2.13.7 (`264946be`), branch `feat/energy-refraction`.

## Escopo

- Malha irregular determinística de triângulos e quadriláteros.
- Rastro de energia: iluminação mais intensa na frente de propagação, halo
  difuso nas arestas, pequeno afastamento dos fragmentos e dissipação gradual.
- Pulsos ambientais alongados, com halo mais largo.
- Refração do fundo real nos painéis acrílicos, separando discretamente as
  amostras de vermelho, verde e azul. Removida a faixa RGB pintada pelo shader.
- Texto e controles continuam no primeiro plano, sem filtro de deformação.

O visualizador de arquivos, controles de imagens e zoom ancorado no cursor não
foram alterados. Nenhuma dependência foi adicionada.

## Implementação

`SignalBackground` mantém a geometria estável e anima somente a energia.
O histórico do cursor tem limite de 36 pontos; o RAF termina após a dissipação.
Redução de movimento, janela oculta, desativação dos pulsos e desmontagem limpam
o rastro e os listeners.

`glass-lens` usa o compositor nativo (`backdrop-filter` com filtro SVG), sem
capturar o DOM. O centro mantém o desfoque; a borda combina uma amostra mais
nítida com deslocamentos cromáticos distintos. Um fundo uniforme não gera
artificialmente um contorno colorido.

O mapa tem resolução máxima de 384 pixels por dimensão. Ao redimensionar,
as dimensões do filtro são atualizadas imediatamente e o bitmap é recalculado
após 120 ms sem nova mudança. A liberação do painel cancela esse trabalho.
Troca para Flat e perda do contexto WebGL removem as lentes e restauram os
estilos anteriores.

As dimensões do `feImage` são explícitas: porcentagens contra um SVG oculto
de tamanho zero resultavam em um mapa vazio no Chromium.

## Verificação

- `npm run check`: TypeScript e bundle de produção.
- `npx playwright test`: suíte completa usando Chrome e cofre temporário.
- Comparação de pixels em um padrão listrado: exige deformação e dispersão
  cromática na borda, sem mudança significativa no centro.
- Testes de dissipação, redução de movimento durante um rastro ativo,
  redimensionamento, limpeza no modo Flat e estabilidade da geometria do editor.
- Revisão de código independente e inspeção das capturas renderizadas.

Testes antigos que exigiam `data-circuit` foram atualizados sem remover suas
comparações de pixels e verificações de repouso. A checagem de cor fixa passou
a validar a paleta efetivamente aplicada e sua luminosidade. A centralização
agora é aguardada por condição, não por um atraso arbitrário de 260 ms; a saída
do diálogo é observada antes do clique para não perder a transição breve.

Referência conceitual: [Meet Liquid Glass, Apple](https://developer.apple.com/videos/play/wwdc2025/219/).
Referência de dissipação: `dxrkths/src/ui/energy-network.js` no Checkpoint Portfolio.
Esta é uma implementação própria; não é o material nativo da Apple.

## Resultado final — 20/10/2026

Build e TypeScript aprovados. Suíte completa: 88 aprovados, zero falhas,
zero ignorados e zero instáveis (310,84 s).

No padrão óptico, diferença média por canal na borda: 70,50/255; no centro:
0/255. Aumento médio da separação cromática na borda: 11,28/255. São medidas
do padrão controlado, não uma avaliação perceptual universal.

Ambiente validado: Chrome headless no Windows, com servidor e cofre temporários.
Inclui geometria compacta, escala de 160%, temas, materiais e recuperação de
contexto WebGL. Não houve teste de instalador Electron nem validação física
em outros navegadores/dispositivos. O build conserva o aviso de chunks maiores
que 500 kB. Não houve merge nem publicação nesta etapa.
