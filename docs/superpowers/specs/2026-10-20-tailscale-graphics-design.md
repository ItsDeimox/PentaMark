# Conexão Android e gráficos adaptativos

O usuário pediu conexão ao PC pelo Tailscale mantendo o APK local offline, sem Termux, e redução real do custo gráfico com ajustes personalizados e adaptação na primeira entrada. Pediu anteriormente implementação direta sem novas perguntas; decisões reversíveis são registradas aqui.

## Conexão

Usar o mesmo frontend embarcado e a API existente do PC, não carregar código remoto dentro da ponte privilegiada. Dois espaços explícitos: local e PC. Não é sincronização de cofres; perder conexão não pode redirecionar gravações para o local. Rascunhos, última nota e mídia separados por origem. Troca de espaço reinicia a interface após preservar rascunhos; voltar ao local nunca depende de rede.

Tailscale oficial instalado/conectado no Android e PC é pré-requisito. PentaMark Desktop aberto já hospeda a API. Aceitar endereços HTTP/HTTPS IPv4 Tailscale 100.64.0.0/10 e HTTPS *.ts.net; rejeitar credenciais, caminhos, query, fragmentos e redirecionamentos. Não instalar VPN própria nem abrir portas públicas. Interface explica PC desligado/VPN desconectada e mantém botão de voltar ao local.

Ponte nativa RemoteVault: configure({origin}) valida destino; request({url,method,body?,base64?,clientId?}) devolve {status,data}; mídia entregue pelo caminho local /_pm_remote/file?path=... com streaming, MIME seguro e bloqueio de navegação como documento. Sem cópias base64 de imagens lidas. Limites de resposta e timeouts; não carregar assets HTML/SVG ativos como documento privilegiado. Eventos SSE nativos reaproveitam o protocolo obrigatório de presença/travas do host; suspensão em background e reconexão com backoff. Conflitos continuam por baseRevision.

## Gráficos

Flat deve remover renderização contínua e filtros caros por padrão. Aba Gráficos separada com presets econômico/equilibrado/qualidade e personalizado, controles independentes para fundo animado, reação ao mouse, movimento de interface e refração. Desativar componentes/renderers, não apenas opacity. Preservar tema/tipografia/preferências existentes; primeira entrada sem preferências escolhe perfil conservador no Android/coarse pointer/reduced motion/dispositivo limitado. Não rodar benchmark pesado nem mudar preferências automaticamente em sessões posteriores. Usuário pode reaplicar recomendação manualmente.

## Verificação

Testar validação de destino, isolamento de rascunhos, volta offline ao local, falha de conexão, gravação/conflito remoto, mídia segura, primeira entrada e persistência de gráficos, ausência de canvas/loops com efeitos desligados. Build TypeScript, suíte unitária, regressões Playwright e Android nativo. Publicar somente após revisão e evidência; sem alegar teste real no tailnet pessoal se não disponível.
