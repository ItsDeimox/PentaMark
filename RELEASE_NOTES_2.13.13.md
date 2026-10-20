# PentaMark 2.13.13 — Luz fina e dissipação contínua

- Núcleo do hover mais fino e esbranquiçado, com três camadas suaves de
  dissipação luminosa. O halo mantém a cor do tema.
- No Acrílico, refração subpixel e granulação espacial estável simulam a
  luz atrás do material, sem ruído animado nem desfoque de tela inteira.
- Sair com o cursor ou perder foco interrompe a entrada de novos impulsos,
  mas deixa a onda existente terminar de dissipar. Janela oculta, movimento
  reduzido e desativação do efeito continuam interrompendo o desenho.
- Preservados os hexágonos, a propagação, as linhas SVG originais, os
  controles independentes e o vidro dos painéis.
- Mantidos o desenho instanciado na GPU, a resolução fixa e a parada em
  repouso. A alternativa Canvas 2D usa núcleo fino e bloom simplificado,
  sem a refração/granulação do caminho acelerado.

O visualizador de imagens não foi alterado. Nenhuma dependência foi adicionada.

## Validação

TypeScript, build de produção, dois testes de geometria/propagação e todos
os **114 testes de interface** passaram, sem falhas, testes ignorados ou retries.
Os três testes novos falharam na versão anterior e passaram com a correção:
saída do cursor, perda de foco e pixels reais do núcleo/halo/material.
Captura visual do Acrílico inspecionada; revisão independente concluída.

No Chrome headless/SwiftShader, o p95 do fundo completo foi 11,2 ms.
O teste de Acrílico foi 16,7 ms na rodada focada e 22,2 ms na suíte longa;
três repetições isoladas deram 16,8 / 16,7 / 16,8 ms. A referência anterior
era 16,7 ms. O scroll adaptativo marcou 5,8 ms (anterior: 5,7 ms).
Há variabilidade de laboratório: não é medição da GPU física do usuário
nem garantia de desempenho idêntico em todo hardware.
