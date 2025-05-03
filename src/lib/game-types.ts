
export type CardType = 'Duke' | 'Assassin' | 'Captain' | 'Ambassador' | 'Contessa';
export const AllCards: CardType[] = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];
export const DeckComposition: CardType[] = Array(3).fill(AllCards).flat();

export type ActionType =
  | 'Income'
  | 'Foreign Aid'
  | 'Coup'
  | 'Tax'
  | 'Assassinate'
  | 'Steal'
  | 'Exchange';

export type BlockActionType = 'Block Foreign Aid' | 'Block Stealing' | 'Block Assassination';
export type ChallengeActionType = 'Challenge';
export type GameResponseType = BlockActionType | ChallengeActionType | 'Allow';

export interface InfluenceCard {
  type: CardType;
  revealed: boolean;
}

export interface Player {
  id: string;
  name: string;
  isAI: boolean;
  money: number;
  influence: InfluenceCard[];
}

export interface GameState {
  players: Player[];
  deck: CardType[];
  treasury: number;
  currentPlayerIndex: number;
  currentAction: {
    player: Player;
    action: ActionType;
    target?: Player;
  } | null;
  challengeOrBlockPhase: {
    actionPlayer: Player;
    action: ActionType;
    targetPlayer?: Player;
    possibleResponses: Player[]; // Players who can challenge or block
    responses: {playerId: string, response: GameResponseType}[];
  } | null;
  pendingExchange: {
    player: Player;
    cardsToChoose: CardType[];
  } | null;
  actionLog: string[];
  winner: Player | null;
}
