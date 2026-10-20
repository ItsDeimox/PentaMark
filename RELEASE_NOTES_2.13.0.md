# PentaMark 2.13.0 | Refinamento visual e navegação

## Arquivos e menus
- Botão direito em nota, pasta ou anexo: **Copiar caminho → Caminho relativo / Caminho absoluto**. Submenu lateral, aberto por hover ou teclado, reposicionado em telas estreitas.
- Caminhos absolutos são resolvidos com validação pela integração Desktop local, sem expor o caminho do cofre no host remoto. No navegador só há caminho relativo.
- **Ctrl+F** abre a busca rápida do cofre. O atalho Ctrl+P continua aceito por compatibilidade, mas não aparece como atalho principal.
- Ajuste de foco/hover quando o arquivo selecionado muda.

## Animação e nitidez
- Efeito de **decodificação de caracteres** ao abrir uma nota, adaptado do algoritmo de apresentação textual do Cortex Idle. Cada glifo temporário resolve da esquerda para a direita. Não escreve caracteres falsos no documento nem interfere no histórico, seleção ou cursor.
- O antigo escaneamento vertical do texto foi removido.
- Cancelamento imediato do efeito ao começar a interagir. Movimentos reduzidos deixam o documento sem animação.
- Centralização harmonizada dos conteúdos Live Preview e Leitura, preservando o tamanho máximo da coluna.

## Materiais
- O vidro segue melhor a paleta do tema ativo, inclusive na seleção de notas, barra lateral, tooltips e botões.
- Blur consistente nas ações inativas, ativas e em hover, sem circuitos atrás da barra estreita de formatação.
- Contornos Flat menos contrastantes; seleção de texto mais contida e discreta.
- Circuitos finos com luminância ligeiramente reforçada, leve oscilação espacial de plasma, sem animação contínua quando o cursor está parado.

## Validação
Verificar a execução do GitHub Actions correspondente à compilação desta versão para resultados concretos. O teste automatizado do executável Windows usa um cofre sintético, sem dados pessoais. Benchmark prolongado no computador do usuário e no Android continua pendente. Faça backup do cofre antes de atualizar.
