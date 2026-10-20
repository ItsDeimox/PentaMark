# PentaMark Android local

O APK usa o mesmo editor React/CodeMirror e os mesmos temas do Desktop. Capacitor contém o bundle web no aplicativo; o WebView do Android o renderiza. O plugin `LocalVault` substitui somente o transporte HTTP por acesso nativo aos arquivos. Não há servidor Node, Termux, conta ou computador obrigatório.

## Uso

Android 7.0 (API 24) ou posterior, com Android System WebView atualizado. Instale o APK assinado da release e permita a instalação por seu navegador/gerenciador de arquivos quando o Android solicitar. Não é necessário desativar o Play Protect.

As notas `.md`, anexos, histórico e lixeira ficam no diretório privado do aplicativo. Funciona em modo avião. Em **Ferramentas → Configurações → Arquivos locais**:

- **Importar arquivos** copia documentos escolhidos pelo seletor Android. Notas vão para a raiz, anexos para `assets`. Arquivos de mesmo nome recebem um sufixo; originais não são alterados. Não é uma pasta externa sincronizada ao vivo.
- **Exportar cofre (ZIP)** salva uma cópia incluindo notas, anexos, histórico e lixeira. Rascunhos pendentes são salvos antes de exportar; conflitos precisam ser resolvidos. O ZIP pode ser extraído em um computador. Importar o ZIP como arquivo não restaura automaticamente sua árvore.
- Anexos têm limite de 32 MB por arquivo nesta versão. Não há limpeza automática de anexos.

**Antes de desinstalar ou limpar os dados, exporte uma cópia.** O Android apaga o armazenamento privado nessas operações. Atualizações assinadas com a mesma chave preservam os dados.

A conexão com outros dispositivos via Tailscale é uma etapa futura. A primeira versão APK não oferece host, sincronização remota ou ponte MCP. O Desktop e o navegador continuam com seu comportamento atual.

## Build e assinatura

Use Node 22, Java 21 e SDK Android 36. `npm ci`, `npm run android:sync`; dentro de `android`, `./gradlew testDebugUnitTest assembleRelease`. O workflow `Android offline APK` também instala o APK de teste em emulador API 35, bloqueia rede e testa a ponte real de arquivos, persistência após reabrir, mídia e ciclo de vida.

O artefato `unsigned-and-local-signing-tool` não é instalável antes da assinatura. Em Windows com JDK, use `scripts/sign-android.ps1 -UnsignedApk <apk> -ApkSignerJar <jar> -OutputApk <destino.apk> -KeyDirectory <diretório-privado>`. O script gera a chave somente na primeira execução, reutiliza-a nas seguintes e verifica a assinatura. Nunca publique o diretório da chave. A senha fica protegida com DPAPI e depende da mesma conta Windows; faça uma migração segura da credencial antes de trocar de computador. Não gere uma chave diferente para atualizar instalações existentes.

Testes JavaScript: `npm run test:unit`. Regressões de interface: `npx playwright test`. Os testes `android-ui.spec.mjs` substituem apenas a ponte externa; a validação do APK real pertence aos testes instrumentados Android.
