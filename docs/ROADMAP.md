# Roadmap do Riverfront

Este documento guarda o mapa do projeto: o que já existe, o que está em desenvolvimento e o que vem depois. As facções e os modos novos entram aos poucos, em ondas, para dar tempo de equilibrar cada uma.

Estados: **pronto**, **parcial** (existe, com ressalva anotada) e **planejado**.

## 1. Base do jogo

| Item | Estado |
|---|---|
| Protótipo visual 3D (tabuleiro, rio, explosões, HUD) | pronto |
| Motor de regras: peças com formas, posicionamento, tiro extra, energia e habilidades | pronto |
| Relógio de turno, strikes e reconexão | pronto |
| Bots com 5 níveis e personalidade | pronto (treino contínuo dos bots: planejado) |
| Arte 3D: 9 papéis de unidade e a torre automática, rio vivo, efeitos, sons, temas | pronto |
| Servidor online: 1 contra 1 e duplas por link, amizades, perfil com cor, desafio diário e campanha sincronizada | pronto |
| App de desktop com "Hospedar partida" e instaladores | parcial: Windows gerado e testado; macOS e Linux saem pelo CI, ainda não verificados; instaladores sem assinatura de código |
| Maré (mutador), tiros especiais e torres automáticas | pronto |
| Arte das facções da onda 1 (Egito, Roma, Grécia): peças, rio, retratos, som | pronto |
| Arte das facções da onda 2 (Vikings, Japão, China, Pérsia): peças, rio, retratos, som | pronto |
| Arte das facções da onda 3 (Mongóis, Otomanos, Maias, Astecas, Incas, Celtas, Cartagineses): peças, rio, retratos, som | pronto |
| Arte das facções da onda 4 (Assírios, Babilônios, Árabes, Bizantinos, Indianos, Hunos, Partos, Macedônios, Espartanos): peças, rio, retratos, som | pronto |
| Mecânica das facções (tiros especiais, habilidades, equilíbrio) | pronto (equilíbrio revisto a cada onda) |
| Menu principal, tela de posicionamento, fim de partida, correções de layout | pronto |

## 2. Facções

Cada facção é composta, em dados, por:

1. um **arquétipo de jogo** (informação, defesa, ataque, tempo ou energia);
2. um **tiro especial** e uma habilidade própria;
3. os **9 papéis de unidade** e a **torre automática**, com nomes e silhuetas da cultura (mesma função e mesmo equilíbrio para todos);
4. o **rio da região** e a vida local;
5. um **personagem** (comandante) com retrato e falas.

Todas recebem o mesmo orçamento de poder. A simulação de bots mede se alguma está forte ou fraca demais antes de entrar no jogo. Os personagens usam nomes fictícios e respeitosos, sem caricatura.

### Onda 1 (lançamento)

Arte pronta · mecânica no core pronta

| Facção | Região | Rio | Arquétipo | Marca |
|---|---|---|---|---|
| Egípcios | Egito | Nilo | Informação | Faraós, pirâmides e deuses |
| Romanos | Roma | Tibre | Defesa | Legiões, disciplina e conquistas |
| Gregos | Grécia | Mar Egeu | Ataque | Filosofia, hoplitas e mitologia |

### Onda 2

Arte pronta · mecânica no core pronta

| Facção | Região | Rio | Arquétipo | Marca |
|---|---|---|---|---|
| Vikings (inclui os nórdicos) | Escandinávia | Fiorde | Tempo | Navegação, machados e exploração |
| Japoneses | Japão | Rio de montanha | Informação | Samurais, ninjas e honra |
| Chineses | China | Rio Amarelo | Ataque | Dinastias, dragões e pólvora |
| Persas | Pérsia | Eufrates | Energia | Cavalaria e grandes impérios |

### Onda 3

Arte pronta · mecânica no core pronta

