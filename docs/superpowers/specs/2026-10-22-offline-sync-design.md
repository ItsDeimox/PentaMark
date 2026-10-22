# PentaMark — sincronização offline para PC e Android

Data: 22/10/2026. Estado: implementação autorizada, em andamento.
Base examinada: 2.13.21, commit 4ff62df, mais a correção local de inicialização em pasta protegida.

## 1. Objetivo e decisões de produto

O usuário quer manter uma cópia do cofre de um host no PC Windows e no Android, editar durante interrupções de minutos ou dias, fechar/reabrir o aplicativo sem o host e sincronizar posteriormente. Ele deve escolher sincronização automática ou manual. Alterações concorrentes não podem ser descartadas nem substituídas silenciosamente.

Escopo: aplicativos Windows e Android; um host responsável por cada cofre, com vários clientes. Não inclui sincronização entre hosts independentes, iOS, edição colaborativa por caractere/CRDT ou garantia offline para o navegador/PWA.

Decisões propostas:

- Configuração por cofre e por aparelho: “Manter cópia offline”, inicialmente desativada nos perfis existentes.
- Ao habilitar, oferecer “Automática” e “Manual”, com “Automática” pré-selecionada. A escolha fica visível antes de iniciar a primeira cópia.
- A criação da primeira cópia é uma ação explícita do usuário e pode acontecer nos dois modos.
- Depois disso, automática executa ao abrir/retomar o app, detectar o host e após alterações locais. Manual só troca conteúdo ao pressionar “Sincronizar agora”.
- No manual, uma verificação leve de disponibilidade pode mudar o indicador de conexão; não pode baixar/aplicar alterações, enviar arquivos ou avançar cursores.
- A edição sempre usa a cópia local quando o recurso está habilitado, inclusive com o host acessível.
- O funcionamento offline deve sobreviver ao encerramento do processo. O serviço não exige que host ou clientes fiquem ligados 24 horas.
- No Android, sincronização é retomada quando o aplicativo está em primeiro plano. Não prometer execução contínua com o app encerrado ou suspenso pelo sistema.
- Ativar o recurso não altera VPN, firewall, permissões de rede, endereço de escuta do host ou chaves de acesso.

## 2. Situação atual

A [auditoria](../../../AUDITORIA-OFFLINE.md) encontrou rascunhos persistidos no Android, revisão base, reconexão e diálogo de conflitos. Não encontrou um espelho persistente do cofre remoto nem reconciliação geral.

Hoje initializeAndroid() depende de uma resposta remota antes de abrir o editor; openNote() busca a nota antes de recuperar seu rascunho. No PC, a conexão navega para a página remota. Essas dependências devem ser removidas para perfis com cópia offline.

O cofre local independente do Android continua separado de cada réplica remota. Não misturar automaticamente arquivos de cofres com nomes iguais.

## 3. Arquitetura escolhida

Adotar réplica local com comparação de três estados: última versão confirmada em comum, versão local e versão atual no host. Reaproveitar o editor, a comparação de conteúdo e o transporte nativo existente.

Alternativas consideradas:

- Somente ampliar o cache/rascunho: menor mudança, mas não atende navegação offline, anexos, reinício e operações de arquivos.
- Réplica local com revisões, fila durável e conflitos explícitos: escolhida; atende PC/Android sem depender de relógios ou de novo serviço de nuvem.
- CRDT ou sincronização entre pares: amplia muito o escopo e não resolve sozinho anexos, exclusões e pastas.

Fluxo:

    Editor → API da réplica local → arquivos + banco + fila
                                      ↕
                               motor compartilhado
                                      ↕
                       API de sincronização do host

O host recebe alterações do próprio editor, APIs normais, MCP e clientes de sincronização pelo mesmo coordenador de gravação. Alterações externas, por exemplo no Obsidian, são reindexadas antes de comparar uma operação com sua base.

## 4. Identidades e armazenamento

