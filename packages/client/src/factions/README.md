# Facções

Cada facção é um **pacote de dados** que veste o jogo: as 9 peças e a torre automática, o rio da região com a sua vida e os seus enfeites, a luz e o solo do tabuleiro, o som e o comandante com retrato. O motor de regras não muda; o que muda é a cara de cada papel.

```
factions/
  types.ts          tipos de dados (FactionDef e companhia)
  registry.ts       lista de facções, applyFaction, factionTheme, leaderPortrait
  portrait.ts       retratos 2D procedurais (5 expressões)
  kit/              silhuetas genéricas dos 10 papéis, vestidas por parâmetros (squad.ts: formações)
  wave1/            peças feitas à mão da onda 1 (Obelisco, Barca Solar, Torre de Vigia...)
  wave2/            peças feitas à mão da onda 2 (Drakkar, Casa Comprida, Torre do Castelo, Torii, Pagode, Muralha, Portal de Persépolis, Cavalaria...)
  data/wave1.ts     Egito, Roma e Grécia
  wave3/            peças feitas à mão da onda 3 (Acampamento de Gers, Canhão Gigante, Observatório, Templo Duplo, Muralha Encaixada, Círculo de Pedras, Elefante de Guerra...)
  data/wave2.ts     Vikings, Japão, China e Pérsia
  data/wave3.ts     Mongóis, Otomanos, Maias, Astecas, Incas, Celtas e Cartagineses (feitas com plan(), como as planejadas)
  wave4/            peças feitas à mão da onda 4 (Portão dos Lamassu, Porta de Ishtar, Jardins Suspensos, Forte do Oásis, Astrolábio, Muralhas de Teodósio, Sifão de Fogo, Elefante com howdah, Palácio dos Chhatris, Círculo de Carroças, Tiro Parto, Portal de Ctesifonte, Helépolis, Muralha de Escudos, Ágora...)
  data/wave4.ts     Assírios, Babilônios, Árabes, Bizantinos, Indianos, Hunos, Partos, Macedônios e Espartanos
  data/planned.ts   o construtor plan() e a lista de facções só com dados (vazia hoje; novas facções começam aqui)
```

## Como usar

```ts
import { applyFaction, leaderPortrait, FACTIONS } from './factions/registry';

applyFaction('egito', themeDirector);                                   // ambiente + os dois exércitos
applyFaction('roma', themeDirector, { environment: false, teams: ['red'] }); // só o exército vermelho
board.reset(); /* e recolocar as peças: as que já existem mantêm o modelo antigo */

const canvas = leaderPortrait(FACTIONS.egito!, 'taunt', 256);           // neutral | taunt | hit | win | lose
```

`themeDirector.setTheme('vale' | 'vulcao' | 'tundra')` continua funcionando e desfaz as peças por time. `sound.play('motif')` toca o tema musical da facção ativa; a vitória usa a versão longa.

## Como adicionar uma facção (checklist)

1. **Entrada de dados** em `data/planned.ts` (com `plan({...})`) ou num arquivo novo. Preencha:
   - `id`, `name`, `people`, `region`, `wave`, `archetype`, `brand`;
   - `palette`: `primary`, `secondary`, `accent`, `stone`, `wood`, `skin` (e `metal`/`cloth` se quiser). As **regras de cor de time** (`team`) dizem quais superfícies recebem a cor do time; mantenha pelo menos túnica (`cloth`) ou escudo (`shield`) com cor de time, para o jogador reconhecer o lado de longe;
   - `motifs`: telhado, coluna, ornamento e estandarte;
   - `kit`: capacete, arma, escudo, arco, veículo, máquina de cerco, torre, fortaleza, barco, vela, santuário e oficina (ver os tipos em `types.ts`);
   - `river`: nome, duas cores de água (`deep`, `shallow`), extras (`flow`, `clarity`, `chop` para mar), `bankProps` e `soil`;
   - `species`: animais do rio já existentes (lista em `board/wildlife/shared.ts`);
   - `names`: os nomes das peças, na ordem recruta, atirador, blindado, artilharia, antena, bunker, anfíbio, gerador, oficina e torre (sem o décimo, a torre se chama "Torre");
   - `leader`: nome **fictício**, título e parâmetros do retrato (pele, cabelo, barba, cobertura de cabeça);
   - `music`: estilo (`pluck`, `lyre`, `brass`, `flute`, `drum`, `bell`, `horn`), nota base, escala e frase.
2. **Abra a galeria** com `?faction=<id>` e confira: peças de perto (botões "Mosaico"), destruição de cada papel, vida do rio, retratos e o tema musical. Em "Verificação rápida" há uma folha com todas as facções prontas lado a lado (tabuleiros ou peças) e um relatório no console que constrói e destrói todas as peças de todas as facções e avisa sobre erros, geometria quebrada ou peças pesadas demais.
3. **Peças próprias (opcional)**: escreva uma fábrica `(kit) => UnitFactory` como as de `wave1/` e `wave2/` e ligue em `unitSkins[papel].factory`. Atalhos do kit: `kitRecruit(k, { backBanner, extras })` para o soldado com bandeira nas costas ou peças extras, `kitSquad(k, {...})` para formações (falange, muralha de escudos, ashigaru, guerreiros jaguar), `kitCavalry(k, { arms: 'spear' | 'bow' })` para lanceiros ou arqueiros montados e `kitBunker(k, estilo)`. A torre automática (papel `tower`) também aceita peça própria (ex.: Torre de Vigia do Forte dos árabes).
   Templos e figuras religiosas só aparecem como paisagem nas margens (`bankProps`), nunca como peça destrutível. Reaproveite `kit/pieces.ts` e as funções de movimento de `units/models/motion.ts`; toda peça precisa de `idle` e `wreck`, e a pegada (células) do papel não muda.
4. **Bicho ou enfeite novo (opcional)**: módulo em `board/wildlife/` registrado em `controller.ts` (e o id em `AmbientSpecies`), ou um tipo novo em `board/bankProps.ts`. Enfeites ficam fora das células: no raso, nas bocas do rio sobre a moldura ou na mesa além das pontas.
5. Quando a facção tiver peças-assinatura, rio, retrato e som, troque `status` para `'pronta'` e mova a entrada para um arquivo de onda (como `data/wave2.ts`).

## Cuidados

- Nomes de comandantes são inventados; nada de caricatura, exagero de traços ou zombaria religiosa. Templos e altares aparecem com respeito, como lugares que o exército protege; nunca use um edifício religioso como arma.
- Mesoamericanos e andinos não tinham carros com rodas nem cavalos: o blindado deles é uma liteira (`armor: 'litter'`).
- Minaretes e cúpulas de mesquita aparecem só como paisagem da cidade na margem, nunca como peças que se destroem; os Astecas não mostram sangue nem sacrifício.
- Tudo é procedural: nada de imagens, fontes ou sons baixados.

## Estado

| Onda | Facções | Estado |
|---|---|---|
| 1 | Egito, Roma, Grécia | pronta |
| 2 | Vikings (inclui os nórdicos), Japão, China, Pérsia | pronta |
| 3 | Mongóis, Otomanos, Maias, Astecas, Incas, Celtas, Cartago | pronta |
| 4 | Assíria, Babilônia, Arábia, Bizâncio, Índia, Hunos, Pártia, Macedônia, Esparta | pronta |

São 23 facções no registro, todas prontas: o roadmap lista Vikings e Nórdicos como uma só e Espartanos uma vez. "Pronta" diz respeito só à arte; tiros especiais e habilidades vêm do core.
