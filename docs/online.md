# Jogo online

Este documento cobre o servidor do Riverfront, o protocolo entre cliente e servidor e as três formas de jogar com um amigo:

1. **Servidor dedicado** (uma máquina sempre ligada, VPS, Docker): os dois entram por link ou código de sala.
2. **Hospedar partida** no app de desktop: o próprio app liga um servidor na rede local e o amigo entra pelo endereço mostrado.
3. **Navegador**: o servidor também entrega o cliente web, então o link `http://endereço:8787/#sala=K7Q2-PX` abre o jogo direto, sem instalar nada.

## Visão geral

```
packages/
  protocol/   mensagens, validadores, códigos de sala, paleta de cores, filtro de apelidos (TS puro, sem dependências)
  server/     servidor autoritativo (Node 20+, ws): contas, salas, partidas, amigos, persistência
  client/src/net/   lado do cliente: conexão, partida remota, sessão, painel online (DOM puro)
  desktop/    app Electron com "Hospedar partida" (usa o servidor como biblioteca)
```

O servidor é a autoridade: ele guarda a `Match` do `core` com os dois layouts e manda para cada jogador **só** `match.viewFor(jogador)` e os eventos da partida. O layout do adversário nunca sai do servidor antes do fim (há um teste que joga a mesma partida com dois layouts diferentes do adversário e confere que tudo o que o outro jogador recebe é idêntico byte a byte).

## Rodando o servidor

### Durante o desenvolvimento

```bash
npm install
npm run build          # compila tudo e empacota o servidor em packages/server/dist
npm run server         # node packages/server/dist/riverfront-server.cjs (porta 8787)
# ou, sem empacotar (Node 22.18+, que entende TypeScript):
npm run dev:server
```

Com o cliente em `npm run dev` (Vite, porta 5173), o painel online precisa do endereço `127.0.0.1:8787` digitado no campo "Servidor".

Para testar o fluxo completo no navegador, aponte `CLIENT_DIR` para o build do cliente e abra `http://127.0.0.1:8787/`:

```bash
CLIENT_DIR=packages/client/dist npm run server
```

### Pacote do servidor dedicado

```bash
npm run pack:server
```

Gera `release/server/riverfront-server-<versão>.zip` com:

| Arquivo | Para quê |
| --- | --- |
| `riverfront-server.cjs` | servidor inteiro num arquivo (core, protocolo e `ws` embutidos) |
| `public/` | cliente web compilado, servido em `/` |
| `iniciar-servidor.bat` / `iniciar-servidor.sh` | criam o `.env` na primeira vez e iniciam o servidor |
| `.env.example` | todas as opções comentadas |
| `Dockerfile`, `docker-compose.yml` | imagem `node:22.20.0-alpine`, dados num volume |
| `LEIA-ME.txt` | instruções curtas para quem só baixou o zip |

Precisa de Node.js 20 ou mais recente na máquina (ou Docker: `docker compose up -d`).

### Configuração (`.env`)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `8787` | porta HTTP/WebSocket |
| `HOST` | `0.0.0.0` | `127.0.0.1` para aceitar só a própria máquina |
| `DATA_DIR` | `./dados` | contas, partidas e denúncias; `memoria` para não gravar nada |
| `CLIENT_DIR` | vazio | pasta do cliente web para servir em `/` |
| `LOG_DIR` | vazio | logs diários em arquivo; vazio = só console |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `ALLOWED_ORIGINS` | vazio (todas) | origens aceitas no WebSocket, separadas por vírgula |
| `ALLOW_NO_ORIGIN` | `true` | aceitar clientes sem cabeçalho `Origin` (scripts, apps nativos) |
| `MAX_CONNECTIONS` | `2000` | limite global de conexões |
| `MAX_CONNECTIONS_PER_IP` | `20` | limite por IP |
| `TRUST_PROXY` | `false` | atrás de um proxy seu: `true` usa o último IP do `X-Forwarded-For` (o que o proxy acrescentou), `cloudflare` usa o `CF-Connecting-IP`; valores que não são IP são ignorados |

Nenhum segredo é necessário: as contas são anônimas e o servidor não guarda senhas.

