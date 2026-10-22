# PentaMark Offline Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Permitir edição offline durável em Windows e Android, sincronização automática/manual e resolução de conflitos sem descartar versões.

**Architecture:** Uma réplica local por aparelho/cofre guarda arquivos, base comum e fila durável; um motor TypeScript compartilhado decide a reconciliação. Host e adaptadores nativos preservam versões em objetos por SHA-256 e registram transações/recuperação em SQLite. Conflitos não têm vencedor automático.

**Tech Stack:** React/TypeScript, Electron 43.3.0, Node com node:sqlite, Capacitor 8.5.3, Java/SQLiteOpenHelper, node:test, Playwright, JUnit e testes instrumentados Android.

**Spec:** ../specs/2026-10-22-offline-sync-design.md

Execução e publicação conjunta autorizadas pelo usuário em 22/10/2026, após validação dos dois aplicativos.

## Global Constraints

- Aplicativos Windows e Android; um host por cofre. Navegador/PWA e iOS ficam fora da garantia offline.
- Android minSdkVersion=24, compileSdkVersion=36, targetSdkVersion=36; preservar a assinatura dos APKs existentes.
- CI e host standalone desta funcionalidade usam Node 24, com piso 24.18.1; o usuário do EXE/APK não precisa instalar Node.
- Perfis existentes começam com “Manter cópia offline” desativado; ao habilitar, oferecer automática/manual.
- Manual não envia/aplica conteúdo nem avança cursores sem “Sincronizar agora”, após a criação inicial explícita.
- Não usar timestamp para escolher vencedor nem mesclar automaticamente versões concorrentes.
- Arquivos e SQLite não formam uma única transação: implementar file_intents e recuperação antes de servir gravações.
- SQLite: WAL, synchronous=FULL, foreign_keys=ON; SQL compatível com API 24.
- Transferências de 1 MiB por segmento; limite total conforme o host. Sem grandes anexos em JSON/base64.
- Nenhuma política automática pode podar conflito, base necessária, tombstone ou operação não confirmada.
- Não usar Program Files para dados graváveis. Preservar a correção local de inicialização.
- Não alterar VPN, firewall, escuta de rede ou chaves por ativar a função.
- Testes com cofres fictícios; publicar EXE e APK juntos somente depois dos gates de validação.

## Review Focus

- Resposta perdida depois da gravação no host: efeito único e confirmação recuperável — tarefas 2, 3 e 6.
- Edição nova durante envio ou pull: ACK antigo não limpa edição nova e pull não substitui editor sujo — tarefas 4, 5 e 6.
- Reinício entre gravação do arquivo e commit SQLite, ou disco cheio: nenhuma versão truncada/pendência esquecida — tarefas 2, 4 e 5.
- Caixa/Unicode, arquivo novo em pasta excluída e rename/delete concorrentes: nenhum nome é fundido ou apagado silenciosamente — tarefas 1, 6 e 8.
- Cofre diferente no mesmo endereço, restauração do host e schema novo em app antigo: bloquear envio inseguro, manter cópia e permitir exportação — tarefas 3, 6, 7 e 10.

---

## Mapa de arquivos e responsabilidades

Novos:

| Arquivos | Responsabilidade |
|---|---|
| src/features/sync/contracts.ts, reconcile.ts, engine.ts | Contratos, decisão pura e agendamento compartilhado. |
| src/features/sync/useSyncController.ts, SyncSettings.tsx, SyncStatus.tsx | Integração React e controles de sincronização. |
| src/features/sync/conflict-model.ts | Decisões de conflito e preservação de resultados. |
| src/platform/replica.ts | Seleção explícita de adaptador/replica ativa. |
| local/sync/schema.sql, database.mjs, objects.mjs, file-journal.mjs | Schema, transações, objetos e recuperação de disco. |
| local/sync/host-service.mjs, routes.mjs, scan.mjs | Host, protocolo HTTP e detecção de mudanças externas. |
| local/sync/replica-service.mjs, transport.mjs | Armazenamento Windows e transporte de sincronização nativo. |
| desktop/sync-ipc.cjs | Ponte fechada entre renderer e processo local. |
| android/.../SyncDatabase.java, SyncFileJournal.java, SyncVault.java, SyncVaultPlugin.java | Armazenamento Android e implementação da ReplicaPort. |
| tests/fixtures/sync/contract-cases.json | Casos compartilhados com resultados literais para TS e Java. |
| tests/sync-*.test.mjs, tests/sync-ui.spec.mjs, tests/sync-pair.spec.mjs | Testes de protocolo, armazenamento, motor e UI. |
| android/.../Sync*Test.java | Testes JVM e instrumentados dos adaptadores. |
| scripts/verify-offline-windows.ps1 | Inicialização offline nativa com fixture. |

