import { FACTIONS, type DialogueHook, type FactionId } from '@riverfront/core';
import { MORE_PERSONAS } from './leaders-more.ts';
import type { BotLevel, TauntEvent } from './types.ts';

/**
 * Faction commanders the bots can play as. Names are fictional; the tone is
 * proud but friendly. Each event has six lines ordered from gentle to stern:
 * levels 1–2 use the first two, level 3 the middle two, levels 4–5 the last two.
 */
export interface LeaderPersona {
  readonly faction: FactionId;
  readonly name: string;
  readonly title: string;
  readonly personality: string;
  readonly taunts: Readonly<Record<TauntEvent, readonly string[]>>;
  /** Text for the dialogue hooks the core lists in `FactionDef.leader.dialogue`. */
  readonly dialogue: Readonly<Record<DialogueHook, string>>;
}

const leader = (faction: FactionId, rest: Omit<LeaderPersona, 'faction' | 'name' | 'title'>): LeaderPersona => ({
  faction,
  name: FACTIONS[faction].leader.name,
  title: FACTIONS[faction].leader.title,
  ...rest,
});

export const LEADERS: Readonly<Partial<Record<FactionId, LeaderPersona>>> = {
  egito: leader('egito', {
    personality: 'Sereno e paciente como a cheia do Nilo. Observa antes de agir, confia no radar e na sonda e fala por imagens do rio e das estrelas.',
    taunts: {
      onHit: [
        'O Nilo encontrou o seu caminho até você.',
        'Um acerto! Até os escribas vão registrar este.',
        'Como a cheia do rio: previsível para quem observa.',
        'As estrelas apontaram, e eu apenas segui.',
        'Nada escapa ao olhar do Faraó.',
        'Cada acerto é uma pedra a mais na minha pirâmide.',
      ],
      onMiss: [
        'Areia... só areia. O deserto é grande.',
        'Hmm, o rio desviou desta vez.',
        'Uma duna vazia. Anotado nos papiros.',
        'Paciência. O Nilo também demora para subir.',
        'O silêncio da areia me diz onde você não está.',
        'Erros são apenas mapas para o próximo acerto.',
      ],
      onLostPiece: [
        'Ai! Essa peça era tão bonita...',
        'Bem, os construtores farão outra.',
        'Uma perda. O reino segue de pé.',
        'Você tem bons olhos. Respeito isso.',
        'Uma pedra caiu, mas a pirâmide continua.',
        'Lembrarei desse golpe por mil cheias.',
      ],
      onWin: [
        'Vencemos! Que festa às margens do Nilo!',
        'O sol sorriu para nós hoje.',
        'Assim termina mais um capítulo nos papiros.',
        'A paciência do rio venceu a pressa.',
        'Está escrito: o Faraó do Nilo prevalece.',
        'Seu nome será lembrado... como o de quem tentou.',
      ],
      onLose: [
        'Você jogou muito bem. Parabéns, de verdade!',
        'Até os faraós aprendem algo novo.',
        'O rio baixou hoje. Ele sempre volta a subir.',
        'Uma boa lição. Os escribas vão registrar.',
        'Venceu desta vez. O Nilo tem boa memória.',
        'Aproveite a vitória. A próxima cheia é minha.',
      ],
      onIdle: [
        'Sem pressa... mas o sol está se pondo.',
        'Quer ajuda para escolher? Brincadeira!',
        'O Nilo não espera para sempre.',
        'As areias do tempo continuam caindo.',
        'Um faraó sabe esperar. Mas não eternamente.',
        'Hesitação é um luxo de quem já perdeu.',
      ],
    },
    dialogue: {
      intro: 'Bem-vindo às margens do Nilo. Aqui, quem observa melhor vence.',
      victory: 'O rio seguiu o seu curso, como sempre.',
      defeat: 'A cheia volta todo ano. Eu também voltarei.',
      special: 'Que a sonda revele o que a areia esconde.',
    },
  }),
  roma: leader('roma', {
    personality: 'Disciplinado e firme, fala como quem comanda uma legião. Prefere segurar a linha, proteger o bunker e responder com precisão.',
    taunts: {
      onHit: [
        'Acertei! O treino deu resultado.',
        'Mais um passo da legião.',
        'Disciplina acerta onde a sorte falha.',
        'Avançar, manter a formação, acertar.',
        'A legião não erra duas vezes o mesmo alvo.',
        'Todos os caminhos levam até as suas peças.',
      ],
      onMiss: [
        'Ops, terreno vazio. Seguimos marchando.',
        'Nada aqui. Próxima posição!',
        'Reconhecimento feito. Ajustar a mira.',
        'Um erro não quebra uma formação.',
        'Cada casa limpa encurta a sua defesa.',
        'Recuar? Nunca. Apenas recalcular.',
      ],
      onLostPiece: [
        'Ai! Perdemos um bravo.',
        'Cerrem as fileiras, pessoal!',
        'Uma baixa. A formação se mantém.',
        'Bom golpe. A legião anota e responde.',
        'Uma coluna caiu; o fórum continua de pé.',
        'Você abriu uma brecha. Vai se arrepender de entrar nela.',
      ],
      onWin: [
        'Vitória! Todo mundo merece um descanso.',
        'Marchamos juntos até o fim!',
        'A disciplina venceu mais uma campanha.',
        'Missão cumprida, como manda o regulamento.',
        'Vim, vi... e você já sabe o resto.',
        'Mais uma província no mapa da legião.',
      ],
      onLose: [
        'Você venceu. Foi uma boa batalha!',
        'Hoje o escudo pesou. Parabéns!',
        'Uma derrota é só um treino mais caro.',
        'A legião aprende com cada campanha.',
        'Roma não foi construída em um dia. Nem a revanche.',
        'Guarde bem esta vitória. A legião voltará.',
      ],
      onIdle: [
        'Tudo bem por aí? A legião espera.',
        'A sopa do acampamento está esfriando!',
        'Uma legião parada é um alvo fácil.',
        'Ordens, comandante? O tempo corre.',
        'O relógio marcha mais rápido que você.',
        'Indecisão perde batalhas antes da primeira lança.',
      ],
    },
    dialogue: {
      intro: 'Escudos unidos, legião! Ninguém atravessa o Tibre sem ser visto.',
      victory: 'A formação aguentou. A vitória é de todos.',
      defeat: 'Hoje recuamos em ordem. Amanhã, avançamos.',
      special: 'Tiro certeiro: onde o radar aponta, a legião acerta.',
    },
  }),
  grecia: leader('grecia', {
    personality: 'Estrategista curioso e ousado, mistura filosofia com o barulho das ondas do Egeu. Ataca em rajadas e confia na torre para vigiar o campo.',
    taunts: {
      onHit: [
        'Acertei! Até Atena aplaudiria.',
        'Como uma onda do Egeu: certeira.',
        'A falange avança, uma casa por vez.',
        'Lógica e coragem: a combinação perfeita.',
        'Minha torre vê o que seus olhos escondem.',
        'Cada acerto é um verso na epopeia que escrevo.',
      ],
      onMiss: [
        'Errei! Os filósofos chamariam de experiência.',
        'Só o mar e as pedras por aqui.',
        'Uma pergunta respondida: aqui não é.',
        'Errar faz parte do método. Continuemos.',
        'Até o oráculo precisa de algumas tentativas.',
        'O vazio também fala, e ele me diz onde procurar.',
      ],
      onLostPiece: [
        'Oh, não! Ele era tão valente...',
        'Os poetas vão cantar sobre ele.',
        'Uma perda digna de tragédia.',
        'Bem jogado. Mas a falange não se dispersa.',
        'Um hoplita cai; dez erguem os escudos.',
        'Você despertou a fúria do Egeu.',
      ],
      onWin: [
        'Vitória! Uma coroa de louros para todos!',
        'Que os jogos celebrem esta batalha!',
        'A estratégia venceu, como ensinam os mestres.',
        'Uma vitória digna de estátua na ágora.',
        'Os deuses do Olimpo assistiram e aprovaram.',
        'Esta campanha será contada por gerações.',
      ],
      onLose: [
        'Você venceu! Que partida bonita.',
        'Aprendi algo hoje. Isso já é vitória.',
        'Até heróis perdem batalhas na epopeia.',
        'Uma derrota que vale uma boa reflexão.',
        'O mar recua antes da próxima onda.',
        'Saboreie a vitória. O Egeu não esquece.',
      ],
      onIdle: [
        'Pensando na vida? Os filósofos também.',
        'Quer um tempo para refletir? Tudo bem.',
        'A ágora inteira espera o seu lance.',
        'Pensar é bom. Agir é melhor.',
        'Nem a tartaruga do paradoxo demorava tanto.',
        'O tempo, como o mar, não espera por ninguém.',
      ],
    },
    dialogue: {
      intro: 'Que comece a batalha! A torre já vigia o seu campo.',
      victory: 'Louros para a falange e para a torre!',
      defeat: 'Uma tragédia em um ato. A próxima será epopeia.',
      special: 'Rajada! Três golpes, uma só ideia.',
    },
  }),
  vikings: leader('vikings', {
    personality: 'Navegador franco e bem-humorado, fala de mar, vento e longas viagens. Gosta de agir rápido e de ver o jogo virar em poucos lances.',
    taunts: {
      onHit: [
        'Acertei! O vento estava a meu favor.',
        'Bela remada, essa!',
        'Como um machado na lenha: direto ao ponto.',
        'O fiorde sempre devolve o que é dele.',
        'Nenhuma costa fica escondida do meu barco.',
        'Cada acerto é mais uma vela no horizonte.',
      ],
      onMiss: [
        'Só água fria por aqui.',
        'Errei, mas a viagem continua!',
        'O nevoeiro enganou meus olhos.',
        'Um bom navegador corrige o rumo.',
        'O mar é grande, mas eu tenho paciência.',
        'Cada erro mostra onde não ancorar.',
      ],
      onLostPiece: [
        'Ai! Lá se foi um bom remador.',
        'Tudo bem, o salão ainda está cheio.',
        'Uma perda. O barco segue firme.',
        'Golpe honesto. Respeito.',
        'Um escudo quebrou; a parede de escudos não.',
        'Agora você acordou o fiorde.',
      ],
      onWin: [
        'Vitória! Hoje tem festa no salão!',
        'Chegamos ao porto em segurança!',
        'O vento e a coragem venceram juntos.',
        'Uma viagem bem planejada sempre chega.',
        'Os cantores vão lembrar desta batalha.',
        'Mais uma costa no mapa do Jarl.',
      ],
      onLose: [
        'Você venceu! Que travessia bonita.',
        'Hoje o mar estava do seu lado.',
        'Até os melhores barcos encalham às vezes.',
        'Boa batalha. Vou estudar a maré.',
        'O inverno passa. Eu volto na primavera.',
        'Guarde bem esse dia. O fiorde não esquece.',
      ],
      onIdle: [
        'Sem pressa, o mar espera um pouco.',
        'Vai remar ou vai olhar a paisagem?',
        'O vento muda enquanto você pensa.',
        'Um Jarl decide rápido.',
        'A maré não espera por ninguém.',
        'Quem demora demais perde a corrente.',
      ],
    },
    dialogue: {
      intro: 'Velas ao vento! Vamos ver quem conhece melhor estas águas.',
      victory: 'O fiorde recebe seus navegadores de volta.',
      defeat: 'Voltaremos com a próxima maré.',
      special: 'Machados no ar: dois golpes de uma vez!',
    },
  }),
  japoneses: leader('japoneses', {
    personality: 'Calmo e cortês, valoriza a observação e a paciência. Prefere conhecer o campo antes de agir e fala com imagens das montanhas e das estações.',
    taunts: {
      onHit: [
        'Um acerto. Que bom.',
        'A paciência deu frutos.',
        'Como a flor que se abre na hora certa.',
        'Observei com calma, e o alvo apareceu.',
        'Nada se esconde no vale por muito tempo.',
        'O golpe certo vem de um olhar atento.',
      ],
      onMiss: [
        'Ah, aqui não. Tudo bem.',
        'Só a neblina da montanha.',
        'Um passo a menos no caminho.',
        'O erro também ensina.',
        'O vazio me mostra onde procurar.',
        'Cada casa vazia aproxima o fim.',
      ],
      onLostPiece: [
        'Oh... uma perda triste.',
        'Ele lutou com honra.',
        'Uma perda. O vale permanece.',
        'Golpe bem dado. Eu reconheço.',
        'Um galho cai; a árvore continua de pé.',
        'Agora jogarei com mais atenção ainda.',
      ],
      onWin: [
        'Vencemos. Obrigado pela partida.',
        'Que bela batalha tivemos.',
        'A calma venceu a pressa.',
        'Como as estações: tudo chega a seu tempo.',
        'O vale está em paz novamente.',
        'Uma vitória conquistada com disciplina.',
      ],
      onLose: [
        'Você jogou muito bem. Parabéns.',
        'Aprendi algo valioso hoje.',
        'Até o rio contorna a pedra.',
        'Uma derrota digna. Vou refletir.',
        'A montanha espera a próxima estação.',
        'Lembrarei desta lição com respeito.',
      ],
      onIdle: [
        'Pense com calma, sem pressa.',
        'Quer um pouco mais de tempo?',
        'O silêncio também é uma jogada.',
        'Até a paciência tem limite.',
        'A estação está mudando.',
        'Hesitar por muito tempo também é escolher.',
      ],
    },
    dialogue: {
      intro: 'Bem-vindo ao vale. Que seja uma partida justa.',
      victory: 'A montanha observou e aprovou.',
      defeat: 'Uma lição recebida com gratidão.',
      special: 'O batedor volta com notícias.',
    },
  }),
  chineses: leader('chineses', {
    personality: 'Estrategista experiente e metódico, cita a importância do terreno e da preparação. Usa a pólvora com cuidado e pensa várias jogadas à frente.',
    taunts: {
      onHit: [
        'Acertei! Muito bem.',
        'O plano está funcionando.',
        'Conhecer o terreno é meio caminho andado.',
        'A preparação sempre aparece no resultado.',
        'A fronteira inteira já sabe onde você está.',
        'Cada acerto é um passo da estratégia.',
      ],
      onMiss: [
        'Ops, só terra aqui.',
        'Nada por aqui. Seguimos.',
        'Uma posição a menos para verificar.',
        'O bom general aprende com o terreno.',
        'O vazio também é informação.',
        'Cada erro estreita o seu esconderijo.',
      ],
      onLostPiece: [
        'Ah, perdemos um soldado.',
        'Reorganizem a linha!',
        'Uma perda. A muralha resiste.',
        'Golpe preciso. Vou responder à altura.',
        'Uma torre caiu; a fronteira não.',
        'Agora a pólvora vai falar.',
      ],
      onWin: [
        'Vencemos! Bom trabalho, tropa!',
        'Uma campanha bem conduzida.',
        'A estratégia venceu, como deve ser.',
        'Tudo saiu conforme o planejado.',
        'A fronteira está segura mais uma vez.',
        'Esta vitória vai para os registros.',
      ],
      onLose: [
        'Você venceu. Parabéns!',
        'Hoje o terreno era seu.',
        'Até os grandes generais recuam.',
        'Boa partida. Vou rever o plano.',
        'Recuar hoje para avançar amanhã.',
        'Guarde a vitória. A fronteira lembra.',
      ],
      onIdle: [
        'Pode pensar, mas não durma.',
        'Um plano precisa de ação também.',
        'O tempo também é um recurso.',
        'Um general decide no momento certo.',
        'A janela da oportunidade se fecha.',
        'Indecisão perde batalhas.',
      ],
    },
    dialogue: {
      intro: 'O terreno está estudado. Que comece a campanha.',
      victory: 'A preparação venceu mais uma vez.',
      defeat: 'Um novo plano já está em andamento.',
      special: 'Pólvora pronta: cuidado com a cruz!',
    },
  }),
  persas: leader('persas', {
    personality: 'Governante elegante e confiante, fala de estradas, cavalaria e da riqueza do império. Gosta de acumular energia e gastá-la num golpe grande.',
    taunts: {
      onHit: [
        'Acertei! Que alegria.',
        'A cavalaria chegou na hora.',
        'Como mensagem pela estrada real: rápida e certa.',
        'O império enxerga longe.',
        'Nada escapa aos olhos de Susa.',
        'Cada acerto enche o tesouro da vitória.',
      ],
      onMiss: [
        'Só areia do caminho.',
        'Errei! A estrada é longa.',
        'Um oásis vazio. Seguimos.',
        'O cavaleiro paciente acha o alvo.',
        'O vazio também paga tributo.',
        'Cada erro desenha melhor o mapa.',
      ],
      onLostPiece: [
        'Ah! Um bom cavaleiro se foi.',
        'O império tem muitos braços.',
        'Uma perda. As estradas continuam abertas.',
        'Golpe digno. Eu reconheço.',
        'Uma coluna caiu; o palácio continua.',
        'Agora a cavalaria inteira vai avançar.',
      ],
      onWin: [
        'Vitória! Um banquete para todos!',
        'A estrada real levou à vitória.',
        'Energia bem guardada, golpe bem dado.',
        'Uma vitória digna de Susa.',
        'O império se estende mais um pouco.',
        'Esta vitória entra para os anais.',
      ],
      onLose: [
        'Você venceu! Muito bem jogado.',
        'Hoje a estrada foi sua.',
        'Até impérios conhecem dias difíceis.',
        'Boa partida. Vou reunir os conselheiros.',
        'A cavalaria volta mais forte.',
        'Aproveite. Susa tem memória longa.',
      ],
      onIdle: [
        'Sem pressa, mas o chá está esfriando.',
        'Quer conselho? Brincadeira!',
        'As estradas esperam o seu lance.',
        'Um sátrapa decide com firmeza.',
        'A caravana não para por ninguém.',
        'Hesitar custa caro no império.',
      ],
    },
    dialogue: {
      intro: 'Bem-vindo a Susa. As estradas levam todos até mim.',
      victory: 'O império celebra mais uma conquista.',
      defeat: 'A estrada continua. Nos veremos de novo.',
      special: 'Carga de cavalaria! Se errar, ela volta.',
    },
  }),
  // Waves 3 and 4: text lives in leaders-more.ts.
  ...Object.fromEntries(
    Object.entries(MORE_PERSONAS).map(([faction, text]) => [faction, leader(faction as FactionId, text!)]),
  ),
};

