# @riverfront/ai

Bots do Riverfront e o treinador. TypeScript puro, roda no navegador e no Node. Os bots recebem **só** o `PlayerView` de `@riverfront/core` (o mesmo JSON que um jogador humano recebe) e as funções puras do core; nunca tocam no estado privado da partida. Toda aleatoriedade vem de uma semente, então a mesma semente repete a mesma partida.

```ts
import { Match } from '@riverfront/core';
import { createBot, playBotTurn, MemoryStorage } from '@riverfront/ai';

const bot = createBot(4, { seed: 7, storage: localStorage }); // ou 'xadrez'
const match = new Match({ seed: 1, config: 'full' });
match.setLayout('red', bot.placeLayout(match.viewFor('red')));
// ...
playBotTurn(match, 'red', bot); // joga o turno inteiro: tiros extras e uma habilidade
bot.gameOver(match.viewFor('red')); // ao fim, para os bots que aprendem
bot.taunt('onWin');
```

## Os cinco

| Nível | Bot | Como joga | Habilidades | Posicionamento |
| --- | --- | --- | --- | --- |
| 1 | Cabo Pipoca | tiro ao acaso; depois de um acerto, 50% de chance de cutucar os vizinhos | nenhuma | desleixado: peças amontoadas |
| 2 | Sargento Rotina | caça em xadrez (paridade) + perseguição: segue linhas de acertos e sonda em volta; varre em volta dos destroços quando o inimigo parece agrupar peças | radar sempre que pode, e vasculha o bloco que acusou algo | evita as bordas |
| 3 | Capitã Neblina | mapa de densidade de probabilidade sobre as peças que restam, coerente com rochas, escudos, radar, espião e regras de posicionamento; supõe que as peças tendem ao centro | espião e bombardeio nos picos de densidade; escudo na peça caçada e reparo com energia sobrando | espalha as peças |
| 4 | Major Xadrez | densidade ajustada pelos hábitos do adversário (mapa de calor salvo no `storage`) | escudo quando uma peça está sendo caçada, bombardeio, espião, radar e reparo com energia sobrando | esconde as peças onde caçadores olham por último e deixa um recruta de isca |
| 5 | General Abismo | Monte Carlo: sorteia layouts inteiros coerentes com tudo que foi revelado (e com os hábitos aprendidos) e atira na célula mais ocupada | escolhe por valor esperado, sem deixar faltar energia para o próximo bombardeio | mistura estilos, foge dos próprios padrões e aprende a ordem em que o adversário procura |

Nenhum nível trapaceia: o teste `a bot cannot tell two matches apart…` confere que a decisão não muda quando só o layout escondido do inimigo muda, e outro confere que o bot decide igual com uma cópia JSON da vista.

Cada perfil (`PROFILES`) tem nome, personalidade e uma fala em pt-BR para cada evento: `onHit`, `onMiss`, `onLostPiece`, `onWin`, `onLose`, `onIdle`.

### Comandantes de facção

`createBot(4, { seed, faction: 'roma' })` faz o bot jogar como o comandante da facção: o nível continua definindo a força, e o nome, a personalidade e as falas vêm do líder (`LEADERS`, `leaderFor`). A onda 1 tem três comandantes fictícios: **Amenkhet, Faraó do Nilo** (Egito), **Caio Valério Serrano, Legado da Legião do Tibre** (Roma) e **Nikandros de Argos, Estratego do Egeu** (Grécia). Cada um tem 6 falas por evento, da mais gentil à mais firme: níveis 1–2 usam as duas primeiras, o 3 as do meio, 4–5 as duas últimas (`tauntTier`). As falas saem de um sorteio próprio e nunca mudam as jogadas. `factionMeta(id)` junta para a interface o nome, região, rio, arquétipo, tiro especial e comandante de qualquer facção.

Todas as 23 facções têm comandante com nome, título e falas (6 por evento), alinhados com a arte do cliente. Onda 2: **Hallvard Steinsson, Jarl do Fiorde** (Vikings), **Kazumori Akihisa, Daimyō do Vale Alto** (Japão), **Wei Jingshan, General da Fronteira** (China) e **Arash Mehrdad, Sátrapa de Susa** (Pérsia). As ondas 3 e 4 ficam em src/leaders-more.ts. Os nomes são fictícios e o tom é respeitoso: imagens da terra, do rio e do jeito de lutar de cada povo, sem caricatura.

### Duplas

`runTeamBotMatch({ seed, config, bots: { 'blue-1': …, 'blue-2': …, 'red-1': …, 'red-2': … } })` joga uma partida 2 contra 2 inteira; `playSeatTurn` joga o turno de um lugar e `placeSeat` posiciona as peças do lugar (o bot planeja o time e fica com a sua parte; se não couber em volta do parceiro, posiciona automaticamente). Cada bot recebe a vista do time, com as peças e a inteligência do parceiro. Os priors treinados vêm de partidas 1 contra 1 e não são usados em duplas.

### Facções, maré e neblina

