# Integração do modo online no cliente

O módulo `packages/client/src/net/` está pronto e testado contra o servidor real, mas **não está ligado** a `app/` nem a `hud/`. Este documento descreve o que falta para ligar.

## O que existe em `net/`

| Arquivo | Conteúdo |
| --- | --- |
| `index.ts` | ponto de entrada; importe daqui |
| `session.ts` | `OnlineSession`: conexão + perfil + sala + amigos + partida remota, com eventos |
| `remoteMatchHost.ts` | `RemoteMatchHost`: a partida no servidor (visão, jogadas, atualizações) |
| `connection.ts` | WebSocket com hello, reconexão com espera crescente, ping, pedidos com resposta |
| `onlinePanel.ts` | `mountOnlinePanel(container, deps)`: painel em DOM puro (servidor, perfil, cor, sala, amigos, convites, excluir conta) |
| `address.ts` | normaliza endereços, lê `?servidor=` e `#sala=`, monta link de convite, copia texto |
| `storage.ts` | credenciais e preferências no `localStorage` (`riverfront.*`) |

O painel injeta o próprio CSS (classes `rf-*`) e todos os textos são pt-BR. Ele não depende de nada de `hud/`.

## 1. Abrir o painel

Sugestão: um item "Jogar online" no menu da esquerda da HUD que abre um contêiner sobreposto.

```ts
import { mountOnlinePanel, type OnlineSession } from '../net';

let online: OnlineSession | null = null;

const panel = mountOnlinePanel(overlayElement, {
  clientVersion: __APP_VERSION__, // ou a versão que preferir
  onSessionChange: (session) => (online = session),
  onMatchStart: ({ session, host, room }) => {
    closeOverlay();
    game.startOnline(session, host, room); // ver passo 2
  },
  onClose: () => closeOverlay(),
});
```

Abra o painel automaticamente na inicialização quando:

- a URL tiver `#sala=XXXX-XX` (convite): `roomCodeFromLocation() !== null`. O painel conecta sozinho e entra na sala assim que o perfil chega;
- a URL tiver `?servidor=` (o app de desktop usa isso ao entrar num servidor ou abrir a partida hospedada): `new URLSearchParams(location.search).has('servidor')`;
- a página tiver sido servida pelo próprio servidor (`location.protocol` http/https e não for a porta 5173 do Vite): `defaultServerUrl() !== null`.

`panel.destroy()` remove o painel mas **não** desconecta: a sessão continua viva durante a partida.

## 2. Partida remota no `GameController`

Hoje `MatchHost` é síncrono e usa a visão antiga (`LegacyPlayerView`). Online, as jogadas são assíncronas e o resultado chega para os dois jogadores ao mesmo tempo, então a ordem muda: **anime a partir dos eventos, não da resposta da jogada**.

```ts
host.onUpdate((update) => {
  if (update.kind === 'state') {
    // entrada na partida, reconexão, revanche: redesenhe tudo a partir de update.view
    rebuildFrom(update.view);
    return;
  }
  const { event, view } = update;
  switch (event.kind) {
    case 'start':     /* fim do posicionamento: vai para a fase de jogo */ break;
    case 'confirmed': /* o adversário confirmou o layout (event.by) */ break;
    case 'shot':      /* event.outcome é o AttackOutcome do core: anime igual ao local */ break;
    case 'ability':   /* event.outcome é null quando a habilidade foi do adversário e é secreta */ break;
    case 'special':   /* tiro especial da facção; outcome null quando é a sonda do adversário */ break;
    case 'tower':     /* torre automática de event.by atirou: event.report (célula, resultado) */ break;
    case 'tide':      /* maré subiu (event.submerged true) ou baixou; linhas em view.mutators.tide */ break;
    case 'timeout':   /* event.player estourou o tempo; event.strikes, event.forfeit */ break;
    case 'end':       /* event.winner, event.reason ('destroyed' | 'surrender' | 'timeout' | 'abandon') */ break;
  }
  // depois da animação, sincronize HUD e tabuleiro com `view`
});
```