Modificar:

- local/server.mjs: encaminhar todas as mutações relevantes ao coordenador e registrar mudanças.
- desktop/main.cjs, desktop/preload.cjs, src/desktop.d.ts: IPC de réplica e manutenção da origem local.
- src/api/client.ts, src/platform/android.ts, src/platform/remote-profile.ts: roteamento, bootstrap e migração.
- src/app/PentaMarkApp.tsx, src/main.tsx: abrir do disco, status local/remoto e proteção do editor.
- src/components/dialogs/SettingsModal.tsx, RemoteConnectionPanel.tsx, ConflictModal.tsx: controles e conflitos.
- android/.../RemoteConnection.java, LocalVault.java, MainActivity.java: streaming, caminhos locais e registro do plugin.
- package.json, tsconfig.json, scripts de build e .github/workflows/{desktop-check,publish-app,android}.yml: compilar/empacotar o motor e executar os novos gates.

android/... significa android/app/src/main/java/com/pentagory/pentamark/. Testes Java equivalentes ficam em android/app/src/test/java/com/pentagory/pentamark/ e android/app/src/androidTest/java/com/pentagory/pentamark/.

Não reestruturar o editor inteiro: extrair somente os pontos necessários ao contrato de réplica.

## Ordem e marcos

1 → 2 → 3 define o host e o protocolo; 4 e 5 podem avançar separadamente após o contrato.
6 depende de 1, 3, 4 e 5; 7/8 integram uso e conflitos; 9 prova o conjunto; 10 libera.

Marcos verificáveis:

- A: protocolo e escrita durável do host.
- B: réplica local durável nos dois sistemas.
- C: sincronização manual e conflitos completos.
- D: automática, migração e ensaios de falhas.
- E: APK/EXE da mesma revisão validados e prontos para publicação.

### Task 1: Contrato e decisão pura de reconciliação

**Files:** criar contracts.ts e reconcile.ts; criar tests/sync-reconcile.test.mjs e fixtures/sync/contract-cases.json.

**Interfaces:** produzir os tipos da seção 5 da spec, normalizePath(path: string): PathResult e planEntry(base: EntryVersion|null, local: EntryVersion|null, remote: EntryVersion|null): ReconcileDecision. O campo action distingue 'none'|'push'|'pull'|'converged'|'conflict', com reason explícito; nunca contém uma escrita incondicional.

- [ ] Escrever primeiro casos com resultados literais: só local, só remoto, idênticos, texto divergente, edição/exclusão, renomeação/exclusão, colisão de caminho e binário divergente. Acrescentar NFC, case-only rename, nomes reservados e relógios invertidos. Exemplo: base=textoA, local=textoB e remoto=textoC deve produzir action='conflict', preservando os hashes literais A/B/C; base=A/local=B/remoto=A deve produzir action='push' com a revisão base original.
- [ ] Executar node --test tests/sync-reconcile.test.mjs e confirmar falhas nas decisões ainda ausentes.
- [ ] Implementar contratos, validação de caminhos e função pura conforme a tabela da spec; persistir decisões técnicas em fixture usada também por Java.
- [ ] Reexecutar o teste e npm run typecheck; exigir todos os casos corretos, inclusive ambos os hashes preservados no resultado de conflito.
- [ ] Commit: feat(sync): define replica protocol and conservative reconciliation.

### Task 2: Histórico durável, escrita condicional e recuperação no host

**Files:** criar local/sync/{schema.sql,database.mjs,objects.mjs,file-journal.mjs,host-service.mjs,scan.mjs}; modificar local/server.mjs; testar tests/sync-host-store.test.mjs.

