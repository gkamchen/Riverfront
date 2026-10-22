import type { BotId, BotProfile } from './types.ts';

export const PROFILES: Readonly<Record<BotId, BotProfile>> = {
  pipoca: {
    id: 'pipoca',
    level: 1,
    name: 'Cabo Pipoca',
    personality: 'Afobado e barulhento, atira no primeiro lugar que vê. Às vezes lembra de olhar em volta de um acerto.',
    taunts: {
      onHit: 'Pipoquei! Acertei sem nem mirar!',
      onMiss: 'Ué, cadê? Juro que tinha alguém aí...',
      onLostPiece: 'Ei! Esse era o meu favorito!',
      onWin: 'Ganhei?! Alguém filma isso, por favor!',
      onLose: 'Tá, tá... da próxima eu pipoco melhor.',
      onIdle: 'Vai jogar ou vai esperar o milho estourar?',
    },
  },
  rotina: {
    id: 'rotina',
    level: 2,
    name: 'Sargento Rotina',
    personality: 'Metódico, varre o campo em xadrez e persegue cada acerto até o fim. Liga o radar sempre que a energia deixa.',
    taunts: {
      onHit: 'Alvo confirmado. Prosseguindo com o protocolo.',
      onMiss: 'Setor limpo. Próxima casa da grade.',
      onLostPiece: 'Baixa registrada. A rotina continua.',
      onWin: 'Missão cumprida dentro do cronograma.',
      onLose: 'Relatório: o protocolo precisa de revisão.',
      onIdle: 'O regulamento recomenda agilidade, recruta.',
    },
  },
  neblina: {
    id: 'neblina',
    level: 3,
    name: 'Capitã Neblina',
    personality: 'Calculista e silenciosa, enxerga probabilidades onde os outros veem névoa. Manda o espião e o bombardeio para os pontos mais quentes.',
    taunts: {
      onHit: 'A névoa nunca esconde nada por muito tempo.',
      onMiss: 'Só um véu de terra. Já sei para onde olhar.',
      onLostPiece: 'Interessante. Você enxerga melhor do que eu supunha.',
      onWin: 'Quando a névoa baixou, você já tinha perdido.',
      onLose: 'Hoje a neblina estava do seu lado.',
      onIdle: 'Pense o quanto quiser. As chances não mudam.',
    },
  },
  xadrez: {
    id: 'xadrez',
    level: 4,
    name: 'Major Xadrez',
    personality: 'Estrategista paciente: estuda onde você costuma esconder as peças, arma iscas e escolhe a hora certa do escudo e do reparo.',
    taunts: {
      onHit: 'Previsível. Você sempre escolhe as mesmas casas.',
      onMiss: 'Uma isca. Exatamente onde eu queria você.',
      onLostPiece: 'Peça sacrificada. Faz parte do plano.',
      onWin: 'Xeque-mate. Estudei você por várias partidas.',
      onLose: 'Bela partida. Vou anotar cada lance seu.',
      onIdle: 'Um bom lance pede tempo, mas não a eternidade.',
    },
  },
  abismo: {
    id: 'abismo',
    level: 5,
    name: 'General Abismo',
    personality: 'Frio e insondável. Simula centenas de campos possíveis antes de cada tiro, gasta energia com precisão e nunca repete um padrão.',
    taunts: {
      onHit: 'Eu já tinha visto esse tiro centenas de vezes antes de dispará-lo.',
      onMiss: 'Uma possibilidade a menos. O abismo se estreita.',
      onLostPiece: 'Irrelevante. Todas as linhas ainda levam a você.',
      onWin: 'Não houve sorte. Houve cálculo.',
      onLose: 'Improvável... mas não impossível. Anotado.',
      onIdle: 'O tempo é seu inimigo, não o meu.',
    },
  },
};

export const BOT_IDS: readonly BotId[] = ['pipoca', 'rotina', 'neblina', 'xadrez', 'abismo'];
