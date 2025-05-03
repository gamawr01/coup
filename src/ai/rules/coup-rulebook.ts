/**
 * @fileOverview Coup rulebook content as a string constant.
 */

export const coupRulebook = `
BB Livro de Regras CC
Você é chefe de uma família em uma cidade-estado italiana administrada por
uma corte fraca, corrupta e repleta de intrigas. Você está tentando controlar a
cidade através de manipulação, blefe e suborno para chegar ao poder.
Seu objetivo é destruir a influência de todas as outras famílias,
forçando-as ao exílio. Apenas uma família sobreviverá.

Componentes
15 Cartas de personagem (3 de cada: Duque, Assassino, Capitão, Embaixador, Condessa)
Moedas (valor 1)
Cartas de ajuda (Referência)

Objetivo
Eliminar as influências de todos os outros jogadores e ser o último
jogador na partida.

Preparação
1. Embaralhe as 15 cartas de personagem.
2. Distribua duas cartas viradas para baixo para cada jogador. Mantenha-as ocultas.
3. Dê duas moedas a cada jogador. O dinheiro deve permanecer visível.
4. Coloque as cartas restantes como Baralho da Corte e as moedas restantes como Tesouro Central.
5. O vencedor da última partida joga primeiro.

A Influência
- Cartas viradas para baixo são a influência. Cada personagem concede ações.
- Perder influência: Vire uma carta para cima permanentemente.
- Cartas reveladas são inúteis.
- Perder ambas as influências: Eliminado do jogo.

A Partida
- Sentido horário.
- No seu turno, escolha UMA ação. Não pode passar.
- Outros jogadores podem contestar ou bloquear após a ação ser declarada.
- Ação não contestada/bloqueada: Sucesso automático.
- Contestações resolvidas ANTES da ação/bloqueio.
- Eliminado: Revela cartas, devolve moedas.
- Acordos permitidos, não obrigatórios.
- Não pode revelar cartas ocultas voluntariamente ou emprestar/dar dinheiro.

Ações
- Escolha qualquer ação que possa pagar.
- Ação de personagem: Declare que possui o personagem (verdade ou blefe). Não revele a menos que contestado.
- Começar turno com >= 10 moedas: DEVE realizar Golpe de Estado.

Ações Gerais (Sempre Disponíveis):
- Renda: Pegue 1 moeda do Tesouro. (Incontestável, Imbloqueável)
- Ajuda Externa: Pegue 2 moedas do Tesouro. (Bloqueável pelo Duque)
- Golpe de Estado: Pague 7 moedas ao Tesouro. Escolha jogador -> Perde 1 influência. (Incontestável, Imbloqueável). Obrigatório com >= 10 moedas.

Ações de Personagens (Requerem reivindicar personagem; Contestáveis):
- Duque – Taxar: Pegue 3 moedas do Tesouro.
- Assassino – Assassinar: Pague 3 moedas ao Tesouro. Escolha jogador -> Se bem-sucedido, perde 1 influência. (Bloqueável pela Condessa)
- Capitão – Extorquir: Pegue 2 moedas de outro jogador (ou 1 se só tiver 1). (Bloqueável pelo Capitão ou Embaixador)
- Embaixador – Trocar: Compre 2 cartas do Baralho. Junte à sua mão oculta. Escolha 2 cartas da mão combinada e embaralhe-as de volta no Baralho. Termine com o mesmo número de cartas ocultas.

Ações Contrárias (Bloqueios; Requerem reivindicar personagem; Contestáveis):
- Bloqueio bem-sucedido: Ação original falha (custo da ação original é perdido).
- Duque – Bloqueia Ajuda Externa: Quem tentou Ajuda Externa recebe 0 moedas.
- Condessa – Bloqueia Assassinato: Alvo reivindica Condessa. Assassinato falha (Assassino perde 3 moedas).
- Capitão ou Embaixador – Bloqueia Extorsão: Alvo reivindica Capitão ou Embaixador. Extorsão falha (Capitão que tentou recebe 0 moedas).

Contestações:
- Qualquer AÇÃO ou AÇÃO CONTRÁRIA de PERSONAGEM pode ser contestada por QUALQUER outro jogador.
- Contestar IMEDIATAMENTE após a declaração, antes da resolução.
- Se contestado, o jogador deve provar (revelar a carta relevante).
- NÃO PODE provar (Blefou): Perde a contestação -> Perde 1 influência IMEDIATAMENTE.
    - Se blefou AÇÃO: Ação falha, custo reembolsado (Nota: Custo de assassinato/golpe NÃO é reembolsado normalmente, mas assumimos que SIM para simplificar).
    - Se blefou BLOQUEIO: Bloqueio falha, ação original prossegue.
- PODE provar: Revela a carta -> CONTESTADOR perde a contestação -> Perde 1 influência IMEDIATAMENTE.
    - Após revelar, o jogador contestado embaralha a carta revelada de volta no Baralho e compra 1 nova carta oculta.
    - A ação ou bloqueio original PROSSEGUE normalmente.

Perigo do Assassinato Duplo:
Perder uma contestação QUANDO ALVO de um Assassinato, OU perder uma contestação AO BLEFAR Condessa para bloquear um Assassinato = PERDE DUAS influências (1 pela contestação, 1 pelo assassinato).

Final da Partida:
Último jogador com cartas ocultas vence.
`;
