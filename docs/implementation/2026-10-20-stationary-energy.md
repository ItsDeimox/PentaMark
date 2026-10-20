# Malha imóvel, seleção e custo gráfico

Base: PentaMark 2.13.8, commit `00eea077`.
Escopo aprovado: malha pequena e fixa, iluminação pelas arestas, seleção sem
faixa luminosa, vidro com dispersão mais perceptível e menor custo de hover.
Referência visual: vídeo fornecido pelo usuário, IGLOO, especialmente 9–12 s.
Visualizador e zoom de imagens não foram alterados.

## Mudanças

- Geometria determinística com passo de 48 unidades, contra 150 anteriormente.
  As arestas são compartilhadas, sem contornos duplicados.
- Energia difunde somente pelas conexões do grafo. Não há deslocamento de
  vértices, escala ou transformação da malha.
- Uma camada Canvas2D com resolução limitada substitui os grupos SVG animados
  e seus filtros individuais. Intensidade interpolada ao longo das arestas,
  desenhada em lotes com halo de três espessuras.
- Um evento de cursor é consumido por frame; nenhuma leitura de layout no
  listener. Seleção com botão pressionado não injeta energia.
- A animação do rastro termina com a dissipação e é limpa em resize,
  redução de movimento, janela oculta, perda de foco, troca de tema e unmount.
- Seleção mantém geometria nativa do CodeMirror e fundo discreto, sem gradiente
  animado de altura arbitrária. Não modifica texto nem persistência.
- Vidro usa as mesmas etapas de filtro, com separação RGB 29/23/17 e transição
  óptica suave até o interior da borda. O centro e os controles ficam intactos.
- Buffer WebGL compartilhado é reutilizado, com viewport/scissor e cópia da
  região correta para cada superfície. Cada dimensão fica limitada a 1414 px,
  respeitando o orçamento de dois milhões de pixels do buffer temporário.

## Evidências iniciais

Antes da correção, o teste de hover registrou 84 mudanças de largura/altura
do buffer em um trajeto de 20 passos. O teste corrigido exige menos de quatro.

No cenário de cursor por três segundos, Chrome headless/SwiftShader:

| Medida, modo normal | Antes | Após correções |
| --- | ---: | ---: |
| Tempo ocupado da thread principal | 0,934 s | 0,344 s |
| Tempo de layout | 0,0082 s | 0,0012 s |
| Intervalo p95 entre frames | 72,3 ms | 44,5 ms |

Medições diagnósticas sujeitas a carga do host; não representam FPS garantido
no Electron/GPU do usuário. A segunda rodada inclui profiler de CPU.
A comparação auxiliar inicial “sem backdrop” era inválida porque estilos
inline importantes prevaleciam sobre a folha de estilos; o teste agora
sobrescreve esses estilos e verifica o estilo computado antes de medir.
Não usar os valores anteriores desse modo para atribuir custo ao vidro.

## Verificação reproduzível

- `npm run check`
- `node scripts/test-energy-network.mjs`
- `npx playwright test` com Chrome instalado e `PM_TEST_PORT` ainda não usado.

O cofre temporário de testes é persistente por porta; reutilizar a porta pode
colidir com notas criadas numa execução anterior.

Os testes verificam conectividade real, ausência de deslocamento, dissipação,
troca de tema, seleção multiline, realocação do buffer, pixels de refração na
borda e na transição interior, centro preservado e limpeza no modo Flat.
Revisão independente não apontou defeito concreto no código do aplicativo;
a falha da medição auxiliar foi corrigida.

## Resultado final

Suíte completa: 93 aprovados, zero falhas/ignorados/flaky, 274,43 segundos.
Uma execução anterior teve 92 aprovados e uma falha no teste de decode:
capturava o texto do editor antes da chegada assíncrona da nota. A espera
agora exige o título da nota antes de guardar o conteúdo; a comparação
integral após navegar permanece intacta. A suíte completa foi repetida.

Última medição normal: 0,357 s de thread principal em três segundos,
contra 0,934 s antes (aproximadamente 62% menos). P95 de frames: 44,6 ms.
Medição sem backdrop, com desativação efetivamente verificada: 0,250 s.
Não há conclusão de FPS garantido em hardware real a partir desses valores.

Teste óptico final, diferença média por canal: borda 78,22/255, transição
interior 3,45/255, centro 0,00024/255; dispersão cromática 56,76/255 no padrão
listrado de teste. Não são medidas de aparência universal.

Build aprovado com o aviso preexistente de chunks maiores que 500 kB.
Alterações mantidas localmente; nenhuma nova release ou merge nesta etapa.