- vaultId: UUID persistente do cofre, independente de nome, IP ou URL.
- serverId: UUID da instalação do host. Alterar o endereço exige confirmar o mesmo vaultId/serverId antes de enviar pendências.
- replicaId: UUID persistente da associação aparelho/cofre.
- entryId: UUID de cada arquivo ou diretório; renomeações feitas pelo app mantêm a identidade.
- opId: UUID por operação imutável; nunca reutilizar para outro conteúdo.
- revision: identificador opaco emitido pelo host para um estado confirmado, incluindo caminho, conteúdo e exclusão. Não usar data/hora como critério de desempate.
- Hashes de conteúdo: SHA-256 dos bytes reais; não normalizar quebras de linha ou texto durante a cópia.
- Cursor: opaco, com epoch do banco e sequência. Serializar contadores de 64 bits como strings.

Metadados: SQLite, WAL, synchronous=FULL, foreign_keys=ON. Windows usa node:sqlite no processo Node local; Android usa SQLiteOpenHelper. O runtime Electron empacotado foi verificado com banco em memória: node:sqlite disponível em Node 24.18.1. Os testes de CI devem repetir essa verificação. CI e host standalone desta funcionalidade usam Node 24, com piso 24.18.1; o usuário do EXE/APK não precisa instalar Node.

SQL compatível com Android API 24: sem STRICT tables, RETURNING ou a sintaxe recente ON CONFLICT DO UPDATE.

Arquivos continuam sendo arquivos reais. Conteúdos base, versões anteriores e versões conflitantes são preservados em um depósito de objetos por hash. SQLite registra identidades, bases, pendências e referências aos objetos, não grandes anexos.

Locais:

- Host: <dataRoot>/sync/hosts/<vaultId>/, fora das notas expostas.
- Réplicas Windows: <userData>/sync/replicas/<vaultId>/<replicaId>/.
- Réplicas Android: diretório privado filesDir/sync/replicas/<vaultId>/<replicaId>/.
- Cada réplica tem working/ para arquivos editáveis, objects/ para versões imutáveis e staging/ para transferências.

Não usar Program Files para dados graváveis. Manter a correção local de inicialização na versão que receber a sincronização.

Não copiar como conteúdo do cofre: bancos internos de sincronização, configurações do host, tokens, chaves, perfis privados, .history e .trash. Notas e anexos que o cofre já expõe são o escopo da cópia.

## 5. Contratos comuns

Criar src/features/sync/contracts.ts com:

    SyncMode = 'automatic' | 'manual'
    ReplicaProfile = { vaultId, serverId, replicaId, origin, offlineEnabled, mode }
    EntryVersion = { entryId, kind, path, revision, blobHash, byteLength, deleted }
    Operation = {
      vaultId, replicaId, opId, entryId,
      kind: 'put' | 'move' | 'delete' | 'mkdir' | 'rmdir',
      baseRevision: string | null,
      after: { path, kind, blobHash, byteLength } | null,
      dependsOn: string[]
    }
    Conflict = { conflictId, entryId, base, local, remote, reason }
    SyncStatus = {
      phase, localSaved, pendingCount, conflictCount,
      snapshotComplete, lastSuccessfulSync, errorCode
    }

Os identificadores, caminhos, revisões e hashes são strings; offlineEnabled/deleted são booleanos, byteLength é número inteiro seguro não negativo. kind de EntryVersion é 'note'|'asset'|'directory'; revision é opaca e obrigatória para uma versão conhecida.

blobHash é null somente em diretórios e tombstones. baseRevision=null significa criação, não autorização para substituir arquivo existente.

