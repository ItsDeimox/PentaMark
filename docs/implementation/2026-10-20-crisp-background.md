# Fundo nítido e desempenho — 2.13.10

## Escopo aprovado

Seguir a concept art com polígonos pequenos, estáticos e irregulares,
incluindo pentágonos. A energia percorre as arestas; não há anéis no cursor.
Separar animação autônoma e reação ao mouse, independentemente do material.
Preservar o vidro e a leitura. O visualizador de imagens fica fora desta etapa.

## Implementação

- `energy-mesh.ts`: células Voronoi determinísticas, com passo de 60 pixels
  de tela, arestas compartilhadas e cálculo somente ao redimensionar.
  Mais espaço disponível produz mais células, não polígonos ampliados.
- `SignalBackground.tsx`: componente memoizado; geometria não depende da
  edição do documento. Resize com debounce e atualização da densidade.
- `signal-renderer.ts`: hover em um tile de 512×512 pixels de tela, até 2×
  DPR, limitado a 30 pinturas por segundo. Luz interpolada ao longo das
  conexões; sem filtros blur por célula. Interrompe quando deixa de haver
  segmentos visíveis. O solver preserva a geometria.
- Oito pequenas luzes com gradientes pré-pintados seguem arestas usando
  transform/opacity via Web Animations. Retirados os grandes trajetos SVG
  com dashoffset animado e o raster que ocupava a janela inteira.
- `backgroundMotion` controla a animação autônoma; `backgroundHover` controla
  a reação ao mouse. A migração respeita o antigo controle desligado.
  Defaults explícitos impedem que “Restaurar visual” reúna os controles.
- Blur, janela oculta e movimento reduzido pausam os efeitos. Ao anexar ou
  reconstruir a camada, o estado real de foco da janela é respeitado.
- Refração usa blur nativo de 9px durante scroll do documento. O filtro
  cromático original retorna após 180ms sem rolagem. Limpeza cancela o timer.

## Testes e metodologia

Novos testes exercitam as quatro combinações dos controles nos dois
materiais, persistência, cancelamento, migração, restauração dos defaults,
foco/blur, resize inativo, 4K com 2× DPR, parada em repouso e movimento
reduzido. O grafo verifica pentágonos, conexões, células pequenas, estabilidade
e dissipação sem mover vértices.

Centralização medida nas escalas 1, 1,25 e 1,5, com navegação aberta e fechada.
O centro da coluna é comparado à área de leitura, não ao tamanho do texto
da primeira linha. Nenhuma alteração de alinhamento foi necessária.

A medição de scroll força e confirma o filtro efetivo durante a amostragem:
refração integral, modo adaptativo, blur e sem filtro. Isso evita comparar
duas variantes que foram silenciosamente simplificadas pelo mesmo handler.
O perfil de camadas ocultas mede composição, não desligamento do solver.

O teste óptico usa captura recortada sem ocultar o caret: a injeção do estilo
de captura provocava uma medição/rolagem no CodeMirror e ativava o modo leve.
Mantidos os limiares de diferença dos pixels de borda, croma e centro.

Testes antigos de animação usam tempo transcorrido, não número fixo de
frames. O teste de salvar/undo/redo espera o conteúdo persistido, tolerando
a breve janela unlink/rename do host existente. O host não foi alterado.

Medições Chrome headless são comparativas: não representam garantia de FPS
nem uso de GPU no dispositivo. O relatório da release registra a rodada
final, build Windows, smoke test nativo e integridade do executável.
