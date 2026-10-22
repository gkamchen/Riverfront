import type { DialogueHook, FactionId } from '@riverfront/core';
import type { TauntEvent } from './types.ts';

/** Lines of the wave 3 and 4 commanders (names and titles come from the core registry). */
export interface PersonaText {
  readonly personality: string;
  readonly taunts: Readonly<Record<TauntEvent, readonly string[]>>;
  readonly dialogue: Readonly<Record<DialogueHook, string>>;
}

export const MORE_PERSONAS: Readonly<Partial<Record<FactionId, PersonaText>>> = {
  mongois: {
    personality: 'Cavaleiro das pastagens, direto e generoso. Fala de cavalos, vento e horizonte aberto, e gosta de manobras rápidas.',
    taunts: {
      onHit: ['Acertei! O cavalo sabia o caminho.', 'Uma flecha bem solta.', 'Na estepe, quem enxerga longe acerta.', 'O arco não hesita.', 'Nenhum vale esconde você da cavalaria.', 'Cada acerto é mais um galope rumo à vitória.'],
      onMiss: ['Só grama e vento.', 'Errei! A estepe é grande.', 'Uma volta a mais no pasto.', 'O cavaleiro paciente acha a trilha.', 'O vazio me mostra para onde cavalgar.', 'Cada erro fecha o cerco.'],
      onLostPiece: ['Ah, um bom cavaleiro caiu.', 'Os outros seguem galopando!', 'Uma perda. A horda continua.', 'Golpe certeiro. Eu reconheço.', 'Um cavalo para; a manada não.', 'Agora a estepe inteira vai correr atrás de você.'],
      onWin: ['Vitória! Festa no acampamento!', 'Os cavalos voltam felizes.', 'A velocidade venceu mais uma vez.', 'O horizonte é nosso.', 'O vento da estepe cantará esta vitória.', 'Mais uma pastagem para o Cã.'],
      onLose: ['Você venceu! Bela cavalgada.', 'Hoje o vento soprou para você.', 'Até o melhor cavalo tropeça.', 'Boa partida. Vou estudar o terreno.', 'A estepe sempre dá outra chance.', 'Guarde a vitória. A cavalaria volta.'],
      onIdle: ['Sem pressa, o cavalo descansa.', 'Vai cavalgar ou vai acampar?', 'O vento muda enquanto você pensa.', 'Um Cã decide no galope.', 'A estepe não espera por ninguém.', 'Quem para demais vira alvo fácil.'],
    },
    dialogue: { intro: 'O horizonte é largo. Vamos ver quem cavalga melhor.', victory: 'A estepe celebra seus cavaleiros.', defeat: 'O vento muda. Nós também.', special: 'Arqueiros montados: dois disparos de uma vez!' },
  },
  otomanos: {
    personality: 'Comandante cortês e paciente, fala do Bósforo, de canhões e de cidades entre dois mares. Prefere preparar bem antes de golpear.',
    taunts: {
      onHit: ['Acertei! Bom tiro, não?', 'A bombarda falou alto.', 'Preparação e paciência, como sempre.', 'Entre dois mares, nada se esconde.', 'Minha artilharia já conhece o seu campo.', 'Cada acerto é uma muralha a menos.'],
      onMiss: ['Só água do estreito.', 'Errei! Vamos ajustar a mira.', 'Uma posição a menos no mapa.', 'O bom artilheiro corrige o ângulo.', 'O silêncio do tiro também ensina.', 'Cada erro estreita o seu abrigo.'],
      onLostPiece: ['Ah, perdemos um bravo.', 'Reforcem a linha!', 'Uma perda. A cidade resiste.', 'Golpe respeitável.', 'Uma torre caiu; o império não.', 'Agora os canhões respondem.'],
      onWin: ['Vitória! Chá para todos!', 'O Bósforo está calmo de novo.', 'A paciência venceu a pressa.', 'Tudo conforme o plano.', 'Mais uma conquista entre dois mares.', 'Esta vitória entra para as crônicas.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje o estreito foi seu.', 'Até impérios recuam um passo.', 'Boa partida. Vou rever a artilharia.', 'Recuamos hoje para avançar amanhã.', 'Guarde a vitória. O Bósforo lembra.'],
      onIdle: ['Sem pressa, o chá está quente.', 'Quer mais um momento?', 'Os canhões esperam a sua ordem.', 'Um paxá decide com firmeza.', 'A maré do estreito não para.', 'Hesitar custa caro nas muralhas.'],
    },
    dialogue: { intro: 'Bem-vindo ao Bósforo. Que vença o melhor plano.', victory: 'Os dois mares celebram.', defeat: 'O império aprende e volta.', special: 'Bombarda pronta: três golpes em linha!' },
  },
  maias: {
    personality: 'Sábio observador do céu, calmo e preciso. Fala de estrelas, calendários e da água clara do cenote.',
    taunts: {
      onHit: ['Acertei! As estrelas ajudaram.', 'O calendário marcou este dia.', 'Quem lê o céu encontra o alvo.', 'A observação venceu o acaso.', 'Nenhuma sombra escapa ao observatório.', 'Cada acerto é uma estrela no meu mapa.'],
      onMiss: ['Só pedra e água.', 'Errei! O céu estava nublado.', 'Mais uma anotação no códice.', 'Toda observação ensina algo.', 'O vazio também é um sinal.', 'Cada erro afina o meu cálculo.'],
      onLostPiece: ['Ah, que perda triste.', 'A cidade segue de pé.', 'Uma pedra a menos no templo.', 'Golpe preciso. Eu anoto.', 'Uma estrela se apaga; o céu continua.', 'Agora observo você com mais atenção.'],
      onWin: ['Vitória! Que dia bonito.', 'O céu sorriu para nós.', 'O cálculo estava certo.', 'Como previsto no calendário.', 'A cidade das estrelas celebra.', 'Esta vitória ficará gravada em pedra.'],
      onLose: ['Você venceu! Muito bem.', 'Hoje os astros estavam com você.', 'Até o céu muda de ciclo.', 'Boa partida. Vou refazer as contas.', 'O próximo ciclo será meu.', 'Guarde a vitória. O calendário volta.'],
      onIdle: ['Pense com calma.', 'Quer consultar as estrelas?', 'O céu continua girando.', 'Até o calendário avança.', 'O ciclo não espera.', 'Hesitar também é uma escolha.'],
    },
    dialogue: { intro: 'O céu de hoje promete. Vamos jogar.', victory: 'Os astros confirmaram.', defeat: 'Um novo ciclo vai começar.', special: 'O observatório revela o que está oculto.' },
  },
  astecas: {
    personality: 'Líder energética e orgulhosa de sua cidade sobre o lago. Fala de ilhas, jardins flutuantes e guerreiros valentes.',
    taunts: {
      onHit: ['Acertei! Que alegria.', 'A obsidiana corta fundo.', 'O lago revela o que guarda.', 'Força e coragem acertam juntas.', 'Nenhuma ilha esconde você de mim.', 'Cada acerto ergue mais um degrau do templo.'],
      onMiss: ['Só água do lago.', 'Errei! Tudo bem, seguimos.', 'Um jardim vazio.', 'O guerreiro paciente encontra o alvo.', 'O vazio me aponta outro caminho.', 'Cada erro aproxima o próximo golpe.'],
      onLostPiece: ['Ah, perdemos um valente.', 'A cidade continua forte!', 'Uma perda. As ilhas resistem.', 'Golpe digno. Eu respeito.', 'Uma canoa afunda; a frota segue.', 'Agora você despertou a cidade inteira.'],
      onWin: ['Vitória! Festa nas ilhas!', 'O lago brilha para nós.', 'A coragem venceu.', 'Uma vitória digna da cidade.', 'Os templos celebram esta batalha.', 'Mais uma conquista sobre o lago.'],
      onLose: ['Você venceu! Que batalha.', 'Hoje o lago estava do seu lado.', 'Até guerreiros descansam.', 'Boa partida. Vou reunir meus guerreiros.', 'O sol nasce de novo amanhã.', 'Guarde a vitória. A cidade não esquece.'],
      onIdle: ['Sem pressa, a cidade espera.', 'Vai remar ou vai pensar?', 'O sol está mudando de lugar.', 'Uma tlatoani decide com firmeza.', 'O lago não fica parado.', 'Quem hesita perde a batalha.'],
    },
    dialogue: { intro: 'Bem-vindo à cidade do lago. Lute com coragem.', victory: 'As ilhas celebram a vitória.', defeat: 'O sol volta amanhã, e eu também.', special: 'Golpe de obsidiana! Se errar, ele volta.' },
  },
  incas: {
    personality: 'Engenheiro das montanhas, sereno e firme. Fala de estradas, pontes e terraços, e confia em defesas bem construídas.',
    taunts: {
      onHit: ['Acertei! Bom trabalho.', 'A funda não falha.', 'Como pedra bem encaixada.', 'Planejamento acerta onde a pressa erra.', 'Nenhuma montanha esconde você.', 'Cada acerto é um degrau a mais no terraço.'],
      onMiss: ['Só pedra da montanha.', 'Errei! Seguimos a estrada.', 'Um terraço vazio.', 'A boa estrada se faz com paciência.', 'O vazio também orienta.', 'Cada erro firma o próximo passo.'],
      onLostPiece: ['Ah, perdemos um amigo.', 'A estrada continua!', 'Uma perda. A muralha resiste.', 'Golpe firme. Eu reconheço.', 'Uma pedra cai; a muralha fica.', 'Agora a montanha inteira responde.'],
      onWin: ['Vitória! Festa no vale!', 'As quatro direções celebram.', 'A boa construção venceu.', 'Tudo bem encaixado, como deve ser.', 'As montanhas lembrarão desta vitória.', 'Mais uma estrada aberta para nós.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje a montanha foi sua.', 'Até pontes balançam.', 'Boa partida. Vou reforçar a muralha.', 'A montanha espera paciente.', 'Guarde a vitória. As estradas voltam a mim.'],
      onIdle: ['Sem pressa, a montanha espera.', 'Precisa de mais tempo?', 'O sol já cruzou o vale.', 'Um bom líder decide no tempo certo.', 'A estrada não se constrói parada.', 'Hesitar enfraquece a muralha.'],
    },
    dialogue: { intro: 'Das montanhas eu vejo todo o vale. Vamos começar.', victory: 'A construção resistiu, como sempre.', defeat: 'Reforçaremos a muralha.', special: 'Funda certeira: onde o radar aponta, a pedra acerta.' },
  },
  celtas: {
    personality: 'Chefe dos clãs, calorosa e misteriosa. Fala de névoa, colinas e histórias contadas ao redor da fogueira.',
    taunts: {
      onHit: ['Acertei! Que sorte boa.', 'A névoa se abriu na hora certa.', 'As colinas me contaram onde você estava.', 'O olhar do druida não falha.', 'Nenhuma névoa esconde você de mim.', 'Cada acerto vira canção na fogueira.'],
      onMiss: ['Só névoa por aqui.', 'Errei! As colinas enganam.', 'Uma pedra antiga, nada mais.', 'O caminho certo aparece com calma.', 'O vazio sussurra onde procurar.', 'Cada erro afina o meu olhar.'],
      onLostPiece: ['Ah, perdemos um companheiro.', 'Os clãs seguem unidos!', 'Uma perda. A fogueira continua acesa.', 'Golpe bem dado. Respeito.', 'Uma árvore cai; a floresta fica.', 'Agora todos os clãs vão se levantar.'],
      onWin: ['Vitória! Música na fogueira!', 'As colinas celebram.', 'Os clãs unidos venceram.', 'Uma vitória digna de canção.', 'A névoa guardará esta lembrança.', 'Esta batalha será contada por gerações.'],
      onLose: ['Você venceu! Boa batalha.', 'Hoje a névoa protegeu você.', 'Até os heróis das histórias perdem.', 'Boa partida. Vou ouvir os anciãos.', 'A névoa volta toda manhã.', 'Guarde a vitória. Os clãs lembram.'],
      onIdle: ['Pense com calma, a fogueira espera.', 'Quer ouvir uma história enquanto isso?', 'A névoa está subindo.', 'Até a paciência dos clãs acaba.', 'As colinas não esperam para sempre.', 'Hesitar também é uma decisão.'],
    },
    dialogue: { intro: 'Bem-vindo às colinas. Cuidado com a névoa.', victory: 'A fogueira arde mais alto hoje.', defeat: 'A névoa volta, e eu com ela.', special: 'O olhar do druida atravessa a névoa.' },
  },
  cartagineses: {
    personality: 'Almirante experiente e negociador hábil. Fala de portos, rotas e navios carregados, e sabe a hora de investir tudo.',
    taunts: {
      onHit: ['Acertei! Bom negócio.', 'O porto aprovou este tiro.', 'Como carga entregue no lugar certo.', 'Rotas bem planejadas sempre chegam.', 'Nenhuma enseada esconde você.', 'Cada acerto rende lucro para a vitória.'],
      onMiss: ['Só água do porto.', 'Errei! O vento virou.', 'Uma rota vazia.', 'O bom almirante corrige o rumo.', 'O vazio também tem valor.', 'Cada erro mostra a rota certa.'],
      onLostPiece: ['Ah, perdemos um navio.', 'A frota continua!', 'Uma perda. O porto está aberto.', 'Golpe bem dado. Anotado.', 'Um navio afunda; a frota navega.', 'Agora a frota inteira responde.'],
      onWin: ['Vitória! O porto está em festa!', 'Boa viagem para todos!', 'O investimento valeu a pena.', 'Tudo chegou ao destino.', 'O mar celebra Cartago.', 'Mais uma rota para o almirante.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje o mar foi seu.', 'Até o melhor navio enfrenta tempestades.', 'Boa partida. Vou rever as rotas.', 'A frota volta na próxima maré.', 'Guarde a vitória. O porto lembra.'],
      onIdle: ['Sem pressa, a carga espera.', 'Quer negociar mais um tempo?', 'O vento está mudando.', 'Um almirante decide rápido.', 'A maré não espera ninguém.', 'Hesitar custa caro no comércio.'],
    },
    dialogue: { intro: 'Bem-vindo ao porto. Vamos ver quem negocia melhor.', victory: 'O porto celebra o almirante.', defeat: 'A frota volta com a próxima maré.', special: 'Elefantes de guerra! Se errarem, avançam de novo.' },
  },
  assirios: {
    personality: 'Rei severo mas justo, fala de muralhas, cercos e da força organizada. Avança com método, sem pressa e sem recuo.',
    taunts: {
      onHit: ['Acertei! Bom golpe.', 'O aríete abriu caminho.', 'Método vence muralha.', 'A organização acerta o alvo.', 'Nenhuma muralha resiste ao cerco.', 'Cada acerto derruba mais uma pedra.'],
      onMiss: ['Só terra do rio.', 'Errei! O cerco continua.', 'Uma torre vazia.', 'O cerco se faz com paciência.', 'O vazio também revela o terreno.', 'Cada erro aperta o cerco.'],
      onLostPiece: ['Ah, perdemos um soldado.', 'Firmes, todos!', 'Uma perda. O exército avança.', 'Golpe forte. Eu reconheço.', 'Um escudo cai; a linha fica.', 'Agora o cerco será completo.'],
      onWin: ['Vitória! Muito bem, tropa.', 'O rio celebra conosco.', 'O método venceu.', 'Tudo segundo a ordem.', 'As quatro direções ouvem esta vitória.', 'Mais uma cidade nos registros do rei.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje a muralha foi sua.', 'Até reis recuam um passo.', 'Boa partida. Vou reorganizar a tropa.', 'O cerco recomeça amanhã.', 'Guarde a vitória. O rei não esquece.'],
      onIdle: ['Sem pressa, mas sem descuido.', 'Precisa de mais tempo?', 'O cerco não para.', 'Um rei decide com firmeza.', 'O tempo trabalha para quem age.', 'Hesitar abre brechas.'],
    },
    dialogue: { intro: 'As muralhas estão à vista. Que comece o cerco.', victory: 'A ordem prevaleceu.', defeat: 'O exército se reorganiza e volta.', special: 'Aríete! Golpe em cruz.' },
  },
  babilonios: {
    personality: 'Rainha estudiosa e elegante, fala de bibliotecas, tábuas de argila e jardins. Confia no conhecimento acumulado.',
    taunts: {
      onHit: ['Acertei! Que bom.', 'Os registros estavam certos.', 'O conhecimento aponta o caminho.', 'Estudei bem este campo.', 'Nenhum segredo resiste à biblioteca.', 'Cada acerto vira mais uma tábua nos arquivos.'],
      onMiss: ['Só areia do rio.', 'Errei! Vou anotar.', 'Mais uma linha nos registros.', 'Todo erro é uma lição.', 'O vazio também é informação.', 'Cada erro completa o meu mapa.'],
      onLostPiece: ['Ah, que perda.', 'A cidade continua de pé!', 'Uma perda. Os arquivos ficam.', 'Golpe preciso. Anotado.', 'Uma torre cai; a cidade das torres não.', 'Agora estudarei você com todo cuidado.'],
      onWin: ['Vitória! Que dia feliz.', 'Os jardins florescem para nós.', 'O conhecimento venceu.', 'Exatamente como os registros previam.', 'A cidade das torres celebra.', 'Esta vitória será escrita em argila.'],
      onLose: ['Você venceu! Parabéns.', 'Aprendi algo novo hoje.', 'Até as bibliotecas têm lacunas.', 'Boa partida. Vou estudar mais.', 'O conhecimento volta mais forte.', 'Guarde a vitória. Os arquivos lembram.'],
      onIdle: ['Pense com calma.', 'Quer consultar os arquivos?', 'O rio continua correndo.', 'Até o estudo tem hora de acabar.', 'O tempo não espera.', 'Hesitar também fica registrado.'],
    },
    dialogue: { intro: 'Bem-vinda à cidade das torres. Os registros já esperam por você.', victory: 'Os arquivos confirmam a vitória.', defeat: 'Uma lição a mais para a biblioteca.', special: 'Os escribas revelam o que está oculto.' },
  },
  arabes: {
    personality: 'Emir viajante e hospitaleiro, fala de caravanas, estrelas do deserto e oásis. Gosta de rapidez e de boas surpresas.',
    taunts: {
      onHit: ['Acertei! Que alegria.', 'A caravana chegou na hora.', 'As estrelas do deserto guiam bem.', 'Rapidez e atenção acertam juntas.', 'Nenhuma duna esconde você.', 'Cada acerto é mais um oásis no caminho.'],
      onMiss: ['Só areia.', 'Errei! O deserto é grande.', 'Uma duna vazia.', 'O viajante paciente encontra o oásis.', 'O vazio me mostra a rota.', 'Cada erro encurta a viagem.'],
      onLostPiece: ['Ah, perdemos um amigo.', 'A caravana segue!', 'Uma perda. O oásis continua.', 'Golpe bem dado. Respeito.', 'Um camelo para; a caravana não.', 'Agora a caravana inteira avança.'],
      onWin: ['Vitória! Chá e tâmaras para todos!', 'O oásis celebra conosco.', 'A rapidez venceu.', 'Uma viagem bem feita.', 'As estrelas do deserto aprovam.', 'Mais uma rota para o Emir.'],
      onLose: ['Você venceu! Muito bem.', 'Hoje o deserto foi seu.', 'Até a caravana para numa tempestade.', 'Boa partida. Vou rever a rota.', 'A caravana volta amanhã.', 'Guarde a vitória. O deserto lembra.'],
      onIdle: ['Sem pressa, o chá está servido.', 'Quer descansar à sombra?', 'As dunas estão mudando.', 'Um emir decide rápido.', 'A caravana não espera.', 'Quem hesita fica para trás.'],
    },
    dialogue: { intro: 'Bem-vindo ao oásis. Que a viagem seja boa.', victory: 'O oásis celebra a caravana.', defeat: 'A caravana volta com as estrelas.', special: 'Caravana veloz: dois golpes de uma vez!' },
  },
  bizantinos: {
    personality: 'Estrategista calculista e diplomático, fala de muralhas, mosaicos e alianças. Prefere resistir e esperar o momento certo.',
    taunts: {
      onHit: ['Acertei! Muito bem.', 'A estratégia funcionou.', 'Como uma peça certa no mosaico.', 'O plano se cumpre.', 'Nenhuma brecha escapa às muralhas.', 'Cada acerto é mais uma peça do mosaico.'],
      onMiss: ['Só pedra antiga.', 'Errei! Ajustemos o plano.', 'Uma posição vazia.', 'A boa estratégia exige paciência.', 'O vazio confirma o que eu suspeitava.', 'Cada erro completa o desenho.'],
      onLostPiece: ['Ah, uma perda.', 'As muralhas resistem!', 'Uma perda. A cidade continua.', 'Golpe hábil. Eu reconheço.', 'Uma torre cai; as muralhas não.', 'Agora a defesa vira ataque.'],
      onWin: ['Vitória! Muito bem.', 'As muralhas aguentaram.', 'A estratégia venceu.', 'Tudo conforme o plano.', 'A cidade celebra mais uma vitória.', 'Esta vitória vai para os mosaicos.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje a estratégia foi sua.', 'Até muralhas cedem um dia.', 'Boa partida. Vou rever o plano.', 'A cidade se reergue.', 'Guarde a vitória. As muralhas lembram.'],
      onIdle: ['Pense com calma.', 'Precisa de conselho?', 'O tempo corre nas muralhas.', 'Um estratego decide no momento certo.', 'A espera tem limite.', 'Hesitar também abre brechas.'],
    },
    dialogue: { intro: 'As muralhas estão firmes. Que comece a partida.', victory: 'As muralhas resistiram, como sempre.', defeat: 'A cidade se reergue.', special: 'Fogo grego: onde o radar aponta, ele acerta.' },
  },
  indianos: {
    personality: 'Rainha serena e determinada, fala de rios sagrados, palácios e elefantes. Acumula forças e avança em grandes cargas.',
    taunts: {
      onHit: ['Acertei! Que bom.', 'Os elefantes abriram caminho.', 'Como o rio que encontra o mar.', 'Paciência e força acertam juntas.', 'Nenhum palácio esconde você.', 'Cada acerto é mais um passo da carga.'],
      onMiss: ['Só areia da margem.', 'Errei! O rio é largo.', 'Um pátio vazio.', 'A boa carga começa devagar.', 'O vazio também orienta.', 'Cada erro prepara o próximo golpe.'],
      onLostPiece: ['Ah, perdemos um amigo.', 'O reino segue firme!', 'Uma perda. O palácio continua.', 'Golpe forte. Eu respeito.', 'Um elefante cai; a manada avança.', 'Agora a carga inteira virá.'],
      onWin: ['Vitória! Festa no palácio!', 'O rio celebra conosco.', 'A paciência venceu.', 'Uma vitória digna do reino.', 'Os elefantes celebram esta batalha.', 'Esta vitória será lembrada por gerações.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje o rio foi seu.', 'Até grandes reinos enfrentam derrotas.', 'Boa partida. Vou reunir o conselho.', 'O rio continua correndo.', 'Guarde a vitória. O reino lembra.'],
      onIdle: ['Sem pressa, o palácio espera.', 'Quer mais um momento?', 'O rio não para.', 'Uma rani decide com calma e firmeza.', 'O tempo corre como o rio.', 'Hesitar enfraquece a carga.'],
    },
    dialogue: { intro: 'Bem-vindo às margens do rio. Que a batalha seja honrosa.', victory: 'O reino celebra.', defeat: 'O rio continua; eu também.', special: 'Carga de elefantes: três golpes em linha!' },
  },
  hunos: {
    personality: 'Chefe da horda, rápido e imprevisível. Fala de galopes, flechas e campos abertos, e adora surpreender.',
    taunts: {
      onHit: ['Acertei! Rápido, não?', 'A flecha voou certeira.', 'Velocidade é tudo.', 'O ataque rápido não dá chance.', 'Nenhum campo esconde você da horda.', 'Cada acerto é mais um galope.'],
      onMiss: ['Só terra batida.', 'Errei! Mas já volto.', 'Um campo vazio.', 'O cavaleiro rápido tenta de novo.', 'O vazio me mostra a próxima trilha.', 'Cada erro acelera o próximo golpe.'],
      onLostPiece: ['Ah, perdemos um cavaleiro.', 'A horda continua!', 'Uma perda. Seguimos galopando.', 'Golpe rápido. Respeito.', 'Um cavalo cai; a horda corre.', 'Agora a horda inteira vem atrás de você.'],
      onWin: ['Vitória! Que corrida!', 'A horda celebra.', 'A velocidade venceu.', 'Rápido e certeiro, como sempre.', 'Os campos ecoam esta vitória.', 'Mais uma terra para o Senhor da Horda.'],
      onLose: ['Você venceu! Bela partida.', 'Hoje você foi mais rápido.', 'Até a horda para às vezes.', 'Boa partida. Vou rever a rota.', 'A horda volta amanhã.', 'Guarde a vitória. A horda lembra.'],
      onIdle: ['Vamos, vamos!', 'O cavalo está impaciente.', 'O campo inteiro espera.', 'Um líder rápido não hesita.', 'A horda não fica parada.', 'Quem demora fica para trás.'],
    },
    dialogue: { intro: 'A horda está pronta. Tente acompanhar.', victory: 'A horda celebra mais uma corrida.', defeat: 'A horda volta, mais rápida.', special: 'Flecha veloz! Se errar, ela ricocheteia.' },
  },
  partos: {
    personality: 'Xá elegante e astuto, fala de planaltos, arqueiros e manobras inesperadas. Gosta de recuar para atacar de novo.',
    taunts: {
      onHit: ['Acertei! Muito bem.', 'O tiro parto nunca falha.', 'Recuar também é atacar.', 'A manobra deu certo.', 'Nenhum planalto esconde você.', 'Cada acerto vem de onde você não espera.'],
      onMiss: ['Só pedra do planalto.', 'Errei! Vamos girar o cavalo.', 'Uma trilha vazia.', 'A boa manobra exige paciência.', 'O vazio me mostra o flanco.', 'Cada erro prepara a surpresa.'],
      onLostPiece: ['Ah, perdemos um arqueiro.', 'Reagrupem!', 'Uma perda. O planalto é nosso.', 'Golpe esperto. Respeito.', 'Um arqueiro cai; os outros miram.', 'Agora vem o tiro que você não vê.'],
      onWin: ['Vitória! Muito bem.', 'O planalto celebra.', 'A astúcia venceu.', 'A manobra funcionou perfeitamente.', 'Os arqueiros celebram esta vitória.', 'Mais uma vitória para o Xá.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje a manobra foi sua.', 'Até o melhor arqueiro erra.', 'Boa partida. Vou estudar seus movimentos.', 'Recuamos hoje; voltamos amanhã.', 'Guarde a vitória. O Xá lembra.'],
      onIdle: ['Pense com calma.', 'Quer mais tempo?', 'O vento do planalto muda.', 'Um xá decide no momento certo.', 'A manobra perde força se esperar.', 'Hesitar também denuncia.'],
    },
    dialogue: { intro: 'O planalto é vasto. Cuidado com o tiro parto.', victory: 'A astúcia prevaleceu.', defeat: 'Recuamos para voltar.', special: 'Tiro parto: dois disparos ao mesmo tempo!' },
  },
  macedonios: {
    personality: 'Comandante de cavalaria ousada e disciplinada, fala de falanges, campanhas longas e lealdade. Gosta de avançar em formação.',
    taunts: {
      onHit: ['Acertei! Bom trabalho.', 'A falange avançou bem.', 'Formação firme acerta o alvo.', 'Disciplina e ousadia juntas.', 'Nenhuma linha resiste à falange.', 'Cada acerto é mais um passo da campanha.'],
      onMiss: ['Só terra do vale.', 'Errei! Mantenham a formação.', 'Uma posição vazia.', 'A campanha é longa, seguimos.', 'O vazio me mostra o flanco.', 'Cada erro alinha a próxima carga.'],
      onLostPiece: ['Ah, perdemos um companheiro.', 'Cerrem a falange!', 'Uma perda. A formação segue.', 'Golpe firme. Eu reconheço.', 'Uma lança cai; a falange avança.', 'Agora a cavalaria inteira carrega.'],
      onWin: ['Vitória! Muito bem, companheiros!', 'A campanha foi um sucesso.', 'A formação venceu.', 'Disciplina e ousadia, como sempre.', 'Esta vitória será contada em Pela.', 'Mais uma terra na campanha.'],
      onLose: ['Você venceu! Parabéns.', 'Hoje o campo foi seu.', 'Até grandes campanhas têm recuos.', 'Boa partida. Vou rever a formação.', 'A falange se reorganiza.', 'Guarde a vitória. A campanha continua.'],
      onIdle: ['Sem pressa, a falange espera.', 'Precisa de mais tempo?', 'A campanha não para.', 'Uma comandante decide com firmeza.', 'A formação perde força parada.', 'Hesitar quebra a linha.'],
    },
    dialogue: { intro: 'A falange está formada. Que comece a campanha.', victory: 'A formação venceu mais uma vez.', defeat: 'A campanha continua amanhã.', special: 'Falange: três golpes em linha!' },
  },
  espartanos: {
    personality: 'Comandante de poucas palavras e muita disciplina. Fala de escudos, treino e firmeza, e respeita adversários valentes.',
    taunts: {
      onHit: ['Acertei. Bom.', 'O treino funcionou.', 'Disciplina acerta.', 'Firmeza e foco.', 'Nenhuma defesa resiste ao treino.', 'Cada acerto prova o valor do treino.'],
      onMiss: ['Nada aqui.', 'Errei. Seguimos.', 'Uma casa vazia.', 'Um erro não quebra a formação.', 'O vazio também ensina.', 'Cada erro torna o próximo golpe certo.'],
      onLostPiece: ['Ah, perdemos um.', 'Escudos juntos!', 'Uma perda. A linha resiste.', 'Golpe digno. Respeito.', 'Um escudo cai; a linha não.', 'Agora vamos à luta de verdade.'],
      onWin: ['Vitória. Bom trabalho.', 'O treino valeu.', 'A disciplina venceu.', 'Como treinamos.', 'Esparta lembrará desta vitória.', 'Mais uma prova de firmeza.'],
      onLose: ['Você venceu. Parabéns.', 'Hoje você foi mais forte.', 'Até os melhores caem.', 'Boa luta. Vou treinar mais.', 'Voltaremos mais firmes.', 'Guarde a vitória. Esparta não esquece.'],
      onIdle: ['Decida.', 'Precisa de tempo?', 'O tempo passa.', 'Firmeza também é decidir.', 'A espera tem fim.', 'Hesitar é ceder.'],
    },
    dialogue: { intro: 'Poucas palavras. Muitos escudos. Comecemos.', victory: 'A disciplina venceu.', defeat: 'Treinaremos mais.', special: 'Lança certeira: onde o radar aponta, ela acerta.' },
  },
};
