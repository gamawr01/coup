
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
// Allow, or a specific Block, or Challenge
export type GameResponseType = BlockActionType | ChallengeActionType | 'Allow'; // Permitir

// Decision after being challenged
export type ChallengeDecisionType = 'Proceed' | 'Retreat';

// Stages for multi-step interactions (like Assassination or Steal)
export type InteractionStage =
  | 'challenge_action' // Initial phase: Can challenge the action claim (e.g., claiming Assassin, Captain)
  | 'block_decision'   // Target decides: Block the action or allow it (e.g., claim Contessa vs Assassinate, claim Captain/Ambassador vs Steal)
  | 'challenge_block'; // Phase: Can challenge the block claim (e.g., challenge Contessa, Captain, Ambassador)

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
    cost?: number; // Store potential cost paid upfront (e.g., Assassinate)
  } | null;
  challengeOrBlockPhase: { // Represents the state when waiting for responses (Challenge or Block)
    actionPlayer: Player; // The player whose claim is being challenged/blocked OR the original action player during block decision
    action: ActionType | BlockActionType; // The action OR block being claimed OR the original action during block decision
    targetPlayer?: Player; // The target of the *original* action
    possibleResponses: Player[]; // Players who can respond in this stage
    responses: {playerId: string, response: GameResponseType}[];
    stage?: InteractionStage; // Optional stage for multi-step actions like Assassination
    validResponses?: GameResponseType[]; // Optional list of valid responses for the current stage
  } | null;
  pendingChallengeDecision: { // Represents state AFTER a challenge is made, before resolution
      challengedPlayerId: string;
      challengerId: string;
      actionOrBlock: ActionType | BlockActionType; // The claim being challenged
      originalTargetPlayerId?: string; // Store original target ID if relevant (e.g., block challenged)
      originalActionPlayerId?: string; // Store original action player ID if relevant (e.g., block challenged)
  } | null;
   pendingAssassinationConfirmation: { // Represents state AFTER Contessa is claimed to block Assassination
     assassinPlayerId: string;
     contessaPlayerId: string;
   } | null;
  pendingExchange: {
    player: Player;
    cardsToChoose: CardType[];
  } | null;
   playerNeedsToReveal: string | null; // ID of the player who must reveal an influence
   pendingActionAfterReveal: { // Stores context to resume an action after a reveal
     type: 'action_proceeds' | 'block_succeeds' | 'block_fails_action_proceeds' | 'action_fails_turn_advances';
     claimerId?: string; // The ID of the player whose original action/block should proceed/succeed
     actionOrBlock?: ActionType | BlockActionType; // The action/block that should proceed/succeed
     originalTargetId?: string; // Target of the original action
     originalActionPlayerId?: string; // Player who took the original action (if a block succeeded/failed)
     loserId?: string; // Player who lost influence during the challenge/reveal
     originalAction?: ActionType | null; // Original action if a block failed challenge
     failedClaim?: ActionType | BlockActionType; // The specific claim that failed due to bluff
   } | null;
  actionLog: string[];
  winner: Player | null;
  needsHumanTriggerForAI: boolean; // Flag to indicate if UI should wait for human input before AI acts
}