Tipos auxiliares do contrato:

    ApiResponse = { status: number, data: Record<string, unknown> }
    BlobRef = { blobHash: string, byteLength: number }
    Handshake = {
      protocol: 1, vaultId: string, serverId: string, epoch: string,
      maxFileBytes: number, chunkBytes: 1048576
    }
    SnapshotPage = {
      snapshotToken: string, atCursor: string,
      entries: EntryVersion[], pageCursor: string | null
    }
    ChangesPage = { fromCursor: string, nextCursor: string, entries: EntryVersion[] }
    ReplicaSnapshot = {
      profile: ReplicaProfile, cursor: string | null,
      status?: SyncStatus, epoch?: string | null,
      initialCopy?: InitialCopyProgress | null, conflicts?: Conflict[],
      entries: { base: EntryVersion | null, local: EntryVersion | null, localHead: string }[]
    }
    InitialCopyProgress = { snapshotToken: string, atCursor: string, pageCursor: string | null }
    ReconcileDecision = {
      action: 'none'|'push'|'pull'|'converged'|'conflict',
      reason: string, base: EntryVersion | null,
      local: EntryVersion | null, remote: EntryVersion | null
    }
    PathResult = { ok: true, path: string, pathKey: string }
      | { ok: false, code: 'invalid-path'|'reserved-name' }
    IncomingBatch = {
      nextCursor: string,
      epoch?: string, initialCopy?: InitialCopyProgress,
      items: { decision: ReconcileDecision, expectedLocalHead: string }[]
    }
    ApplyResult = {
      opId: string, status: 'applied'|'already-applied'|'conflict'|'blocked',
      confirmed?: EntryVersion, conflict?: Conflict, errorCode?: string
    }
    TransferProgress = { blobHash: string, verifiedBytes: number, complete: boolean }
    ConflictResolution = {
      conflictId: string, expectedRemoteRevision: string | null,
      expectedLocalHead: string,
      choice: 'keep-both'|'local'|'remote'|'merged', mergedContent?: string
    }

phase em SyncStatus é 'initial-copy'|'offline'|'idle'|'waiting-manual'|'syncing'|'conflicts'|'blocked'; localSaved/snapshotComplete são booleanos, contadores são inteiros, lastSuccessfulSync é timestamp ISO ou null e errorCode é string ou null. Concluir um ciclo parcial não muda lastSuccessfulSync nem produz “Sincronizado”.

Portas assíncronas comuns:

    ReplicaPort.open(profile): Promise<SyncStatus>
    ReplicaPort.configure({offlineEnabled, mode}): Promise<SyncStatus>
    ReplicaPort.request(url, method, body?): Promise<ApiResponse>
    ReplicaPort.snapshot(): Promise<ReplicaSnapshot>
    ReplicaPort.preparePending(limit): Promise<Operation[]>
    ReplicaPort.persistIncoming(batch: IncomingBatch): Promise<void>
    ReplicaPort.confirm(result): Promise<void>
    ReplicaPort.resolve(input: ConflictResolution): Promise<void>

    RemotePort.handshake(profile): Promise<Handshake>
    RemotePort.snapshot(snapshotToken?, cursor?): Promise<SnapshotPage>
    RemotePort.changes(cursor, limit): Promise<ChangesPage>
    RemotePort.apply(operations): Promise<ApplyResult[]>
    RemotePort.downloadBlob(blob: BlobRef, offset): Promise<TransferProgress>
    RemotePort.uploadBlob(blob: BlobRef, offset): Promise<TransferProgress>

RemotePort é vinculada à mesma réplica de ReplicaPort; os métodos de blob leem/gravam o staging nativo, não devolvem bytes à WebView. Antes de persistIncoming, todos os objetos exigidos pelas decisões precisam estar completos e verificados. Se expectedLocalHead mudou, a porta rejeita com stale-local-head sem aplicar o lote/avançar cursor; o motor refaz a comparação com o estado atual.

Complemento de implementação: as portas nativas novas retornam status, epoch, progresso da cópia inicial e conflitos persistidos em snapshot(). Os campos são opcionais no tipo para evolução dos adaptadores, mas o motor deve tratar ausência como cópia não confirmada. Páginas intermediárias de initialCopy persistem entradas/progresso e preservam edições locais, sem avançar o cursor confirmado. Somente pageCursor=null finaliza o manifesto em atCursor; mudanças posteriores ainda precisam ser processadas antes de exibir sincronização concluída.

Snapshot e transferências usam referências a objetos; não colocar anexos em JSON/base64. ApiResponse preserva o formato status/data já usado pelo aplicativo. Scheduler do motor expõe now(): number, schedule(callback, delayMs): cancelFn e random(): number; todos são substituíveis nos testes.

