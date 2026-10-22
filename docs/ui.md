# Interface do cliente

Como a interface do Riverfront está organizada (`packages/client/src/app` e `packages/client/src/hud`) e as decisões de usabilidade por trás dela.

## Fluxo

```
menu principal ─┬─ Jogar agora / Treino / Contra bot / Desafio diário / Campanha ──► LocalHost (Match + bot)
                ├─ Duplas ──────────────────────────────────────────────────────► LocalTeamHost (TeamMatch + 3 bots)
                └─ 1x1 online / duplas online / Desafiar amigo ──► painel online ─► RemoteHost (servidor)
                                                            │
                         GameController: posicionamento ► batalha ► fim ► revanche / subir nível / menu
```

- `app/matchHost.ts` define o `GameHost`: as jogadas só dizem se foram aceitas; o resultado chega sempre por `onUpdate`. O `LocalHost` usa um relógio virtual (só avança com o jogo rodando, então pausar é simplesmente não avançar) e faz o bot jogar uma decisão por vez. O `RemoteHost` adapta o `RemoteMatchHost` de `net/`.
- `app/game.ts` (`GameController`) anima **a partir do histórico da visão** (`view.history`): tiros, torre, habilidades, tiros especiais, maré e estouros de tempo entram na mesma fila, em ordem, local ou online. Um estado completo (`state`, reconexão) redesenha tudo sem animação. Se o tabuleiro divergir da visão (reparo ou neblina fechando uma célula), ele também redesenha.
- `app/flow.ts` é a máquina de estados pura (`idle → placing → waiting → playing → ended`, com `busy`, `paused`, `offline`, modo de mira e célula armada). É ela que responde "o jogador pode agir agora?".
- `app/placement.ts` envolve o `LayoutBoard` do core: a prévia verde/vermelha e as mensagens de erro usam exatamente as regras que a partida aplica.
- `app/fieldBoard.ts` encaixa campos menores (15 × 5 nos modos rápidos) no tabuleiro 25 × 7, centralizados ao longo do rio; o resto fica escurecido e fora de jogo.
- `app/modes.ts` traduz os presets do menu (clássico, completo, rápido, rápido com poderes) para as configs do core, com relógio padrão de cada um.

## Duplas, desafio diário e campanha

- **Duplas**: escolha do lugar (1 abre e posiciona bunker, antena e gerador; 2 posiciona em volta do parceiro), nível do parceiro e dos adversários, facção de cada time, modo, relógio e variantes. No posicionamento a bandeja só tem as suas peças; as do parceiro aparecem travadas e destacadas em verde-água no tabuleiro, também durante a batalha. O placar e o registro dizem de quem é a vez e quem atirou; energia, recargas e informações são do time; cada lugar tem o seu relógio.
- **Desafio diário**: mostra data, modo, facções, mutadores (com explicação) e o bot do dia. Joga com as mesmas opções de dailyMatchOptions; o bot não usa o aprendizado do aparelho. A pontuação (dailyScore) entra na tabela local; com sessão online o match.log vai para session.submitDaily e a tabela mostrada é a do servidor.
- **Campanha**: mapa dos 23 arcos por onda, com retrato do comandante, mutador assinatura, estrelas e cadeado (2 arcos de uma onda abrem a próxima). A missão mostra a fala do comandante, o briefing, o adversário, os mutadores explicados e o par de tiros para 3 estrelas. O progresso fica no aparelho (CampaignStore de 
et/storage.ts, com try/catch); online há o botão Sincronizar e a missão vencida vai para session.submitMission.
- **Seletor de facção** (hud/factionPicker.ts): as 23 facções do core com retrato do líder, selo pronta / em breve / indisponível vindo do registro da arte, filtros por onda e arquétipo e um cartão com arquétipo, região, rio e tiro especial.
- **Social em duplas online**: no popover de emojis (botão de carinha ou tecla E) há "Só para o parceiro" (emotes com `to: 'team'`), "Silenciar adversários" e "Silenciar parceiro" (`mute` com `who`). As recargas são as mesmas do servidor e os botões ficam desligados enquanto isso; cada botão tem texto sr-only. Emotes do parceiro aparecem do nosso lado com o nome dele.
- **Mutadores no HUD**: o painel de informações lista as variantes ativas e o motivo (escolhidas por você, desafio do dia, assinatura da campanha, definidas pela sala), além dos avisos de maré.

## HUD em grade

O HUD é uma grade CSS com áreas nomeadas (`menu`, `top`, `status`, `left`, `stage`, `right`, `views`, `bottom`, `actions`), então nenhum painel fica por cima de outro. A célula livre `stage` é medida a cada mudança e a câmera é deslocada para ela com `camera.setViewOffset`: o tabuleiro sempre fica centrado no espaço que sobra, inclusive em 812 × 375 e 375 × 812.