Jogadas (todas devolvem `Promise<NetResult>`; em erro, `result.message` já vem em pt-BR para mostrar na HUD):

```ts
await host.attack({ col, row });
await host.useAbility({ ability: 'radar', target: { col, row } });
await host.special({ target: { col, row }, axis: 'row' });
await host.autoPlace();
await host.submitPlacement(placements, /* confirm */ true);
await host.surrender();
```

Pontos de atenção:

- **Lado do jogador**: online, o jogador pode ser `red`. Use `host.seat` (ou `view.player`) no lugar da constante `HUMAN = 'blue'`. O campo "meu" no tabuleiro continua sendo `view.own`, e o do adversário `view.enemy`.
- **Entrada**: só habilite o clique quando `view.turn === view.player` e `view.phase === 'playing'`. Enquanto a jogada está no ar, desabilite (o servidor recusa jogada fora da vez com `not-your-turn`, sem efeito colateral).
- **Tiro extra**: `outcome.extraShot` e `outcome.nextTurn` dizem quem joga depois.
- **Sem bot**: no modo online não chame `chooseRandomTarget` nem `#botReact`.
- **Transição**: enquanto a nova HUD não usa `PlayerView`, `host.legacyView()` devolve a visão no formato antigo (via `toLegacyView` do core).
- **Relógio**: `view.clock.deadline` está no relógio do servidor. Para a contagem regressiva use `host.localDeadline()` (já corrigido pela diferença de horário). `view.clock.frozen` fica `true` enquanto alguém está desconectado.
- **Strikes**: `view.own.clock.strikes` / `consecutiveStrikes` e o mesmo em `view.enemy.clock`.
- **Posicionamento**: `room.placementDeadline` (no evento `room` da sessão) é o prazo da fase; quando acaba, o servidor confirma o layout atual ou um automático.
- **Fim**: em `view.phase === 'finished'`, `view.enemy.layout` traz o layout do adversário para revelar.

## 3. Eventos da sessão para a HUD

```ts
session.on('opponent', ({ connected, graceLeftMs }) => /* faixa "adversário desconectado, 0:45" */);
session.on('emote', ({ from, kind, emote }) => /* mostrar emoji/provocação do lado de `from` */);
session.on('rematchOffer', (seat) => /* botão "Aceitar revanche" */);
session.on('roomClosed', (reason) => /* voltar ao menu com aviso */);
session.on('status', (s) => /* 'reconnecting': mostrar "Reconectando…" e travar a entrada */);
session.on('rtt', (ms) => /* ping no canto da tela */);
session.on('invite', ({ from, code }) => /* o painel já mostra; repita na HUD se ele estiver fechado */);
session.on('fatal', (reason) => /* conexão encerrada de vez (conta aberta em outro lugar, versão incompatível) */);
```

Emotes: `session.sendEmoji('fogo')`, `session.sendTaunt('errou')`, `session.muteOpponent(true)`. Os ids válidos e os textos estão em `@riverfront/protocol` (`EMOJIS`, `EMOJI_GLYPHS`, `TAUNTS`, `TAUNT_TEXT`). O servidor aplica as recargas (emoji 2 s e 3 a cada 10 s; provocação 15 s) e devolve `emote-cooldown`; vale desabilitar os botões no cliente pelo mesmo tempo.

Revanche: `session.rematch(true)`. Quando os dois aceitam, chega um novo `matchStart` (com `room.matchNumber` maior) e um `state` completo.

Denúncia: `session.report(userId, 'provocacao', 'texto opcional', true)` (o último parâmetro anexa o registro da partida).

## 4. Facções e variantes

Modos: `classic`, `full`, os apelidos `classico`/`completo`, `rapido` e `rapido-poderes` (15×5); a lista para o menu é `GAME_PRESETS` do core. `session.createRoom(clock, mode, mutators, size?)` aceita um tamanho de campo (limites em `FIELD_LIMITS` do protocolo). Use sempre `view.config.cols/rows`, nunca 25×7 fixo.