## 6. Protocolo do host, versão 1

Rotas novas:

- GET /api/sync/v1/hello: protocolo, vaultId, serverId, epoch e limites.
- POST /api/sync/v1/snapshot: cria uma visão estável e retorna token, sequência S e primeira página; GET subsequente usa token e cursor.
- GET /api/sync/v1/changes?cursor=...&limit=100: mudanças após o cursor.
- GET /api/sync/v1/blobs/<sha256>: bytes imutáveis, com suporte a Range.
- PUT /api/sync/v1/blobs/<sha256>?offset=...: envio retomável por segmentos.
- POST /api/sync/v1/apply: no máximo 100 operações, resultados individuais.

Transferir segmentos de 1 MiB; verificar comprimento, offset e hash final antes de disponibilizar um objeto. O limite total do arquivo segue o limite anunciado pelo host, sem ultrapassar sua configuração maxUploadMB. Transporte Android deve fazer streaming nativo; não reutilizar a importação em base64 limitada a 32 MiB.

Handshake incompatível, cofre diferente, mudança inesperada de serverId ou host antigo: manter a cópia local e as pendências; não fazer fallback para envio sem comparação de revisões.

Snapshot inicial consistente:

1. Fixar manifesto e sequência S em uma transação.
2. Baixar páginas e objetos pelos hashes desse manifesto.
3. Manter disponível o histórico necessário enquanto o token estiver válido.
4. Marcar a base inicial e cursor S somente após persistência local.
5. Consumir mudanças posteriores a S. Não perder edições ocorridas durante o download.

Se o token expirar, recriar a visão e reutilizar os objetos já verificados. Uma cópia incompleta continua identificada como incompleta; arquivos já baixados podem ser usados, mas arquivos ausentes não viram notas vazias.

Mudança de epoch exige novo manifesto. Comparar com a base antiga e preservar todas as pendências antes de aceitar uma nova base.

## 7. Durabilidade, repetição e recuperação

Tabelas comuns: vaults, entries, versions, pending_ops, applied_ops, conflicts, file_intents, transfer_progress e change_log no host.

Uma alteração local precisa garantir, antes de mostrar “Salvo neste aparelho”:

1. Conteúdo novo gravado em objeto temporário, sincronizado no disco e validado pelo hash.
2. Intenção persistida com estado anterior e estado desejado.
3. Publicação sem truncamento e sem substituir um destino inesperado, no mesmo volume. No host com escritores externos, conservar o arquivo anterior no journal antes de publicar o novo por uma operação que falha se o destino reaparecer. As leituras coordenadas do aplicativo aguardam a transação; uma ferramenta externa pode observar um breve intervalo sem o nome de trabalho. A intenção durável recupera esse intervalo antes de servir o cofre após reinício.
4. Estado local e operação pendente confirmados no banco.

Arquivos e SQLite não formam uma única transação: file_intents é obrigatório. Na inicialização, recuperar cada intenção antes de servir novas gravações. Falhas em qualquer fronteira devem resultar em uma versão íntegra recuperável, nunca em arquivo truncado ou fila esquecida.

Refinamento durante implementação: a publicação conservadora acima substitui a exigência original de uma única troca atômica do pathname no host. A prioridade é não sobrescrever uma criação/edição externa que apareça entre a verificação e a publicação. Todo staging reutilizado precisa ter hash e comprimento verificados; mera existência não prova integridade. Sistemas de arquivos sem o mecanismo seguro exigido devem bloquear a operação com dados preservados, sem fallback destrutivo. A validação de encerramento de processo não equivale a uma certificação contra falha física de armazenamento.

No host, a mesma regra inclui captura da versão anterior, comparação da revisão atual, aplicação em disco, registro em change_log e applied_ops. Serializar mutações por cofre e revalidar arquivos alterados fora do app.

Repetir o mesmo (replicaId, opId) devolve o resultado já confirmado, inclusive após reiniciar o host. A confirmação só é enviada depois da persistência. O cliente só remove a pendência após gravar essa confirmação localmente.

