# PentaMark 2.13.14 — Bloom discreto para leitura

O hover recebia branco demais no núcleo e pouco brilho difuso, formando uma
malha clara que competia com o texto. Agora o núcleo acompanha a cor do tema,
o bloom se espalha por três camadas mais largas e a intensidade é limitada
antes do desenho. A faixa central de leitura recebe atenuação adicional.

A opacidade final foi reduzida de 60% para 42%. A alternativa Canvas 2D
também usa menos branco, núcleo mais fraco e halo mais largo. A expansão do
rastro, a dissipação ao sair, os controles independentes e as linhas
automáticas mantêm o comportamento anterior.

Sem novo passe de desfoque de tela inteira ou novas dependências.

## Validação

TypeScript, build de produção, dois scripts de geometria/propagação e os
29 testes gráficos relevantes passaram. Incluem pixels reais do halo mais
largo, limite de brilho, atenuação central, cor do tema, repouso, seleção,
4K/2×, perda de contexto e alternativa Canvas. Captura do Acrílico inspecionada.

No Chrome headless/SwiftShader, a comparação alternada dos shaders mediu
p95 de 16,7 ms no novo e 16,6 ms no anterior, em duas alternâncias. Medições
isoladas oscilaram; isso não é uma medição da GPU física nem garantia de
desempenho idêntico em todo hardware. O teste do fundo completo marcou 11,2 ms.
