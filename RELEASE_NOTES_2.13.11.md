# PentaMark 2.13.11 — Circuitos clássicos e rastro de energia

- Restaurados os doze trajetos sci-fi de contorno da 2.13.9 para as luzes
  automáticas, mantendo a animação leve de posição e opacidade da 2.13.10.
- A malha de reação ao mouse usa pentágonos pequenos e simétricos,
  alternados em um padrão periódico sem lacunas. Suas linhas ficam invisíveis
  em repouso; não são pentágonos regulares, que não fecham uma malha sozinhos.
- O pulso deforma suavemente os vértices compartilhados e retorna à forma
  original. Ecos cromáticos finos, bloom em camadas e iluminação discreta
  nas faces produzem uma fragmentação digital sem deslocar texto ou painéis.
  Os pontos dissipam a energia em tempos ligeiramente diferentes.
- O rastro permanece nas posições pelas quais o cursor passou, com energia
  propagada pelas arestas e dissipação mais rápida. Movimentos rápidos são
  interpolados para não deixar apenas pontos isolados.
- Desenho a até 24 Hz em até quatro áreas locais, normalmente de 512×512 pixels
  de tela com até 2× de densidade. Em trajetos excepcionalmente largos, as
  áreas ampliam a cobertura reduzindo a densidade temporariamente, sem cortar
  partes vivas do rastro nem exceder quatro buffers de 1024×1024 pixels.
  O desenho para quando a energia desaparece e respeita movimento reduzido e foco.
  Apenas a área efetivamente pintada é limpa entre quadros.
- Preservados os controles independentes, o vidro cromático e a composição
  mais leve durante a rolagem. Sem círculos no cursor.

O visualizador de imagens não foi alterado. Nenhuma dependência foi adicionada.

## Validação

TypeScript, build de produção, testes de geometria/propagação e 108 testes de
interface aprovados, sem falhas, ignorados ou flaky. Revisões independentes
verificaram a malha pentagonal, continuidade do rastro e limpeza dos buffers.
O alinhamento do texto teve desvio de 0 pixels em 100%, 125% e 150%.

Em navegador headless, p95 de 5,7 ms no perfil do fundo e no scroll adaptativo.
Com o pulso completo e Acrílico, p95 de 16,7 ms, contra 11,2 ms medidos na
2.13.10: a nova camada visual tem custo adicional, apesar do limite de desenho
e da parada em repouso. Estas medições não garantem FPS nem percentual de GPU
em todas as máquinas.