Separar alterações locais ainda não preparadas de operações de rede imutáveis. preparePending prepara e persiste operações elegíveis; uma operação já preparada retorna sempre com o mesmo opId, base e conteúdo até receber resposta definitiva. Alterações posteriores do mesmo arquivo esperam a operação em andamento ser confirmada, e só então recebem nova operação com a revisão confirmada como base. Recalcular o plano contra qualquer mudança remota antes de preparar a próxima operação. Nunca “atualizar a base” de uma operação já enviada.

Alterações locais ainda não enviadas podem ser consolidadas, preservando seus objetos/histórico. Criar e apagar um arquivo que nunca chegou a ser preparado não exige criar/apagar esse arquivo no host. Se a criação já estiver preparada ou em trânsito, a exclusão espera o resultado e usa sua revisão confirmada.

Se o usuário continuar editando enquanto uma versão é enviada, a confirmação antiga não limpa nem marca como sincronizada a versão mais nova.

O cursor avança somente quando cada mudança da página estiver representada de forma durável como estado aplicado ou conflito com todas as versões preservadas.

Não podar automaticamente versões conflitantes, operações não confirmadas, bases necessárias ou tombstones na primeira versão. Limpeza futura é um recurso separado, com política própria; o limite atual de histórico não pode eliminar essas referências.

Disco cheio: preservar fila e objetos anteriores, interromper novas transferências e informar o erro. Não limpar conteúdo pendente para liberar espaço.

## 8. Regras de reconciliação

| Estado comparado com a base comum | Ação |
|---|---|
| Só mudou localmente | Enviar com baseRevision; confirmar apenas após aceite do host. |
| Só mudou no host | Aplicar localmente após garantir que não surgiu nova edição local. |
| Os dois chegaram ao mesmo conteúdo/caminho | Confirmar convergência sem duplicar arquivo. |
| Os dois mudaram de modo diferente | Preservar base/local/remoto e abrir conflito. |
| Um excluiu e o outro editou/renomeou | Preservar o arquivo editado e o tombstone; conflito. |
| Dois arquivos distintos pedem o mesmo caminho | Preservar ambos; conflito de nome. |
| Binário/anexo mudou nos dois lados | Manter os dois objetos; nunca mesclar bytes. |

Na primeira versão, não haverá escolha automática por timestamp nem mesclagem automática de edições concorrentes do mesmo arquivo.

Conflitos oferecem:

- Manter ambas: criar arquivo adicional com nome exclusivo, sem colisão.
- Manter minha versão: envio condicional sobre a revisão remota exibida, preservando a versão remota anterior.
- Usar versão do host: preservar a versão local no arquivo de conflito antes de atualizar o arquivo de trabalho.
- Mesclar: editor de texto com base, local e remoto; resultado enviado condicionalmente.

Resolver exige expectedRemoteRevision e expectedLocalHead da tela exibida. Se o host ou a edição local mudar novamente durante a decisão, preservar o resultado digitado e atualizar o conflito. Não reutilizar uma autorização para substituir uma revisão que o usuário ainda não viu.

Sem ação do usuário, conflito permanece pendente, com ambas as versões acessíveis e exportáveis. Outros arquivos independentes podem continuar sincronizando.

## 9. Nomes, pastas, exclusões e anexos

Usar uma chave de caminho comparável entre Windows e Android: normalização Unicode NFC e comparação sem distinção de maiúsculas para detectar colisões; preservar a grafia original para exibição. A validação também verifica colisão no sistema de arquivos real antes da aplicação; uma diferença entre regras de Unicode das plataformas nunca autoriza substituir um destino. Nomes reservados do Windows, links simbólicos, junções e caminhos que escapam do cofre são recusados com erro recuperável.

Não adivinhar identidade de renomeação externa apenas porque dois arquivos têm o mesmo hash. Quando não for possível provar a identidade, representar como remoção/criação e aplicar as regras de conflito.