**Interfaces:** createHostService({dataRoot,vaultRoot}): HostService; recover(): Promise<void>; rescan(): Promise<void>; apply(operation): Promise<ApplyResult>; openSnapshot(): Promise<Snapshot>; readChanges(cursor,limit): Promise<ChangesPage>. Produzir applied_ops idempotente, histórico por entryId e objetos imutáveis.

- [ ] Testar em fixture: base divergente não altera bytes do host e preserva incoming; repetir opId não grava duas vezes; conteúdo anterior continua recuperável; exclusão vira lixeira/tombstone; uma versão externa observada entra no histórico.
- [ ] Injetar interrupções depois do objeto, depois da intenção, depois do rename e antes do commit. Reabrir o serviço e conferir que arquivo, revisão, fila de intenções e resultado idempotente são coerentes.
- [ ] Executar node --test tests/sync-host-store.test.mjs, verificar falhas corretas e só então implementar o armazenamento e a recuperação.
- [ ] Encaminhar notas/anexos/pastas e mutações MCP ao coordenador; antes de validar base, atualizar o índice do arquivo real. Acrescentar varredura na abertura, antes de um snapshot e em ciclos ativos; watcher é otimização, não fonte única de verdade.
- [ ] Testar pasta com filho desconhecido, falha de rename por arquivo bloqueado, EACCES/ENOSPC e crash durante uma exclusão. Sem remoção recursiva de conteúdo desconhecido.
- [ ] Reexecutar testes e suíte unitária existente. Commit: feat(sync): persist host history and recover file transactions.

### Task 3: API versionada, snapshots consistentes e transferências

**Files:** criar local/sync/routes.mjs; modificar local/server.mjs; testar tests/sync-protocol.test.mjs e tests/sync-transfer.test.mjs.

**Interfaces:** implementar exatamente as rotas da seção 6; ApplyResult associa opId a status='applied'|'already-applied'|'conflict'|'blocked', versão confirmada e conflito quando houver. Nunca emitir ACK antes de apply() persistir o resultado.

- [ ] Testar handshake com vaultId/serverId/epoch, host incompatível, criação concorrente durante snapshot e cursor de epoch antiga.
- [ ] Testar segmentos retomados/repetidos, comprimento/hash incorretos, arquivo maior que 32 MiB por streaming e tamanho acima do limite anunciado. Transferência inválida não disponibiliza blob.
- [ ] Confirmar falhas com node --test tests/sync-protocol.test.mjs tests/sync-transfer.test.mjs.
- [ ] Implementar snapshot paginado fixado em S e objetos imutáveis; changes inclui alterações posteriores a S. Tamanho máximo de apply=100 operações; operações inválidas têm resultado explícito.
- [ ] Validar permissões de arquivo/cofre, limites, caminhos e dependências; não permitir usar baseRevision=null para substituir destino existente. Não aceitar endereços arbitrários fornecidos pelo renderer.
- [ ] Executar testes de protocolo/transferência e testes atuais de API. Commit: feat(sync): add resumable versioned host exchange.

### Task 4: Réplica durável e ponte local no Windows

**Files:** criar local/sync/replica-service.mjs e desktop/sync-ipc.cjs; modificar main.cjs, preload.cjs, src/desktop.d.ts e servidor para mensagens IPC; testar tests/sync-desktop-store.test.mjs.

**Interfaces:** implementar ReplicaPort no processo Node local. Electron expõe window.pentaMarkDesktop.sync.invoke(command), com command validado por união fechada equivalente aos métodos das portas nativas: {requestId, replicaId, method, payload}. Cada chamada carrega replicaId fixo; respostas são associadas a requestId. O adaptador não recebe JavaScript, caminho absoluto nem uma URL de blob arbitrária.

