# PentaMark 2.10.0: acrílico em toda a interface

## Material e iluminação

Um material GLSL compartilhado adiciona microtextura de vidro, fundo óptico refratado, circuitos impressos discretos, vias e contatos. Uma luz suave acompanha o cursor e revela o desenho sob a superfície. O texto permanece nítido e selecionável. O material também atende aos painéis auxiliares, menus, prévias e blocos decorativos do documento, estes com intensidade menor.

Há um único contexto WebGL, cache por superfície, limite de resolução e de superfícies visíveis. O cursor atualiza apenas a superfície ativa e o breve apagamento da anterior. Sem movimento ou alterações, não existe animação contínua. Flat remove os canvases; falha ou perda do contexto utiliza fallback nativo, com recuperação quando possível.

## Modais e navegação

Conta local, Configurações, Compartilhar, Conectar, Conectados, Celular, Conflito, Kanban e Fonte do bloco compartilham cabeçalho, conteúdo rolável, ações fixas e transições de entrada e saída. O foco de teclado permanece no diálogo ativo e retorna ao contexto anterior ao fechar. Confirmações de descarte e remoção agora usam o mesmo acabamento, sem caixas de confirmação do navegador.

Configurações separa Aparência, Tipografia, Cofre e host e MCP. Temas e materiais têm prévia imediata; cancelar restaura o visual. Os rascunhos de host não sobrescrevem automaticamente campos não editados. Mudanças concorrentes no campo editado são sinalizadas.

## Acesso direto ao MCP

O primeiro acesso no menu dos três pontos abre a Ponte MCP. Ela não é ativada só por abrir o painel. O token fica mascarado, a geração cria um rascunho e as alterações precisam ser salvas explicitamente. A interface sem privilégios de host não exibe o token nem as ações de configuração.

## Validação e limites

A suíte contém 55 cenários de navegador, incluindo pixels reais do shader, cache ocioso, perda de contexto, Flat, foco, confirmação aninhada, blocos sem deslocamento, opções salvas, cancelamento, conflitos e telas de 390 a 1672px, além de escala de 160%. Algumas situações de cliente remoto e revisão conflitante são injetadas explicitamente na fixture. Consulte os resultados da execução correspondente, não somente a existência dos testes.

A distribuição Windows passa separadamente pelo teste que abre o executável, carrega sua interface e grava/lê uma nota descartável. Não houve benchmark na GPU do autor nem teste em Android/iPhone físicos. O shader refrata o fundo procedural; o blur nativo trata o DOM atrás do vidro. Seletores de arquivos do sistema, o visualizador PDF externo e prompts do navegador não são redesenhados. As dependências existentes não foram atualizadas nesta entrega e mantêm alertas de auditoria.

Feche a versão anterior e faça backup do cofre antes de atualizar. Preferências são preservadas. O portátil Windows não tem assinatura digital. A integração na main permanece sujeita à aprovação do autor.