### Na internet, com HTTPS

Navegadores em página `https` só conectam em `wss`. O jeito mais simples é um Caddy na frente:

```
jogo.exemplo.com.br {
    reverse_proxy 127.0.0.1:8787
}
```

E no `.env`: `HOST=127.0.0.1`, `TRUST_PROXY=true`, `ALLOWED_ORIGINS=https://jogo.exemplo.com.br,riverfront://app`. O link de convite fica `https://jogo.exemplo.com.br/#sala=K7Q2-PX`. A origem `riverfront://app` é a do app de desktop.

### Endpoints HTTP

| Rota | Descrição |
| --- | --- |
| `GET /healthz` | `{ ok, version, protocol, sessions, players, rooms, matches }` |
| `GET /ws` (upgrade) | WebSocket do jogo |
| `GET /api/daily?data=AAAA-MM-DD` | desafio e tabela do dia (sem `data`, hoje; até 14 dias atrás) |
| `DELETE /api/account` | apaga a conta; cabeçalho `Authorization: Bearer <userId>.<token>` |
| `GET /*` | arquivos do cliente, se `CLIENT_DIR` estiver definido |

## Hospedar partida (app de desktop)

Na tela inicial do app, **Hospedar partida** liga o mesmo servidor dentro do app, na porta escolhida (padrão 8787), e mostra os endereços desta máquina na rede (`192.168.x.x:8787` e `http://192.168.x.x:8787/`). O amigo pode:

- abrir o app dele e usar **Entrar** com esse endereço; ou
- abrir `http://192.168.x.x:8787/` no navegador (o servidor entrega o jogo).

O servidor embutido só aceita WebSocket da página do próprio app (`riverfront://app`) e do jogo servido por ele (`http://127.0.0.1:porta`, `http://localhost:porta` e `http://<IP da rede>:porta`); conexões sem `Origin` são recusadas.

Quem hospeda clica em **Abrir o jogo neste servidor**, cria a sala e passa o código ou o link. Os dados desse servidor ficam na pasta do app (`Ajuda > Abrir pasta de dados`, subpasta `servidor`). Ao fechar o app, o servidor é desligado e as salas abertas se perdem.

Na primeira vez o Windows pergunta sobre o firewall: permita em **redes privadas**. Para jogar pela internet a partir de casa é preciso redirecionar a porta no roteador (ou usar uma VPN de jogo como Tailscale/ZeroTier, que é mais simples e seguro).

## Fluxo de uma partida

1. **Conexão**: o cliente manda `hello` com a faixa de versões do protocolo que entende. Sem conta salva, o servidor cria uma (id aleatório + token de 256 bits; só o hash SHA-256 do token é guardado) e devolve o token **uma única vez** no `welcome`. O cliente guarda `{ userId, token }` no `localStorage`.
2. **Sala**: `room.create` escolhe o modo (`classic`/`classico`, `full`/`completo`, `rapido` e `rapido-poderes`, campo 15×5), as variantes (`mutators`) e, se quiser, o tamanho do campo (`size`, de 8×4 a 25×9; o servidor recusa com `room-options` o que não couber) e devolve um código `K7Q2-PX` (alfabeto sem 0/O/1/I). A sala expira em 10 minutos se a partida não começar. O segundo jogador entra com `room.join` (o código aceita minúsculas e sem hífen) ou pelo link `#sala=K7Q2-PX`.
3. **Cores**: se as cores dos dois forem parecidas demais (ΔE2000 < 20), quem entrou recebe a cor livre mais próxima da escolhida e um `colour.adjusted`. A paleta tem um par seguro para daltonismo (azul e laranja da paleta Okabe-Ito).
4. **Facção e pronto**: cada um escolhe a facção (`faction`, padrão `neutra`) e manda `ready`; a partida é criada (`placing`). Quem cria a sala pode ligar variantes (`room.create.mutators`: maré, tiro duplo, neblina).
5. **Posicionamento**: `placement.auto` pede um layout aleatório; `placement.submit` manda o layout inteiro, com `confirm: true` para confirmar. Tempo para posicionar: relâmpago 60 s, padrão 2 min, tranquilo 4 min, sem limite. Se o tempo acaba, quem não confirmou tem o layout atual confirmado (ou um automático, se estiver incompleto).
6. **Jogo**: `attack`, `ability` e `special` (tiro especial da facção; a sonda é privada, os outros são públicos). O relógio do `core` decide timeouts: cada estouro de tempo é um strike; 3 seguidos ou 5 no total entregam a partida. Um tiro zera a sequência.
   - **Torre automática e maré** não têm jogada própria: acontecem dentro da jogada que passou a vez. O servidor lê o histórico da partida e manda aos dois lados os eventos `tower` (`by`, `report`) e `tide` (`submerged`). Os dois são públicos; o tiro da torre só mostra o resultado da célula atingida, como um tiro comum.
   - **Neblina**: erros antigos somem do mapa de quem atirou. Para eles não voltarem pelo histórico, nas salas com neblina o servidor manda o histórico sempre completo e sem os erros do próprio jogador em células que hoje aparecem ocultas (`packages/server/src/fog.ts`).
