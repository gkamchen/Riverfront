# Hospedagem gratuita para jogar com amigos

O jogo (a página) e o servidor (as partidas) são coisas separadas:

- **Página**: a demo estática no GitHub Pages, `https://gkamchen.github.io/Riverfront/` (gerada por `npm run build:demo`). Não tem servidor próprio; ela só abre o painel online quando recebe um endereço.
- **Servidor**: roda no seu PC (com um túnel), num serviço gratuito como o Render, ou numa máquina com porta aberta.

O link para os amigos junta os dois:

```
https://gkamchen.github.io/Riverfront/#sala=K7Q2-PX&servidor=wss://seu-endereco/ws
```

Quem abre o link cai direto na sala. O painel também aceita `?servidor=` e `#servidor=` sem sala (para quem vai criar a sala).

> **Página HTTPS exige `wss://`.** O navegador bloqueia `ws://` a partir de uma página `https` (como o GitHub Pages). Por isso o servidor precisa estar atrás de HTTPS: os túneis abaixo já entregam isso. Um `ws://192.168.x.x` só funciona com a página aberta em `http` (o próprio servidor entregando o jogo, ou o app de desktop).

## 1. Túnel no seu PC (recomendado)

Nada de abrir porta no roteador: o túnel sai do seu PC para a internet e devolve um endereço `https`. O script só confere se a ferramenta está instalada; ele não instala nada nem cria conta.

```bash
npm install
npm run build
npm run host:tunnel              # Cloudflare (padrão)
npm run host:tunnel:tailscale    # Tailscale Funnel
```

O script:

1. abre o túnel e descobre o endereço público;
2. sobe o servidor só em `127.0.0.1` (nada exposto direto na rede), aceitando apenas as origens `https://gkamchen.github.io` e a do próprio túnel (`ALLOWED_ORIGINS`), sem clientes sem `Origin` e lendo o IP real do cabeçalho do túnel (`TRUST_PROXY=cloudflare`, que lê o `CF-Connecting-IP`, no túnel da Cloudflare; `TRUST_PROXY=true`, que lê o **último** IP do `X-Forwarded-For`, no Funnel);
3. imprime o link para você abrir o jogo já conectado e o formato do link de convite.

Crie a sala no painel e use **Copiar link**: o link já sai com `#sala=...&servidor=wss://...`. **Ctrl+C** encerra o servidor e o túnel.

Opções: `--porta 9000`, `--com-app` (aceita também o app de desktop, origem `riverfront://app`) e `--teste` (não abre túnel; usa um endereço fictício, para conferir a configuração).

### Cloudflare Tunnel rápido

- Instale o `cloudflared` pelo site da Cloudflare (página de downloads do cloudflared). O túnel rápido (`trycloudflare.com`) **não precisa de conta**.
- O endereço muda a cada vez que o túnel abre: mande o link novo aos amigos.
- A Cloudflare não garante disponibilidade do túnel rápido; é para testes e partidas entre amigos.

### Tailscale Funnel

- Instale o Tailscale, entre na sua conta e libere o Funnel para a sua máquina no painel do Tailscale (é um ajuste da conta, feito por você).
- O endereço é fixo (`https://nome-do-pc.sua-rede.ts.net`), bom para quem joga sempre com o mesmo grupo.
- Ao sair, o script desliga o Funnel (`tailscale funnel --https=443 off`).

Enquanto o PC estiver ligado e o script rodando, o servidor está no ar. Fechou, acabou: as salas abertas se perdem (contas e amigos ficam salvos em `packages/server/dados`).

## 2. Render (gratuito, dorme)

Para ter o servidor no ar sem deixar o PC ligado:

1. Crie um *Web Service* no Render apontando para um repositório com o conteúdo do zip do servidor (`npm run pack:server`; o `Dockerfile` está dentro do zip).
2. Variáveis: `ALLOWED_ORIGINS=https://gkamchen.github.io`, `TRUST_PROXY=true` (o servidor usa só o último IP do `X-Forwarded-For`, o que o proxy do serviço acrescentou; os anteriores podem ser forjados pelo cliente e são ignorados), `DATA_DIR=/data` (sem disco persistente no plano gratuito, os dados somem a cada novo deploy ou reinício).
3. O endereço fica `wss://seu-servico.onrender.com/ws`.

Limites do plano gratuito: o serviço **dorme** depois de um tempo sem acesso e leva perto de um minuto para acordar (a primeira conexão do dia demora; o cliente tenta de novo sozinho). Reinícios encerram as partidas em andamento.

## 3. Porta aberta no roteador (não recomendado)

Dá para redirecionar a porta 8787 do roteador para o seu PC e passar o IP público aos amigos. Riscos e limitações:

- sem HTTPS, só funciona com a página em `http` (o jogo entregue pelo próprio servidor), **não** pelo GitHub Pages;
- seu IP de casa fica exposto, e qualquer pessoa pode tentar conectar;
- muitos provedores usam CGNAT e a porta nem chega ao seu roteador;
- se for usar mesmo assim: `ALLOWED_ORIGINS` preenchido, feche a porta quando terminar e mantenha o Windows e o Node atualizados.

## Limites de carga conhecidos

Medição local (servidor e clientes no mesmo notebook, `npm run test:load`):

| Cenário | Tempo | Mensagens | Tráfego |
| --- | --- | --- | --- |
| 100 partidas 1×1 completas ao mesmo tempo | ~29 s | ~98 mil | ~376 MiB |
| 50 partidas de duplas (200 jogadores) | ~26 s | ~83 mil | ~445 MiB |

Uma partida inteira gera alguns MiB por jogador. Para um grupo de amigos, um PC comum e o plano gratuito do Render sobram. O que limita na prática é a banda de upload da sua conexão e o túnel (a Cloudflare não promete nada para o túnel rápido).

O servidor guarda as salas em memória numa instância só: não dá para dividir entre várias máquinas sem trocar o armazenamento (veja `docs/online.md`).

## Segurança

- O servidor nunca manda o layout do adversário antes do fim da partida, mesmo para clientes modificados.
- Contas são anônimas (token guardado só como hash). Não há senha nem e-mail. O jogo só manda o token para o servidor que o criou: um link com outro servidor não vê a sua conta.
- Contas novas têm limite por IP e um teto total; contas paradas há um ano expiram.
- Origens permitidas, limite de mensagens por segundo, tamanho máximo de mensagem e limite de conexões por IP vêm ligados.
- O IP dos jogadores só fica nos arquivos de log e é apagado depois de 7 dias.
- Só passe o link para quem você conhece: quem tem o endereço do servidor pode criar salas nele.
- Ao terminar, encerre o script (Ctrl+C). Nos túneis, o endereço deixa de funcionar na hora.
