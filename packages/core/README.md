# @riverfront/core

Motor de regras do Riverfront em TypeScript puro: sem DOM, sem three.js, sem relógio do sistema e sem `Math.random`. Tudo que é aleatório sai de um gerador com semente, então a mesma semente e a mesma sequência de ações produzem sempre a mesma partida (inclusive os bots de `@riverfront/ai`).

```ts
import { Match } from '@riverfront/core';

const match = new Match({ seed: 42, config: 'full', clock: 'padrao' });
match.autoPlace('blue');
match.autoPlace('red');
match.confirm('blue');
match.confirm('red'); // fase 'playing'

match.tick(Date.now()); // só quando há relógio
const result = match.attack('blue', { col: 3, row: 2 });
if (result.ok) console.log(result.outcome.result, result.outcome.extraShot);

const view = match.viewFor('blue'); // JSON puro, pode ir direto para o cliente
```

## Regras

### Campo

- Cada jogador tem um campo de **25 × 7** (175 células); um lago separa os dois campos.
- A **linha 0 é a margem do lago** (`BANK_ROW`). Colunas 0–24, linhas 0–6; rótulo de célula `A1`…`Y7` (`cellLabel`).
- "Adjacente" sempre significa os 4 vizinhos ortogonais.
- **Terreno**: antes do posicionamento, cada campo recebe suas rochas a partir da semente (`config.rocks`, 45 nos dois presets). O dono vê as próprias rochas enquanto posiciona; o inimigo não. Unidades podem ficar em **qualquer célula que não seja rocha**; toda célula sem rocha e sem unidade é terra. Se um sorteio de rochas não comportar nenhum posicionamento legal, ele é descartado e sorteado de novo (determinístico).

### Peças

Formatos são listas de deslocamentos e giram em passos de 90° (`rotateShape`, `orientations`). A âncora de um posicionamento é o canto superior esquerdo do formato já girado.

| Papel (`RoleId`) | Nome | Formato | Regra de posicionamento | Valor (espião) |
| --- | --- | --- | --- | --- |
| `recruit` | Recruta | 1×1 | — | 1 |
| `armor` | Blindado | 1×2 | — | 2 |
| `amphibian` | Anfíbio | 1×2 | todas as células na margem (linha 0) | 3 |
| `sniper` | Atirador | 1×1 | nenhuma outra unidade adjacente (vale nos dois sentidos) | 4 |
| `bunker` | Bunker | 2×2 | nenhuma célula na borda do campo | 5 |
| `workshop` | Oficina | 1×2 | — | 6 |
| `generator` | Gerador | 1×1 | adjacente a um bunker ou a uma antena (verificado no `confirm`) | 7 |
| `artillery` | Artilharia | 1×3 | nenhuma célula na margem (linha 0) | 8 |
| `antenna` | Antena | L de 3 | pelo menos uma célula adjacente a rocha | 9 |
| `tower` | Torre | 1×1 | só nas 2 linhas do fundo (`REAR_ROWS`); só em exércitos de facção que a trazem | 10 |

### Modos (presets)

`PRESETS`, `resolveConfig`, `GAME_PRESETS` (lista para menus):

| Preset | Apelido | Campo | Peças | Poderes |
| --- | --- | --- | --- | --- |
| `classic` | `classico` | 25×7, 45 rochas | recruta ×6, blindado ×3, artilharia ×2, bunker ×1 (12 peças, 22 células) | nenhum |
| `full` | `completo` | 25×7, 45 rochas | recruta ×4, atirador, blindado ×2, artilharia, antena, bunker, anfíbio, gerador, oficina (13 peças, 24 células) | as 5 habilidades, energia, facções |
| `rapido` | — | 15×5, 16 rochas | recruta ×3, blindado ×2, artilharia (6 peças, 10 células) | nenhum |
| `rapido-poderes` | — | 15×5, 16 rochas | recruta ×2, blindado, artilharia, antena (5 peças, 10 células) | radar e bombardeio; energia começa em 2, máximo 6; facções |

A escala de energia é do modo (`FieldConfig.energy`, o que faltar vem de `ENERGY`). O tamanho do campo é configurável: `new Match({ config: 'full', size: { cols: 20, rows: 6 } })` ou `sizedConfig('full', 20, 6)`; as rochas acompanham a área e o nome vira `full-20x6`. Se o exército não couber, o `Match` recusa a configuração com erro. O `autoPlace` é testado com 500 sementes nos modos rápidos e num campo 18×6.