- [ ] Testar edição offline, reinício, sequência local A→B durante envio de A, atomicidade disco/banco e confirmação duplicada. ACK de A não remove B; preparePending reutiliza exatamente a operação preparada e só prepara B depois do ACK de A, usando a base confirmada. persistIncoming com expectedLocalHead antigo retorna stale-local-head, conserva B e não avança o cursor.
- [ ] Testar path traversal, réplica errada, chamada de frame remoto e tentativa de expor arquivos do cache por uma conexão de rede.
- [ ] Confirmar falhas com node --test tests/sync-desktop-store.test.mjs.
- [ ] Implementar o armazenamento em userData e IPC pelo canal pai/filho do servidor, mantendo trustedFrame e sem endpoint público de gestão da réplica.
- [ ] Implementar mídia local por IDs/capacidade de sessão, restrita a loopback; não aceitar caminhos absolutos vindos da página.
- [ ] Executar os testes e os existentes desktop-data-root/desktop-updater. Commit: feat(sync): add persistent Windows replica adapter.

### Task 5: Réplica Android e operações nativas

**Files:** criar SyncDatabase.java, SyncFileJournal.java, SyncVault.java e SyncVaultPlugin.java; modificar MainActivity.java e RemoteConnection.java; criar SyncVaultTest.java, SyncDatabaseInstrumentedTest.java e SyncBridgeInstrumentedTest.java.

**Interfaces:** plugin Capacitor SyncVault implementa a mesma ReplicaPort por JSON; grandes blobs são manipulados nativamente, apenas IDs/progresso atravessam a ponte. O contrato compartilhado usa os mesmos campos, estados e erros.

- [ ] Usar as fixtures comuns para validar caminhos e aplicação de decisões produzidas pelo motor compartilhado, sem criar um segundo algoritmo Java de reconciliação. Testar persistência após recriar objetos/Activity, escrita durante transferência, preparação imutável/serialização de operações do mesmo arquivo, stale-local-head e crash/reabertura do journal.
- [ ] Confirmar falhas com cd android e ./gradlew :app:testDebugUnitTest. Para SQLite/ponte reais, usar os testes instrumentados, não mocks do banco.
- [ ] Implementar armazenamento privado, transações e fsync/rename compatíveis com API 24; manter fila fora da WebView.
- [ ] Acrescentar streaming em segmentos e retomada no transporte nativo; manter setBlockNetworkLoads(true). Servir mídia da réplica por rota local validada.
- [ ] Rodar :app:testDebugUnitTest e :app:connectedDebugAndroidTest em API 24 e 35, com fixtures e rede simulada. Exigir preservação dos bytes e fila após reinício.
- [ ] Commit: feat(sync): add durable Android replica and streaming adapter.

### Task 6: Motor comum, manual e automático

**Files:** criar src/features/sync/engine.ts e useSyncController.ts; criar local/sync/transport.mjs e adaptadores da RemotePort; testar tests/sync-engine.test.mjs.

**Interfaces:** createSyncEngine({replica:ReplicaPort,remote:RemotePort,clock:Scheduler}): SyncEngine. Métodos start(), stop(), synchronizeNow(), setMode(mode), onStatus(listener); relógio injetado evita testes com espera real. Só um ciclo ativo por réplica.

- [ ] Testar que manual, após a cópia inicial, não chama snapshot/changes/apply/transfer em boot, resume ou reconexão; somente synchronizeNow() inicia troca de conteúdo.
- [ ] Testar automática com host desligado por 7 dias simulados, restauração de conexão, app reiniciado, clique durante ciclo ativo e modo alterado durante envio.
- [ ] Testar resposta perdida após commit no host, edição B durante envio de A, sequência criar→editar→renomear→excluir offline, página recebida mas não persistida, epoch diferente e outro vaultId no mesmo IP. Criação apagada antes de preparePending não gera arquivo remoto; criação já preparada exige ACK antes da exclusão condicional.
- [ ] Confirmar falhas com node --test tests/sync-engine.test.mjs.
- [ ] Implementar handshake, download inicial, recepção durável, plano de três estados, envio condicional, ACK persistido e repetição idempotente. Usar RemotePort.downloadBlob/uploadBlob no staging nativo; somente depois de verificar objetos persistir IncomingBatch com os localHeads esperados. Repetir a comparação em stale-local-head. Erro num arquivo não apaga a fila nem oculta conflitos.
- [ ] Agendar automática com debounce de 1 segundo após edição; retentativas com jitter em 1, 2, 4, 8, 16 e no máximo 30 segundos. Manual não possui retentativa de conteúdo fora do ciclo explicitamente solicitado.
- [ ] Reexecutar testes com relógio simulado. Commit: feat(sync): coordinate manual and automatic reconciliation.

