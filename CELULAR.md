# PentaMark no celular

## Melhor configuração

Use o **PC como host** e o **celular como PWA**, conectados por Tailscale. Essa opção preserva os arquivos `.md` no computador, mantém o MCP funcionando e fornece um endereço HTTPS privado que pode ser instalado na tela inicial.

| Opção | Funciona | Recomendação |
| --- | --- | --- |
| PC host + Tailscale + PWA | Android e iPhone | Melhor para uso diário |
| Android como host via Termux | Android | Portátil, mas experimental |
| Radmin no celular | Não | O cliente oficial é somente Windows |
| Vercel com o servidor atual | Não | O sistema de arquivos das Functions não é um disco persistente |
| VPS com disco persistente | Sim, após configurar autenticação e backup | Alternativa para deixar o PC desligado |

## PC como host e celular como aplicativo

1. Instale o [Tailscale](https://tailscale.com/download) no PC e no celular.
2. Entre na mesma rede Tailscale nos dois aparelhos.
3. Abra o PentaMark no PC com `Iniciar-PentaMark.bat` ou pelo aplicativo Desktop.
4. No PC, execute `Configurar-Acesso-Remoto-Tailscale.bat` uma vez.
5. Copie o endereço `https://...ts.net` mostrado pelo Tailscale Serve.
6. Abra esse endereço no celular.
7. No Android, use **Instalar app** no menu do navegador. No iPhone, use **Compartilhar → Adicionar à Tela de Início**.

O Tailscale Serve mantém o endereço restrito ao seu tailnet e fornece HTTPS. Não use Tailscale Funnel para o cofre: Funnel tornaria o serviço público na internet.

### Compartilhar com um amigo

Adicione seu amigo ao mesmo tailnet ou compartilhe o dispositivo pelo painel do Tailscale. Depois envie o endereço HTTPS do PentaMark. No PentaMark, abra **Conectados** para definir o perfil como Leitor, Editor ou Admin.

### Usar a Ponte MCP

No PC host, abra **Configurações → Ponte IA · Codex / MCP**, habilite a ponte e copie a URL HTTPS terminada em `/mcp?token=...`. O token concede acesso ao cofre; compartilhe somente com quem deve editar os arquivos.

## Android como host

Gere o pacote sem Electron:

```sh
npm run mobile:bundle
```

O resultado fica em `mobile-dist`. Compacte essa pasta e envie ao Android. Dentro do pacote há `LEIA-ME.md` e `Iniciar-no-Android.sh` com o passo a passo do Termux.

Limitações importantes:

- o Android pode encerrar o Termux em segundo plano;
- o iPhone não oferece um ambiente equivalente para manter este servidor Node e uma pasta arbitrária de arquivos;
- acesso por IP HTTP funciona, mas a instalação completa da PWA requer HTTPS ou `localhost`;
- para um host 24 horas sem PC, prefira um pequeno VPS com volume persistente, autenticação e backup.

## Por que não Vercel diretamente?

O PentaMark atual depende de um processo Node contínuo, eventos SSE e escrita em arquivos reais do cofre. Vercel Functions podem escalar a zero e não fornecem o disco persistente esperado pelo servidor. Uma versão realmente cloud exigiria trocar a persistência por banco/armazenamento de objetos e adicionar autenticação; isso seria outro modo de produto, não apenas uma implantação.