Um `FieldConfig` próprio pode mudar tamanho, rochas, unidades (`{ role, count, shape? }`), habilidades e energia. Os ids das peças seguem a ordem da config: `recruit-1`, `armor-2`…

### Posicionamento

A partida começa em `'placing'`. Cada jogador usa `place`, `move`, `rotate`, `remove`, `setLayout` (layout inteiro de uma vez) ou `autoPlace`, e termina com `confirm`. Os erros (`PlacementError`) são: `out-of-bounds`, `on-rock`, `overlap`, `isolation`, `bank-row`, `needs-rock`, `border`, `bank-only`, `needs-support`, `not-placed`, `unknown-piece`, `bad-rotation`. A regra do gerador só é cobrada no `confirm` (ele pode ser posto antes do bunker ou da antena); a vista própria lista as pendências em `own.issues`. Quando os dois confirmam, a partida passa a `'playing'` e começa quem foi definido em `firstTurn` (padrão `blue`).

`autoPlace(size, terrain, pieces, rng, { weight })` é uma função pura que sempre devolve um layout legal (testado com 500 sementes por preset); o `weight` opcional permite estilos de posicionamento (os bots usam).

### Combate

`attack(player, coord)` devolve um `AttackOutcome` com `result`:

| `result` | Significado | Tiro extra? |
| --- | --- | --- |
| `earth` | errou, terra revelada | não |
| `rock` | rocha revelada, ela absorve o tiro | não |
| `hit` | acertou parte de uma peça (o papel **não** é revelado) | sim |
| `destroyed` | a peça caiu; `destroyed.role` e `destroyed.cells` são revelados | sim |
| `shield` | o escudo absorveu; a célula fica marcada como unidade conhecida | não |

- Acerto dá tiro extra, no máximo **3 extras seguidos** (`MAX_EXTRA_SHOTS`): o 4º acerto do turno passa a vez.
- **Concreto do bunker**: acertos no bunker não dão tiro extra até a 2ª célula dele ser atingida.
- **Último tiro do atirador**: quando o atirador cai, o dono dele descobre uma célula intacta aleatória de uma unidade do atacante (`sniperReveal`); ela aparece como `spotted` para o dono do atirador e como `exposed` para o atacante.
- Vence quem destruir todas as células de unidade do outro lado (`winReason: 'destroyed'`). `surrender(player)` encerra a partida a favor do outro.

### Energia e habilidades (preset `full`)

Energia começa em 2, ganha **+1 no início de cada turno seu**, **+2 por peça inimiga destruída**, máximo 8 (`ENERGY`). Uma habilidade por turno, e ela **não** encerra o turno. Recarga é contada em turnos seus: recarga 3 = pode usar de novo 3 turnos seus depois. As habilidades são dados (`ABILITIES`) e o efeito de cada uma é escolhido pelo `id`.

| Habilidade | Custo | Recarga | Requer peça viva | Alvo (`AbilityRequest`) | Efeito |
| --- | --- | --- | --- | --- | --- |
| `radar` | 3 | 3 | antena | célula inimiga | conta as células **ocupadas** (atingidas ou não) no 3×3; anfíbios não aparecem; rocha no centro bloqueia o sinal (`count: null`) |
| `bomb` | 4 | 4 (3 com artilharia viva) | — | célula inimiga | atinge o centro e as 4 vizinhas; se o centro for rocha, só ele conta; não dá tiro extra; recusa centro que já é rocha revelada |
| `shield` | 3 | 5 | gerador | peça própria | protege a peça por 2 turnos inimigos; não vale para peças na margem |
| `repair` | 3 | 5 | oficina | célula própria | restaura uma célula danificada de peça viva que encosta em terra livre; ela volta a ficar oculta e a peça ganha **reforço** (escudo de 1 turno inimigo) |
| `spy` | 2 | 5 | — | linha (`axis: 'row' \| 'col'`, `index`) | revela o **tipo** de uma peça viva sorteada entre as que cruzam a linha (ou `null` se não há nenhuma), sem posição |

Por que o espião e o reparo mudaram: o espião antigo (custo 2, sempre a peça mais valiosa) zerava linhas de 25 células e ainda descartava as peças fortes delas; agora a resposta não tem ordem e a recarga é maior (os egípcios mantêm a versão antiga). O reparo quase não servia contra quem lembra dos acertos: a célula voltava a ser atingida no turno seguinte; com o reforço, esse tiro é absorvido.