### Task 7: Abrir e editar localmente nos dois aplicativos; migração

**Files:** criar src/platform/replica.ts; modificar src/api/client.ts, src/platform/{android.ts,remote-profile.ts}, src/main.tsx e src/app/PentaMarkApp.tsx; testar tests/sync-ui.spec.mjs e tests/sync-migration.test.mjs.

**Interfaces:** ActiveVaultContext distingue local-host, live-remote e offline-replica, com identidade imutável durante requisições. request<T>() mantém sua assinatura pública e escolhe a porta por contexto.

- [ ] Testar abrir o app offline após a primeira cópia, navegar entre várias notas, pesquisar arquivos, criar/renomear/excluir e abrir anexos já copiados. Nunca apresentar arquivo remoto ausente como conteúdo vazio. Editar uma nota já baixada durante a cópia inicial não pode ser perdido quando o snapshot terminar.
- [ ] Testar que pull não substitui editor com digitação nova e que fechamento antes do ACK de rede conserva a edição local já confirmada.
- [ ] Testar migração Android por host/caminho; cofre diferente não recebe rascunho; falha no meio permite repetir; revisão base desconhecida cria conflito e mantém o rascunho antigo.
- [ ] Confirmar falhas nos testes acima antes de trocar o roteamento.
- [ ] Remover dependência de handshake no bootstrap de réplica existente. No Windows, impedir window.location.assign para perfis offline: interface continua na origem local.
- [ ] Migrar somente após identidade confirmada e confirmação durável do conteúdo; manter cofre Android independente separado.
- [ ] Executar os novos testes e tests/remote-ui.spec.mjs. Commit: feat(sync): open cached vaults offline and migrate protected drafts.

### Task 8: Conflitos e configurações sem descarte silencioso

**Files:** criar conflict-model.ts, SyncSettings.tsx e SyncStatus.tsx; modificar SettingsModal.tsx, RemoteConnectionPanel.tsx, ConflictModal.tsx e domain/types.ts; testar tests/sync-conflicts.test.mjs e tests/sync-ui.spec.mjs.

**Interfaces:** ReplicaPort.resolve(input: ConflictResolution) recebe conflictId, expectedRemoteRevision, expectedLocalHead, choice e mergedContent opcional; choice='keep-both'|'local'|'remote'|'merged'. A porta persiste a versão que deixa de ser a versão de trabalho antes de mudar qualquer arquivo.

- [ ] Testar os quatro caminhos de resolução e verificar conteúdo base/local/remoto recuperável depois de cada escolha.
- [ ] Testar host ou edição local alterados enquanto o diálogo está aberto, binários distintos, rename/delete e dois nomes que colidem no Windows. Revisão/head inesperados rejeitam a resolução, e o resultado digitado não pode sumir num novo conflito.
- [ ] Testar habilitação explícita, manual/automática por cofre, status de cópia incompleta e tentativa de desativar com pendências/conflitos.
- [ ] Confirmar falhas antes de implementar: node --test tests/sync-conflicts.test.mjs e npx playwright test tests/sync-ui.spec.mjs.
- [ ] Implementar os controles e textos da seção 11. “Sincronizado” exige ausência de pendências/conflitos e snapshot completo.
- [ ] Manter exclusões na lixeira; rmdir de pasta não vazia gera conflito. Não adicionar “forçar sobrescrita” nem limpeza automática de versões.
- [ ] Reexecutar testes e verificar PC/tela Android. Commit: feat(sync): expose safe conflict resolution and per-vault modes.

### Task 9: Ensaios ponta a ponta e falhas reproduzíveis

**Files:** criar tests/sync-pair.spec.mjs, tests/sync-crash.test.mjs e scripts/verify-offline-windows.ps1; ampliar testes Android instrumentados e os workflows de validação.

