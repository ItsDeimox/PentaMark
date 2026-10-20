# PentaMark 2.13.16 — edição no lugar

- Corrigido o deslocamento visual de aproximadamente 10 px na seleção e no cursor do Live causado pelo gutter inicial da rolagem.
- Callouts, células de tabelas, código e propriedades escalares compatíveis podem ser editados diretamente no conteúdo. A fonte de estruturas especializadas permanece dentro do próprio bloco, sem janela modal nem mudança de altura ao abrir.
- Live e leitura compartilham geometria de títulos, callouts, tabelas e código. Corrigidas herança de espaços, margens acumuladas e largura do documento.
- Alterações de texto usam intervalos derivados dos tokens Markdown: preservam destinos ocultos de links, delimitadores de formatação, prefixos de citações e células ausentes. Histórico, foco, seleção e conflitos com alterações externas são protegidos.
- Reaproveitado o lexer do marked para listas aninhadas, continuações, títulos setext, fences longos e tabelas sem pipes externos.
- Diagramas Mermaid usam cores do tema e rótulos SVG sanitizados. Previews e incorporações têm cache limitado, deduplicação, cancelamento e proteção contra ciclos. Navegação das prévias por Ctrl/Meta + clique.
- Controles nativos preservam semântica e teclado com aparência personalizada do tema. Painel de ferramentas revela e recolhe horizontalmente da direita para a esquerda, com movimento reduzido respeitado.
- Mantidas as melhorias de imagens da 2.13.15.

Casos cuja representação não pode ser mapeada com segurança (por exemplo, HTML arbitrário e YAML estruturado) usam a edição explícita da fonte no próprio bloco; nenhuma posição aproximada é usada para salvar texto.

## Validação

- `npm run check`: TypeScript e bundle aprovados.
- `npm run test:unit`: 100 testes aprovados.
- Suíte completa Playwright: 173 testes aprovados, sem falhas, skips ou retries. Inclui edição, conflitos, seleção em múltiplas escalas, igualdade geométrica Live/leitura, imagens, temas, painéis e perfis de rolagem/efeitos.
- A publicação executa novamente os unitários e o teste nativo de inicialização/leitura/gravação do executável Windows antes de disponibilizar os pacotes.
