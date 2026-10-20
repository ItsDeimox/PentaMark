# PentaMark 2.13.1: controles transparentes

Uma correção visual pontual da 2.13.0. A pedido do autor, removemos os preenchimentos coloridos atrás de botões e opções clicáveis, incluindo hover, arquivos selecionados e os modos Live, Código, Leitura e Dividido.

- Botões de navegação, menu contextual, barra de seleção e opções ficam sem preenchimento colorido em Flat e Acrílico.
- A luz suave nas bordas do shader foi mantida, mas o corpo óptico do botão não cria um fundo tingido.
- Indicadores de seleção continuam legíveis pela cor do texto/ícone e pela linha do arquivo ativo.
- Blur, tooltips, animações, dados locais, atalhos, MCP e operações Markdown não foram modificados.
- Botões de confirmação primária ou ação destrutiva de modais mantêm sua distinção semântica.

**Windows:** baixar `PentaMark-Desktop-2.13.1-Windows.exe`. Feche a versão anterior e faça backup do cofre. O app é portátil e não possui assinatura digital.

Build automatizado, testes Chromium e inicialização do executável Windows são validados pelo workflow correspondente; o código permanece em branch de revisão, sem alterar a `main`.
