# PentaMark Mobile Host 2.7.0

Este pacote transforma um Android em host do PentaMark sem Electron e sem instalar dependências do projeto. O servidor, a interface móvel e a Ponte MCP já estão compilados.

## Preparar o Android

1. Instale o Termux pelo F-Droid ou pela página oficial do projeto.
2. Abra o Termux e execute:

```sh
pkg update
pkg install nodejs
termux-setup-storage
```

3. Extraia este pacote em uma pasta acessível pelo Termux.
4. Entre nessa pasta e execute:

```sh
bash Iniciar-no-Android.sh
```

5. Abra `http://localhost:3417` no navegador do próprio celular.

O cofre fica em `Armazenamento interno/PentaMark` quando a permissão de armazenamento foi concedida. Sem essa permissão, ele fica em `~/.pentamark/vault` dentro do Termux.

## Compartilhar

- Na mesma rede Wi-Fi, envie o endereço `http://IP-DO-CELULAR:3417` exibido pelo PentaMark.
- Fora de casa, use Tailscale no Android e no aparelho do colaborador. O endereço costuma ser `http://100.x.y.z:3417`.
- O Radmin VPN oficial não possui cliente Android.

O Android pode suspender o Termux quando a tela apaga. Desative a otimização de bateria para o Termux e mantenha a notificação/sessão ativa. Para colaboração diária, um PC ligado é um host mais confiável.

## Encerrar

Volte ao Termux e pressione `Ctrl+C`. Se o wake lock tiver sido ativado, execute `termux-wake-unlock`.
