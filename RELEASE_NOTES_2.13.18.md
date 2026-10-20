# PentaMark 2.13.18 — PC conectado e gráficos leves

## Android
- Conexão opcional ao PentaMark Desktop via IP Tailscale ou HTTPS .ts.net. Mesmo editor embarcado, sem Termux ou servidor no celular.
- Cofre local continua offline e separado do PC. Botão Local disponível durante a conexão e na recuperação de falhas.
- Rascunhos e última nota isolados por endereço; conflitos e presença usam o protocolo existente do host.
- Transporte nativo com timeouts, limites, validação de destinos, bloqueio de redirecionamento e mídia por streaming.

## Gráficos
- Aba Gráficos: Econômico, Equilibrado, Qualidade e Personalizado.
- Controles independentes de fundo animado, reação ao mouse, movimento da interface e refração.
- Recomendação leve na primeira entrada; preferências manuais preservadas depois.
- Flat antigo migra para Econômico sem alterar tema, fontes ou escala. Efeitos desligados deixam de criar canvas, malha e ciclos de animação; painéis e troca de nota respeitam movimento desativado.

## Uso
Instale o APK Android desta release para uso local e conexão ao PC. O ZIP Mobile-Host-Android é um pacote legado, não é necessário para este APK. Mantenha o cliente oficial do Tailscale conectado nos dois dispositivos e o PentaMark aberto no PC. Endereço comum: `100.x.x.x:3417`. HTTPS .ts.net requer Serve previamente configurado. Não há sincronização automática entre cofres.

Exporte o cofre local antes de desinstalar ou limpar dados. Atualizações assinadas com a mesma chave preservam os arquivos. Consulte ANDROID.md para instruções e limites.
