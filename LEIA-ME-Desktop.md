# PentaMark Desktop 2.6.2

## Como abrir

1. Extraia o ZIP inteiro.
2. Abra a pasta `PentaMark`.
3. Execute `PentaMark.exe`.

Não é necessário instalar Python, Node.js ou abrir outro servidor. O próprio aplicativo hospeda o cofre para a rede local e para o Radmin VPN.

## Compartilhar

1. No computador host, abra o PentaMark e o Radmin VPN.
2. Clique em **Compartilhar** e copie o endereço que começa com `http://26.`.
3. No outro computador ou celular, abra esse endereço no navegador ou use **Conectar a um cofre** no PentaMark Desktop.

Use **Conta** para escolher apelido e foto. O botão **Conectados** mostra quem está online e permite ao host definir Leitor, Editor ou Admin. Os cursores remotos aparecem inclusive no Live Preview; acessos da IA ficam marcados como **IA / MCP**.

Em **Configurações > Host local**, o host pode ativar **Bloquear edição simultânea**. Quando essa regra está ligada, apenas a primeira pessoa no arquivo consegue editá-lo; as demais continuam podendo visualizar.

## Trocar de cofre

Clique com o botão direito no nome do cofre no topo, use o menu `…` ou abra **Configurações > Cofre** e escolha **Abrir outro**. Selecione qualquer pasta com arquivos `.md`; o PentaMark reinicia sozinho usando essa pasta.

Wikilinks como `[[Nota|apelido]]`, embeds como `![[assets/imagem.png]]`, áudios, vídeos, PDFs, propriedades YAML, callouts, Kanban e blocos `mermaid` são reconhecidos no Preview e no Live Preview. Assets aparecem na árvore e abrem no workspace, com zoom por scroll e movimento por arraste para imagens.

O Live Preview revela a fonte Markdown da linha tocada pelo cursor/seleção. O Kanban permite criar, editar, remover e arrastar cartões entre colunas, alternar o layout horizontal/vertical e recolher o quadro inteiro.

## Ponte IA

O host pode ativar **Configurações > Ponte IA · Codex / MCP** e copiar a URL do Radmin. No Codex Desktop/IDE do amigo, adicione essa URL como servidor MCP do tipo **Streamable HTTP**. Assim o Codex consegue buscar, ler e editar o cofre sob demanda sem uma cópia local completa e sem chave de API adicional do PentaMark.

## Arquivos e backup

Notas, anexos, histórico e lixeira ficam na pasta `vault` do host ou na pasta escolhida como cofre. Para fazer backup, copie essa pasta inteira.

No aplicativo do host, clique com o botão direito em uma nota ou pasta e escolha **Abrir na pasta** para localizá-la no Explorer.

## Atualizar

Feche o aplicativo e extraia a nova versão. O PentaMark não apaga seu cofre. Mesmo assim, mantenha backup da pasta `vault` antes de atualizações importantes.
