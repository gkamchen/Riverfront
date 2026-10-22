# Changelog do @riverfront/core

## 0.4.0 — nomes da arte e ajuste do modo rápido com poderes

- **Nome de exibição das facções** (`FactionDef.name`) agora é o da arte do cliente: Egito, Roma, Grécia, Vikings, Japão, China, Pérsia, Mongólia, Império Otomano, Maias, Astecas, Incas, Celtas, Cartago, Assíria, Babilônia, Arábia, Bizâncio, Índia, Hunos, Pártia, Macedônia, Esparta. Os ids não mudaram.
- **Ajustes por modo** (opcionais, por nome do preset): `SpecialShotDef.modes` troca energia, recarga ou cargas do tiro especial (`specialForMode`); `FactionDef.modes` troca a peça extra e os ajustes de habilidade (`extraPieceFor`, `modifiersFor`). O orçamento continua medido pelos números base do `full`. No `rapido-poderes`: ricochete 3 de energia e recarga 2, tiro duplo 2 e recarga 4, cruz 3 e recarga 3, rajada 2 e recarga 2, sonda recarga 4, e a Grécia mantém o bombardeio mais rápido do modelo de ataque (no campo pequeno o bombardeio é o poder principal).
- **Dados do `full`**: tiro duplo custa 1 de energia (peso 0 no orçamento); Pérsia troca o bombardeio mais barato por radar mais barato e espião mais rápido; China troca energia inicial por radar que vê anfíbios e reforço; Império Otomano troca escudo mais barato por espião mais rápido e reforço; Incas trocam as recargas menores de escudo e reparo por energia máxima +1 e escudo mais rápido. Todas seguem com 10 pontos.
- Arcos da campanha das ondas 2–4 passam a se chamar "Facção: título do comandante".

## 0.3.0 — duplas, desafio diário, campanha e equilíbrio

Tudo aditivo; o `Match` de 1 contra 1 não mudou de interface.

- **Duplas**: `TeamMatch` (2 contra 2) por cima do `Match`: campo, energia e inteligência por time, ordem A1, B1, A2, B2, relógio por lugar, `viewFor(seat)` com o sigilo do time, log e `fromRecord` determinísticos. Novo erro `not-your-piece`.
- **Desafio diário**: `dailyChallenge`, `dailyMatchOptions`, `dailyScore`, tabela `DailyBoard` serializável.
- **Campanha**: `CAMPAIGN` (um arco de 3 partidas por comandante, com mutador assinatura e desbloqueios) e funções puras sobre `CampaignProgress`.
- **Equilíbrio (muda dados)**: a torre passou a valer 6 pontos no orçamento (era 4) e por isso gregos e macedônios perderam o bombardeio mais rápido do modelo de ataque; o tiro certeiro tem recarga 2 (era 3) e o tipo `precise` vale 1,5 ponto (era 2). Todas as facções seguem com 10 pontos.
- **Ondas 2–4 rebalanceadas** pela liga (23 facções): ataque sem desconto no bombardeio, tiro duplo (energia 2, recarga 1) e ricochete (energia 1, recarga 1) mais baratos, pesos double 0,5 e icochet 0 no orçamento; egípcios trocam −1 de recarga no espião por +1 turno de reforço no reparo.
- **Comandantes das ondas 2 a 4** alinhados com a arte (nomes e títulos fictícios dos arquivos de facção do cliente); Hallvard Steinsson (Jarl do Fiorde), Kazumori Akihisa (Daimyō do Vale Alto), Wei Jingshan (General da Fronteira) e Arash Mehrdad (Sátrapa de Susa).
- Removidos os `.js` compilados antigos que estavam em `src/` (não eram importados por nada).

## 0.2.0 — facções, tiros especiais, torre, mutadores e modos rápidos

Tudo é aditivo: os exports antigos continuam com o mesmo nome e uma partida sem `factions`, sem `mutators` e sem `size` segue as regras de antes, **exceto pelos dois ajustes de equilíbrio abaixo**, que valem para todo mundo.

### Mudanças de comportamento (equilíbrio)