O bombardeio é público (o adversário vê as células atingidas no histórico). Radar, espião, escudo e reparo são privados: o adversário só vê que a habilidade foi usada. A vista inimiga também informa `shieldActive` (se há um escudo ligado do outro lado).

Erros de habilidade: `abilities-disabled`, `ability-used`, `cooldown`, `energy`, `missing-piece`, `invalid-target`, `out-of-bounds`, `unknown-piece`. `own.abilities` traz para cada uma o custo, a recarga efetiva, quanto falta e o motivo do bloqueio.

### Facções

`new Match({ seed, factions: { blue: 'egito', red: 'grecia' } })`. Sem `factions` (ou com `'neutra'`) valem as regras de sempre. As facções são dados (`FACTIONS`, `FactionDef`): arquétipo, tiro especial, passivas, ajustes de custo/recarga das habilidades (`abilityModifiers`), peça extra opcional e o comandante (`leader`, com ids de falas). A partida só lê esses campos; nada no motor depende do id. A mecânica só liga em modos com energia (`full`, `rapido-poderes`); no `classic` e no `rapido` a facção é só visual.

O registro traz todas as facções do `docs/ROADMAP.md`: a onda 1 desenhada à mão e as ondas 2–4 montadas a partir de modelos por arquétipo, cada uma com seu tempero.

| Facção | Arquétipo | Tiro especial | Passivas e ajustes |
| --- | --- | --- | --- |
| Egípcios | informação | **Sonda**: revela terra, rocha ou unidade numa célula, sem atingir e sem gastar o tiro; 1 de energia, recarga 3 | radar −1 de custo e vê anfíbios; espião com ranking (a peça mais valiosa); +1 turno de reforço no reparo |
| Romanos | defesa | **Tiro certeiro**: no centro de um radar seu que achou unidades, acerta com certeza uma célula intacta daquele 3×3; 1 de energia, recarga 2 | **testudo** (o 1º acerto no bunker ou numa peça encostada nele é absorvido, uma vez por partida); escudo e reparo −1 de custo; +1 de energia por abate |
| Gregos | ataque | **Rajada**: 3 células em linha (rocha para a rajada), conta como o tiro do turno, sem tiro extra; 3 de energia, recarga 3 | **torre** extra; bombardeio fura rocha; energia máxima +1 |

**Orçamento de poder.** Toda facção gasta exatamente `FACTION_BUDGET` = 10 pontos (`factionPower`), com distribuição diferente:

```
poder = Σ (−Δcusto) × PESO_CUSTO + Σ (−Δrecarga) × PESO_RECARGA + Σ passivas + especial + peças extras × PESO_PEÇA
especial = TIPO + (cargas ? 1,5 × cargas : 3) + (recarga por energia ? 1 : 0) − 0,5 × energia − 0,5 × recarga
```

Os pesos (`POWER_WEIGHTS`) foram calibrados pela simulação de bots: o que a liga mostrou mais forte (a torre, a sonda barata) custa mais pontos. O teste confere que todas somam 10.

Equilíbrio medido com `npm run sim -- --factions` (bots do mesmo nível, lados e início trocados). Onda 1 no `full`, 200 partidas por confronto:

| Nível | Egito | Roma | Grécia |
| --- | --- | --- | --- |
| 4 | 49,8% | 49,5% | 50,7% |
| 5 | 48,3% | 49,8% | 52,0% |
| 3 | 52,5% | 44,8% | 52,8% |

As 14 facções prontas (ondas 1–3), nível 4, 400 partidas por par:

- `full`: todas entre 46,2% e 54,3%, exceto Cartago (44,0%).
- `rapido-poderes`: todas entre 47,3% e 53,6%.

O nível 3 não usa o radar fora do tiro certeiro, então Roma fica um pouco abaixo nele. A onda 4 segue os mesmos modelos e o mesmo orçamento; na última medição com todas as 23 (40 partidas por par) só os Persas passavam de 55%, e eles foram ajustados depois.
### Tiros especiais