7. **Queda de conexão**: o relógio congela, o adversário recebe `opponent { connected: false, graceLeftMs }` e o estado atualizado. Quem caiu tem 45 s por queda e 90 s no total para voltar; ao reconectar com o mesmo token (`hello` com `auth`) o servidor devolve a sala e o estado completo. Passado o prazo, perde por abandono.
8. **Fim e revanche**: evento `end` com vencedor e motivo; o layout do adversário vem na visão final. `rematch { accept: true }` dos dois começa outra partida, alternando quem começa.

## Duplas (2 contra 2)

`room.create` com `format: 'doubles'` abre uma mesa de quatro lugares (`blue-1`, `red-1`, `blue-2`, `red-2`, ocupados nessa ordem). No saguão dá para trocar de lugar livre (`seat.choose`) e o parceiro entra pelo mesmo código, link ou convite de amigo. A partida começa quando os quatro marcam pronto.

- **Regras** são as do `TeamMatch` do core: campo e exército do time, cada lugar posiciona só as próprias peças (`not-your-piece` para as do parceiro), turnos A1, B1, A2, B2, energia, recargas e inteligência do time.
- **Posicionamento**: `placement.submit` troca só as peças de quem enviou; `placement.auto` encaixa as peças em volta das do parceiro. O parceiro recebe o campo atualizado a cada mudança.
- **Relógio por lugar**: estouros, faltas e reserva são de cada jogador; o 3º estouro seguido (ou o 5º no total) de qualquer um entrega a partida para o time. O evento `timeout` traz `seat`.
- **Queda de conexão por lugar**: a mesma tolerância do 1×1 (45 s por queda, 90 s no total). Os outros três recebem `opponent { seat, connected, graceLeftMs }`; quem volta com o token recebe sala e estado. Estourou a tolerância, o time perde por abandono. O `TeamMatch` não congela o relógio, então o turno de quem caiu continua correndo e pode contar falta.
- **Sigilo**: cada lugar recebe `viewFor(lugar)`: o próprio time inteiro (campo, peças com dono, inteligência), nunca o campo inimigo. Radar, espião e sonda são do time; o time adversário recebe `outcome: null`. Os testes jogam a mesma partida com dois layouts diferentes do time vermelho e conferem que os dois lugares azuis recebem exatamente as mesmas mensagens.
- **Emotes**: `to: 'team'` vai só para o parceiro, `'all'` para a mesa; `mute { who: 'partner' | 'opponents' }`; bloqueio vale entre quaisquer dois da mesa (inclusive para entrar na sala).
- **Revanche**: os quatro aceitam e o time que começa alterna.

## Desafio diário

Todo mundo recebe a mesma configuração no mesmo dia UTC (`dailyChallenge` do core): semente, modo, mutadores, facções e nível do bot. A partida é jogada no aparelho, contra o bot; ao terminar o cliente manda `daily.submit { date, log }` com o `match.log` inteiro.

O servidor **refaz a partida** a partir das opções do dia e confere:

- cada entrada é aceita pelo core, na ordem e no instante informados (instantes nunca voltam);
- os estouros de tempo são exatamente os que o relógio produziria: jogada depois do prazo sem estouro registrado, ou estouro inventado, derruba o envio;
- o bot não desiste nem estoura o tempo; não existem quedas de conexão numa partida local;
- a partida terminou.

Tiros, tempo e pontuação (`dailyScore`) saem da partida refeita, nunca do que o cliente declarou. A tabela guarda o melhor resultado de cada `Nome#1234` (até 100 por dia), só os últimos 14 dias, com até 20 envios por conta e por dia. Vale enviar o de hoje e o de ontem (para quem terminou depois da meia-noite UTC).

O layout do adversário também não vem do cliente: ele é sempre `autoPlace('red', opponentLayoutSeed(semente))`, e o servidor recusa qualquer outro posicionamento do lado vermelho no log.

**A tabela é "por honra".** O código é público: o servidor confere que a partida é possível e que o adversário ficou onde devia, mas não refaz as decisões do bot, então um cliente modificado ainda poderia fabricar jogadas fracas (e legais) do adversário. Para um ranking com prêmio seria preciso jogar o desafio contra o servidor.

## Campanha

O progresso fica **no aparelho** por padrão (`localStorage`, chave `riverfront.campaign`, via `CampaignStore` do módulo `net/`). Sincronizar com a conta é opcional:

- `campaign.sync { progress }`: o servidor confere que o progresso é possível (cada missão vencida estava desbloqueada, a anterior do arco foi vencida e as estrelas batem com o menor número de tiros), junta com o da conta (o melhor de cada missão) e devolve.
- `campaign.result { mission, log }`: o servidor refaz a partida da missão como no desafio diário e registra o resultado; vitórias conferidas assim entram em `verified`.
- `campaign.get` devolve o que está na conta. Excluir a conta apaga também o progresso.

## Protocolo

Mensagens JSON, uma por frame de texto. Todas as do cliente podem ter `id`; a resposta é `ok { ref }` ou `error { ref, code, detail, message }` (texto em pt-BR). Tipos completos em `packages/protocol/src/messages.ts`.

**Cliente → servidor:** `hello`, `profile.update`, `room.create`, `room.join`, `room.leave`, `faction`, `ready`, `placement.submit`, `placement.auto`, `attack`, `ability`, `special`, `surrender`, `emote`, `mute`, `ping`, `sync`, `rematch`, `friends.list`, `friends.request`, `friends.accept`, `friends.decline`, `friends.remove`, `friends.block`, `friends.unblock`, `invite`, `report`, `account.delete`, `seat.choose`, `daily.get`, `daily.submit`, `campaign.get`, `campaign.sync`, `campaign.result`.

**Servidor → cliente:** `welcome`, `ok`, `error`, `profile`, `room`, `room.closed`, `match.state`, `match.event`, `colour.adjusted`, `opponent`, `emote`, `pong`, `friends`, `friend.request`, `presence`, `invite`, `rematch`, `account.deleted`, `server.shutdown`, `daily`, `daily.result`, `campaign`.

**Versões:** `hello.protocol = { min, max }`; o servidor escolhe a maior versão em comum ou responde `protocol-mismatch` e fecha a conexão (código 4003). Ao mudar mensagens de forma incompatível, suba `PROTOCOL_MAX` em `codec.ts` e mantenha o suporte à anterior enquanto houver clientes antigos.

**Visão compactada:** a `PlayerView` do core passa de 30 KB em JSON. Na rede, as 2 × 175 células vão como textos de um caractere por célula e o histórico só com o que o jogador ainda não recebeu (`packView`/`unpackView`, com teste de ida e volta). Uma partida inteira fica em torno de 3,5 KB por mensagem.

**Validação:** toda mensagem do cliente passa por validadores escritos à mão (`packages/protocol/src/validate.ts`): tipos, faixas, tamanho de textos e listas, campos desconhecidos recusados (inclusive `__proto__`). Limite de 8 KiB por mensagem, exceto as que levam o log de uma partida (`daily.submit`, `campaign.result`), que vão até 256 KiB (é também o teto do WebSocket).