**Interfaces:** fixture levanta host e réplicas em diretórios temporários diferentes, permite interromper transporte e processo em fronteiras nomeadas, sem usar endereços/cofres reais.

- [ ] Implementar ensaios com resultados literais esperados: PC→Android, Android→PC e dois clientes editando simultaneamente com host desligado.
- [ ] Simular 7 dias offline sem esperar 7 dias; encerrar/reabrir clientes, reiniciar host, perder ACK e repetir solicitações. Comparar hashes finais e todas as versões de conflitos.
- [ ] Exercitar download inicial com host mudando, arquivo grande retomado, disco cheio, permissões negadas, arquivo bloqueado no Windows e conteúdo alterado externamente.
- [ ] Rodar npm run typecheck, npm run test:unit e node --test tests/sync-*.test.mjs; os novos testes unitários também devem ser incluídos em test:unit.
- [ ] Rodar PM_TEST_PORT=35268 npx playwright test tests/remote-ui.spec.mjs tests/sync-ui.spec.mjs tests/sync-pair.spec.mjs, configurando as variáveis com a sintaxe do shell usado.
- [ ] Rodar o smoke nativo Windows e os testes Android em API 24 e 35; nenhum teste pode habilitar compartilhamento de um cofre pessoal.
- [ ] Registrar resultados por cenário, sem marcar como aprovado um caso só por ter recompilado. Commit: test(sync): verify crash recovery and cross-device offline editing.

### Task 10: Empacotamento, atualização e liberação conjunta

**Files:** modificar package.json/build, .github/workflows/{desktop-check,publish-app,android}.yml, documentação de uso e notas de versão; criar teste tests/sync-upgrade.test.mjs.

**Interfaces:** schemaVersion=1 para a primeira entrega; protocolo=1 independente da versão do app. Antes de migrar schema, criar backup fechado e aplicar migração transacional. Versão desconhecida abre sem gravações e oferece exportação.

- [ ] Testar upgrade com fila/conflito existente, falha na migração e tentativa de downgrade. Nunca “recriar banco” apagando estado incompatível.
- [ ] Fixar CI em Node 24 e piso 24.18.1 para o host standalone; verificar node:sqlite nos runtimes do CI e do EXE; compilar motor compartilhado para o frontend, incluir todos os módulos local/sync e o schema nos recursos empacotados.
- [ ] Manter a correção de inicialização em pasta protegida. Atualizar scripts de smoke para isolar também o userData/configuração de seleção do cofre; PENTAMARK_DATA_DIR sozinho não basta se o perfil do teste apontar a um cofre real.
- [ ] Compilar Windows e Android a partir do mesmo commit; conferir assinatura Android compatível, versão interna, schema, hashes e nomes reconhecidos pelo atualizador.
- [ ] Testar atualizar sem desinstalar, reabrir offline e confirmar que pendências continuam existentes.
- [ ] Somente após os dois gates passarem, preparar a release com EXE e APK juntos. O atualizador não deve anunciar uma release incompleta para uma plataforma.
- [ ] Executar revisão final dos invariantes da spec e registrar evidências. Commit: build(sync): package verified Windows and Android offline replicas.

## Critério de conclusão

Concluir apenas quando os dez critérios da seção 12 da spec forem demonstrados, todos os arquivos conflitantes puderem ser recuperados e as interfaces distinguirem “salvo localmente” de “sincronizado”.

Não contar testes de ponte simulada como evidência suficiente do armazenamento SQLite Android: exigir banco/arquivos reais em emulador. Não contar só o EXE ou só o APK como entrega completa.

## Revisão deste plano e execução futura

O plano cobre identidade, cópia inicial, fila, recuperação, protocolo, PC, Android, modos, conflitos, migração e publicação conjunta. Os cinco pontos de Review Focus têm testes atribuídos nas tarefas indicadas.

Recomendação de execução: etapas pequenas, com revisão independente do armazenamento/protocolo e dos casos de perda de dados antes da integração final. As tarefas 4 e 5 podem ser executadas separadamente depois de estabilizar o contrato; a tarefa 6 precisa de ambas.

Revisar este plano e seus padrões propostos antes da implementação. Nenhuma tarefa foi executada nesta fase de planejamento.
