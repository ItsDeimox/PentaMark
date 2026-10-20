# PentaMark 2.13.12 — Linhas originais e onda do Checkpoint

- Restaurada a animação de traço SVG dos circuitos da 2.13.9: os doze
  caminhos, velocidades, defasagens, comprimentos do núcleo luminoso e halo.
  O traço acompanha as curvas do caminho; não é uma barra girando sobre ele.
- Hexágonos regulares substituem os pentágonos em formato de “casinha”.
- O hover usa uma onda amortecida inspirada diretamente no `PanelEnergyField`
  dos cards do Checkpoint Portfólio: impulso na velocidade, propagação entre
  conexões, brilho residual e dissipação depois que o cursor sai.
- Removidas a oscilação artificial dos vértices e as duplicações cromáticas
  do hover. O vidro cromático dos painéis permanece intacto.
- Desenho principal direto na GPU: arestas com antialiasing e halo, atualização
  de um pequeno buffer de dados, sem enviar bitmaps de tela inteira por quadro.
  A resolução não cai quando a onda ocupa uma área maior.
- Parada em repouso, perda de foco, movimento reduzido e desativação do
  controle. Os controles de animação automática e reação ao mouse continuam
  independentes. Há alternativa Canvas 2D quando WebGL não está disponível.

O desenho acelerado reserva um buffer do tamanho da janela, até 2× de densidade;
é uma troca de memória gráfica por nitidez e menor custo de atualização, não
uma promessa de consumir menos memória que os quatro blocos antigos.

O visualizador de imagens não foi alterado. Nenhuma dependência foi adicionada.

Referência consultada: `ItsDeimox/checkpoint-portfolio`,
`dxrkths/src/scene/panel-energy-field.js` e
`dxrkths/src/shaders/panel-network.js`. A topologia foi adaptada para hexágonos;
não é uma cópia pixel a pixel de um card 3D.

## Validação

TypeScript e build de produção aprovados, dois scripts de testes de geometria
e propagação aprovados, e **111 testes de interface aprovados** na rodada final.
Inclui controles independentes, zoom, 4K/2×, decaimento, continuidade do rastro,
tema e resize durante perda de contexto gráfico, ausência de WebGL e falha de
compilação do shader. Revisão independente concluída sem pendências importantes.

No laboratório Chrome headless/SwiftShader: p95 de 11,2 ms no fundo completo,
16,7 ms com ponteiro contínuo e Acrílico, e 5,7 ms no scroll adaptativo.
O p95 de Acrílico e scroll permaneceu igual à referência da 2.13.11; as linhas
SVG originais têm custo de pintura maior que as barras anteriores. Estes
números não são medição da GPU física do usuário nem garantia para todo hardware.