## Amigos

- Pedido pela etiqueta `Nome#1234`. Limites: 200 amigos, 20 pedidos pendentes enviados, 10 pedidos por hora, pedidos vencem em 30 dias.
- Pedido mútuo vira amizade direto.
- **Recusa silenciosa**: quem pediu continua vendo "pendente" até vencer.
- **Bloqueio**: desfaz a amizade e os pedidos; quem foi bloqueado não é avisado, seus pedidos somem, convites e emotes não chegam e ele não entra na sala de quem bloqueou.
- **Presença** (online, em partida, offline) só em memória e só para amigos.
- **Convite**: de dentro de uma sala aberta, para um amigo online (até 6 por minuto).
- **Denúncia**: motivo, observação e, se marcado, o registro completo da última partida entre os dois (com os dois layouts e o log, para quem modera) e os emotes trocados na sala. Fica em `dados/reports.ndjson`.

## Emotes

Só ids de uma lista fechada (`packages/protocol/src/cosmetics.ts`). Emoji: 2 s entre um e outro e no máximo 3 a cada 10 s. Provocação: 15 s. Cada jogador pode silenciar os emotes do adversário (`mute`).

## Segurança e limites

- **Contas novas**: no máximo 20 por IP por hora (`ACCOUNTS_PER_IP_HOUR`) e um teto total (`MAX_ACCOUNTS`, 200 mil). A conta só é gravada quando o jogador faz algo além de conectar (a lista de amigos, que o cliente pede ao entrar, já conta); conexões que só dão `hello` não deixam rastro. Contas sem acesso há mais de 365 dias (`ACCOUNT_INACTIVE_DAYS`) expiram e são apagadas como numa exclusão.
- **Credencial por servidor**: o cliente guarda o token em `riverfront.auth:<host[:porta]>` e só o manda para o servidor que o emitiu; um link com outro `#servidor=` cria outra conta nesse servidor.
- **Rotas HTTP** (`/api/*` e arquivos do cliente): limite por IP (60 de rajada, 20 por segundo). O HTML do cliente sai com CSP, `Permissions-Policy` e `X-Frame-Options`; o `index.html` também traz a CSP em `<meta>` para quando é servido por outro lugar (GitHub Pages).
- **Campanha**: até 20 missões conferidas por conexão a cada 10 minutos.

- Validação estrita e tamanho máximo de mensagem (8 KiB; acima disso o WebSocket é fechado com 1009).
- Limite de taxa por conexão (30 de rajada, 12 por segundo). Quem insiste em mensagens inválidas ou acima do limite é desconectado (1008).
- Limite de conexões por IP e global; quem não manda `hello` em 10 s é desconectado.
- Lista de origens permitidas (`ALLOWED_ORIGINS`).
- Ping do WebSocket a cada 20 s; conexão sem resposta é derrubada. Cliente lento (fila de saída acima de 4 MiB) também.
- Desligamento gracioso em `SIGINT`/`SIGTERM`: avisa os clientes (`server.shutdown`), grava os dados e fecha.
- Contas: token aleatório, guardado só como hash; comparação em tempo constante.
- Arquivos estáticos: caminho normalizado e preso à pasta do cliente, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`.

## Privacidade e dados

O servidor guarda: apelido, etiqueta, cor, bandeira, emblema, amigos, pedidos, bloqueios, partidas encerradas (log completo, para revanche/denúncia) e denúncias. Não guarda e-mail, senha nem IP nos dados.

O IP aparece só nos arquivos de log (`LOG_DIR`), nunca no console, e é apagado das linhas com mais de 7 dias (verificação a cada hora). Os arquivos de log são apagados depois de 30 dias (`LOG_RETENTION_DAYS`).

Retenção: denúncias e partidas encerradas ficam 90 dias (`REPORT_RETENTION_DAYS`, `MATCH_RETENTION_DAYS`) e saem numa limpeza que roda ao iniciar e a cada 6 horas; tabelas do desafio diário, 14 dias.

**Excluir a conta** (mensagem `account.delete` ou `DELETE /api/account`): apaga a conta, tira o id das listas dos outros, remove as partidas em que ela jogou e as denúncias que ela fez; denúncias contra ela ficam sem identificação, sem o registro da partida.

## Armazenamento (`Store`)

O servidor usa a interface `Store` (`packages/server/src/store/types.ts`). Vêm duas implementações:

- `FileStore` (padrão com `DATA_DIR`): `accounts.json` é uma foto das contas e `accounts.journal.ndjson` guarda só as mudanças depois dela (uma linha por conta, juntadas com meio segundo de atraso); quando o diário cresce, ou ao desligar, vira uma foto nova gravada de forma atômica. `matches.ndjson` e `reports.ndjson` são anexados linha a linha. Busca por apelido usa um índice em memória. Sem módulos nativos.
- `MemoryStore`: tudo em memória (testes, `DATA_DIR=memoria`).

Para muitos jogadores ou várias instâncias, implemente `Store` sobre um banco (Postgres, SQLite, Redis) e passe em `startServer({ store })`.

## Usando o servidor como biblioteca

```ts
import { startServer } from '@riverfront/server';