Com neblina, o histórico da visão já chega sem os erros apagados: não guarde no cliente erros antigos fora do que vem em `view`.

No saguão, `session.setFaction(id)` (antes de marcar pronto; o painel já tem o seletor) e `session.createRoom(clock, mode, mutators)`. A facção de cada lado aparece em `room.players[i].faction` e as variantes em `room.mutators`.

## 5. Duplas, desafio diário e campanha

**Duplas**: `session.createRoom(clock, mode, mutators, undefined, 'doubles')`; no saguão `session.chooseSeat('red-2')`. Na partida, `host.seatId` é o lugar (`'blue-1'`...) e `host.teamView()` traz `doubles` (`seatOnTurn`, `myTurn`, `partner`, `pieceOwners`, relógio de cada lugar). Habilite a entrada só com `doubles.myTurn`; no posicionamento mostre as peças do parceiro travadas (`pieceOwners[id] !== seatId`). Eventos `shot`/`ability`/`special`/`timeout` trazem `seat` (quem jogou) e `opponent` traz `seat` (quem caiu). Emotes: `session.sendEmoji(id, 'team')` só para o parceiro; `session.mutePartner(true)`. `room.you` e `room.players[].seat` passam a ser lugares de duplas quando `room.format === 'doubles'`.

**Desafio diário**: `session.getDaily()` → evento `daily` (`challenge`, `board`, `rank`). Jogue localmente com `dailyMatchOptions(challenge, 0)` e, ao terminar, `session.submitDaily(challenge.id, match.log)` → evento `dailyResult` (ou erro `replay-rejected` com o motivo). O log precisa ser o `match.log` original (tempo virtual serve, mas cada jogada tem de respeitar o prazo do turno do relógio `padrao`).

**Campanha**: `session.campaign` (`CampaignStore`) guarda o progresso no aparelho: `campaign.record(missionId, { won, shots })` depois de cada missão, `campaign.progress` para as telas. Sincronizar é opcional: `session.syncCampaign()`; para marcar como verificada, `session.submitMission(missionId, match.log)`. O evento `campaign` traz o que ficou na conta (e já foi juntado ao aparelho).

## 6. Cores do time

A cor de cada jogador na sala está em `room.players[i].colour` (id da paleta). Use `colourById(id).hex` de `@riverfront/protocol` para pintar peças e bandeiras. Ela pode ser diferente da cor do perfil quando os dois escolheram cores parecidas; o servidor já resolve isso.

## 7. App de desktop

No app, `window.riverfront` existe (preload) com `platform: 'desktop'`. O cliente não precisa dele para jogar online; só se quiser um botão "Voltar ao início" (`window.riverfront.openLauncher()`).

A página roda sob CSP `script-src 'self' 'wasm-unsafe-eval'` (sem scripts inline nem `eval`) e é servida em `riverfront://app/`, então caminhos absolutos como `/assets/...` funcionam. O mesmo vale quando o servidor entrega o cliente em `http://ip:8787/`.

## Checklist

- [ ] item "Jogar online" na HUD abrindo `mountOnlinePanel`
- [ ] abrir o painel sozinho com `#sala=`, `?servidor=` ou página servida pelo servidor
- [ ] `GameController` com modo online usando `RemoteMatchHost` e animando a partir de `onUpdate`
- [ ] lado do jogador vindo de `host.seat`
- [ ] tela de posicionamento enviando `submitPlacement` / `autoPlace` e mostrando o prazo
- [ ] relógio, strikes e aviso de adversário desconectado
- [ ] emotes e provocações com recarga e "silenciar"
- [ ] revanche e volta ao menu em `roomClosed`
- [ ] estado "Reconectando…" travando a entrada
- [ ] duplas: formato no painel (já existe), lugar e vez do parceiro na HUD, peças do parceiro travadas no posicionamento
- [ ] desafio diário: jogar com `dailyMatchOptions`, enviar o `match.log`, mostrar a tabela
- [ ] campanha: `CampaignStore` no aparelho e botão opcional "Sincronizar com a conta"