- **Espião**: recarga 4 → **5**, e a resposta agora é o tipo de **uma peça sorteada** entre as que cruzam a linha (antes: sempre a mais valiosa). Linha vazia continua voltando `null`. Motivo: no preset `full` o espião barato zerava uma linha de 25 células e, pela ordem de valor, ainda descartava as peças mais valiosas dela. Os egípcios mantêm a versão antiga (`spyRanked`). O resultado traz `ranked: boolean` (`SpyIntel.ranked`, `AbilityOutcome.ranked`).
- **Reparo**: custo 4 → **3**, recarga 6 → **5**, e a peça reparada ganha **reforço** (um escudo de 1 turno inimigo, `REPAIR_GUARD_TURNS`) se nenhum outro escudo estiver ligado. Motivo: contra quem lembra dos acertos (todos os bots e qualquer humano atento) o reparo só devolvia uma célula que levava outro tiro no turno seguinte; agora esse tiro é absorvido. O resultado traz `guardTurns`.

### Novidades

- `MatchOptions.factions` (`{ blue?, red? }`, id ou `FactionDef`), `MatchOptions.mutators` (`'mare' | 'tiro-duplo' | 'neblina'`) e `MatchOptions.size` (`{ cols, rows }`). `MatchRecord` ganhou `factions?` e `mutators?` (registros antigos continuam válidos).
- `Match.special(player, request)` dispara o tiro especial da facção. Novos erros em `MatchError`: `submerged`, `no-special`, `special-used`, `no-charges`, `no-target`. `PlacementError` ganhou `rear-only`.
- Novo papel `tower` (Torre, 1×1, só nas duas linhas do fundo). Só aparece nos exércitos que o trazem (gregos e macedônios no modo com poderes).
- `ShotResult` ganhou `submerged`; `ShotReport.absorbedBy?: 'testudo'`.
- `HistoryEntry` ganhou os tipos `special`, `tower` e `tide` (os dois últimos sem `by` no caso de `tide`: confira `kind` antes de ler `by`).
- `LogEntry` ganhou `special` e `tower`. A entrada `tower` é registrada pela própria partida; no replay ela é só conferida.
- `PlayerView` ganhou campos opcionais: `mutators`, `turnState.specialUsed`, `turnState.shotsLeft`, `own.units`, `own.faction`, `own.energyMax`, `enemy.units`, `enemy.faction`, `intel.probes`. `RadarIntel.amphibians?` diz se a contagem incluiu anfíbios.
- Presets novos em `PRESETS`: `classico` e `completo` (apelidos de `classic` e `full`), `rapido` e `rapido-poderes` (campo 15×5). `FieldConfig.energy?` define a escala de energia do modo. `GAME_PRESETS` lista os modos para menus; `sizedConfig` muda o tamanho do campo de qualquer preset.
- Exports novos: `FACTIONS`, `FACTION_IDS`, `FACTION_BUDGET`, `factionPower`, `resolveFaction`, `SPECIAL_SHOTS`, `TOWER_PERIOD`, `SHOT_KINDS`, `shotCells`, `MUTATORS`, `MUTATOR_IDS`, `tideAt`, `TIDE`, `DOUBLE_SHOTS`, `FOG_FADE_TURNS`, `REPAIR_GUARD_TURNS`, `REAR_ROWS`, `RAPID_CONFIG`, `RAPID_POWERS_CONFIG`, `GAME_PRESETS`, `sizedConfig`.

### O que o servidor e o cliente precisam saber

- A torre dispara **no início do turno do dono**, dentro do `attack`/`special`/`applyTimeout` que passou a vez. O servidor não recebe um evento separado: o tiro aparece no `history` (`kind: 'tower'`) e o novo estado já está na `viewFor`.
- A maré também só aparece no `history` (`kind: 'tide'`) e em `view.mutators.tide`.
- Um tiro direto numa célula submersa é **recusado** (`submerged`) sem gastar o turno e sem registrar nada; a recusa depende só de dados públicos.
- O protocolo hoje só aceita `mode: 'classic' | 'full'`; para os modos rápidos basta aceitar `'rapido' | 'rapido-poderes'` (ou os apelidos) e repassar ao `Match`.
