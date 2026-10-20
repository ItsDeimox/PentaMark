# PentaMark Android local

O APK usa o mesmo editor React/CodeMirror e os mesmos temas do Desktop. Capacitor contém o bundle web no aplicativo; o WebView do Android o renderiza. O plugin `LocalVault` substitui somente o transporte HTTP por acesso nativo aos arquivos. Não há servidor Node, Termux, conta ou computador obrigatório.

## Uso

Android 7.0 (API 24) ou posterior, com Android System WebView atualizado. Instale o APK assinado da release e permita a instalação por seu navegador/gerenciador de arquivos quando o Android solicitar. Não é necessário desativar o Play Protect.

As notas `.md`, anexos, histórico e lixeira ficam no diretório privado do aplicativo. Funciona em modo avião. Em **Ferramentas → Configurações → Arquivos locais**:

- **Importar arquivos** copia documentos escolhidos pelo seletor Android. Notas vão para a raiz, anexos para `assets`. Arquivos de mesmo nome recebem um sufixo; originais não são alterados. Não é uma pasta externa sincronizada ao vivo.
- **Exportar cofre (ZIP)** salva uma cópia incluindo notas, anexos, histórico e lixeira. Rascunhos pendentes são salvos antes de exportar; conflitos precisam ser resolvidos. O ZIP pode ser extraído em um computador. Importar o ZIP como arquivo não restaura automaticamente sua árvore.
- Anexos têm limite de 32 MB por arquivo nesta versão. Não há limpeza automática de anexos.

**Antes de desinstalar ou limpar os dados, exporte uma cópia.** O Android apaga o armazenamento privado nessas operações. Atualizações assinadas com a mesma chave preservam os dados.

## Conectar ao PC pelo Tailscale

1. Conecte o cliente oficial do Tailscale no PC e no Android, na mesma rede privada. O APK não incorpora uma VPN própria. Não é necessário Termux.
2. Abra o PentaMark Desktop no PC. O servidor de arquivos já faz parte do aplicativo Desktop; o PC precisa permanecer ligado durante o acesso remoto.
3. No celular, abra **Ferramentas → Conectar ao PC · Tailscale**. Informe o IP Tailscale do PC e a porta do PentaMark, por exemplo `100.100.10.2:3417`. Confira a porta mostrada no Desktop se foi alterada.
4. Também é aceito `https://pc.sua-rede.ts.net` se o Tailscale Serve já estiver configurado para o PentaMark. Serve não é necessário para usar o IP Tailscale. A conexão depende das permissões da tailnet e do firewall do PC.

A interface e o editor continuam embarcados no APK; o PC fornece dados, não código remoto. São dois espaços independentes: **Local** e **PC conectado**. Não há sincronização automática entre cofres. O botão **Local** volta ao armazenamento do celular sem depender da internet. Rascunhos remotos ficam protegidos no aparelho, vinculados ao endereço usado; reconecte ao mesmo endereço para recuperá-los. Usar IP e nome DNS para o mesmo PC cria espaços de recuperação separados.

Se a conexão falhar ao abrir, use **Usar arquivos locais**. Se cair durante a edição, o app protege o rascunho e retoma a conexão com intervalo progressivo. Conflitos com edições no PC continuam exigindo resolução; não há sobrescrita silenciosa. Não são abertas portas públicas nem alteradas permissões/firewall automaticamente. O acesso reutiliza as permissões do host; excluir arquivos pode exigir que o host conceda administrador.

## Gráficos e desempenho

**Configurações → Gráficos** oferece Econômico, Equilibrado, Qualidade e Personalizado. Há controles separados de animações de fundo, reação ao mouse, movimento da interface e refração. Na primeira entrada, indícios leves do aparelho recomendam Econômico em Android/toque/reduced motion/dispositivos limitados; não há benchmark pesado. As escolhas seguintes são manuais e persistentes.

Flat antigo migra uma vez para Econômico, preservando tema, fontes e escala. O atalho **Flat** aplica Econômico; **Acrílico** aplica Qualidade. Em Personalizado, é possível ligar efeitos específicos. Desligados, os renderizadores de fundo são desmontados, sem canvas, malha, observadores ou animação contínua. O ganho real de FPS/bateria depende do aparelho e do documento; não há porcentagem universal garantida.

## Build e assinatura

Use Node 22, Java 21 e SDK Android 36. `npm ci`, `npm run android:sync`; dentro de `android`, `./gradlew :app:testDebugUnitTest :app:assembleRelease`. O workflow `Android offline APK` também instala o APK de teste em emulador API 35, bloqueia rede e testa a ponte real de arquivos, persistência após reabrir, mídia e ciclo de vida.

O artefato `unsigned-and-local-signing-tool` não é instalável antes da assinatura. Em Windows com JDK, use `scripts/sign-android.ps1 -UnsignedApk <apk> -ApkSignerJar <jar> -OutputApk <destino.apk> -KeyDirectory <diretório-privado>`. O script gera a chave somente na primeira execução, reutiliza-a nas seguintes e verifica a assinatura. Nunca publique o diretório da chave. A senha fica protegida com DPAPI e depende da mesma conta Windows; faça uma migração segura da credencial antes de trocar de computador. Não gere uma chave diferente para atualizar instalações existentes.

Testes JavaScript: `npm run test:unit`. Regressões de interface: `npx playwright test`. Os testes `android-ui.spec.mjs` substituem apenas a ponte externa; a validação do APK real pertence aos testes instrumentados Android.
