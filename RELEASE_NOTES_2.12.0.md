# PentaMark 2.12.0 | Polimento óptico e seleção energética

## Novidades
- Bordas ópticas com dispersão RGB discreta e micro-refração procedural, sem duplicação de contornos rígidos.
- Mini-acrílico com desfoque nos estados hover/foco/selecionado, inclusive no modo Live e nas ações Compartilhar/Conectados.
- Seleção de texto no Live Preview com brilho suave e energia de baixa intensidade, sem alterar a geometria do documento. Respeita movimento reduzido; Flat mantém seleção simples.
- Barra contextual de seleção expandida: negrito, itálico, título, lista, tarefa, citação, link e código, mais acesso às ações restantes.
- Tooltips próprios da interface, ancorados nos controles e mostrando atalhos de teclado sem usar a tooltip nativa do navegador.
- Menu dos três pontos com formação óptica no Acrílico, animação sutil no Flat e X vetorial centralizado.
- Leitura de arquivos com varredura óptica transitória, sem movimentar as linhas ou bloquear seleção/edição.
- Limites anteriores de WebGL, cache e renderização sob demanda preservados.

## Compatibilidade
Mantidos os modos Live Preview, Código, Somente leitura e Dividido. Cofres Markdown, histórico, colaboração, permissões e MCP não foram alterados. O brilho de seleção é efeito de apresentação: o editor e os dados salvos continuam intactos.

## Limite óptico
A distorção/espectro usa o substrato procedural do shader e blur nativo do navegador sobre o DOM; não captura nem refrata diretamente caracteres da interface. Não foi feito benchmark na GPU do usuário. A versão Windows permanece sem assinatura digital.

Faça backup do cofre e feche versões anteriores antes de atualizar.