/** Commander persona of a faction (every faction except the neutral army). */
export function leaderFor(faction: FactionId | undefined): LeaderPersona | null {
  return faction ? (LEADERS[faction] ?? null) : null;
}

/** Lines a level may use: gentle at 1–2, firm at 3, stern at 4–5. */
export function tauntTier(level: BotLevel): readonly [number, number] {
  return level <= 2 ? [0, 1] : level === 3 ? [2, 3] : [4, 5];
}

/** Everything a UI needs to present a faction and its commander. */
export interface FactionMeta {
  readonly id: FactionId;
  readonly name: string;
  readonly region: string;
  readonly river: string;
  readonly archetype: string | null;
  readonly wave: number;
  readonly brand: string;
  readonly special: { readonly id: string; readonly name: string; readonly kind: string; readonly description: string } | null;
  readonly leader: { readonly name: string; readonly title: string; readonly personality: string | null; readonly hasPersona: boolean };
}

export function factionMeta(id: FactionId): FactionMeta {
  const f = FACTIONS[id];
  const persona = LEADERS[id];
  return {
    id,
    name: f.name,
    region: f.region,
    river: f.river,
    archetype: f.archetype,
    wave: f.wave,
    brand: f.brand,
    special: f.specialShot
      ? { id: f.specialShot.id, name: f.specialShot.name, kind: f.specialShot.kind, description: f.specialShot.description }
      : null,
    leader: { name: f.leader.name, title: f.leader.title, personality: persona?.personality ?? null, hasPersona: persona !== undefined },
  };
}
