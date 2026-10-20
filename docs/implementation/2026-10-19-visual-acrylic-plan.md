# Refinamento visual e acrílico: implementação

## Autoridade
Feedback do autor em 19/10/2026: painel externo com arredondamento discreto, centralização ao recolher a navegação, paleta unificada, expansão animada e reconstrução dos painéis. Isso substitui o requisito anterior de cantos externos completamente quadrados e coluna fixa na tela.

## Implementado
- [x] Reproduzir o salto de 73,9375px do título após o callout na versão 2.8.0, antes de corrigir.
- [x] Substituir a troca de widget por fonte bruta e compensações de espaço por edição de fonte sobreposta, com proteção contra alterações concorrentes.
- [x] Reconstruir menu de ferramentas, compactar e animar a árvore, preservar a marca, centralizar o texto e adicionar fade na rolagem.
- [x] Unificar cores e métricas de controles, incluindo checkboxes.
- [x] Implementar Flat/Acrílico, GLSL sob demanda, resolução limitada, fallback e liberação dos recursos.
- [x] Ancorar prévias recursivas e preservar ancestrais, com cancelamento de requisições e profundidade limitada.
- [x] Corrigir foco de criação/renomeação após expansão e impedir confirmação duplicada ao descartar edição de bloco.
- [x] Executar 29 testes no Chromium com host real, sem falhas ou testes ignorados, na execução 39211485008.
- [x] Inspecionar capturas reais em Flat/Acrílico e telas 1672, 1280 e 390px.

## Verificação de distribuição
A inicialização do executável Windows é testada separadamente pelo workflow Build e publicar PentaMark. Consulte a execução do commit distribuído para o resultado, sem presumir aprovação a partir do checklist. A compilação e o teste de navegador não comprovam a taxa de quadros da máquina do usuário.

## Referência e limite técnico
Referência consultada: cortex-idle/src/rendering/postprocessing/modal-glass.js, blob 3873cf56247ac704e6268019ff9a92622752ba54. A adaptação combina refração de um fundo óptico procedural em WebGL com backdrop blur nativo para o DOM. Não captura nem refrata arbitrariamente o texto DOM no shader. Não adiciona partículas contínuas nem altera a fonte salva do documento.

## Fronteiras preservadas
Host, arquivos do cofre, colaboração e configuração MCP não foram substituídos. A edição da fonte avançada está fora do fluxo do documento; aplicar uma mudança real pode alterar o tamanho do bloco, mas apenas receber foco não o altera. Mapa neural, monitor MCP e auditoria ampla de dependências continuam fora desta entrega.