`match.special(player, { target, axis?, second? })`. Um por turno. A biblioteca (`SHOT_KINDS`, `shotCells`) tem: `single`, `line3` (para a direita ou para baixo; rocha para), `cross` (cruz; rocha no centro absorve), `probe` (não atinge, não gasta o tiro, resultado privado), `precise` (no centro de um radar seu com unidades), `double` (duas células não vizinhas) e `ricochet` (se cair em terra, pula para uma vizinha não revelada, sorteada pela semente). Cada facção define energia, recarga e cargas (`SpecialShotDef`). A regra do tiro extra continua igual: só os tipos de alvo único (`single`, `precise`, `ricochet`) dão tiro extra, sempre com o limite de 3. A sonda é privada (o outro lado só vê que ela foi usada); os outros tiros vão para o histórico de todo mundo. Os sorteios (precise, ricochet) saem de sementes derivadas da partida, então o replay reproduz tudo.

### Torre automática

Peça 1×1 que conta como célula de unidade (precisa ser destruída para vencer) e só fica nas duas linhas do fundo. No início de cada 5º turno do dono (`TOWER_PERIOD`) ela atira numa célula inimiga ainda não revelada e fora d'água, sorteada a partir da semente da partida. O tiro entra no `log` (`type: 'tower'`, conferido no replay) e no histórico dos dois (`kind: 'tower'`). As duas vistas mostram quantas torres estão de pé e em quantos turnos ela atira (`faction.tower.nextFireIn`), dado público.

### Mutadores

`new Match({ seed, mutators: ['mare', 'neblina'] })`; `view.mutators` mostra os ativos.

- **`mare`**: a cada 6 turnos da partida a água sobe e cobre a margem (linha 0) dos dois campos por 2 turnos (turnos 5–6, 11–12…; `tideAt`). Tiro direto numa célula submersa é **recusado** (`submerged`): não gasta o turno e a recusa depende só de dados públicos, então não revela nada. Tiros de área (bombardeio, cruz, rajada) passam pela água sem revelar nada (`result: 'submerged'`), **exceto o anfíbio**, que nada exposto e é atingido normalmente; o radar também passa a contar anfíbios. Escudos não mudam. Se só sobraram células submersas, o tiro é aceito e some na água. A vista avisa: `mutators.tide.turnsUntilRise` ("a maré sobe em 2 turnos").
- **`tiro-duplo`**: dois tiros por turno, acertando ou não, e nenhum tiro extra (`turnState.shotsLeft`).
- **`neblina`**: erros (terra e rocha) somem do seu mapa depois de 3 turnos seus (`FOG_FADE_TURNS`); atirar de novo ali gasta o tiro e mostra o mesmo terreno. Acertos não somem.

### Duplas (2 contra 2)

`new TeamMatch({ seed, config: 'full', factions: { blue: 'roma', red: 'grecia' } })`. Decisões de regra:

- Dois times (`blue`, `red`), dois lugares em cada um: `blue-1`, `blue-2`, `red-1`, `red-2` (`SeatId`).
- **Campo e exército compartilhados**: cada time tem um campo e o exército do preset. As peças são divididas entre os parceiros (`splitPieces`): o lugar 1 fica com bunker, antena e gerador (assim a regra do gerador nunca depende do parceiro) e o resto alterna, para cada um ficar com metade. Cada lugar posiciona só as próprias peças (`not-your-piece` para as do parceiro; `autoPlace(seat)` encaixa as suas em volta das do parceiro). A partida começa quando os quatro confirmam.
- **Ordem intercalada**: A1, B1, A2, B2, A1… (`seatForTurn`). Cada turno segue as regras do 1 contra 1 (tiro extra, uma habilidade, um tiro especial).
- **Tudo do time é compartilhado**: energia (+1 a cada turno de um dos parceiros), recargas, escudo, cargas do especial, torre e a inteligência. Habilidades cooperativas: o radar, o espião e a sonda de um parceiro aparecem no mapa do outro.
- **Relógio por jogador**: cada lugar tem reserva, estouros e faltas próprios; quem estoura 3 vezes seguidas (ou 5 no total) perde a partida para o time (`winReason: 'timeout'`). Quedas de conexão ficam com o servidor (estouro ou desistência).
- **Sigilo**: `viewFor(seat)` é a vista do time (o parceiro vê o campo e a inteligência do time, nunca o campo inimigo) mais `doubles` (lugar, parceiro, quem joga, dono de cada peça, relógios). Do time inimigo só aparece se confirmou e o relógio.
- **Log e replay**: o log tem as ações por lugar; `TeamMatch.fromRecord(record)` reproduz o estado exato.

### Desafio diário

