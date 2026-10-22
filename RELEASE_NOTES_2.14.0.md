# PentaMark 2.14.0 — cópias offline por cofre

Windows e Android passam a compartilhar o protocolo de reconciliação versão 1.

- Ativação explícita por cofre, cópia inicial e escolha entre sincronização automática ou manual.
- Notas/anexos já copiados continuam disponíveis sem o host; fila e conteúdo são persistidos no aparelho.
- Alterações concorrentes exigem resolução: manter ambas, escolher uma versão ou mesclar quando suportado. Versões anteriores são retidas; não há descarte automático por horário de edição.
- Retomada de transferências, operações idempotentes, verificação de hashes e rejeição de decisões obsoletas.
- Exportação nativa das pendências e histórico; bloqueio de desativação quando há conteúdo não reconciliado.
- Inicialização Windows mantém os dados fora da pasta protegida do executável.

## Uso e limites

**Android mínimo: Android 15 (API 35)**. Este APK não instala em versões anteriores. Não desinstale uma versão existente para tentar contornar essa restrição; preserve os dados locais.

Consulte `docs/offline-sync.md`. A primeira cópia precisa ser concluída antes de depender do modo offline. No Android, a sincronização automática retoma com o aplicativo em primeiro plano; não é um serviço permanente em segundo plano.

Dados da réplica não são cache descartável. Não limpe dados do aplicativo nem desinstale sem salvar pendências. Exportação Windows é uma pasta; Android é ZIP, sem restauração automática nesta versão. Sincronização não substitui backup e não oferece garantia contra defeito físico do armazenamento.

Renomear pasta pode substituir a identidade interna do diretório, preservando identidades, conteúdo e histórico dos arquivos. Filhos desconhecidos bloqueiam a remoção da pasta antiga.

Host standalone requer Node.js 24.18.1 ou superior. O EXE inclui runtime. APK deve manter a assinatura da versão anterior para atualização sem desinstalar.

Esta release só pode ser publicada com EXE e APK do mesmo commit, após os gates nativos e verificação da assinatura. As evidências e hashes finais acompanham a publicação; este arquivo não declara validação concluída por si só.
