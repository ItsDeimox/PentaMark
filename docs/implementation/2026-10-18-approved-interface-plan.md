# PentaMark: implementação do guia visual aprovado

Autoridade: `PentaMark-Guia-Visual-Aprovado.zip`. Contrato preservado em `approved-visual-spec.md`. A imagem principal prevalece sobre concepts históricas. A referência privada não foi republicada.

## Primeiro incremento: interface e edição inline

- [x] Partir do aplicativo existente, mantendo host, cofre, colaboração e renderização compartilhada.
- [x] Acrescentar testes com cofre sintético isolado e executar a versão anterior antes das mudanças.
- [x] Implementar superfícies grafite, componentes quadrados e navegação flutuante.
- [x] Recolher a árvore sem deslocar a coluna do documento, perdendo rolagem ou expansão.
- [x] Apresentar busca, ferramentas e formatação contextual sob demanda.
- [x] Preservar os quatro modos, preferências existentes e acesso às configurações.
- [x] Remover o salto causado pela exposição de marcadores inline e de títulos ao receber foco.
- [x] Manter edição, seleção, formatação, salvamento, desfazer e refazer.
- [x] Tratar Escape rápido, criação/renomeação com árvore fechada e Ctrl+B dentro de campos.
- [x] Adaptar a composição a telas menores e respeitar movimento reduzido.
- [x] Registrar testes e screenshots do aplicativo real em CI.

Os itens marcados indicam código implementado. O resultado de cada execução da validação deve ser consultado no workflow `Approved workspace regression`, não presumido a partir desta lista.

## Próximos incrementos, ainda não implementados

- [ ] Edição dos blocos complexos sem substituir sua geometria: YAML, tabelas, código, Mermaid, callouts e mídia. O comportamento anterior desses widgets permanece.
- [ ] Mapa neural baseado na hierarquia e nos vínculos reais, com organização estável, navegação por teclado/toque e renderização GLSL limitada ao necessário.
- [ ] Atividade MCP com eventos reais, arquivos afetados, diferenças e estados verificáveis. A conexão/configuração MCP existente continua disponível, sem painel fictício de atividade.
- [ ] Perfil de desempenho com cofres grandes e carregamento sob demanda das dependências pesadas.
- [ ] Regressões completas de colaboração em dois clientes, permissões/conflitos e dispositivos físicos.
- [ ] Empacotamento e teste do executável Windows e do host móvel.

## Fronteira de entrega

Branch de revisão: `agent/approved-visual-guide`. Não mesclar nem publicar automaticamente. Este incremento não representa a execução completa do guia.