- **Tiro especial** (`planSpecial`): do nível 2 em diante. O nível 2 usa sempre que pode; do 3 em diante o bot compara com um tiro comum e guarda energia para o próximo bombardeio. Sonda antes de atirar na casa mais provável; tiro certeiro sobre um radar que ainda tem unidade escondida (e o bot liga o radar para isso); rajada, cruz e tiro duplo quando o valor esperado supera o tiro simples; ricochete quando o melhor palpite pode errar.
- **Torre**: o exército inimigo vem de `view.enemy.units`, então a torre entra no mapa de probabilidade (só nas linhas do fundo).
- **Maré**: nenhum bot escolhe célula submersa enquanto houver outra; quando a maré vai subir antes do próximo turno, as casas da margem valem 30% a mais (`tideFactor`). O radar que contou anfíbios é interpretado como tal.
- **Neblina**: do nível 3 em diante o bot lembra dos erros que sumiram do mapa (`ViewMemory`).
- **Reparo**: uma célula reparada fica marcada como provável escudo enquanto o inimigo tiver um escudo ligado.

O teste `a bot cannot tell two matches apart…` também roda com facções e maré.

### Orçamento de raciocínio

`createBot(5, { seed, budget: { samples: 240, maxMs: 60 } })`. `samples` mantém o resultado determinístico; `maxMs` corta pelo relógio (útil num navegador lento, mas aí o resultado depende da máquina). No Node, o nível 5 leva em média 3–5 ms por decisão.

### Aprendizado

`storage` é qualquer objeto com `getItem`/`setItem` (o próprio `localStorage` serve; `MemoryStorage` para testes e simulação). Chaves usadas: `riverfront:xadrez:habits:<preset>`, `riverfront:abismo:habits:<preset>`, `riverfront:abismo:self:<preset>` e `riverfront:abismo:order:<preset>`. O aprendizado só usa o que o jogo mostra: o layout inimigo revelado no fim da partida e os tiros do adversário no histórico.

## Treinador

```ts
import { coach } from '@riverfront/ai';
const advice = coach(match.viewFor('blue'));
advice.heat;        // chance (0..1) de unidade em cada célula inimiga, por índice
advice.best;        // { col, row } recomendado
advice.explanation; // "Atire em F3 (41%). O acerto em F2 ainda não derrubou a peça..."
```

## Simulação

```bash
npm run sim                                  # 200 partidas por confronto, níveis vizinhos, nos 4 modos
npm run sim -- --all                         # todos contra todos
npm run sim -- --games 50 --presets full --pairs 4-5 --out sim/resultado.json
npm run sim -- --factions                    # matriz das facções da onda 1, nível 3 contra nível 3
npm run sim -- --factions all --level 4 --games 200 --mutators mare
```

Cada confronto alterna quem começa e o lado de cada um e mantém um `MemoryStorage` por bot durante o confronto, então os bots que aprendem estudam o adversário. A saída mostra vitórias, win-rate, tiros para vencer e tempo por decisão, e termina com `Ordem L1 < L2 < L3 < L4 < L5: OK` (ou `FALHOU`, com código de saída 1). No modo `--factions`, a tabela mostra quanto a facção da linha vence a da coluna e o win-rate geral, com `Todas as facções entre 45% e 55%: OK/FALHOU`. O `--out` é sempre relativo a este pacote (caminhos absolutos ou com `..` são recusados).

## Treino por autojogo

```bash
npm run train                                # priors + busca de parâmetros + relatório
npm run train -- --generations 3 --games 120 --final 400
npm run train -- --skip-search               # só refaz os priors
```

1. **Priors**: os níveis 4 e 5 jogam entre si em todos os modos e facções; no fim de cada partida o layout revelado e o histórico de tiros (dados públicos) viram dois mapas por modo e facção: onde cada exército costuma deixar as unidades (prior de tiro) e quão cedo os caçadores chegam a cada casa (prior de posicionamento). Salvos em `trained/priors.json`.
2. **Parâmetros**: busca evolutiva (1+λ) nos números do Major Xadrez e do General Abismo (`DEFAULT_PARAMS`, limites em `PARAM_BOUNDS`). A cada geração, mutantes do campeão jogam contra ele; um mutante só vira campeão se vencer com folga. Salvos em `trained/params.json`.
3. **Relatório** (`trained/report.json`): a versão treinada contra os valores feitos à mão e contra a versão treinada anterior, com 400 partidas ou mais por comparação e margem de 95%. Se a nova versão não superar a anterior, os parâmetros antigos ficam.

Cada nível só usa o que venceu com folga no relatório (taxa menos a margem de 95% acima de 50%), registrado em `use` dentro de `trained/params.json`; a versão anterior só é mantida se a nova perder com folga para ela. Resultado da versão atual (v6, 400 partidas por comparação, 4 modos, facções neutra/egito/roma/grécia):

| Nível | Treinado (parâmetros + priors) × padrão | Só priors × padrão | Em uso |
| --- | --- | --- | --- |
| 4 Major Xadrez | **56,0% ± 4,9%** | 57,0% ± 4,9% | parâmetros e priors treinados |
| 5 General Abismo | **57,8% ± 4,8%** | 49,5% ± 4,9% | parâmetros e priors treinados |

Depois do treino a liga continua em ordem nos 4 modos (L1 < L2 < L3 < L4 < L5, 200 partidas por confronto, nenhuma ação recusada); no `rapido` a distância entre L3 e L4 é a menor (56,5%). O nível 5 fica em ~0,7–3,6 ms por decisão em média.

Os bots carregam esses arquivos por padrão; `createBot(5, { seed, trained: false })` joga com os valores originais (útil para comparar). Os mapas aprendidos com o adversário da vez (`storage`) continuam valendo por cima dos priors treinados. Treino e decisão usam só a visão pública.