const server = await startServer({ port: 8787, dataDir: './dados', clientDir: './public' });
console.log(server.url, server.stats());
await server.close();
```

O app de desktop faz exatamente isso. Opções em `packages/server/src/index.ts` (`ServerOptions`), incluindo `clocks` e `placementMs` para eventos com tempos diferentes.

## Transporte e outros hosts

A lógica (`GameServer`) não conhece rede: recebe `open`, `message` e `close` de um `Transport` (`packages/server/src/transport.ts`). O padrão é `WsTransport` (servidor HTTP do Node + `ws`).

Dá para escrever outro transporte, por exemplo para uma plataforma de WebSocket sem servidor (API Gateway WebSocket, Cloudflare Durable Objects, PartyKit), implementando `Transport` e chamando os handlers do `GameServer`. O que muda nesse caso:

- Salas, partidas e presença vivem na memória de uma instância. Os dois jogadores de uma sala precisam cair na mesma instância (em Durable Objects, um objeto por sala resolve; em funções sem estado, seria preciso mover as salas para fora da memória).
- O relógio depende de um `setInterval` (`tickMs`); plataformas que hibernam precisam de um alarme equivalente.
- `Store` precisa ser um banco compartilhado.

Isso não está implementado; o transporte WebSocket atual atende o servidor dedicado e o modo hospedar.

## Testes

```bash
npm test                # inclui os testes de integração do servidor com clientes ws reais
npm run test:load       # 100 salas jogando partidas completas ao mesmo tempo (LOAD_ROOMS=200 para mais)
```

Os testes de integração jogam partidas inteiras, comparam o que um jogador recebe com dois layouts diferentes do adversário também com torre automática, maré, neblina, sonda e tiro certeiro do adversário, cobrem os modos rápidos e o tamanho personalizado (com tiros extras), cobrem timeouts e strikes, queda e volta, abandono, revanche, posicionamento manual e automático, sigilo do layout, limites de taxa e de tamanho, fuzz de mensagens, origens, limite por IP, amigos (pedido, aceite, recusa, bloqueio, limite por hora, convite), denúncia com registro, exclusão de conta, persistência em arquivo e conflito de cores. Há também um teste do módulo `client/src/net` contra o servidor real (cria sala, joga, derruba a conexão e confere a reconexão).

Medição de referência (notebook de desenvolvimento, servidor e 200 clientes no mesmo processo): 100 partidas completas simultâneas em cerca de 24 s, ~98 mil mensagens, ~340 MiB trafegados.

## Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| "Não foi possível conectar" na rede local | firewall do Windows (redes privadas), mesmo Wi-Fi, endereço 192.168.x.x e não 169.254.x.x |
| Funciona no PC, não no celular | o celular está na rede de convidados? |
| Página https não conecta | precisa de `wss` (proxy com TLS), veja "Na internet, com HTTPS" |
| "Origem não autorizada" | inclua a origem em `ALLOWED_ORIGINS` (para o app: `riverfront://app`) |
| Conta "sumiu" | o token fica no navegador/app; limpar os dados cria outra conta |
