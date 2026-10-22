# PentaMark 2.13.21 — auditoria de funcionamento offline

Revisão: 22/10/2026. Base local: `4ff62df`.

## Resultado

O modo descrito pelo usuário — manter cópia local do cofre remoto, trabalhar por dias com o host desligado, reiniciar o app sem rede e reconciliar tudo posteriormente — ainda não está implementado.

## O que já existe

- Cofre Android local independente, com notas e anexos no aparelho.
- Proteção de rascunhos Android no `localStorage`, separados por endereço do host e caminho da nota. Incluem o conteúdo e a revisão base.
- Reconexão do fluxo de eventos remoto com espera progressiva.
- Retomada do salvamento da nota ativa após a conexão voltar.
- Comparação de revisões no servidor, resposta 409 para conflito e diálogo para comparar e escolher/mesclar versões.
- Testes que verificam proteção de rascunhos, isolamento entre cofre local e remoto e retomada após falha de requisição.

## O que impede o uso offline completo

- `initializeAndroid()` exige uma resposta do host remoto antes de montar o editor. Se o app for reaberto sem host, oferece tentar novamente ou voltar ao cofre local, que é separado.
- `openNote()` busca a nota no host antes de recuperar seu rascunho. O rascunho não constitui uma cópia navegável do cofre remoto.
- Não há um espelho persistente das notas e anexos do host, nem uma fila durável geral de operações offline.
- Não há reconciliação completa de múltiplos arquivos, renomeações, exclusões, anexos e alterações concorrentes após vários dias.
- No Windows/navegador, conectar a outro host navega para a URL remota. A proteção de rascunhos descrita acima é específica do Android.
- O service worker armazena a interface, mas exclui `/api/` e `/uploads/` do cache. Isso não fornece os dados do cofre offline.
- O painel de conexão já informa: “O cofre local funciona offline e é separado do PC. Não há sincronização automática.”

## Arquivos examinados

- `src/platform/android.ts`: inicialização remota, requisições, reconexão e envio de rascunhos.
- `src/platform/local-files.ts`: armazenamento e revisão base dos rascunhos.
- `src/app/PentaMarkApp.tsx`: abertura, salvamento, retomada e conflitos.
- `src/components/dialogs/RemoteConnectionPanel.tsx`: descrição e configuração atuais.
- `local/server.mjs`: comparação de revisões e operações de arquivos.
- `public/sw.js`: limites do cache da interface.
- `tests/remote-ui.spec.mjs`: testes de desconexão e recuperação existentes.

## Próxima etapa proposta, ainda não implementada

1. Definir uma opção por cofre: “Manter cópia offline”, com sincronização automática ou manual.
2. Manter espelho local, revisão base e fila persistente de alterações; abrir e editar essa cópia mesmo após reiniciar sem host.
3. Na reconexão, comparar a base com as versões local e remota, aplicar alterações não conflitantes e preservar ambas as versões quando houver conflito. Confirmar o recebimento antes de remover operações da fila.
4. Incluir criação, alteração, renomeação, exclusão e anexos; identificar o cofre independentemente de mudanças no IP/endereço.
5. Validar desconexão prolongada, reinício durante a sincronização, respostas perdidas, mudanças nos dois aparelhos e conflitos de exclusão/renomeação.

Esta auditoria não habilita nem implementa o novo sistema de sincronização.
