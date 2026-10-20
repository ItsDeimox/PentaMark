# PentaMark 2.13.17 — Android local

- Primeiro APK Android independente: o mesmo editor React/CodeMirror, temas, leitura, Live Preview e efeitos do Desktop, empacotados com Capacitor.
- Notas Markdown e anexos ficam no próprio aparelho, sem servidor, Termux ou computador. Funciona offline.
- Importação pelo seletor Android e exportação do cofre em ZIP, incluindo histórico e lixeira. Os arquivos originais importados não são alterados.
- Gravação atômica, detecção de conflitos, recuperação de rascunhos e proteção de edições durante salvamento/renomeação.
- Mídia local servida diretamente ao WebView, sem carregar anexos inteiros como base64 para exibição.
- Botão Voltar fecha painéis antes de minimizar; suspensão solicita salvamento. Preferências ficam no aparelho.
- Corrigida uma corrida de salvamento que podia misturar conteúdo de duas notas ao trocar de arquivo durante a consulta de um conflito.
- A busca aguarda o índice inicial do cofre antes de aceitar entrada, evitando perder a abertura por Enter durante a inicialização.

## Instalação Android

Baixe **PentaMark-2.13.17-Android.apk**. Requer Android 7.0 ou superior e WebView atualizado. O ZIP `Mobile-Host-Android` é o pacote legado de host; **não é o APK** e não é necessário para o aplicativo Android local.

Em Configurações → Arquivos locais, importe notas/anexos ou exporte uma cópia. **Exporte antes de desinstalar ou limpar os dados do app**: o armazenamento é privado e essas operações o apagam. Importar arquivos não mantém uma pasta externa sincronizada; anexos têm limite de 32 MB por arquivo.

Conexão entre dispositivos via Tailscale, sincronização e MCP no APK ficam para a próxima etapa. O Desktop mantém seus recursos de rede atuais.

## Verificação

O workflow Android compila os APKs, executa testes JVM do cofre e instala o app em emulador API 35 com rede bloqueada para verificar ponte nativa, persistência após reabrir, mídia e ciclo de vida. O APK distribuído recebe assinatura de produção local; a chave privada não é publicada. Consulte o relatório da versão para os resultados da execução.
