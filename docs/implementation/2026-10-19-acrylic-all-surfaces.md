# Acrílico em toda a interface: execução 2.10.0

## Direção aprovada

Continuar o visual 2.9 aprovado pelo autor, estendendo acrílico e circuitos discretos sob a luz do cursor a todas as superfícies do app. Redesenhar os modais e organizar configurações, com entrada direta MCP no menu de ferramentas. Preservar os controles, o host local, a colaboração e a geometria do documento. Sem merge automático na main.

## Implementação

- [x] Um renderer WebGL compartilhado, microtextura e circuitos fixos, luz localizada, superfícies documentais mais discretas.
- [x] Cache por superfície, limite de 20 superfícies, 8 milhões de pixels de backing total, scratch até 2 milhões e 2048px por eixo, renderização sob demanda e recuperação de contexto.
- [x] DialogFrame e DialogPresence para foco modal, teclado, entrada/saída, cabeçalho e rodapé fixos, rolagem interna.
- [x] Conta local, Configurações, Compartilhar, Conectar, Conectados, Celular, Conflito, Kanban, Fonte do bloco e confirmações.
- [x] Tipografia e tema, cancelamento visual, rascunhos do host e proteção contra alterações concorrentes no campo editado.
- [x] MCP direto, token mascarado e habilitação somente após ação explícita de salvar; configuração não acessível na interface sem privilégios de host.
- [x] Prévias, menus contextuais, seleção, assets e avisos cobertos sem mudar a estrutura aprovada.

## Evidências antes da distribuição

Os testes adicionados falharam antes da implementação: duas regressões de acesso MCP/categorias e uma de circuitos. Após a implementação, a execução 39230731719 verificou 54 dos 55 cenários. O cenário restante procurava um texto auxiliar de rodapé que fica oculto em diálogos compactos; foi corrigido para verificar o aviso de acesso que permanece visível e a ausência de campos/ações privilegiados, mantendo essas verificações.

Capturas inspecionadas: Configurações, Conta, MCP, desktop 1672px, mobile 390px e escala 160%. A suite completa e o executável do commit de distribuição são verificados pelos workflows existentes. O resultado final deve ser consultado na execução do commit, sem deduzir aprovação a partir deste checklist.

## Limites e revisão

O shader refrata seu próprio fundo óptico procedural, com blur nativo para o DOM por trás. Não captura texto DOM. O renderer de pixel tests é o Chromium do CI, não a GPU física do autor. As fixtures de não-host e revisão conflitante são identificadas como simuladas; a mesclagem final grava no host real de testes.

As dependências não foram atualizadas. A versão do aplicativo e do bundle móvel é 2.10.0, derivada de package.json; o lockfile conserva os metadados de versão raiz anteriores, com as mesmas declarações e resoluções de dependências. npm ci é verificado no CI. Alertas de dependências são preexistentes e não fazem parte da auditoria visual. Seletores nativos de arquivos e visualizadores externos continuam pertencendo ao sistema/navegador.