`dailyChallenge('2026-10-20')` dá a mesma configuração para todo mundo no mesmo dia UTC: semente (`dailySeed`), modo, mutadores, facção do jogador e do adversário, nível do bot e relógio. `dailyMatchOptions` monta as opções do `Match` (o jogador é azul e começa). Pontuação (`dailyScore`): vitória vale 5000 − 20 por tiro − 1 por segundo (mínimo 1000); derrota vale 25 por célula inimiga destruída; em empate, menos tiros e depois menos tempo. A tabela (`DailyBoard`) é JSON puro: `addDailyResult` guarda o melhor resultado de cada nome, ordenado e limitado a 100; `parseDailyBoard` valida o que vier de fora; `dailyResultFromMatch` lê o resultado de uma partida terminada.

### Campanha

`CAMPAIGN` tem um arco por comandante (todas as facções do roteiro), com 3 partidas cada, todas com o mutador assinatura do arco (Egito: maré; Roma: tiro duplo; Grécia: neblina; as outras pelo arquétipo). As partidas sobem de dificuldade (modo completo contra o exército neutro no nível 2, rápido com poderes contra um rival no nível 3, completo com mais um mutador no nível 4). Desbloqueio: a onda 1 começa aberta, cada partida abre a seguinte do arco e os arcos de uma onda abrem quando 2 arcos da onda anterior estão completos. Estrelas: vitória com até `par` tiros vale 3, até 1,25 × `par` vale 2, qualquer vitória vale 1. O progresso (`CampaignProgress`) é JSON puro e as funções são puras: `newCampaignProgress`, `missionStatus`, `availableMissions`, `recordMission`, `missionMatchOptions`, `campaignStars`, `parseCampaignProgress`.

### Relógio

Nada lê a hora do sistema: o tempo entra por parâmetro.

| Preset (`ClockPresetId`) | Tempo por turno | Reserva |
| --- | --- | --- |
| `relampago` | 10 s | 0 |
| `padrao` | 30 s | 60 s |
| `tranquilo` | 60 s | 120 s |
| `unlimited` | — | — |

- `match.tick(now)` avança o relógio e aplica o que venceu (pode aplicar vários estouros se o tempo pulou muito). Devolve `ClockEvent[]`.
- `match.applyTimeout(player)` aplica um estouro explicitamente (para servidores que já controlam o prazo).
- Estouro: o turno é pulado e conta uma falta. **3 faltas seguidas ou 5 no total** = derrota (`winReason: 'timeout'`). Qualquer tiro zera a sequência. O tempo que passar do turno é descontado da reserva.
- Queda de conexão: `disconnect(player)` congela o relógio do turno; `reconnect(player)` descongela e empurra o prazo. Tolerância de **45 s por queda e 90 s no total**; estourou, `winReason: 'abandon'`. Só vale durante `'playing'`.
- As funções puras estão em `clock` (`timeLeft`, `spendTurn`, `addStrike`, `graceLeft`…), para quem quiser usá-las fora da partida.

## Sigilo

`viewFor(player)` devolve um `PlayerView` em JSON puro:

- `own`: o campo inteiro do jogador (terreno, peças, dano, escudo, energia, habilidades, pendências de posicionamento).
- `enemy.cells`: cada célula inimiga é `hidden`, `spotted` (unidade intacta conhecida), `earth`, `rock` ou `hit`; `role` só aparece em peças destruídas. Células ocultas são idênticas entre si: `{ col, row, state: 'hidden', role: null, shield: false }`.
- `enemy.remaining` (peças de pé por papel, como a lista de frota do Batalha Naval), `enemy.destroyed`, `enemy.unitCellsLeft`, `enemy.energy`, `enemy.shieldActive`.
- `intel`: resultados do próprio radar e espião. `history`: tiros dos dois lados e habilidades (com o resultado oculto quando não é do jogador).
- `enemy.layout` só é preenchido quando a partida termina.

Os testes conferem que a vista de um jogador **não muda** quando só o layout escondido do inimigo muda (inclusive com o inimigo usando habilidades, tiros especiais e torre, com sonda, recusas da maré e bombardeio sobre células submersas) e que ela sobrevive a `JSON.stringify` sem perder nada. `log`, `toRecord()` e `serverState()` contêm os dois layouts e são só para o lado autoritativo.

## Log e replay

Toda ação aceita entra em `match.log` (`LogEntry`, com o instante `at`); ações recusadas não entram. Para reconstruir:

```ts
const copy = Match.fromLog(seed, config, match.log, { clock: 'padrao' });
// ou
const copy2 = Match.fromRecord(JSON.parse(JSON.stringify(match.toRecord())));
```

O replay reproduz o estado exatamente (`serverState()` igual), inclusive estouros de tempo, o sorteio do último tiro do atirador, os tiros especiais, a maré, a neblina e os disparos da torre (que o replay refaz sozinho e confere com as entradas `tower` do log). `toRecord()` guarda `factions` e `mutators` quando existem. `autoPlace` sem semente deriva uma da semente da partida e grava a usada no log. `dailySeed(date)` dá a semente do desafio do dia (mesma para todos no mesmo dia UTC).

## API

| Export | Para quê |
| --- | --- |
| `Match` | partida autoritativa: `place`, `move`, `rotate`, `remove`, `setLayout`, `autoPlace`, `confirm`, `attack`, `useAbility`, `special`, `surrender`, `tick`, `applyTimeout`, `disconnect`, `reconnect`, `viewFor`, `log`, `toRecord`, `fromLog`, `fromRecord`, `serverState`, `piecesOf`, `factionOf`, `mutators` |
| `startAutoMatch(options)` | atalho: posiciona os dois lados e confirma |
| `PRESETS`, `GAME_PRESETS`, `CLASSIC_CONFIG`, `FULL_CONFIG`, `RAPID_CONFIG`, `RAPID_POWERS_CONFIG`, `resolveConfig`, `sizedConfig`, `validateConfig`, `unitCellCount`, `pieceCount` | configurações e modos |
| `ROLES`, `REAR_ROWS`, `rotateShape`, `orientations` | papéis e formatos |
| `ABILITIES`, `ENERGY`, `MAX_EXTRA_SHOTS`, `SHIELD_TURNS`, `REPAIR_GUARD_TURNS` | dados das habilidades |
| `FACTIONS`, `FACTION_IDS`, `FACTION_BUDGET`, `POWER_WEIGHTS`, `factionPower`, `resolveFaction`, `factionsOfWave`, `SPECIAL_SHOTS`, `TOWER_PERIOD` | facções |
| `SHOT_KINDS`, `shotCells` | biblioteca de tiros |
| `MUTATORS`, `MUTATOR_IDS`, `TIDE`, `tideAt`, `DOUBLE_SHOTS`, `FOG_FADE_TURNS` | mutadores |
| `TeamMatch`, `SEATS`, `teamOf`, `partnerOf`, `seatsOf`, `seatForTurn`, `splitPieces`, `seatCells` | duplas 2 contra 2 |
| `dailyChallenge`, `dailyMatchOptions`, `dailyScore`, `dailyResultFromMatch`, `emptyDailyBoard`, `addDailyResult`, `dailyRank`, `parseDailyBoard` | desafio diário |
| `CAMPAIGN`, `campaignMission`, `newCampaignProgress`, `missionStatus`, `availableMissions`, `recordMission`, `missionMatchOptions`, `missionStars`, `campaignStars`, `arcUnlocked`, `parseCampaignProgress` | campanha |
| `LayoutBoard`, `autoPlace`, `candidatesFor`, `buildPieces`, `generateTerrain` | posicionamento puro (usado também pelos bots no próprio campo) |
| `CLOCK_PRESETS`, `resolveClock`, `clock.*` | relógio |
| `createRng`, `hashSeed`, `dailySeed` | aleatoriedade com semente |
| `indexOf`, `coordOf`, `isInside`, `neighbors4`, `block3x3`, `plusShape`, `lineCells`, `cellLabel`, `BANK_ROW` | geometria |

Todas as ações devolvem `{ ok: true, ... }` ou `{ ok: false, error }` (`MatchError`); nenhuma lança exceção por jogada inválida.

### Compatibilidade com o protótipo

`LegacyMatch`, `toLegacyView`, `chooseRandomTarget` e os tipos `UnitType`, `OwnCellView`, `EnemyCellView`, `Revealed`, `LegacyPlayerView`, `LegacyAttackOutcome` mantêm a interface antiga (peças de uma célula `soldier`/`tank`/`tower`). A `LegacyMatch` usa o preset `classic`, posiciona os dois lados sozinha e começa direto em jogo; cada papel é desenhado como um tipo antigo (`LEGACY_UNIT`: recruta → soldado, blindado → tanque, antena → torre…), e um acerto só mostra o tipo depois que a peça inteira cai.

## Testes

```bash
npm test -w @riverfront/core
```
