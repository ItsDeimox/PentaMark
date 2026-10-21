# Convites e atualizações Implementation Plan

> **For agentic workers:** Implementar tarefas independentes em paralelo, revisar a integração e validar antes de publicar.

**Goal:** Criar convites do Tailscale pelo PentaMark e instalar atualizações pelo aplicativo Windows/Android.

**Architecture:** O Desktop guarda a credencial pessoal de Tailscale com criptografia do sistema e chama somente a API oficial para compartilhar seu próprio dispositivo. Um convite PentaMark contém o endereço do cofre e o convite oficial, sem credenciais. Atualizadores nativos consultam a release estável no repositório fixo, validam o pacote e iniciam a instalação após ação explícita.

**Tech Stack:** Electron portable, Capacitor Android, React, GitHub Releases, Tailscale device invites API.

**Spec:** Pedido do usuário nesta conversa: criar convite pelo aplicativo, configuração inicial guiada, link para o amigo e atualização dentro do aplicativo.

## Global Constraints

- Versão 2.13.19 / Android versionCode 21319. Manter a chave de assinatura Android.
- Cofres e preferências existentes preservados. Atualizar somente o executável/APK.
- Chaves Tailscale somente no armazenamento nativo criptografado do host. IPC restrito à origem e frame principal do app local.
- Sem terminal para o usuário. A geração da chave abre a página oficial; o restante é guiado pelo app.
- O amigo aceita o convite Tailscale antes de conectar; cliente oficial Tailscale permanece necessário.
- Instalação Android depende da confirmação do instalador do sistema.
- Textos compactos e ajuda recolhida. Sem bibliotecas pesadas ou novos renderizadores.

## Review Focus

- Convite não pode iniciar navegação privilegiada para origem arbitrária; validar esquema, tamanho, campos e IP Tailscale.
- Chave expirada ou conexão indisponível não deve gerar convite falso nem descartar arquivos locais.
- Update interrompido, hash incorreto ou pacote inesperado não pode substituir a instalação.
- Executável portable precisa substituir o arquivo original e restaurá-lo em caso de falha, preservando o diretório de dados.
- Instalação deve aguardar salvamento; erros/conflitos mantêm editor aberto.

### Task 1: Tailscale Desktop

- [ ] Criar desktop/tailscale.cjs com status/saveKey/forgetKey/createInvite/openSetup e testes unitários isolados da conta real.
- [ ] Integrar IPC e preload local-only, tipar API e implementar assistente em Compartilhar.
- [ ] Testar erros de chave, Tailscale ausente/desconectado e geração de convite sem expor credenciais.

### Task 2: Link do convite

- [ ] Criar parser/serializer pentamark://join com origem validada e URL oficial de convite.
- [ ] Registrar protocolo no Windows e intent-filter Android, receber link em inicialização e app aberto.
- [ ] Implementar diálogo de aceite/conexão e permitir colar o link nas telas de conexão.
- [ ] Testar payload malformado, origem arbitrária, cancelamento e salvamento antes da troca de cofre.

### Task 3: Atualizadores nativos

- [ ] Criar updater Windows e helper recuperável; metadados fixos, download/hash e relançamento portable.
- [ ] Criar AppUpdate Android com download nativo, validação de pacote, assinatura, versão e instalador.
- [ ] Criar aba Atualizações com checagem, progresso, baixar, permissão Android e instalar após salvar.
- [ ] Validar metadados inválidos, hashes incorretos, duplicidade de download, assinatura divergente e erros offline.

### Task 4: Integração e publicação

- [ ] Revisar código, executar TypeScript, testes unitários e UI dos novos fluxos.
- [ ] Compilar Windows/Android e validar inicialização/ponte nativas via CI.
- [ ] PR, merge da release, assinar APK com chave original, publicar 2.13.19 e conferir hashes dos downloads.
- [ ] Explicar a instalação inicial necessária para receber o atualizador e os limites da validação sem credencial pessoal real.