Renomear/excluir pastas gera operações condicionais dos arquivos conhecidos e operações de diretórios em ordem de dependência. rmdir só remove diretório vazio. Arquivos novos/desconhecidos no host não são incluídos em uma exclusão recursiva. Uma divergência mantém a pasta pendente e visível para revisão.

Exclusões confirmadas movem a versão para uma lixeira de sincronização, com tombstone. Não apagar permanentemente durante a reconciliação.

Anexos são copiados por streaming e hash; Markdown referencia caminhos estáveis. Downloads interrompidos são retomáveis. Hash inválido mantém a versão anterior. Arquivo indisponível offline tem indicação explícita, não um conteúdo substituto.

## 10. Integração PC/Android

Motor de decisão e agendamento em TypeScript compartilhado; arquivos e transações pertencem à implementação nativa de cada plataforma.

PC: manter a interface no endereço local. Electron/preload expõem um conjunto fechado de operações de réplica; o processo servidor local atende essas operações por IPC, sem publicar gerenciamento do cache pela rede. Preservar trustedFrame. URLs de mídia local exigem capacidade de sessão e conexão de loopback.

Android: novo plugin SyncVault com acesso ao armazenamento privado/SQLite; RemoteConnection continua responsável pela rede. A WebView permanece com bloqueio de carregamentos externos. Mídia da réplica passa por uma rota local validada em MainActivity.

src/api/client.ts escolhe a API conforme contexto explícito: host local, remoto ao vivo ou réplica offline. Não inferir destino por URL atual nem trocar o destino de uma gravação em andamento.

O motor roda enquanto o app estiver ativo; não é necessário serviço Android permanente. Pause/resume cancela/retoma a rede sem descartar pendências.

## 11. Interface e migração

Criar seção “Sincronização” nos dois aplicativos com:

- Manter cópia offline; modo automática/manual; Sincronizar agora.
- Indicadores distintos: “Salvo neste aparelho”, “Offline — alterações pendentes”, “Aguardando sincronização manual”, “Sincronizando”, “Conflitos para revisar”, “Download inicial incompleto” e “Sincronizado”.
- Contadores de pendências/conflitos e última sincronização concluída.
- Acesso a revisar conflitos e exportar uma cópia com pendências.

“Sincronizado” só aparece com snapshot completo, nenhuma pendência, nenhum conflito e todas as mudanças recebidas representadas localmente.

Desativar/remover uma réplica não apaga pendências ou conflitos. Se existirem, oferecer sincronizar, exportar ou cancelar; não remover o último exemplar de uma versão.

Migrar rascunhos Android uma única vez, por endereço associado e caminho, depois de confirmar vaultId/serverId. Não apagar o rascunho antigo até o conteúdo estar persistido na réplica. Se a revisão base não existir mais, preservar como conflito/origem desconhecida; não enviar incondicionalmente.

Não vincular automaticamente o cofre Android independente ao host.

## 12. Entrega e aceitação

Antes de liberar:

1. Windows e Android abrem o cofre previamente copiado com o host desligado, após encerrar e iniciar os processos.
2. Alterações de minutos ou vários dias, inclusas criações, renomeações, exclusões e anexos, são retomadas.
3. Manual reconecta sem enviar nem aplicar conteúdo até o botão ser acionado.
4. Conflitos de texto, binário, nome e exclusão mantêm todos os conteúdos envolvidos.
5. Queda após gravar no host e antes do ACK não duplica nem repete efeitos.
6. Queda em cada fronteira disco/banco recupera estado íntegro e fila correta.
7. Mudança de IP não duplica cofre; outro cofre no mesmo IP não recebe pendências.
8. Clientes e host antigos/incompatíveis não recebem escritas inseguras.
9. Atualização do app conserva banco, arquivos e fila. Downgrade com schema desconhecido bloqueia gravações e oferece exportação.
10. APK e EXE da mesma revisão passam pelos testes antes de publicar uma release completa.

Trabalhar somente com cofres fictícios nos testes. Não habilitar rede, sincronizar cofres reais nem publicar versões durante a fase de planejamento.
