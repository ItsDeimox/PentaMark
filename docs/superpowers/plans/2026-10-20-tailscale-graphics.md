# Tailscale e gráficos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking. Independent native transport and graphics slices may execute under dispatching-parallel-agents; main owns integration.

**Goal:** APK local offline com acesso opcional ao PC e gráficos significativamente mais leves.
**Architecture:** transporte nativo remoto isolado por origem, mesmo editor, escolha explícita de espaço; política gráfica pura e renderers desmontados quando desativados.
**Tech Stack:** React, TypeScript, Capacitor 8, Android Java, Playwright, node:test/JUnit.
**Spec:** docs/superpowers/specs/2026-10-20-tailscale-graphics-design.md

## Global Constraints
- Sem Termux, dependência de PC no modo local, sincronização implícita ou execução de frontend remoto.
- Nenhum rascunho pode atravessar a fronteira local/PC ou PC A/PC B.
- Preferências existentes de tema/tipografia preservadas; decisões gráficas automáticas somente na primeira entrada.

## Review Focus
- Queda de conexão durante autosave e troca de espaço: preservar texto e nunca salvar no destino errado (tarefa 2).
- URL maliciosa/redirecionamento/HTML como mídia: rejeitar sem expor ponte nativa (tarefa 1).
- Nome de nota idêntico em dois cofres: estado e rascunho isolados (tarefa 2).
- Flat desativado apenas visualmente mas com loops ativos: verificar ausência dos renderers (tarefa 3).
- Primeira entrada mobile/reduced motion e sessão seguinte: não substituir escolha manual (tarefa 3).

### Task 1: Transporte Android remoto
**Files:** android/app/src/main/java/com/pentagory/pentamark/{RemoteVaultPlugin,RemoteConnection,MainActivity}.java, AndroidManifest.xml, testes Java/instrumentados.
**Interfaces:** configure({origin}):Promise<void>; request({url,method,body?,base64?,clientId?}):Promise<{status:number,data:Record<string,unknown>}>. Origem validada e persistida apenas em memória; mídia /_pm_remote/file?path=... delega /api/file?path=... com fluxo fechado corretamente. Main integra a configuração a cada inicialização.
- [x] Testar rejeição de destino arbitrário, URL com credencial e redirecionamento antes de implementar.
- [x] Implementar ponte limitada, cabeçalho clientId e streaming de arquivos sem código remoto.
- [x] Rodar JUnit e testes nativos reais antes de entregar.

### Task 2: Sessão e UI de conexão
**Files:** src/platform/{android,local-files,remote-profile}.ts, src/components/dialogs/RemoteConnectionPanel.tsx, SettingsModal.tsx, src/app/PentaMarkApp.tsx, src/main.tsx; testes remote-profile/remote-ui.
**Interfaces:** normalização de origem pura; DraftStore(storage,prefix?) mantém compatibilidade local e namespace remoto; android.ts exporta isRemoteVault, remoteOrigin, connectAndroidPc(origin), returnToAndroidLocal(), androidLastNoteKey; switch reinicia página após persistir perfil.
- [x] Testar destinos, isolamento de drafts e volta ao local sem rede (RED).
- [x] Implementar nativeRequest roteado ao espaço atual e SSE com backoff/visibilidade; flush usa mesmo destino capturado.
- [x] Integrar painel de conexão, status honesto e recuperação de inicialização. Botão local funciona mesmo com PC indisponível e preserva draft remoto.
- [x] Rodar testes unitários/Playwright, revisar conflitos e mídia.

### Task 3: Política e UI gráfica
**Files:** src/features/workspace/graphics-policy.ts, GraphicsSettings.tsx, SignalBackground.tsx, CSS/renderers; domain/types.ts, app/constants.tsx. Main faz integração de SettingsModal/PentaMarkApp.
**Interfaces:** loadAppearance(storage, capabilities):Appearance; resolveGraphics(appearance):{animated,reactive,acrylic,refraction,interfaceMotion}; GraphicsSettings({appearance,setAppearance}); graphics-policy exporta presets/recomendação. Agente informa assinaturas finais antes da integração.
- [x] Testar primeira entrada, preferências existentes e Flat econômico (RED).
- [x] Implementar política, aba customizada e desmontagem de efeitos/loops.
- [x] Testar renderers desativados, persistência e navegação sem animações caras (GREEN).

### Task 4: Integração e entrega
- [x] TypeScript/build e suíte unitária completa, testes focados e revisão independente.
- [x] Versionar 2.13.18, build Android CI e assinatura com chave existente.
- [ ] PR, merge/release conforme fluxo autorizado, verificar APK publicado. Documentar necessidade do cliente oficial Tailscale e limites de teste/performance.

## Progress / rulings
- Base 2.13.17. Reutilizar worktree existente; não tocar no checkout antigo com alterações do usuário.
- Aprovações intermediárias dispensadas pela instrução explícita do usuário de seguir sem perguntas.
- Manter dois espaços, sem sincronização automática: escopo seguro e reversível; PC exige conectividade, local não.
- Ruling: substituir polling por SSE nativo com suspensão em background; /api/presence exige registro SSE para manter travas corretas. Evita alterar o protocolo do host.
- Ruling: Flat legado migra uma vez para Econômico, pois a versão anterior persistia efeitos caros ligados por padrão. Tema/fontes/escala e escolhas de novos perfis preservados.
- Task 2: testes de perfis/rascunhos RED→GREEN, 10/10. Interface conexão/local/queda RED→GREEN, 6/6 antes dos casos adicionais da revisão.
- Revisão independente identificou recuperação após falha isolada e clientId no flush sob trava; ambas corrigidas com reproduções RED→GREEN. Os cinco cenários remotos passaram também na primeira regressão completa.
- CI Android 39502188955: APK compilado; 21 testes JVM e 12 instrumentados (WebView/HTTP/SSE/mídia/desconexão) passaram. Assinatura local verificada com a chave da 2.13.17.
- 125 testes unitários e 7 testes de componentes passaram. Primeira regressão completa: 176/188; ajustes de seletores, prontidão do documento e coleta de pixels dos testes gráficos em andamento. Nenhuma falha será ignorada para a publicação.
- Limite de validação: cliente Tailscale deste PC está desconectado. Transporte real validado com fixture HTTP nativa no emulador; conexão entre os aparelhos pessoais exige cliente oficial e permissões da tailnet/firewall.
- Regressão final completa: 188/188 passaram em 11,4 minutos, sem retries. Ajustes mantiveram asserções e corrigiram seletores, prontidão do conteúdo e medições feitas pelo teste. Código de produção não mudou depois do build Android validado.
- Windows CI 39505199427: build, 125 testes unitários e inicialização nativa passaram. PR #18 pronto para integração/publicação autorizada.