| Layout (`hud/layout.ts`) | Quando | Arranjo |
| --- | --- | --- |
| `wide` | paisagem com altura ≥ 520 | registro à esquerda, informações e ações à direita, mensagens embaixo |
| `tablet` | retrato com largura ≥ 600 | painéis acima e abaixo do tabuleiro |
| `phone-portrait` | retrato estreito | placar no topo, ações embaixo; registro e informações viram gavetas |
| `phone-landscape` | paisagem baixa | ações numa coluna à esquerda, bandeja e vistas à direita |

Em telas baixas os avisos curtos (toasts) aparecem no topo, longe do seu campo. Em celulares, na sua vez a câmera se aproxima do campo inimigo; o "modo mira" dá a vista de cima.

## Sobreposição do tabuleiro

`hud/boardOverlay.ts` é um canvas 2D por cima da cena que projeta os cantos das células com a câmera atual: mapa de calor do treinador, prévia de posicionamento, área do radar/bombardeio/espião, anel forte da mira, célula armada (toque), sondas, escudos, células expostas, maré e coordenadas de alto contraste. Os marcadores 3D persistentes (X, losango, explosão) vêm de `board.markResult`.

## Acessibilidade

- Alvos de toque de 44 px com `pointer: coarse`; no toque, o disparo é "tocar a célula e confirmar em Disparar" (configurável).
- Ícones com texto em `sr-only` (nunca `display: none`), sem `aria-label` escondendo valores visíveis; anúncios para leitor de tela na mira por teclado e nos resultados.
- Diálogos com `<dialog>` modal, `aria-modal`, foco preso e Esc; Reiniciar e Desistir pedem confirmação segurando o botão por 1 segundo.
- Cores para daltonismo (par Okabe-Ito do protocolo) e símbolos ✓ ✗ ◆ ⛨ no registro, na dica da célula e sobre os resultados. Nos temas de lava os símbolos ficam ligados, porque o contraste das pedras cai.
- Movimento reduzido (sistema ou configuração): sem trajetórias, sem tremor nem câmera lenta, animações mais rápidas.
- Atalhos: 1/2/3 vistas, R gira, P pausa, M som, H ajuda, Esc cancela; os de uma tecla podem ser desligados.
- Texto mínimo de 12 px; português e inglês completos, troca de idioma na hora.

## Tamanho do campo

Nenhuma tela assume 25 × 7: o controlador, o editor de posicionamento, a sobreposição e o relógio usam iew.config.cols/rows. O tabuleiro 3D tem 25 × 7 fixos, então campos menores (15 × 5 nos modos rápidos) ficam centralizados ao longo do rio por pp/fieldBoard.ts; o resto aparece escurecido e as coordenadas passam para a sobreposição. Campos maiores que 25 × 7 dependem de o tabuleiro aceitar outro tamanho.

## Carregamento

O bundle é dividido: o código do jogo (~420 kB), three.js num pedaço próprio (~620 kB, muda pouco e fica em cache), o registro de facções (~210 kB: kits, retratos, rios), os bots e o treinador e o painel online carregam sob demanda (pp/factionArt.ts, pp/aiLoader.ts, import() do painel). Os menus mostram monogramas até os retratos chegarem.

## Quadros em segundo plano

Alguns navegadores embutidos param os quadros de animação sem marcar a página como oculta. Quando isso acontece, um temporizador avança a partida em passos maiores até os quadros voltarem, para a fila de animações não travar.

## Desempenho

Qualidade automática por padrão: uma medição de FPS de 3 s (`FpsProbe`) escolhe entre alta e baixa e o resultado fica salvo. Em toque o `devicePixelRatio` é limitado a 1,5 e, em toque ou qualidade baixa, os painéis não usam `backdrop-filter`.

## Configurações e dados locais

Tudo numa só chave do `localStorage` (`riverfront.settings`, ver `app/settings.ts`): idioma, tema, qualidade, som, daltonismo, coordenadas, movimento, confirmação de disparo, atalhos, apelido/cor/facção offline, dicas vistas e a última configuração contra o bot. Credenciais e perfil online ficam no `ProfileStorage` de `net/`.

## Testes

`npm test -w @riverfront/client` roda a lógica pura (máquina de estados, relógio, grade e câmera, modos, editor de posicionamento, partida local inteira contra bot). Também há testes de duplas locais (posicionamento com peças do parceiro travadas e partida inteira com 3 bots) e das opções do desafio e da campanha. Com um servidor rodando, `RIVERFRONT_SERVER=ws://127.0.0.1:8787/ws` liga os testes online: duelo completo, duplas com 4 sessões até o fim e um desafio diário jogado localmente e aceito pelo replay do servidor.
