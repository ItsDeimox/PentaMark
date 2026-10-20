# PentaMark 2.13.10 — Fundo nítido e controles independentes

- Malha estática de polígonos irregulares, incluindo pentágonos, com linhas
  finas. Telas maiores recebem mais células em vez de ampliar uma textura.
- Luzes de fundo com núcleo definido e dissipação suave, percorrendo as
  arestas. Sem círculos no cursor ou deslocamento dos vértices.
- Dois controles em Configurações → Aparência: **Animações de fundo** e
  **Reação ao mouse**, independentes entre si e do modo Flat/Acrílico.
  Quem havia desligado o controle antigo mantém ambos desligados.
- Hover limitado a uma superfície local de 512×512 pixels de tela, com até
  2× de densidade e atualização limitada a 30 Hz. O efeito para quando a
  energia apaga; não há raster animado cobrindo a janela inteira.
- Pulsos automáticos passam a usar pequenas luzes com animações de posição
  e opacidade, evitando repintar os trajetos SVG a cada quadro.
- Durante o scroll do documento, o vidro usa uma composição mais leve.
  A refração cromática completa retorna 180 ms depois de parar.
- Preferência por movimento reduzido, janela oculta, cancelamento e
  persistência dos controles respeitados.

O visualizador e o zoom de imagens não foram alterados. Nenhuma dependência
foi adicionada. Medições de navegador headless são comparações de laboratório,
não uma garantia de FPS ou de percentual de GPU em todas as máquinas.

## Validação

TypeScript, build de produção, testes do grafo e 103 testes de interface
aprovados (zero falhas, ignorados ou flaky). Revisão independente concluída.
Na medição controlada com Acrílico, p95 dos quadros passou de 49,8 ms para
11,2 ms durante o movimento do cursor. No scroll, o modo adaptativo registrou
5,6 ms contra 11,1 ms com refração integral forçada.

A centralização apresentou desvio de 0 pixels nas escalas 100%, 125% e 150%,
com navegação aberta e fechada; o alinhamento não precisou ser alterado.
O pipeline Windows verifica o executável e a gravação/leitura de uma nota
em cofre temporário antes de publicar.
