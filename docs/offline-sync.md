# Cópia offline no Windows e Android

## Ativar

1. Abra o PentaMark no host e conecte os aparelhos pela rede Tailscale já configurada.
2. No aparelho que precisa trabalhar desconectado, abra **Configurações → Sincronização**.
3. Marque **Manter cópia offline**, informe o endereço do host e escolha **Automática** ou **Manual**.
4. Confirme **Criar cópia inicial** e aguarde a conclusão antes de desligar o host. Uma cópia parcial não garante que todos os arquivos estejam disponíveis.

Cada cofre/aparelho tem uma réplica separada. A cópia não substitui o cofre independente do Android nem o cofre local que o Windows já hospedava. Uma mudança de endereço exige verificar novamente a identidade do mesmo host/cofre.

## Trabalhar sem o host

As notas e os anexos já copiados são lidos do aparelho. Edições são salvas localmente e permanecem pendentes até a reconciliação. **Salvo neste aparelho** não significa enviado ao host. Não é necessário manter o host ligado durante a edição offline.

- **Automática:** tenta reconciliar quando a conexão volta. No Android, retoma com o aplicativo em primeiro plano; não promete execução contínua em segundo plano.
- **Manual:** depois da cópia inicial, só troca conteúdo ao clicar em **Sincronizar agora**. Abrir o aplicativo ou recuperar a rede não deve iniciar essa troca.
- **Anexos:** em Ferramentas, informe o caminho/nome com extensão e use **Anexar arquivo offline**. O seletor nativo lê o arquivo diretamente; um arquivo existente não é substituído por essa importação.

Se o host negar permissão, estiver com o arquivo bloqueado, faltar espaço ou a transferência falhar, a pendência deve continuar visível. Não interprete uma tentativa incompleta como sincronização concluída.

## Conflitos

Alterações concorrentes não usam a regra “o último a salvar vence”. A revisão apresenta as versões disponíveis e oferece manter ambas, escolher uma versão ou mesclar texto quando essa ação é suportada.

Uma escolha é vinculada às revisões mostradas. Se o arquivo mudar enquanto a revisão estiver aberta, a decisão fica obsoleta e deve ser revista; o texto digitado não deve ser aplicado silenciosamente sobre a nova edição. Os objetos/versionamentos anteriores são retidos. Um rascunho recuperado do editor é preservado em uma nota de conflito antes de aceitar outra versão ou uma mesclagem.

Renomear uma pasta não apaga arquivos desconhecidos encontrados no destino/host. O procedimento transfere os filhos conhecidos em ordem e só remove uma pasta antiga vazia. Um filho novo ou alterado pode impedir a conclusão, exigindo revisão.

## Exportar e desativar

**Exportar pendências** cria uma cópia nativa da réplica, incluindo manifesto, conteúdo e versões retidas. Windows exporta uma pasta própria; Android usa um arquivo ZIP. Um cancelamento não é uma exportação concluída. Não há promessa de restauração automática desse formato nesta versão.

A desativação é bloqueada enquanto houver cópia inicial incompleta, alterações, operações preparadas ou conflitos. Exportar não elimina essas pendências nem desativa a réplica automaticamente.

Os dados da réplica são arquivos de trabalho, **não cache descartável**. Limpar os dados do aplicativo, desinstalar sem backup ou perder o aparelho pode remover conteúdo ainda não enviado. Sincronização não substitui um backup independente. As proteções de recuperação são testadas contra interrupções de processo e falhas simuladas de armazenamento; não constituem garantia contra qualquer falha física ou corrupção do dispositivo.

## Banco de uma versão incompatível

Se uma versão antiga não reconhecer o formato da réplica, a abertura para edição é bloqueada. A tela oferece **Exportar cópia para recuperação**: uma cópia bruta dos arquivos privados, sem interpretar nem converter o banco. Ela exige uma versão compatível para recuperação; não é restauração automática. Cancelar ou falhar nessa exportação não remove os originais. Não limpe os dados nem desinstale para tentar corrigir incompatibilidade.