| Facção | Região | Rio | Arquétipo | Marca |
|---|---|---|---|---|
| Mongóis | Mongólia | Rio da estepe | Tempo | Cavalaria e arqueiros montados |
| Otomanos | Anatólia | Bósforo | Ataque | Artilharia e expansão imperial |
| Maias | América Central | Cenote | Informação | Cidades, astronomia e rituais |
| Astecas | México | Lago de Texcoco | Energia | Guerreiros e grandes templos |
| Incas | Andes | Rio de montanha (Urubamba) | Defesa | Engenharia, estradas e montanhas |
| Celtas | Europa Ocidental | Rio com névoa | Informação | Guerreiros tribais e druidas |
| Cartagineses | Norte da África | Porto do Mediterrâneo | Energia | Comércio marítimo e elefantes de guerra |

### Onda 4

Arte pronta · mecânica no core pronta

| Facção | Região | Rio | Arquétipo | Marca |
|---|---|---|---|---|
| Assírios | Mesopotâmia | Tigre | Ataque | Cerco de cidades e exército poderoso |
| Babilônios | Mesopotâmia | Eufrates | Informação | Cidades monumentais e conhecimento |
| Árabes | Península Arábica | Oásis | Tempo | Comércio, cavalaria e expansão |
| Bizantinos | Mediterrâneo Oriental | Bósforo | Defesa | Fortificações e estratégia |
| Indianos | Índia | Ganges | Ataque | Elefantes de guerra e grandes reinos |
| Hunos | Ásia Central e Europa | Rio da estepe | Tempo | Cavalaria rápida e invasões |
| Partos | Pérsia e vizinhança | Rio do planalto | Ataque | Arqueiros montados e cavalaria |
| Macedônios | Macedônia | Rio da Macedônia | Ataque | Falanges e conquistas de Alexandre |
| Espartanos | Grécia | Eurotas | Defesa | Infantaria pesada e disciplina |

Os arquétipos acima são propostas e podem mudar depois dos testes de equilíbrio. Macedônios e Espartanos podem nascer como variantes da facção grega antes de virarem facções próprias.

## 3. Modos de jogo

| Modo | Estado |
|---|---|
| Treino solo, contra bot (5 níveis), 1 contra 1 por link | pronto |
| Desafio diário (mesma seed para todos) | pronto (o servidor refaz a partida, mas a tabela é "por honra": o código é público) |
| Campanha com os comandantes de cada facção | pronto (progresso no aparelho; sincronização opcional com a conta) |
| Mutadores: maré, neblina e tiro duplo | pronto (outros: planejado) |
| **Duplas (2 contra 2)** | pronto (local com bots e online) |
| Torneio e espectador | planejado |

### Duplas (2 contra 2)

Como ficou:

- Campo e exército compartilhados pelo time; cada parceiro posiciona metade das peças.
- Turnos intercalados A1, B1, A2, B2; o parceiro vê o mapa do time, nunca o campo inimigo.
- Energia, recargas e inteligência do time (o radar de um aparece para o outro).
- Emojis só para o parceiro ou para a mesa, provocações com recarga, silenciar e bloquear.
- Relógio por jogador, com faltas próprias; queda de conexão com a mesma tolerância do 1 contra 1.
- Planejado: combinações de facções dentro da dupla com bônus de sinergia.

## 4. Outros jogos da plataforma

O repositório tende a virar uma base para mais de um jogo, reaproveitando motor de partidas, servidor online, amizades, perfil, temas, 3D, sons e bots. As mesmas facções formam um universo compartilhado.

| Jogo | Ideia | Estado |
|---|---|---|
| Batalha automática (estilo auto-battler) | Loja, rodadas e unidades que lutam sozinhas, aproveitando o tabuleiro 3D e as facções | planejado |
| Jogo de cartas por turnos | Regras de ataque e defesa, cartas das facções, partidas online | planejado |

Os dois jogos terão nomes, personagens e arte originais. A mitologia e a história usadas são de domínio público.

## 5. O que falta de fato

- Assinatura de código dos instaladores (Windows e macOS).
- Verificar os instaladores de macOS e Linux numa máquina real.
- Treino contínuo dos bots (hoje os parâmetros são treinados à mão, com `npm run train`).
- Partidas de várias máquinas pela internet em escala (hoje: uma instância, salas em memória).
- Torneio, espectador e os outros jogos da plataforma (auto-battler e cartas).
