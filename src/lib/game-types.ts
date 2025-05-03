

export type CardType = 'Duke' | 'Assassin' | 'Captain' | 'Ambassador' | 'Contessa';
export const AllCards: CardType[] = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];
// Correct Portuguese rulebook says 3 of each card = 15 total.
export const DeckComposition: CardType[] = Array(3).fill(AllCards).flat();

export type ActionType =
  | 'Income'          // Renda
  | 'Foreign Aid'     // Ajuda Externa
  | 'Coup'            // Golpe de Estado
  | 'Tax'             // Taxar (Duke)
  | 'Assassinate'     // Assassinar (Assassin)
  | 'Steal'           // Extorquir (Captain)
  | 'Exchange';       // Trocar (Ambassador)

// Actions Contrárias (Blocks)
export type BlockActionType =
    | 'Block Foreign Aid'       // Bloqueia Ajuda Externa (Duke)
    | 'Block Stealing'          // Bloqueia Extorsão (Captain or Ambassador)
    | 'Block Assassination';    // Bloqueia Assassinato (Contessa)

export type ChallengeActionType = 'Challenge'; // Contestar
export type GameResponseType = BlockActionType | ChallengeActionType | 'Allow'; // Permitir

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
  currentAction: { // Represents the action just declared or underway
    player: Player;
    action: ActionType;
    target?: Player;
  } | null;
  challengeOrBlockPhase: { // Represents the state when waiting for responses
    actionPlayer: Player; // The player whose claim is being challenged/blocked
    action: ActionType | BlockActionType; // The action OR block being claimed
    targetPlayer?: Player; // The target of the *original* action (relevant for blocking/challenge-block)
    possibleResponses: Player[]; // Players who can challenge or block this claim
    responses: {playerId: string, response: GameResponseType}[];
  } | null;
  pendingExchange: {
    player: Player;
    cardsToChoose: CardType[];
  } | null;
  actionLog: string[];
  winner: Player | null;
  needsHumanTriggerForAI: boolean; // Flag to indicate if UI should wait for human input before AI acts
}
