

import { type GameState, type Player, type CardType, type InfluenceCard, DeckComposition, ActionType, GameResponseType, BlockActionType, ChallengeActionType, ChallengeDecisionType, InteractionStage } from './game-types';
import { selectAction } from '@/ai/flows/ai-action-selection';
import { aiChallengeReasoning } from '@/ai/flows/ai-challenge-reasoning';
import { aiBlockReasoning } from '@/ai/flows/ai-block-reasoning';
import { coupRulebook } from '@/ai/rules/coup-rulebook'; // Import rulebook

// Fisher-Yates Shuffle Algorithm
function shuffleDeck(deck: CardType[]): CardType[] {
  const shuffledDeck = [...deck];
  for (let i = shuffledDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledDeck[i], shuffledDeck[j]] = [shuffledDeck[j], shuffledDeck[i]];
  }
  return shuffledDeck;
}

// Initialize game state and potentially trigger first AI turn if AI starts
export function initializeGame(playerNames: string[], aiPlayerCount: number): GameState {
    console.log("[initializeGame] Starting game initialization...");
    const players: Player[] = [];
    const humanPlayers = playerNames.length;
    const totalPlayers = humanPlayers + aiPlayerCount;

    // Create human players
    for (let i = 0; i < humanPlayers; i++) {
        players.push({
        id: `player-${i}`,
        name: playerNames[i],
        isAI: false,
        money: 2,
        influence: [], // Dealt later
        });
    }

    // Create AI players
    for (let i = 0; i < aiPlayerCount; i++) {
        players.push({
        id: `ai-${i}`,
        name: `AI Player ${i + 1}`,
        isAI: true,
        money: 2,
        influence: [], // Dealt later
        });
    }
    console.log("[initializeGame] Players created:", players.map(p => p.name));

    let deck = shuffleDeck([...DeckComposition]);
    console.log(`[initializeGame] Deck shuffled (${deck.length} cards).`);


    // Deal influence cards
    players.forEach(player => {
        const card1 = deck.pop();
        const card2 = deck.pop();
        if (card1 && card2) {
        player.influence = [
            { type: card1, revealed: false },
            { type: card2, revealed: false },
        ];
        } else {
        console.error("[initializeGame] Not enough cards to deal initial influence!");
        // Handle error - maybe throw or return a specific error state?
        // For now, continue, but players will have missing cards.
        }
    });
     console.log("[initializeGame] Influence dealt.");

    const initialTreasury = 50 - players.length * 2; // Assuming 50 coins total? Check rulebook
    const startingPlayerIndex = Math.floor(Math.random() * totalPlayers);
    console.log(`[initializeGame] Starting player index: ${startingPlayerIndex} (${players[startingPlayerIndex].name})`);


    let initialState: GameState = {
        players,
        deck,
        treasury: initialTreasury,
        currentPlayerIndex: startingPlayerIndex,
        currentAction: null,
        challengeOrBlockPhase: null,
        pendingChallengeDecision: null, // Initialize new phase
        pendingAssassinationConfirmation: null, // Initialize new phase
        pendingExchange: null,
        playerNeedsToReveal: null, // Initialize new state
        pendingActionAfterReveal: null, // Initialize new state
        actionLog: ['Game started!'],
        winner: null,
        needsHumanTriggerForAI: false, // Initialize flag
    };

    initialState = logAction(initialState, `--- ${initialState.players[startingPlayerIndex].name}'s turn ---`);

    // IMPORTANT: The responsibility of triggering the first AI turn is moved to the `startGame` function in page.tsx
    // It will call handleAIAction *after* setting the initial state if the first player is AI.
    console.log("[initializeGame] Initialization complete. Returning initial state.");
    return initialState;
}

function drawCard(deck: CardType[]): { card: CardType | null, remainingDeck: CardType[] } {
  if (deck.length === 0) {
    console.warn("[drawCard] Deck is empty!");
    return { card: null, remainingDeck: [] };
  }
  const remainingDeck = [...deck];
  const card = remainingDeck.pop();
  // console.log(`[drawCard] Drawn: ${card}, Remaining deck size: ${remainingDeck.length}`);
  return { card: card || null, remainingDeck };
}

function returnCardToDeck(deck: CardType[], card: CardType): CardType[] {
   // console.log(`[returnCardToDeck] Returning ${card} to deck.`);
   const newDeck = [...deck, card];
   return shuffleDeck(newDeck);
}


// --- Utility Functions with Enhanced Null Checks ---

// Safely gets a player by ID, returns undefined if not found or gameState is invalid.
function getPlayerById(gameState: GameState | null, playerId: string | undefined): Player | undefined {
    if (!gameState || !playerId) {
        // console.warn(`[getPlayerById] Called with null gameState or playerId.`); // Too noisy
        return undefined;
    }
    // Add check for gameState.players array
    if (!Array.isArray(gameState.players)) {
        console.error(`[getPlayerById] Error: gameState.players is undefined or not an array.`);
        return undefined; // Or potentially throw an error depending on desired strictness
    }
    return gameState.players.find(p => p.id === playerId);
}


// Safely gets active players, returns empty array if gameState is invalid.
function getActivePlayers(gameState: GameState | null): Player[] {
    if (!gameState || !Array.isArray(gameState.players)) {
        // console.error(`[getActivePlayers] Error: gameState or gameState.players is invalid.`); // Logged too frequently
        return [];
    }
    return gameState.players.filter(p => p.influence.some(card => !card.revealed));
}

// Safely gets the next player index, returns current index on error.
function getNextPlayerIndex(currentIndex: number, players: Player[] | undefined): number {
    // Add check for players array
    if (!Array.isArray(players) || players.length === 0) {
        console.error(`[getNextPlayerIndex] Error: Invalid 'players' array provided.`);
        return currentIndex; // Return current index as fallback
    }

    const activePlayers = players.filter(p => p.influence.some(card => !card.revealed));
    if (activePlayers.length <= 1) {
         // console.log("[getNextPlayerIndex] Only one or zero active players left."); // Too noisy
         return currentIndex; // Game might be over or only one player left
    }

    let nextIndex = (currentIndex + 1) % players.length;
    let safetyCounter = 0; // Prevent infinite loops

     // Loop until we find an active player, checking player existence at each step
    while (!players[nextIndex] || !players[nextIndex].influence.some(card => !card.revealed)) {
        nextIndex = (nextIndex + 1) % players.length;
        safetyCounter++;
        if (safetyCounter > players.length * 2) { // Increased safety margin
            console.error("[getNextPlayerIndex] Infinite loop detected! Could not find next active player.");
            return currentIndex; // Return current index to prevent crash
        }
    }
    // console.log(`[getNextPlayerIndex] Next index: ${nextIndex} (${players[nextIndex].name})`);
    return nextIndex;
}

// Helper function to validate if an object is a valid GameState
// Export this function so it can be used in page.tsx
export function isValidGameState(state: any): state is GameState {
     if (!state || typeof state !== 'object') {
         console.warn("[isValidGameState] State is null or not an object.");
         return false;
     }
     if (!Array.isArray(state.players)) {
         console.warn("[isValidGameState] State.players is not an array.");
         return false;
     }
     if (typeof state.currentPlayerIndex !== 'number' || !Number.isInteger(state.currentPlayerIndex) || state.currentPlayerIndex < 0) {
         console.warn("[isValidGameState] State.currentPlayerIndex is invalid.");
         return false;
     }
      if (!Array.isArray(state.deck)) {
         console.warn("[isValidGameState] State.deck is not an array.");
         return false;
     }
      if (!Array.isArray(state.actionLog)) {
          console.warn("[isValidGameState] State.actionLog is not an array.");
         return false;
      }
      if (typeof state.treasury !== 'number' || state.treasury < 0) {
          console.warn("[isValidGameState] State.treasury is invalid.");
          return false;
      }
      // Check player structure (basic)
      if (state.players.some((p: any) => !p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.isAI !== 'boolean' || typeof p.money !== 'number' || !Array.isArray(p.influence))) {
         console.warn("[isValidGameState] Invalid player structure found.");
         return false;
      }
      // Add more detailed checks as needed for phases etc.
     return true;
}


// Helper function to safely create a GameState object with an error message
// Ensures it *always* returns a valid GameState object.
function createErrorState(errorMessage: string, previousState?: GameState | null): GameState {
    console.error(`[createErrorState] Error encountered: ${errorMessage}`); // Log error immediately

    // Define a minimal default structure
    const defaultState: GameState = {
        players: [],
        deck: [],
        treasury: 0,
        currentPlayerIndex: 0,
        currentAction: null,
        challengeOrBlockPhase: null,
        pendingChallengeDecision: null,
        pendingAssassinationConfirmation: null,
        pendingExchange: null,
        playerNeedsToReveal: null,
        pendingActionAfterReveal: null,
        actionLog: [],
        winner: null,
        needsHumanTriggerForAI: false,
    };

    let baseState: GameState;
    // Attempt to safely parse the previous state, falling back to default if invalid or parsing fails
    try {
        // Use isValidGameState for a more robust check
         if (previousState && isValidGameState(previousState)) {
             baseState = JSON.parse(JSON.stringify(previousState)); // Deep copy valid state
         } else {
              console.warn(`[createErrorState] Previous state provided but invalid or null (${!!previousState}). Using default state.`);
              baseState = JSON.parse(JSON.stringify(defaultState)); // Deep copy default
         }
    } catch (parseError: any) {
         console.warn(`[createErrorState] Error parsing/cloning previous state: ${parseError.message}. Using default state.`);
         baseState = JSON.parse(JSON.stringify(defaultState)); // Deep copy default
    }

    // Ensure actionLog is an array before pushing
    baseState.actionLog = Array.isArray(baseState.actionLog) ? baseState.actionLog : [];
    const MAX_LOG_ENTRIES = 50;
    baseState.actionLog = [...baseState.actionLog, `Error: ${errorMessage}`].slice(-MAX_LOG_ENTRIES); // Add error to game log

    // Optionally clear transient states that might be inconsistent after an error
    baseState.currentAction = null;
    baseState.challengeOrBlockPhase = null;
    baseState.pendingChallengeDecision = null;
    baseState.pendingAssassinationConfirmation = null;
    baseState.pendingExchange = null;
    baseState.playerNeedsToReveal = null; // Clear this too
    baseState.pendingActionAfterReveal = null; // Clear this too

    // Reset needsHumanTriggerForAI flag in error state to avoid getting stuck
    baseState.needsHumanTriggerForAI = false;

    console.log("[createErrorState] Returning error state:", JSON.stringify(baseState, null, 2)); // Log the state being returned
    return baseState; // Always return a valid GameState object
}


function logAction(gameState: GameState | null, message: string): GameState {
    // If gameState is null or invalid, create a base error state first
     if (!isValidGameState(gameState)) {
          const errorMsg = `[logAction] Received invalid or null gameState while trying to log: "${message}"`;
         console.warn(errorMsg);
         // Pass the potentially invalid state to createErrorState for context
         return createErrorState(errorMsg, gameState);
     }


    console.log("[Game Log]", message); // Add console logging for server/debug
    const MAX_LOG_ENTRIES = 50;
    // Ensure actionLog exists before spreading (already validated by isValidGameState)
    const currentLog = gameState.actionLog || [];
    const newLog = [...currentLog, message].slice(-MAX_LOG_ENTRIES);
    // Return a new object to ensure immutability
    return {
        ...gameState,
        actionLog: newLog
    };
}


function eliminatePlayer(gameState: GameState, playerId: string): GameState {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.players[playerIndex].influence.every(c => c.revealed)) {
        // Check if already logged elimination for this player
        if (!newState.actionLog.some(log => log.includes(`${newState.players[playerIndex].name} has been eliminated`))) {
             console.log(`[eliminatePlayer] Eliminating ${newState.players[playerIndex].name}`);
             // Use logAction to ensure immutability
             newState = logAction(newState, `${newState.players[playerIndex].name} has been eliminated!`);
        }
        // Optionally remove player or just mark as inactive - current logic relies on checking revealed cards
    }
    // Return potentially updated state
    return newState;
}


function checkForWinner(gameState: GameState | null): Player | null {
     if (!isValidGameState(gameState)) {
        console.warn("[checkForWinner] Called with invalid or null gameState.");
        return null;
    }
    const activePlayers = getActivePlayers(gameState); // Uses safe version
    if (activePlayers.length === 1) {
        console.log(`[checkForWinner] Winner found: ${activePlayers[0].name}`);
        return activePlayers[0];
    }
    if (activePlayers.length === 0) {
        console.warn("[checkForWinner] No active players left, but no winner set?");
        // This might happen if the last two players eliminate each other simultaneously (rare/impossible in standard Coup?)
        // Or if elimination logic is slightly off.
        return null; // Or handle draw?
    }
    // console.log("[checkForWinner] No winner yet.");
    return null;
}


// Reveals influence, checks for elimination, returns new state and revealed card type
// Returns a valid GameState even on error.
export async function handleForceReveal(gameState: GameState | null, playerId: string, cardToReveal?: CardType): Promise<{ newState: GameState, revealedCard: CardType | null }> {
    console.log(`[handleForceReveal] Entered for player ${playerId}${cardToReveal ? ` specific card ${cardToReveal}` : ''}.`);
     if (!isValidGameState(gameState)) {
        const errorMsg = `[handleForceReveal] Error: Called with invalid or null gameState for player ${playerId}.`;
        console.error(errorMsg);
        return { newState: createErrorState(errorMsg, gameState), revealedCard: null };
    }
    const stateBeforeReveal = JSON.parse(JSON.stringify(gameState)); // Fallback state
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy for safety
    let revealedCardType: CardType | null = null;
    const playerIndex = newState.players.findIndex(p => p.id === playerId);

    // Clear the reveal flag immediately
     newState.playerNeedsToReveal = null;

    if (playerIndex !== -1) {
        const player = newState.players[playerIndex];
        let influenceToReveal: InfluenceCard | undefined;
        let cardIndexToReveal = -1;

        // Find the specific card if provided and unrevealed
        if (cardToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => c.type === cardToReveal && !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
                 console.log(`[handleForceReveal] Found specific unrevealed card ${cardToReveal} for ${playerId} at index ${cardIndexToReveal}.`);
            } else {
                 console.warn(`[handleForceReveal] Player ${playerId} asked to reveal ${cardToReveal}, but no unrevealed ${cardToReveal} found. Unrevealed: [${player.influence.filter(c=>!c.revealed).map(c=>c.type).join(', ')}]. Choosing another card.`);
            }
        }

        // If no specific type needed, or specific type not found/already revealed, find *any* unrevealed card
        if (!influenceToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
                 console.log(`[handleForceReveal] No specific card required or found, revealing first available: ${influenceToReveal?.type} at index ${cardIndexToReveal}.`);
            }
        }


        if (influenceToReveal && cardIndexToReveal !== -1) {
             // Create a new influence array with the revealed card marked
             const newInfluence = [...player.influence];
             newInfluence[cardIndexToReveal] = { ...influenceToReveal, revealed: true };
             newState.players[playerIndex] = { ...player, influence: newInfluence }; // Update player immutably

             revealedCardType = influenceToReveal.type;
             console.log(`[handleForceReveal] ${player.name} revealed ${revealedCardType}.`);
             newState = logAction(newState, `${player.name} revealed a ${revealedCardType}.`);
             newState = eliminatePlayer(newState, playerId); // Check if this reveal eliminates the player
        } else {
             const errorMsg = `${player.name} has no more influence to reveal!`;
             newState = logAction(newState, errorMsg); // Should ideally not happen if logic is correct
             console.warn(`[handleForceReveal] Could not find influence to reveal for ${player.name} (Card type: ${cardToReveal || 'any'}, Unrevealed: ${player.influence.filter(c=>!c.revealed).map(c=>c.type).join(',')})`);
             newState = eliminatePlayer(newState, playerId); // Ensure elimination check runs even if reveal fails
        }
    } else {
         const errorMsg = `[handleForceReveal] Player ID ${playerId} not found.`;
         console.error(errorMsg);
         newState = logAction(newState, errorMsg); // Log error in game state
    }
     console.log(`[handleForceReveal] Exiting for player ${playerId}. Revealed: ${revealedCardType}`);
      // Final safety check
      if (!isValidGameState(newState)) {
         console.error("[handleForceReveal] Error: newState became invalid during processing. Reverting.");
         return { newState: createErrorState("[handleForceReveal] Internal error during processing.", stateBeforeReveal), revealedCard: null };
     }
     return { newState, revealedCard: revealedCardType };
}

// Helper to set the playerNeedsToReveal flag and handle immediate AI reveal
async function setPlayerNeedsToReveal(gameState: GameState, playerId: string): Promise<GameState> {
    console.log(`[setPlayerNeedsToReveal] Setting flag for player ${playerId}`);
    let newState = { ...gameState, playerNeedsToReveal: playerId };
    const stateBeforeReveal = JSON.parse(JSON.stringify(newState)); // Fallback

    // If player is AI, handle reveal immediately
    const player = getPlayerById(newState, playerId);
    if (player?.isAI) {
        console.log(`[setPlayerNeedsToReveal] Player ${playerId} is AI. Handling forced reveal immediately.`);
        // AI reveals the first available card (or maybe choose randomly?)
         const cardToReveal = player.influence.find(c => !c.revealed)?.type;
         // Use Promise.resolve to make it thenable, simulating async flow
         const result = await handleForceReveal(newState, playerId, cardToReveal);
         // The state returned *already* has the playerNeedsToReveal flag cleared by handleForceReveal
         newState = result.newState; // Update state with the result after reveal
         // Validate state after reveal
         if (!isValidGameState(newState)) {
             console.error("[setPlayerNeedsToReveal] Error: newState became invalid after AI reveal. Reverting.");
             return createErrorState("[setPlayerNeedsToReveal] Internal error after AI reveal.", stateBeforeReveal);
         }
         return newState; // Return the state AFTER the reveal
    } else {
         console.log(`[setPlayerNeedsToReveal] Player ${playerId} is Human. Waiting for UI interaction.`);
         // Validate state before returning
         if (!isValidGameState(newState)) {
             console.error("[setPlayerNeedsToReveal] Error: newState became invalid while setting flag for human. Reverting.");
             return createErrorState("[setPlayerNeedsToReveal] Internal error setting human reveal flag.", stateBeforeReveal);
         }
         return newState; // Return state with flag set for human
    }

}


// --- Action Execution ---

async function performIncome(gameState: GameState | null, playerId: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[performIncome] Error: gameState is invalid or null.");
    console.log(`[performIncome] ${playerId} takes Income.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.treasury > 0) {
        const player = newState.players[playerIndex];
        const newMoney = player.money + 1;
        const newTreasury = newState.treasury - 1;
        newState.players[playerIndex] = { ...player, money: newMoney };
        newState.treasury = newTreasury;
        newState = logAction(newState, `${player.name} takes Income (+1 coin). Now has ${newMoney} coins.`);
    } else if (newState.treasury <= 0) {
        newState = logAction(newState, `${newState.players[playerIndex]?.name || playerId} takes Income, but treasury is empty.`);
    }
     return await advanceTurn(newState);
}


async function performForeignAid(gameState: GameState | null, playerId: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[performForeignAid] Error: gameState is invalid or null.");
    console.log(`[performForeignAid] ${playerId} attempts Foreign Aid.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const player = getPlayerById(newState, playerId);
    if (!player) {
        const errorMsg = `[performForeignAid] Error: Player ${playerId} not found.`;
        return createErrorState(errorMsg, newState);
    }

    newState = logAction(newState, `${player.name} attempts Foreign Aid (+2 coins).`);
     // Store cost in currentAction - Use the *updated* player state
     newState.currentAction = { player: player, action: 'Foreign Aid', target: undefined, cost: 0 };


    const potentialBlockers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialBlockers.length > 0) {
         console.log(`[performForeignAid] Potential blockers exist. Entering phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Foreign Aid',
            targetPlayer: undefined, // No target for Foreign Aid
            possibleResponses: potentialBlockers,
            responses: [],
            stage: 'challenge_action', // Only blocking is possible
            // Foreign Aid cannot be challenged, only blocked by Duke claim.
             validResponses: ['Allow', 'Block Foreign Aid'], // Only Block or Allow
        };
        // AI needs to decide to block here
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge or block, action succeeds immediately
         console.log(`[performForeignAid] No blockers. Action succeeds.`);
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
         if (playerIndex !== -1) {
            const amount = Math.min(2, newState.treasury);
            const newMoney = newState.players[playerIndex].money + amount;
            const newTreasury = newState.treasury - amount;
            newState.players[playerIndex] = { ...newState.players[playerIndex], money: newMoney };
            newState.treasury = newTreasury;
             newState = logAction(newState, `${player.name}'s Foreign Aid succeeds (+${amount} coins). Now has ${newMoney} coins.`);
         }
         newState = await advanceTurn(newState);
    }
     return newState;
}



async function performCoup(gameState: GameState | null, playerId: string, targetId: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[performCoup] Error: gameState is invalid or null.");
    console.log(`[performCoup] ${playerId} performs Coup against ${targetId}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const target = getPlayerById(newState, targetId); // Target needed for logging

    if (playerIndex !== -1 && target && newState.players[playerIndex].money >= 7) {
        const player = newState.players[playerIndex];
        const newMoney = player.money - 7;
        const newTreasury = newState.treasury + 7; // Or handle differently if coins are just removed
        newState.players[playerIndex] = { ...player, money: newMoney };
        newState.treasury = newTreasury;
        newState = logAction(newState, `${player.name} performs a Coup against ${target.name} (-7 coins). Now has ${newMoney} coins.`);

        // Coup cannot be challenged or blocked, target must reveal influence
        console.log(`[performCoup] Target ${targetId} must reveal influence.`);
        // Set the flag for the target to reveal
        newState = await setPlayerNeedsToReveal(newState, target.id); // Await AI reveal handling
        // Turn advances *after* reveal is handled

    } else {
        const errorMsg = `${newState.players[playerIndex]?.name || 'Player'} cannot perform Coup (not enough money or invalid target).`;
        newState = logAction(newState, errorMsg);
        console.error(`[performCoup] Failed Coup. Player: ${JSON.stringify(newState.players[playerIndex])}, Target: ${JSON.stringify(target)}`);
        // Should not advance turn if action failed pre-conditions
        return newState; // Return without advancing if failed
    }

     // Don't advance turn here, it happens after the forced reveal is completed via handleForceReveal or processPendingActionAfterReveal
     return newState;
}


async function performTax(gameState: GameState | null, playerId: string): Promise<GameState> {
      if (!isValidGameState(gameState)) return createErrorState("[performTax] Error: gameState is invalid or null.");
    console.log(`[performTax] ${playerId} attempts Tax.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const player = getPlayerById(newState, playerId);
     if (!player) {
          const errorMsg = `[performTax] Error: Player ${playerId} not found.`;
          return createErrorState(errorMsg, newState);
     }

     newState = logAction(newState, `${player.name} attempts to Tax (+3 coins).`);
     // Store cost in currentAction - Use the *updated* player state
     newState.currentAction = { player: player, action: 'Tax', target: undefined, cost: 0 };

     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
         console.log(`[performTax] Potential challengers exist. Entering challenge phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Tax',
            targetPlayer: undefined,
            possibleResponses: potentialChallengers,
            responses: [],
            stage: 'challenge_action',
            validResponses: ['Challenge', 'Allow'],
        };
        const stateAfterTrigger = await triggerAIResponses(newState);
        newState = stateAfterTrigger;
    } else {
        // No challengers, action succeeds
        console.log(`[performTax] No challengers. Action succeeds.`);
        const amount = Math.min(3, newState.treasury);
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
        if(playerIndex !== -1){
            const newMoney = newState.players[playerIndex].money + amount;
            const newTreasury = newState.treasury - amount;
            newState.players[playerIndex] = { ...newState.players[playerIndex], money: newMoney };
            newState.treasury = newTreasury;
            newState = logAction(newState, `${player.name}'s Tax succeeds (+${amount} coins). Now has ${newMoney} coins.`);
        }
        newState = await advanceTurn(newState);
    }
    return newState;
}



async function performAssassinate(gameState: GameState | null, playerId: string, targetId: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[performAssassinate] Error: gameState is invalid or null.");
    console.log(`[performAssassinate] ${playerId} attempts Assassinate against ${targetId}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const target = getPlayerById(newState, targetId);

    if (playerIndex === -1 || !target) {
        const errorMsg = `[performAssassinate] Invalid player or target. PlayerIndex: ${playerIndex}, Target: ${!!target}`;
        return createErrorState(errorMsg, newState);
    }
    const player = newState.players[playerIndex];

    if (player.money < 3) {
         const errorMsg = `${player.name} cannot Assassinate (needs 3 coins).`;
         console.warn(`[performAssassinate] Insufficient funds for ${playerId}.`);
        return logAction(newState, errorMsg); // Return state with log, don't crash
    }

     // Deduct cost immediately upon attempt
     const newMoney = player.money - 3;
     const newTreasury = newState.treasury + 3;
     newState.players[playerIndex] = { ...player, money: newMoney };
     newState.treasury = newTreasury;
     newState = logAction(newState, `${player.name} attempts to Assassinate ${target.name} (-3 coins). Now has ${newMoney} coins.`);
     // Store cost in currentAction - Use the *updated* player state
     newState.currentAction = { player: newState.players[playerIndex], action: 'Assassinate', target, cost: 3 };


    const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
         console.log(`[performAssassinate] Potential challengers exist. Entering challenge_action phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: newState.players[playerIndex], // Pass updated player state
            action: 'Assassinate',
            targetPlayer: target,
            possibleResponses: potentialChallengers, // Anyone can challenge the Assassin claim
            responses: [],
            stage: 'challenge_action',
            validResponses: ['Challenge', 'Allow'], // Only challenge or allow the initial claim
        };
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge the Assassin claim initially
         console.log(`[performAssassinate] No challengers for Assassin claim. Proceeding to block_decision stage.`);
         // Immediately transition to the block decision stage
          newState.challengeOrBlockPhase = {
             actionPlayer: newState.players[playerIndex], // Original player (Assassin)
             action: 'Assassinate', // Original action
             targetPlayer: target, // Target of assassination
             possibleResponses: [target], // Only the target can block
             responses: [],
             stage: 'block_decision',
             validResponses: ['Block Assassination', 'Allow'], // Target can block or allow
         };
          newState = logAction(newState, `No one challenged the Assassinate claim. ${target.name}, do you block with Contessa or allow?`);
         // Trigger AI response if target is AI, otherwise wait for human
          const stateAfterTrigger = await triggerAIResponses(newState);
          newState = stateAfterTrigger;
    }
     return newState;
}


async function performSteal(gameState: GameState | null, playerId: string, targetId: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[performSteal] Error: gameState is invalid or null.");
    console.log(`[performSteal] ${playerId} attempts Steal from ${targetId}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (!player || !target) {
        const errorMsg = `[performSteal] Invalid player or target. Player: ${!!player}, Target: ${!!target}`;
        return createErrorState(errorMsg, newState);
    }
     if (target.money === 0) {
          const infoMsg = `${player.name} attempts to Steal from ${target.name}, but they have no money.`;
         newState = logAction(newState, infoMsg);
         return await advanceTurn(newState); // Action effectively fails, advance turn
     }

    newState = logAction(newState, `${player.name} attempts to Steal from ${target.name}.`);
     // Store cost in currentAction - Use the *updated* player state
     newState.currentAction = { player: player, action: 'Steal', target: target, cost: 0 };

    const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);


    if (potentialChallengers.length > 0) {
         console.log(`[performSteal] Potential challengers exist. Entering challenge_action phase.`);
         // Stage 1: Challenge the Captain claim
         newState.challengeOrBlockPhase = {
            actionPlayer: player, // Player claiming Captain
            action: 'Steal',
            targetPlayer: target,
            possibleResponses: potentialChallengers, // Anyone can challenge the Captain claim
            responses: [],
            stage: 'challenge_action',
            validResponses: ['Challenge', 'Allow'], // Only challenge or allow the Captain claim initially
        };
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge the Captain claim
         console.log(`[performSteal] No challengers for Captain claim. Proceeding to block_decision stage.`);
         // Immediately transition to the block decision stage
         newState.challengeOrBlockPhase = {
             actionPlayer: player, // Original action player
             action: 'Steal', // Original action
             targetPlayer: target, // Target of steal
             possibleResponses: [target], // Only the target can block
             responses: [],
             stage: 'block_decision',
             validResponses: ['Block Stealing', 'Allow'], // Target can claim Captain/Ambassador to block or allow
         };
         newState = logAction(newState, `No one challenged the Steal claim. ${target.name}, do you block with Captain/Ambassador or allow?`);
          const stateAfterTrigger = await triggerAIResponses(newState); // Trigger AI block decision if target is AI
          newState = stateAfterTrigger;
    }
     return newState;
}



async function performExchange(gameState: GameState | null, playerId: string): Promise<GameState> {
       if (!isValidGameState(gameState)) return createErrorState("[performExchange] Error: gameState is invalid or null.");
     console.log(`[performExchange] ${playerId} attempts Exchange.`);
     let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
     const player = getPlayerById(newState, playerId);
      if (!player) {
          const errorMsg = `[performExchange] Error: Player ${playerId} not found.`;
          return createErrorState(errorMsg, newState);
      }

     newState = logAction(newState, `${player.name} attempts Exchange.`);
      // Store cost in currentAction - Use the *updated* player state
     newState.currentAction = { player: player, action: 'Exchange', target: undefined, cost: 0 };

     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
         console.log(`[performExchange] Potential challengers exist. Entering challenge phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Exchange',
            targetPlayer: undefined,
            possibleResponses: potentialChallengers,
            responses: [],
            stage: 'challenge_action',
            validResponses: ['Challenge', 'Allow'],
        };
        const stateAfterTrigger = await triggerAIResponses(newState);
        newState = stateAfterTrigger;
    } else {
        // No challengers, exchange proceeds
         console.log(`[performExchange] No challengers. Initiating exchange.`);
        newState = await initiateExchange(newState, player); // Make initiateExchange async

        // Turn doesn't advance until exchange is complete
    }
    return newState;
}


async function initiateExchange(gameState: GameState | null, player: Player): Promise<GameState> {
      if (!isValidGameState(gameState)) return createErrorState(`[initiateExchange] Error: gameState is invalid or null for player ${player?.id}.`);
    console.log(`[initiateExchange] Initiating exchange for ${player.name}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const { card: card1, remainingDeck: deckAfter1 } = drawCard(newState.deck);
    const { card: card2, remainingDeck: deckAfter2 } = drawCard(deckAfter1);

    const currentInfluence = player.influence.filter(c => !c.revealed);
    const cardsToChoose: CardType[] = [...currentInfluence.map(c => c.type)];
    if (card1) cardsToChoose.push(card1);
    if (card2) cardsToChoose.push(card2);

    newState.deck = deckAfter2;
    newState.pendingExchange = {
        player,
        cardsToChoose,
    };
    newState = logAction(newState, `${player.name} draws ${[card1, card2].filter(Boolean).length} card(s) for Exchange. Choices: [${cardsToChoose.join(', ')}].`);
     console.log(`[initiateExchange] Pending exchange set for ${player.name}. Cards: ${cardsToChoose.join(', ')}`);

    // If player is AI, trigger AI Exchange choice
    if(player.isAI) {
        console.log(`[initiateExchange] Player ${player.name} is AI. Handling AI exchange.`);
        newState = await handleAIExchange(newState); // Make handleAIExchange async

    } else {
        console.log(`[initiateExchange] Player ${player.name} is Human. Waiting for UI selection.`);
    }
    // If player is human, UI needs to present choice

    return newState;
}


async function completeExchange(gameState: GameState | null, playerId: string, cardsToKeepIndices: number[]): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState(`[completeExchange] Error: gameState is invalid or null for player ${playerId}.`);
    const stateBeforeComplete = JSON.parse(JSON.stringify(gameState)); // Fallback
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const exchangeInfo = newState.pendingExchange;

    if (playerIndex === -1 || !exchangeInfo || exchangeInfo.player.id !== playerId) {
        const errorMsg = `[completeExchange] Invalid state for completing exchange. Phase: ${JSON.stringify(exchangeInfo)}`;
        const stateWithError = logAction(newState, errorMsg);
        if (stateWithError) stateWithError.pendingExchange = null;
        return stateWithError || createErrorState(errorMsg, gameState); // Return error state or fallback
    }

    const player = newState.players[playerIndex];
    const cardsToChooseFrom = exchangeInfo.cardsToChoose;
    const originalUnrevealedCount = player.influence.filter(c => !c.revealed).length;

    if (cardsToKeepIndices.length !== originalUnrevealedCount) {
        const errorMsg = `[completeExchange] Exchange error: Player ${playerId} selected ${cardsToKeepIndices.length} cards, but needs ${originalUnrevealedCount}. Indices chosen: ${cardsToKeepIndices.join(',')}. Cards available: ${cardsToChooseFrom.join(',')}`;
        console.error(errorMsg);
        newState = logAction(newState, `Error: ${player.name} did not select the correct number of cards (${originalUnrevealedCount}) for exchange. Selection cancelled.`);
        newState.pendingExchange = null;
        return newState; // Return state without advancing, UI should handle retry
    }

     // Validate indices
     if (cardsToKeepIndices.some(index => index < 0 || index >= cardsToChooseFrom.length)) {
        const errorMsg = `[completeExchange] Exchange error: Player ${playerId} selected invalid index. Indices: ${cardsToKeepIndices.join(',')}. Max index: ${cardsToChooseFrom.length - 1}`;
        console.error(errorMsg);
        newState = logAction(newState, `Error: ${player.name} selected invalid card index for exchange. Selection cancelled.`);
        newState.pendingExchange = null;
        return newState;
     }

     // --- Logic using indices ---
     const cardsToKeep: CardType[] = cardsToKeepIndices.map(index => cardsToChooseFrom[index]);
     console.log(`[completeExchange] Player ${playerId} completes exchange, keeping indices [${cardsToKeepIndices.join(', ')}] corresponding to cards [${cardsToKeep.join(', ')}].`);


    // Find cards to return: Iterate through original indices, if index not in cardsToKeepIndices, add the card to return list.
    const cardsToReturn: CardType[] = [];
    for (let i = 0; i < cardsToChooseFrom.length; i++) {
        if (!cardsToKeepIndices.includes(i)) {
            cardsToReturn.push(cardsToChooseFrom[i]);
        }
    }
    console.log(`[completeExchange] Cards returned to deck: ${cardsToReturn.join(', ')}.`);


    // Update player influence
    const revealedInfluence = player.influence.filter(c => c.revealed);
    const newUnrevealedInfluence: InfluenceCard[] = cardsToKeep.map(type => ({ type, revealed: false })); // Use the mapped card types
    const newPlayerInfluence = [...revealedInfluence, ...newUnrevealedInfluence];
    newState.players[playerIndex] = { ...player, influence: newPlayerInfluence };


    // Return unused cards to deck
    let currentDeck = newState.deck;
    cardsToReturn.forEach(card => {
        currentDeck = returnCardToDeck(currentDeck, card);
    });
    newState.deck = currentDeck;
    console.log(`[completeExchange] New deck size: ${currentDeck.length}`);


    newState = logAction(newState, `${player.name} completed Exchange, kept ${originalUnrevealedCount} influence.`);
    newState.pendingExchange = null;

    return await advanceTurn(newState);
}


// --- Challenge/Block Resolution ---

async function resolveChallengeOrBlock(gameState: GameState): Promise<GameState> {
     // No null check needed here, called internally by functions that already check
    console.log(`[resolveChallengeOrBlock] Resolving phase for action: ${gameState.challengeOrBlockPhase?.action}, stage: ${gameState.challengeOrBlockPhase?.stage}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeResolve = JSON.parse(JSON.stringify(gameState)); // For fallback
    const phase = newState.challengeOrBlockPhase;
    if (!phase) {
        console.warn("[resolveChallengeOrBlock] Phase is already null. Returning state.");
        return newState; // Should not happen if called correctly
    }

    const actionPlayer = getPlayerById(newState, phase.actionPlayer.id); // Player whose claim (action or block) is being resolved OR original action player
    const targetPlayer = phase.targetPlayer ? getPlayerById(newState, phase.targetPlayer.id) : undefined; // Original action target
     // Safety check if players were somehow removed during the phase (unlikely)
     if (!actionPlayer) {
         const errorMsg = `[resolveChallengeOrBlock] Error: Action player ${phase.actionPlayer.id} not found during resolution.`;
         newState.challengeOrBlockPhase = null; // Clear invalid phase
         return createErrorState(errorMsg, newState);
     }


    const actionOrBlock = phase.action; // The claim being resolved (e.g., 'Tax', 'Block Foreign Aid')
    const stage = phase.stage;


    const challenges = phase.responses.filter(r => r.response === 'Challenge');
    const blocks = phase.responses.filter(r => (r.response as BlockActionType).startsWith('Block'));
    const allows = phase.responses.filter(r => r.response === 'Allow');


    // CRITICAL: Clear the phase state *before* potentially await-ing further async operations
    // to prevent re-entry issues if an AI response comes in late.
    newState.challengeOrBlockPhase = null;
    console.log("[resolveChallengeOrBlock] Challenge/Block Phase cleared.");


    if (challenges.length > 0) {
        // --- Handle Challenge ---
        // Regardless of stage, a challenge always targets the current claim.
        const challengerId = challenges[0].playerId;
        const challenger = getPlayerById(newState, challengerId);
        // If challenging an action (Tax, Steal, Exchange, Assassinate), challengedPlayer is actionPlayer.
        // If challenging a block (Block ..., Block ...), challengedPlayer is the blocker (who is stored in phase.actionPlayer for this stage).
        const challengedPlayerId = phase.actionPlayer.id;
        const challengedPlayer = getPlayerById(newState, challengedPlayerId);

        if(!challenger || !challengedPlayer) {
             const errorMsg = `[resolveChallengeOrBlock] Challenger (${challengerId}) or Challenged (${challengedPlayerId}) not found.`;
             return createErrorState(errorMsg, newState);
        }

        console.log(`[resolveChallengeOrBlock] Challenge found from ${challenger.name} against ${challengedPlayer.name}'s claim of ${actionOrBlock}.`);
        // Initiate the Pending Challenge Decision Phase
        newState.pendingChallengeDecision = {
            challengedPlayerId: challengedPlayer.id,
            challengerId: challenger.id,
            actionOrBlock: actionOrBlock, // The specific claim being challenged
             // Pass original context if the challenged item was a block
             originalTargetPlayerId: actionOrBlock.startsWith('Block ') ? phase.targetPlayer?.id : undefined,
             originalActionPlayerId: actionOrBlock.startsWith('Block ') ? newState.currentAction?.player.id : undefined, // Get original action player from currentAction context
        };
        newState = logAction(newState, `${challenger.name} challenges ${challengedPlayer.name}'s claim of ${actionOrBlock}! ${challengedPlayer.name}, do you want to proceed or retreat?`);

        // Trigger AI decision if challenged player is AI
        if (challengedPlayer.isAI) {
            console.log(`[resolveChallengeOrBlock] Triggering AI challenge decision for ${challengedPlayer.name}.`);
            newState = await handleAIChallengeDecision(newState); // Handles proceed/retreat
        } else {
             console.log(`[resolveChallengeOrBlock] Waiting for Human (${challengedPlayer.name}) challenge decision.`);
        }
        // Return state, waiting for handleChallengeDecision call
        // Ensure we return a valid state
        if (!isValidGameState(newState)) {
             console.error("[resolveChallengeOrBlock] Error: newState became invalid after setting up challenge decision. Reverting.");
             return createErrorState("[resolveChallengeOrBlock] Internal error after setting up challenge decision.", stateBeforeResolve);
        }
        return newState; // Return state waiting for decision


    } else if (stage === 'challenge_action' && blocks.length > 0) {
         // --- Handle Block (during initial challenge_action stage) ---
         const blockerId = blocks[0].playerId;
         const blockType = blocks[0].response as BlockActionType;
         console.log(`[resolveChallengeOrBlock] Block (${blockType}) found from ${blockerId}. Setting up next phase.`);
         const originalActionPlayer = newState.currentAction?.player; // Get original player from context
          if (!originalActionPlayer) {
               const errorMsg = "[resolveChallengeOrBlock] Error: Cannot find original action player context when handling block.";
               return createErrorState(errorMsg, newState);
          }
          const blocker = getPlayerById(newState, blockerId);
          if (!blocker) {
             const errorMsg = `[resolveChallengeOrBlock] Error: Blocker ${blockerId} not found.`;
             return createErrorState(errorMsg, newState);
          }

         // Handle specific block types
          if (blockType === 'Block Assassination') {
                console.log(`[resolveChallengeOrBlock] Contessa block claimed for Assassination. Entering confirmation phase.`);
                 // Enter pendingAssassinationConfirmation
                 newState.pendingAssassinationConfirmation = {
                     assassinPlayerId: originalActionPlayer.id,
                     contessaPlayerId: blocker.id,
                 };
                 newState = logAction(newState, `${blocker.name} claims Contessa to block the assassination! ${originalActionPlayer.name}, do you challenge the Contessa claim or accept the block?`);
                 // Trigger AI decision if Assassin is AI
                 if (originalActionPlayer.isAI) {
                     console.log(`[resolveChallengeOrBlock] Triggering AI assassination confirmation for ${originalActionPlayer.name}.`);
                     newState = await handleAIAssassinationConfirmation(newState);
                 } else {
                     console.log(`[resolveChallengeOrBlock] Waiting for Human Assassin (${originalActionPlayer.name}) confirmation.`);
                 }
                 // Return state waiting for confirmation
                 return newState;
            } else {
                 // Other blocks (Foreign Aid, Steal) enter challenge_block stage
                 console.log(`[resolveChallengeOrBlock] Standard block (${blockType}). Setting up challenge_block stage.`);
                 newState.challengeOrBlockPhase = {
                     actionPlayer: blocker, // Blocker is now the one making the claim (the block)
                     action: blockType, // The claim is the block type
                     targetPlayer: originalActionPlayer, // Target of the block challenge is the original action player
                     possibleResponses: getActivePlayers(newState).filter(p => p.id !== blockerId), // Anyone else can challenge the block claim
                     responses: [],
                     stage: 'challenge_block',
                     validResponses: ['Challenge', 'Allow'], // Only challenge or allow the block claim
                 };
                  newState = logAction(newState, `${blocker.name} claims to ${blockType}. Others can challenge this claim.`);
                  // Trigger AI responses for challenging the block
                  newState = await triggerAIResponses(newState);
            }

    } else if ((stage === 'block_decision') && blocks.length > 0) { // Only block decision stage
        // --- Handle Block (during block_decision stage for Assassination/Steal) ---
        // Target (claimer) chose to block
         const blockerId = blocks[0].playerId; // Should be the target
         const blockType = blocks[0].response as BlockActionType; // Should be Block Assassination or Block Stealing
         console.log(`[resolveChallengeOrBlock] Target ${blockerId} chose to ${blockType}. Setting up challenge_block stage or confirmation.`);
         const originalActionPlayer = newState.currentAction?.player; // Original action taker (Assassin or Stealer)
         const blocker = getPlayerById(newState, blockerId); // Target/Blocker

         if (!originalActionPlayer || !blocker) {
             const errorMsg = `[resolveChallengeOrBlock] Error: Cannot find original player or Blocker context when handling target's block claim.`;
             return createErrorState(errorMsg, newState);
         }

         // Special Handling for Assassination Block
         if (blockType === 'Block Assassination') {
             console.log(`[resolveChallengeOrBlock] Contessa block claimed. Entering confirmation phase.`);
             // Instead of challenge_block, enter pendingAssassinationConfirmation
             newState.pendingAssassinationConfirmation = {
                 assassinPlayerId: originalActionPlayer.id,
                 contessaPlayerId: blocker.id,
             };
             newState = logAction(newState, `${blocker.name} claims Contessa to block the assassination! ${originalActionPlayer.name}, do you challenge the Contessa claim or accept the block?`);

             // Trigger AI decision if Assassin is AI
             if (originalActionPlayer.isAI) {
                 console.log(`[resolveChallengeOrBlock] Triggering AI assassination confirmation for ${originalActionPlayer.name}.`);
                 newState = await handleAIAssassinationConfirmation(newState);
             } else {
                 console.log(`[resolveChallengeOrBlock] Waiting for Human Assassin (${originalActionPlayer.name}) confirmation.`);
             }
             // Return state, waiting for handleAssassinationConfirmation call
             if (!isValidGameState(newState)) {
                 console.error("[resolveChallengeOrBlock] Error: newState became invalid after setting up assassination confirmation. Reverting.");
                 return createErrorState("[resolveChallengeOrBlock] Internal error after setting up assassination confirmation.", stateBeforeResolve);
             }
             return newState; // Return state waiting for confirmation
         } else { // Handle Steal Block (and potentially others if added)
             // Standard block handling: Go to challenge_block stage
              console.log(`[resolveChallengeOrBlock] Target ${blocker.name} claims ${blockType}. Setting up challenge_block stage.`);
              newState.challengeOrBlockPhase = {
                  actionPlayer: blocker, // Blocker is now making the claim
                  action: blockType, // The claim is the block
                  targetPlayer: originalActionPlayer, // Target of challenge is original action player
                  possibleResponses: getActivePlayers(newState).filter(p => p.id !== blockerId), // Anyone else can challenge
                  responses: [],
                  stage: 'challenge_block',
                  validResponses: ['Challenge', 'Allow'],
              };
               newState = logAction(newState, `${blocker.name} claims to ${blockType}. Others can challenge this claim.`);
               newState = await triggerAIResponses(newState); // Trigger challenges against the block
         }

     } else if (allows.length === phase.possibleResponses.length || phase.possibleResponses.length === 0 ) {
         // --- Handle All Allows / No Responses Possible ---
          console.log(`[resolveChallengeOrBlock] No challenges or blocks received (or possible). Processing claim: ${actionOrBlock}, Stage: ${stage}`);
         // Refresh action player state before executing
         const currentClaimer = getPlayerById(newState, phase.actionPlayer.id)!; // Player making the current claim or original action player
         const originalTarget = getPlayerById(newState, phase.targetPlayer?.id || ''); // Original target if relevant
         const originalAction = newState.currentAction?.action; // Get original action type from context

          if (actionOrBlock.startsWith('Block ')) {
              // A block claim was allowed (not challenged). Block succeeds.
              const originalActionFromBlock = getActionFromBlock(actionOrBlock as BlockActionType); // Map block back to action
              const originalActionPlayer = newState.currentAction?.player; // Get original player from context
              if (originalActionFromBlock && originalActionPlayer) {
                  newState = logAction(newState, `No challenge to ${currentClaimer.name}'s claim of ${actionOrBlock}. Block succeeds. ${originalActionPlayer.name}'s ${originalActionFromBlock} is cancelled.`);
              } else {
                   newState = logAction(newState, `No challenge to ${currentClaimer.name}'s claim of ${actionOrBlock}. Block succeeds, original action cancelled.`);
              }
              newState = await advanceTurn(newState);
         } else if (stage === 'block_decision' && allows.length > 0) {
              // Target chose to ALLOW the action (Assassinate/Steal)
              console.log(`[resolveChallengeOrBlock] Target ${originalTarget?.name} allowed the action ${originalAction}.`);
              newState = logAction(newState, `${originalTarget?.name} allows ${originalAction}.`);
              newState = await executeSuccessfulAction(newState, currentClaimer, originalAction as ActionType, originalTarget);
         } else if (stage === 'challenge_action') {
              // An action claim was allowed (not challenged or blocked).
              newState = logAction(newState, `No challenges or blocks. ${currentClaimer.name}'s ${actionOrBlock} attempt succeeds.`);
              // For Assassination/Steal, this means the claim passed, now check block
              if ((actionOrBlock === 'Assassinate' || actionOrBlock === 'Steal') && originalTarget) {
                   console.log(`[resolveChallengeOrBlock] ${actionOrBlock} claim successful. Proceeding to block_decision stage.`);
                   // Transition to block decision phase
                    newState.challengeOrBlockPhase = {
                       actionPlayer: currentClaimer, // Original action player
                       action: actionOrBlock as ActionType, // Original action
                       targetPlayer: originalTarget, // Target
                       possibleResponses: [originalTarget], // Only target can block
                       responses: [],
                       stage: 'block_decision',
                       validResponses: actionOrBlock === 'Assassinate' ? ['Block Assassination', 'Allow'] : ['Block Stealing', 'Allow'],
                   };
                    newState = logAction(newState, `${originalTarget.name}, do you block ${actionOrBlock} with ${actionOrBlock === 'Assassinate' ? 'Contessa' : 'Captain/Ambassador'} or allow?`);
                    newState = await triggerAIResponses(newState);
               } else {
                    // Execute other successful actions (Tax, Foreign Aid, Exchange)
                    newState = await executeSuccessfulAction(newState, currentClaimer, actionOrBlock as ActionType, originalTarget);
               }
          } else {
              // Should not be reached if stages are handled correctly
              console.warn(`[resolveChallengeOrBlock] Reached unexpected 'allow' state. Action: ${actionOrBlock}, Stage: ${stage}. Advancing turn.`);
               newState = await advanceTurn(newState);
          }
     } else {
         // This case should ideally not be reached if logic is correct
         // (e.g., waiting for more responses, which should be handled by triggerAIResponses returning without resolving)
         console.warn(`[resolveChallengeOrBlock] Reached unexpected state. Phase: ${JSON.stringify(phase)}. Returning current state.`);
         // To prevent infinite loops, maybe force resolution based on current responses? Risky.
         // For now, just return the state, assuming triggerAIResponses will be called again or human input is awaited.
         // Restore the cleared phase to allow continuation
         newState.challengeOrBlockPhase = phase;
    }

    console.log(`[resolveChallengeOrBlock] Phase resolution complete (or transitioned to next stage/decision).`);
     // Ensure we return a valid state
    if (!isValidGameState(newState)) {
         console.error("[resolveChallengeOrBlock] Error: newState became invalid at end of function. Reverting.");
         return createErrorState("[resolveChallengeOrBlock] Internal error at end of function.", stateBeforeResolve);
    }
    return newState; // Return the state after resolution
}

// New function to handle the decision after being challenged
export async function handleChallengeDecision(gameState: GameState | null, challengedPlayerId: string, decision: ChallengeDecisionType): Promise<GameState> {
    console.log(`[handleChallengeDecision] Entered for player ${challengedPlayerId}, decision: ${decision}.`);
     if (!isValidGameState(gameState)) return createErrorState(`[handleChallengeDecision] Error: gameState is invalid or null for player ${challengedPlayerId}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeDecision = JSON.parse(JSON.stringify(gameState)); // For fallback
    const pendingDecision = newState.pendingChallengeDecision;

    if (!pendingDecision || pendingDecision.challengedPlayerId !== challengedPlayerId) {
        const errorMsg = `[handleChallengeDecision] Error: No pending challenge decision found for player ${challengedPlayerId}. Current pending: ${JSON.stringify(pendingDecision)}`;
        return createErrorState(errorMsg, newState);
    }
    const challengedPlayer = getPlayerById(newState, challengedPlayerId);
    const challenger = getPlayerById(newState, pendingDecision.challengerId);

     if(!challengedPlayer || !challenger) {
         const errorMsg = `[handleChallengeDecision] Error: Challenged player (${challengedPlayerId}) or challenger (${pendingDecision.challengerId}) not found.`;
          newState.pendingChallengeDecision = null; // Clear invalid phase
         return createErrorState(errorMsg, newState);
     }

    console.log(`[handleChallengeDecision] ${challengedPlayer.name} chose to ${decision} the challenge from ${challenger.name}.`);
    newState = logAction(newState, `${challengedPlayer.name} decides to ${decision}.`);
    // Clear the pending decision phase
    newState.pendingChallengeDecision = null;
    console.log(`[handleChallengeDecision] Cleared pendingChallengeDecision.`);


    if (decision === 'Retreat') {
        console.log(`[handleChallengeDecision] ${challengedPlayer.name} retreats. Action/Block fails.`);
        newState = logAction(newState, `${challengedPlayer.name} retreats. Their claim of ${pendingDecision.actionOrBlock} fails.`);

        // If a BLOCK was challenged and retreated, the original action proceeds
        if (pendingDecision.actionOrBlock.startsWith('Block ')) {
            const originalAction = getActionFromBlock(pendingDecision.actionOrBlock as BlockActionType);
            const originalActionPlayer = getPlayerById(newState, pendingDecision.originalActionPlayerId || ''); // Use stored ID
            const originalTargetPlayer = getPlayerById(newState, pendingDecision.originalTargetPlayerId || ''); // Use stored ID

            if (originalAction && originalActionPlayer) {
                 console.log(`[handleChallengeDecision] Block retreated. Original action ${originalAction} by ${originalActionPlayer.name} proceeds.`);
                 newState = logAction(newState, `${challengedPlayer.name}'s block fails due to retreat. ${originalActionPlayer.name}'s ${originalAction} proceeds.`);
                 // Special handling: If the *block* fails, the *action* succeeds now.
                 // This requires calling executeSuccessfulAction for the original action.
                 newState = await executeSuccessfulAction(newState, originalActionPlayer, originalAction, originalTargetPlayer);

            } else {
                 const errorMsg = `[handleChallengeDecision] Error: Could not resolve original action after block retreat.`;
                 newState = logAction(newState, errorMsg);
                 newState = await advanceTurn(newState); // Advance turn to prevent stall
            }
        } else {
            // If an ACTION was challenged and retreated, simply advance the turn
            newState = await advanceTurn(newState);
        }

    } else { // Decision is 'Proceed'
        console.log(`[handleChallengeDecision] ${challengedPlayer.name} proceeds. Calling executeChallengeResolution...`);
        // Call the actual challenge resolution logic
        newState = await executeChallengeResolution(newState, challengedPlayerId, pendingDecision.challengerId, pendingDecision.actionOrBlock);
        console.log(`[handleChallengeDecision] Returned from executeChallengeResolution.`);

    }

    // Added safety check to ensure a valid GameState is returned
    if (!isValidGameState(newState)) {
        console.error("[handleChallengeDecision] Error: newState became invalid after processing decision. Reverting.");
        return createErrorState("[handleChallengeDecision] Internal error after processing decision.", stateBeforeDecision);
    }

    console.log(`[handleChallengeDecision] Exiting for player ${challengedPlayerId}.`);
    return newState;
}


// Extracted logic for actually resolving the challenge AFTER proceed/retreat decision
async function executeChallengeResolution(gameState: GameState, challengedPlayerId: string, challengerId: string, actionOrBlock: ActionType | BlockActionType): Promise<GameState> {
     console.log(`[executeChallengeResolution] Resolving challenge: ${challengerId} vs ${challengedPlayerId} over ${actionOrBlock}.`);
     let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
     const stateBeforeResolve = JSON.parse(JSON.stringify(gameState)); // For fallback
     const challengedPlayer = getPlayerById(newState, challengedPlayerId);
     const challenger = getPlayerById(newState, challengerId);
     const originalCurrentAction = stateBeforeResolve.currentAction; // Capture original action context for target/cost info

      // Safety Checks
      if (!challengedPlayer || !challenger) {
          const errorMsg = `[executeChallengeResolution] Error: Challenged player (${challengedPlayerId}) or Challenger (${challengerId}) not found.`;
          return createErrorState(errorMsg, newState);
      }

     const requiredCard = getCardForAction(actionOrBlock);

     if (!requiredCard) {
          const errorMsg = `[executeChallengeResolution] Error: Action/Block ${actionOrBlock} cannot be challenged (or logic error).`;
          console.error(errorMsg);
          newState = logAction(newState, errorMsg);
           // Need original context to proceed correctly
           // Assume action proceeds if challenge was invalid? Or block succeeds?
           // If challenge was on a block, block succeeds. If on action, action proceeds.
           const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');

          if(actionOrBlock.startsWith('Block ')) { // Invalid challenge on a block
                const originalAction = getActionFromBlock(actionOrBlock as BlockActionType);
                const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
                newState = logAction(newState, `Invalid challenge on block ${actionOrBlock}. Block by ${challengedPlayer.name} succeeds.`);
                if (originalAction && originalActionPlayer) {
                    newState = logAction(newState, `${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
                }
                newState = await advanceTurn(newState);
          } else { // Invalid challenge on an action
               newState = logAction(newState, `Invalid challenge on action ${actionOrBlock}. Action by ${challengedPlayer.name} proceeds.`);
                // Check for block stage for actions like Assassinate/Steal
               if ((actionOrBlock === 'Assassinate' || actionOrBlock === 'Steal') && originalTarget) {
                    console.log(`[executeChallengeResolution] Invalid challenge on ${actionOrBlock}. Proceeding to block_decision stage.`);
                    newState.challengeOrBlockPhase = {
                        actionPlayer: challengedPlayer, // Original action player
                        action: actionOrBlock as ActionType, // Original action
                        targetPlayer: originalTarget, // Target
                        possibleResponses: [originalTarget], // Only target can block
                        responses: [],
                        stage: 'block_decision',
                        validResponses: actionOrBlock === 'Assassinate' ? ['Block Assassination', 'Allow'] : ['Block Stealing', 'Allow'],
                    };
                    newState = logAction(newState, `${originalTarget.name}, do you block ${actionOrBlock} with ${actionOrBlock === 'Assassinate' ? 'Contessa' : 'Captain/Ambassador'} or allow?`);
                    newState = await triggerAIResponses(newState);
               } else {
                    // Execute other actions directly
                    newState = await executeSuccessfulAction(newState, challengedPlayer, actionOrBlock as ActionType, originalTarget);
               }
          }
           if (!isValidGameState(newState)) { // Safety check after handling invalid challenge
              console.error("[executeChallengeResolution] Error: newState became invalid after handling invalid challenge. Reverting.");
              return createErrorState("[executeChallengeResolution] Internal error after handling invalid challenge.", stateBeforeResolve);
           }
          return newState;
     }

      // Check if the challenged player has the required card OR the alternative card for stealing block
      const hasRequiredCard = challengedPlayer.influence.some(c => c.type === requiredCard && !c.revealed);
      const hasAlternativeStealCard = actionOrBlock === 'Block Stealing' && challengedPlayer.influence.some(c => c.type === getAlternateCardForStealBlock() && !c.revealed);
      const canProve = hasRequiredCard || hasAlternativeStealCard;
      const cardToReveal = hasRequiredCard ? requiredCard : (hasAlternativeStealCard ? getAlternateCardForStealBlock() : null);


     if (canProve && cardToReveal) {
         // --- Challenge Failed (Challenged Player Proves Claim) ---
         console.log(`[executeChallengeResolution] Challenge failed. ${challengedPlayer.name} has ${cardToReveal}.`);
         newState = logAction(newState, `${challengedPlayer.name} reveals ${cardToReveal} to prove the challenge wrong.`);
         // Player reveals the specific card, shuffles it back, draws a new one.
         const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
         if (playerIndex !== -1) {
              // Find the first instance of the required card that is not revealed
             const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === cardToReveal && !c.revealed);
             if (cardIndex !== -1) {
                 // Temporarily store the card type, remove from influence
                 const cardTypeToShuffle = newState.players[playerIndex].influence[cardIndex].type;
                 let currentInfluence = [...newState.players[playerIndex].influence];
                  currentInfluence.splice(cardIndex, 1); // Remove the card

                  // Shuffle back and draw
                  newState.deck = returnCardToDeck(newState.deck, cardTypeToShuffle);
                  const { card: newCard, remainingDeck } = drawCard(newState.deck);
                  newState.deck = remainingDeck;
                  if (newCard) {
                      currentInfluence.push({ type: newCard, revealed: false }); // Add new card
                      newState = logAction(newState, `${challengedPlayer.name} shuffles back ${cardTypeToShuffle} and draws a new card.`);
                       console.log(`[executeChallengeResolution] ${challengedPlayer.name} drew ${newCard}.`);
                  } else {
                      newState = logAction(newState, `${challengedPlayer.name} shuffles back ${cardTypeToShuffle} but could not draw a new card (deck empty?).`);
                       console.warn(`[executeChallengeResolution] Deck empty, ${challengedPlayer.name} could not draw replacement.`);
                  }
                  // Update player state immutably
                  newState.players[playerIndex] = { ...newState.players[playerIndex], influence: currentInfluence };

             } else {
                  const errorMsg = `Error: ${challengedPlayer.name} had ${cardToReveal} but couldn't find unrevealed instance? Unrevealed: [${challengedPlayer.influence.filter(c => !c.revealed).map(c => c.type).join(', ')}]`;
                  newState = logAction(newState, errorMsg);
                  console.error(`[executeChallengeResolution] Logic error: Cannot find unrevealed ${cardToReveal} for ${challengedPlayer.name}`);
                   // As a fallback, force reveal any unrevealed card to prevent game getting stuck
                   newState = await setPlayerNeedsToReveal(newState, challengedPlayerId); // Await reveal handling
             }
         }

         // Challenger loses influence
         newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
          console.log(`[executeChallengeResolution] Challenger ${challenger.name} must reveal.`);
         const stateAfterChallengerReveal = await setPlayerNeedsToReveal(newState, challengerId); // Await reveal handling


          // If challenge failed, the original action/block proceeds *after* the reveal is handled.
           console.log(`[executeChallengeResolution] Challenge failed. Original claim (${actionOrBlock}) by ${challengedPlayer.name} will proceed after challenger reveal.`);
            // Store pending action
           newState = { // Create new object to ensure flag isn't overwritten by reveal state
              ...stateAfterChallengerReveal, // Start with the state AFTER the reveal
               pendingActionAfterReveal: {
                  type: actionOrBlock.startsWith('Block ') ? 'block_succeeds' : 'action_proceeds',
                  claimerId: challengedPlayerId,
                  actionOrBlock: actionOrBlock,
                  originalTargetId: originalCurrentAction?.target?.id,
                  originalActionPlayerId: originalCurrentAction?.player?.id,
                  // Store challenger ID to check if they are eliminated after reveal
                  loserId: challengerId,
              }
           };


           // If the challenger was AI, their reveal already happened inside setPlayerNeedsToReveal
           // We can immediately process the pending action.
           if (challenger.isAI) {
                console.log("[executeChallengeResolution] AI challenger reveal complete. Processing pending action immediately.");
                newState = await processPendingActionAfterReveal(newState); // Process the pending action
           } else {
                console.log("[executeChallengeResolution] Human challenger needs to reveal. Action will proceed afterwards.");
                // newState remains waiting for human reveal
           }
            // Ensure we return a valid state even if we're waiting
            if (!isValidGameState(newState)) {
                console.error("[executeChallengeResolution] Error: newState became invalid after setting pending action (challenge failed). Reverting.");
                return createErrorState("[executeChallengeResolution] Internal error setting pending action (challenge failed).", stateBeforeResolve);
            }
           return newState; // Return state waiting for human reveal OR after processing AI reveal


     } else {
          // --- Challenge Successful (Challenged Player Bluffed) ---
         console.log(`[executeChallengeResolution] Challenge successful! ${challengedPlayer.name} bluffed ${actionOrBlock}.`);
         newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge with ${requiredCard} ${actionOrBlock === 'Block Stealing' ? `or ${getAlternateCardForStealBlock()}`: ''} and loses influence.`);
         // Challenged player loses influence because they bluffed
         const stateAfterBlufferReveal = await setPlayerNeedsToReveal(newState, challengedPlayerId); // Await reveal handling

         // Action/Block fails because bluff was called.
          console.log(`[executeChallengeResolution] Bluff called. ${challengedPlayer.name}'s claim for ${actionOrBlock} fails.`);

           // Store the next step (which is usually advancing the turn, or proceeding with original action if block failed)
           newState = { // Create new object
              ...stateAfterBlufferReveal, // Start with state after reveal
               pendingActionAfterReveal: {
                   type: actionOrBlock.startsWith('Block ') ? 'block_fails_action_proceeds' : 'action_fails_turn_advances',
                   originalAction: actionOrBlock.startsWith('Block ') ? getActionFromBlock(actionOrBlock as BlockActionType) : null,
                   originalActionPlayerId: actionOrBlock.startsWith('Block ') ? originalCurrentAction?.player?.id : null,
                   originalTargetId: actionOrBlock.startsWith('Block ') ? originalCurrentAction?.target?.id : null,
                    // Store the player who lost influence due to the bluff
                   loserId: challengedPlayerId,
                   failedClaim: actionOrBlock, // Store what claim failed
               }
           };

           // If the bluffer was AI, their reveal already happened. Process the pending action.
           if (challengedPlayer.isAI) {
                console.log("[executeChallengeResolution] AI bluffer reveal complete. Processing pending action immediately.");
               newState = await processPendingActionAfterReveal(newState); // Process the pending action
           } else {
                console.log("[executeChallengeResolution] Human bluffer needs to reveal. Consequence will apply afterwards.");
               // newState remains waiting for human reveal
           }
            // Ensure we return a valid state even if we're waiting
            if (!isValidGameState(newState)) {
                console.error("[executeChallengeResolution] Error: newState became invalid after setting pending action (challenge succeeded). Reverting.");
                return createErrorState("[executeChallengeResolution] Internal error setting pending action (challenge succeeded).", stateBeforeResolve);
            }
            return newState; // Return state waiting for human reveal OR after processing AI reveal
     }
}


export async function processPendingActionAfterReveal(gameState: GameState | null): Promise<GameState> {
      if (!isValidGameState(gameState) || !gameState.pendingActionAfterReveal) {
         // console.log("[processPendingActionAfterReveal] No pending action found or invalid state."); // Too noisy
         return gameState || createErrorState("[processPendingActionAfterReveal] Error: gameState is null or invalid and no pending action.");
     }
    console.log("[processPendingActionAfterReveal] Processing action after reveal...");
    let newState = JSON.parse(JSON.stringify(gameState));
    const stateBeforeProcess = JSON.parse(JSON.stringify(gameState)); // Fallback
    const pendingAction = newState.pendingActionAfterReveal;
     // Clear the pending action flag immediately
    newState.pendingActionAfterReveal = null;
    console.log(`[processPendingActionAfterReveal] Pending action data:`, pendingAction);


    // Check if the player who lost influence (loserId) is now eliminated
    const loserPlayer = pendingAction.loserId ? getPlayerById(newState, pendingAction.loserId) : null;
    const loserEliminated = loserPlayer ? !getActivePlayers(newState).some(p => p.id === pendingAction.loserId) : false;

    if (loserEliminated && loserPlayer) {
        console.log(`[processPendingActionAfterReveal] Player ${loserPlayer.name} (ID: ${pendingAction.loserId}) was eliminated by the reveal.`);
        newState = logAction(newState, `${loserPlayer.name} was eliminated!`);
        // Check for game winner immediately after elimination
        const winner = checkForWinner(newState);
        if (winner) {
            newState.winner = winner;
            newState = logAction(newState, `${winner.name} has won the game!`);
            console.log(`[processPendingActionAfterReveal] Game Over! Winner: ${winner.name}`);
            return newState; // End processing early if game over
        }
    } else {
        // console.log(`[processPendingActionAfterReveal] Player who lost influence (ID: ${pendingAction.loserId}) is still active or ID missing.`); // Too noisy
    }

    // --- Resume based on stored action type ---
     switch (pendingAction.type) {
        case 'action_proceeds': { // Challenge failed, original action proceeds
             const claimer = getPlayerById(newState, pendingAction.claimerId);
             const originalTarget = getPlayerById(newState, pendingAction.originalTargetId);
             if (claimer) {
                 console.log(`[processPendingActionAfterReveal] Reveal complete. Original action ${pendingAction.actionOrBlock} by ${claimer.name} proceeds.`);
                 newState = logAction(newState, `Challenge failed. ${claimer.name}'s ${pendingAction.actionOrBlock} proceeds.`);
                 if ((pendingAction.actionOrBlock === 'Assassinate' || pendingAction.actionOrBlock === 'Steal') && originalTarget) {
                      console.log(`[processPendingActionAfterReveal] ${pendingAction.actionOrBlock} claim proceeding to block decision stage.`);
                     newState.challengeOrBlockPhase = {
                         actionPlayer: claimer,
                         action: pendingAction.actionOrBlock as ActionType,
                         targetPlayer: originalTarget,
                         possibleResponses: [originalTarget],
                         responses: [],
                         stage: 'block_decision',
                         validResponses: pendingAction.actionOrBlock === 'Assassinate' ? ['Block Assassination', 'Allow'] : ['Block Stealing', 'Allow'],
                     };
                     newState = logAction(newState, `${originalTarget.name}, do you block ${pendingAction.actionOrBlock} with ${pendingAction.actionOrBlock === 'Assassinate' ? 'Contessa' : 'Captain/Ambassador'} or allow?`);
                     newState = await triggerAIResponses(newState);
                 } else {
                     // For Tax, Exchange, Foreign Aid actions, execute them now.
                     newState = await executeSuccessfulAction(newState, claimer, pendingAction.actionOrBlock as ActionType, originalTarget);
                 }
             } else {
                  const errorMsg = `[processPendingActionAfterReveal] Error: Original claimer ${pendingAction.claimerId} not found.`;
                  newState = createErrorState(errorMsg, newState);
                  newState = await advanceTurn(newState); // Advance turn to prevent stall
             }
             break;
         }
         case 'block_succeeds': { // Challenge failed, original block proceeds
             const claimer = getPlayerById(newState, pendingAction.claimerId); // Blocker
             const originalActionPlayer = getPlayerById(newState, pendingAction.originalActionPlayerId);
             const originalAction = getActionFromBlock(pendingAction.actionOrBlock as BlockActionType);
             if (claimer && originalActionPlayer && originalAction) {
                 console.log(`[processPendingActionAfterReveal] Reveal complete. Block ${pendingAction.actionOrBlock} by ${claimer.name} succeeds.`);
                 newState = logAction(newState, `${claimer.name}'s block is successful. ${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
             } else {
                 newState = logAction(newState, `[processPendingActionAfterReveal] Block successful, original action cancelled.`);
             }
             newState = await advanceTurn(newState);
             break;
         }
        case 'block_fails_action_proceeds': { // Challenge succeeded (block bluffed), original action proceeds
             const originalActionPlayer = getPlayerById(newState, pendingAction.originalActionPlayerId);
             const originalTarget = getPlayerById(newState, pendingAction.originalTargetId);
             const failedBlockerId = pendingAction.loserId; // The player who bluffed the block
             const failedBlocker = getPlayerById(newState, failedBlockerId);

             if (pendingAction.originalAction && originalActionPlayer && failedBlocker) {
                 console.log(`[processPendingActionAfterReveal] Bluffer (${failedBlocker.name}) reveal complete. Original action ${pendingAction.originalAction} by ${originalActionPlayer.name} proceeds.`);
                  newState = logAction(newState, `${failedBlocker.name}'s block fails. ${originalActionPlayer.name}'s ${pendingAction.originalAction} proceeds.`);
                 // Action succeeds automatically because block failed
                 newState = await executeSuccessfulAction(newState, originalActionPlayer, pendingAction.originalAction, originalTarget);

             } else {
                  const errorMsg = `[processPendingActionAfterReveal] Error retrieving original action/player/blocker after failed block challenge. ActionPlayer: ${!!originalActionPlayer}, Blocker: ${!!failedBlocker}`;
                  newState = createErrorState(errorMsg, newState);
                  newState = await advanceTurn(newState); // Advance to prevent stall
             }
             break;
         }
         case 'action_fails_turn_advances': { // Challenge succeeded (action bluffed), turn advances
             const failedClaimerId = pendingAction.loserId; // The player who bluffed the action
             const failedClaimerPlayer = getPlayerById(newState, failedClaimerId);
             if (failedClaimerPlayer) {
                 console.log(`[processPendingActionAfterReveal] Bluffer (${failedClaimerPlayer.name}) reveal complete. Action ${pendingAction.failedClaim} cancelled.`);
                 newState = logAction(newState, `${failedClaimerPlayer.name}'s ${pendingAction.failedClaim} is cancelled.`);
             } else {
                 newState = logAction(newState, `[processPendingActionAfterReveal] Bluffed action cancelled.`);
             }
              // Refund rule: NO REFUND
             newState = await advanceTurn(newState);
             break;
         }
         default:
             console.warn(`[processPendingActionAfterReveal] Unknown pending action type: ${pendingAction.type}`);
             newState = await advanceTurn(newState); // Advance turn as a fallback
     }

     // Final validation
     if (!isValidGameState(newState)) {
          console.error("[processPendingActionAfterReveal] Error: newState became invalid at end of processing. Reverting.");
          return createErrorState("[processPendingActionAfterReveal] Internal error at end of processing.", stateBeforeProcess);
     }
    return newState;
}



async function executeSuccessfulAction(gameState: GameState | null, player: Player, action: ActionType, target?: Player): Promise<GameState> {
      if (!isValidGameState(gameState)) return createErrorState(`[executeSuccessfulAction] Error: gameState is invalid or null for player ${player?.id}.`);
    console.log(`[executeSuccessfulAction] Executing successful ${action} for ${player.name}${target ? ` targeting ${target.name}`: ''}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeExecute = JSON.parse(JSON.stringify(gameState)); // Fallback
    const playerIndex = newState.players.findIndex(p => p.id === player.id);
    const targetIndex = target ? newState.players.findIndex(p => p.id === target.id) : -1;

     // Ensure target is still active before applying effect
     // Refresh target player state from potentially modified newState
     const currentTarget = targetIndex !== -1 ? newState.players[targetIndex] : undefined;
     const targetStillActive = currentTarget ? getActivePlayers(newState).some(p => p.id === currentTarget.id) : true; // Assume true if no target

    // Refresh player state
    const currentPlayer = playerIndex !== -1 ? newState.players[playerIndex] : undefined;
     if (!currentPlayer) {
          const errorMsg = `[executeSuccessfulAction] Error: Player ${player.id} not found in current state.`;
         return createErrorState(errorMsg, newState);
     }

    switch (action) {
        case 'Foreign Aid':
             if (playerIndex !== -1) {
                const amount = Math.min(2, newState.treasury);
                 const newMoney = currentPlayer.money + amount;
                 const newTreasury = newState.treasury - amount;
                 newState.players[playerIndex] = { ...currentPlayer, money: newMoney };
                 newState.treasury = newTreasury;
                 newState = logAction(newState, `${currentPlayer.name}'s Foreign Aid succeeded. Now has ${newMoney} coins.`);
                 console.log(`[executeSuccessfulAction] Foreign Aid success. ${currentPlayer.name} now has ${newMoney} coins.`);
            }
            newState = await advanceTurn(newState);
            break;
        case 'Tax':
            if (playerIndex !== -1) {
                const amount = Math.min(3, newState.treasury);
                 const newMoney = currentPlayer.money + amount;
                 const newTreasury = newState.treasury - amount;
                 newState.players[playerIndex] = { ...currentPlayer, money: newMoney };
                 newState.treasury = newTreasury;
                 newState = logAction(newState, `${currentPlayer.name}'s Tax succeeded. Now has ${newMoney} coins.`);
                  console.log(`[executeSuccessfulAction] Tax success. ${currentPlayer.name} now has ${newMoney} coins.`);
            }
             newState = await advanceTurn(newState);
            break;
        case 'Assassinate':
             // This case is now handled within the challenge resolution logic or assassination confirmation
             // If it gets here, it means it was allowed or the block was accepted/failed challenge.
             if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive && currentTarget) {
                 // Cost was already paid on attempt
                  console.log(`[executeSuccessfulAction] Assassination success against ${currentTarget.name}. Target must reveal.`);
                 newState = logAction(newState, `Assassination against ${currentTarget.name} succeeds.`);
                 // Set flag for target reveal
                 newState = await setPlayerNeedsToReveal(newState, currentTarget.id); // Await reveal handling
                 // Turn advances *after* reveal

             } else if (targetIndex !== -1 && (!targetStillActive || !currentTarget)) {
                  const infoMsg = `Assassination target ${target?.name || target?.id} was already eliminated or not found.`;
                  console.log(`[executeSuccessfulAction] ${infoMsg}`);
                  newState = logAction(newState, infoMsg);
                   newState = await advanceTurn(newState); // Advance if target gone
             } else if (playerIndex === -1) { // Should be caught earlier, but safety check
                  const errorMsg = `[executeSuccessfulAction] Assassin ${player.id} not found.`;
                  console.error(errorMsg);
                  newState = logAction(newState, errorMsg);
                   newState = await advanceTurn(newState); // Advance on error
             }
             break;
        case 'Steal':
            if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive && currentTarget) {
                 const amount = Math.min(2, currentTarget.money);
                 if (amount > 0) {
                     const playerNewMoney = currentPlayer.money + amount;
                     const targetNewMoney = currentTarget.money - amount;
                     newState.players[playerIndex] = { ...currentPlayer, money: playerNewMoney };
                     newState.players[targetIndex] = { ...currentTarget, money: targetNewMoney };
                     newState = logAction(newState, `${currentPlayer.name} successfully stole ${amount} coins from ${currentTarget.name}. ${currentPlayer.name} now has ${playerNewMoney}, ${currentTarget.name} now has ${targetNewMoney}.`);
                      console.log(`[executeSuccessfulAction] Steal success. ${currentPlayer.name} now has ${playerNewMoney}, ${currentTarget.name} now has ${targetNewMoney}.`);
                 } else {
                     const infoMsg = `${currentPlayer.name} successfully stole from ${currentTarget.name}, but they had no coins.`;
                      newState = logAction(newState, infoMsg);
                      console.log(`[executeSuccessfulAction] Steal success, but target ${currentTarget.name} had 0 coins.`);
                 }
             } else if(targetIndex !== -1 && (!targetStillActive || !currentTarget)) {
                  const infoMsg = `Steal target ${target?.name || target?.id} was already eliminated or not found.`;
                  console.log(`[executeSuccessfulAction] ${infoMsg}`);
                  newState = logAction(newState, infoMsg);
             } else if (playerIndex === -1) { // Safety check
                  const errorMsg = `[executeSuccessfulAction] Stealer ${player.id} not found.`;
                  console.error(errorMsg);
                  newState = logAction(newState, errorMsg);
             }
              newState = await advanceTurn(newState);
            break;
        case 'Exchange':
             console.log(`[executeSuccessfulAction] Exchange approved, initiating exchange process for ${currentPlayer.name}.`);
            newState = await initiateExchange(newState, currentPlayer); // await exchange initiation

             // Turn advances after exchange completion (handled in completeExchange)
            break;
        // Income and Coup are handled directly and don't go through challenge phase or this function
        default:
             const warnMsg = `[executeSuccessfulAction] Action ${action} completed successfully (no specific execution logic needed here).`;
             console.warn(warnMsg);
             newState = logAction(newState, `Action ${action} completed successfully.`);
             newState = await advanceTurn(newState);
    }

    // Added safety check to ensure a valid GameState is returned
     if (!isValidGameState(newState)) {
         console.error("[executeSuccessfulAction] Error: newState became invalid after executing action. Reverting.");
         return createErrorState("[executeSuccessfulAction] Internal error after executing action.", stateBeforeExecute);
     }


    return newState;
}



export async function advanceTurn(gameState: GameState | null): Promise<GameState> {
    console.log("[advanceTurn] Advancing turn...");
     if (!isValidGameState(gameState)) {
        const errorMsg = "[advanceTurn] Error: gameState is invalid or null.";
        console.error(errorMsg);
        return createErrorState(errorMsg, gameState); // Pass potentially invalid state for context
    }

    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeAdvance = JSON.parse(JSON.stringify(gameState)); // Fallback

     // Check if there is a pending action after a reveal that needs processing
     if (newState.pendingActionAfterReveal) {
         console.log("[advanceTurn] Pending action found after reveal. Processing it now instead of advancing turn.");
         return await processPendingActionAfterReveal(newState);
     }
     // Check if someone still needs to reveal influence
     if (newState.playerNeedsToReveal) {
         console.log(`[advanceTurn] Waiting for player ${newState.playerNeedsToReveal} to reveal influence. Turn not advanced.`);
         return newState;
     }

    // 1. Check for Winner *before* advancing index
    const winner = checkForWinner(newState);
    if (winner) {
        if (!newState.winner) { // Set winner only if not already set
             newState.winner = winner;
             newState = logAction(newState, `${winner.name} has won the game!`);
             console.log(`[advanceTurn] Winner found: ${winner.name}. Returning final state.`);
        } else {
            console.log(`[advanceTurn] Winner already set: ${newState.winner.name}. Returning final state.`);
        }
        newState.needsHumanTriggerForAI = false; // Game over, no trigger needed
        newState.currentAction = null; // Ensure current action is cleared on game end
        newState.challengeOrBlockPhase = null; // Clear any lingering phase
        newState.pendingChallengeDecision = null;
        newState.pendingAssassinationConfirmation = null;
        newState.pendingExchange = null;
        newState.playerNeedsToReveal = null;
        newState.pendingActionAfterReveal = null;
        return newState; // Return immediately if game is over
    }

     // 2. Clear transient states
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision || newState.currentAction || newState.pendingAssassinationConfirmation || newState.playerNeedsToReveal || newState.pendingActionAfterReveal) {
        console.log("[advanceTurn] Clearing transient states before advancing turn.");
         newState.challengeOrBlockPhase = null;
         newState.pendingExchange = null;
         newState.pendingChallengeDecision = null;
         newState.pendingAssassinationConfirmation = null;
         newState.currentAction = null;
         newState.playerNeedsToReveal = null;
         newState.pendingActionAfterReveal = null;
     }


    // 3. Get next active player index
    const nextPlayerIndex = getNextPlayerIndex(newState.currentPlayerIndex, newState.players);
     newState.currentPlayerIndex = nextPlayerIndex;
    const nextPlayer = newState.players[nextPlayerIndex];
     if (!nextPlayer) { // Safety check
          const errorMsg = `[advanceTurn] Error: Could not find next player at index ${nextPlayerIndex}.`;
          return createErrorState(errorMsg, newState); // Return error state
     }
    newState = logAction(newState, `--- ${nextPlayer.name}'s turn ---`);
    console.log(`[advanceTurn] New turn for player index ${nextPlayerIndex}: ${nextPlayer.name} (${nextPlayer.isAI ? 'AI' : 'Human'})`);


    // 4. If the new current player is AI, set the flag to wait for human trigger
    if (nextPlayer.isAI) {
        console.log(`[advanceTurn] New player ${nextPlayer.name} is AI. Setting needsHumanTriggerForAI flag.`);
        newState.needsHumanTriggerForAI = true; // Set flag for UI
        // DO NOT call handleAIAction here anymore. UI will trigger it.
    } else {
         // 5. If the new player is Human, clear the flag and return. UI waits for input.
         console.log(`[advanceTurn] New player ${nextPlayer.name} is Human. Clearing needsHumanTriggerForAI flag.`);
         newState.needsHumanTriggerForAI = false; // Clear flag
    }
    // Ensure we return a valid state
    if (!isValidGameState(newState)) {
         console.error("[advanceTurn] Error: newState became invalid at end of function. Reverting.");
         return createErrorState("[advanceTurn] Internal error at end of function.", stateBeforeAdvance);
    }

    console.log("[advanceTurn] Exiting successfully.");
    return newState; // Return the updated state.
}



function getCardForAction(action: ActionType | BlockActionType): CardType | null {
    switch (action) {
        case 'Tax': return 'Duke';
        case 'Assassinate': return 'Assassin';
        case 'Steal': return 'Captain';
        case 'Exchange': return 'Ambassador';
        // Handle challenge *against blocks* (checking the blocker's claim)
        case 'Block Foreign Aid': return 'Duke';
        case 'Block Stealing': return 'Captain'; // Primary card for blocking steal (or Ambassador)
        case 'Block Assassination': return 'Contessa';
        default: return null; // Income, Foreign Aid, Coup cannot be challenged based on card claim
    }
}

// Use this specifically for resolving block challenges - finds the card(s) the blocker needs
function getCardForBlock(block: BlockActionType): CardType | null {
    switch (block) {
        case 'Block Foreign Aid': return 'Duke';
        case 'Block Stealing': return 'Captain'; // Can also be Ambassador, handled in resolveChallenge
        case 'Block Assassination': return 'Contessa';
        default: return null;
    }
}

function getAlternateCardForStealBlock(): CardType {
    return 'Ambassador';
}

// Find which block corresponds to an action
function getBlockTypeForAction(action: ActionType): BlockActionType | null {
     switch (action) {
        case 'Foreign Aid': return 'Block Foreign Aid';
        case 'Steal': return 'Block Stealing';
        case 'Assassinate': return 'Block Assassination';
        default: return null;
    }
}


// Need a function to map block type back to original action if block fails challenge
function getActionFromBlock(block: BlockActionType): ActionType | null {
     switch (block) {
        case 'Block Foreign Aid': return 'Foreign Aid';
        case 'Block Stealing': return 'Steal'; // Changed from 'Steal' to 'Block Stealing' -> 'Steal'
        case 'Block Assassination': return 'Assassinate';
        default: return null;
    }
}


// --- AI Logic Integration ---

// Function to get available actions for a player
function getAvailableActions(player: Player, gameState: GameState): ActionType[] {
    const actions: ActionType[] = [];
     // Check if eliminated
    if (!player.influence.some(c => !c.revealed)) {
        // console.log(`[getAvailableActions] Player ${player.name} is eliminated. No actions available.`); // Too noisy
        return [];
    }

    if (player.money >= 10) {
        console.log(`[getAvailableActions] Player ${player.name} has >= 10 coins. Must Coup.`);
        // Need to check if Coup is possible (i.e., if there are targets)
         const activeOpponents = getActivePlayers(gameState).filter(p => p.id !== player.id);
        if (activeOpponents.length > 0) {
            return ['Coup']; // Must Coup if money is 10 or more and targets exist
        } else {
             console.log(`[getAvailableActions] Player ${player.name} has >= 10 coins but no targets for Coup. Allowing other actions.`);
             // Fall through to allow other actions if no targets exist (edge case)
        }
    }

     actions.push('Income');
     actions.push('Foreign Aid');
    if (player.money >= 7) {
        actions.push('Coup');
    }
    actions.push('Tax'); // Can always claim Duke
    if (player.money >= 3) {
        actions.push('Assassinate'); // Can always claim Assassin
    }
    actions.push('Steal'); // Can always claim Captain
    actions.push('Exchange'); // Can always claim Ambassador

    // Filter out actions targeting non-existent/eliminated players
    const activeOpponents = getActivePlayers(gameState).filter(p => p.id !== player.id);
     if (activeOpponents.length === 0) {
         // console.log(`[getAvailableActions] No active opponents for ${player.name}. Filtering target actions.`); // Too noisy
        return actions.filter(a => a !== 'Coup' && a !== 'Assassinate' && a !== 'Steal');
    }

    // console.log(`[getAvailableActions] Available actions for ${player.name}: ${actions.join(', ')}`);
    return actions;
}

// Generate a simple text description of the game state for the AI
// Include AI player's own cards for better context
function generateGameStateDescription(gameState: GameState | null, aiPlayerId: string): string {
    if (!gameState) {
      return "Error: Game state is null."; // Handle null case
    }
    let description = "Current Game State:\n";
    const aiPlayer = getPlayerById(gameState, aiPlayerId); // Uses safe version
    if (aiPlayer) {
        const unrevealedCards = aiPlayer.influence.filter(c => !c.revealed).map(c => c.type);
        const revealedCards = aiPlayer.influence.filter(c => c.revealed).map(c => c.type);
        description += `You are ${aiPlayer.name}. Money: ${aiPlayer.money}. Unrevealed Influence: [${unrevealedCards.join(', ') || 'None'}]. Revealed Influence: [${revealedCards.join(', ') || 'None'}].\n`;
    } else {
         description += `Generating context (not specific to one AI player).\n`; // For general context scenarios
    }
    description += "All Players Status:\n";
    gameState.players.forEach(p => {
        const influenceStatus = p.influence.map(inf => inf.revealed ? `Revealed ${inf.type}` : 'Hidden').join(', ');
        const activeStatus = p.influence.some(inf => !inf.revealed) ? "(Active)" : "(Eliminated)";
        description += `- ${p.name} (${p.isAI ? 'AI' : 'Human'}) ${activeStatus}: ${p.money} coins, Influence: [${influenceStatus}]\n`;
    });
    description += `Deck has ${gameState.deck.length} cards left.\n`;
    description += `Treasury has ${gameState.treasury} coins.\n`;
     if(gameState.currentAction) {
         // Describe the *attempted* action, including cost if relevant
         let actionDesc = `${gameState.currentAction.player.name} attempting ${gameState.currentAction.action}`;
         if(gameState.currentAction.target) actionDesc += ` targeting ${gameState.currentAction.target.name}`;
         if(gameState.currentAction.cost) {
             // Get the money *from the current state* as cost is paid upfront
             const playerCurrentMoney = getPlayerById(gameState, gameState.currentAction.player.id)?.money ?? gameState.currentAction.player.money;
             const moneyBeforeCost = playerCurrentMoney + gameState.currentAction.cost;
             actionDesc += ` (Cost: ${gameState.currentAction.cost}, Money before: ${moneyBeforeCost}, Money now: ${playerCurrentMoney})`;
         } else {
             actionDesc += ` (Money: ${gameState.currentAction.player.money})`;
         }
         description += `Current Action Attempt: ${actionDesc}.\n`;
     }
     if(gameState.challengeOrBlockPhase) {
          const phase = gameState.challengeOrBlockPhase;
           const phaseDesc = phase.stage === 'challenge_action' ? `claim of ${phase.action}`
                            : phase.stage === 'block_decision' ? `action ${phase.action}`
                            : phase.stage === 'challenge_block' ? `claim of ${phase.action}`
                            : phase.action;
           const possibleResponderNames = phase.possibleResponses.filter(p => !phase.responses.some(r => r.playerId === p.id)).map(p => p.name).join(', ');
           const currentResponseDesc = phase.responses.map(r => `${getPlayerById(gameState, r.playerId)?.name}: ${r.response}`).join('; ') || 'None';
          description += `Challenge/Block Phase (Stage: ${phase.stage || 'N/A'}): ${phase.actionPlayer.name}'s ${phaseDesc} ${phase.targetPlayer ? ` targeting ${phase.targetPlayer.name}`: ''} is being considered. Responses needed from: ${possibleResponderNames || 'None'}. Current responses: ${currentResponseDesc}.\n`;
     }
      if(gameState.pendingChallengeDecision) {
          const phase = gameState.pendingChallengeDecision;
          const challengerName = getPlayerById(gameState, phase.challengerId)?.name || 'Unknown';
          const challengedName = getPlayerById(gameState, phase.challengedPlayerId)?.name || 'Unknown';
          description += `Pending Challenge Decision: ${challengerName} challenged ${challengedName}'s claim of ${phase.actionOrBlock}. ${challengedName} must decide to proceed or retreat.\n`;
      }
       if(gameState.pendingAssassinationConfirmation) {
           const phase = gameState.pendingAssassinationConfirmation;
            const contessaName = getPlayerById(gameState, phase.contessaPlayerId)?.name || 'Unknown';
            const assassinName = getPlayerById(gameState, phase.assassinPlayerId)?.name || 'Unknown';
            description += `Pending Assassination Confirmation: ${contessaName} claimed Contessa to block ${assassinName}'s assassination. ${assassinName} must decide whether to challenge the Contessa claim or accept the block.\n`;
       }
     if(gameState.pendingExchange) {
          description += `Pending Exchange: ${gameState.pendingExchange.player.name} is choosing cards from [${gameState.pendingExchange.cardsToChoose.join(', ')}].\n`;
     }
      if(gameState.playerNeedsToReveal) {
          const revealerName = getPlayerById(gameState, gameState.playerNeedsToReveal)?.name || 'Unknown';
          description += `Pending Reveal: ${revealerName} must reveal an influence card.\n`;
      }
     const logEntries = gameState.actionLog.slice(-5); // Get last 5 entries
     description += `Recent Action Log Summary (${logEntries.length} entries):\n${logEntries.map(l => `  - ${l}`).join('\n')}\n`; // Last 5 log entries
    description += `It is currently ${gameState.players[gameState.currentPlayerIndex]?.name || 'Unknown'}'s turn.\n`;
    return description;
}


// Export handleAIAction so it can be called by page.tsx for the first turn or via button trigger
export async function handleAIAction(gameState: GameState | null): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[handleAIAction] Error: gameState is invalid or null.");
    console.log(`[handleAIAction] >>> Entering for ${gameState.players[gameState.currentPlayerIndex]?.name || 'UNKNOWN PLAYER'}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeAIAction = JSON.parse(JSON.stringify(gameState)); // Fallback
    const aiPlayer = newState.players[newState.currentPlayerIndex];

    // Safety checks
    if (!aiPlayer || !aiPlayer.isAI) {
         const errorMsg = `[handleAIAction] Error: Called for non-AI player (${aiPlayer?.name}) or invalid player index (${newState.currentPlayerIndex}).`;
         newState.needsHumanTriggerForAI = false; // Ensure flag is off if error
         return createErrorState(errorMsg, newState);
    }
     if (!aiPlayer.influence.some(c => !c.revealed)) {
         const infoMsg = `[handleAIAction] AI ${aiPlayer.name} is eliminated. Advancing turn.`;
         console.log(infoMsg);
         // Need to advance turn *from* this state
         newState.needsHumanTriggerForAI = false; // Ensure flag is off before advancing
         return await advanceTurn(newState); // Skip turn if AI is eliminated
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision || newState.winner || newState.pendingAssassinationConfirmation || newState.playerNeedsToReveal) {
          const infoMsg = `[handleAIAction] AI ${aiPlayer.name}'s turn skipped: Ongoing phase, needs reveal, or game over. Phase: ${!!newState.challengeOrBlockPhase}, Exchange: ${!!newState.pendingExchange}, ChallengeDecision: ${!!newState.pendingChallengeDecision}, AssassinationConfirm: ${!!newState.pendingAssassinationConfirmation}, NeedsReveal: ${newState.playerNeedsToReveal}, Winner: ${!!newState.winner}`;
         console.log(infoMsg);
         newState.needsHumanTriggerForAI = false; // Ensure flag is off
         return newState; // Don't act if in another phase or waiting for reveal
     }

    // Clear the flag now that the AI is acting
    newState.needsHumanTriggerForAI = false;
    console.log(`[handleAIAction] Cleared needsHumanTriggerForAI flag for ${aiPlayer.name}.`);

    const availableActions = getAvailableActions(aiPlayer, newState);
     if (availableActions.length === 0) {
         // This should theoretically only happen if must Coup but no targets, or eliminated.
          const infoMsg = `[handleAIAction] AI ${aiPlayer.name} has no available actions (Eliminated or no Coup targets?). Advancing turn.`;
         console.log(infoMsg);
         return await advanceTurn(newState);
     }

    const gameStateDescription = generateGameStateDescription(newState, aiPlayer.id);
    const currentOpponentInfo = getActivePlayers(newState)
        .filter(p => p.id !== aiPlayer.id)
        .map(p => ({
            name: p.name,
            money: p.money,
            influenceCount: p.influence.filter(inf => !inf.revealed).length,
            revealedCards: p.influence.filter(inf => inf.revealed).map(inf => inf.type),
        }));

    let stateAfterAction: GameState = newState; // Initialize with current state
    let aiDecisionAction: ActionType | null = null; // Track chosen action for error reporting

    try {
        console.log(`[handleAIAction] Requesting action selection for ${aiPlayer.name} from AI service...`);
        const aiDecision = await selectAction({
            playerMoney: aiPlayer.money,
            playerInfluenceCards: aiPlayer.influence.filter(c => !c.revealed).map(c => c.type), // Pass unrevealed cards
            opponentInfo: currentOpponentInfo, // Pass detailed opponent info
            availableActions,
            gameState: gameStateDescription,
            rulebook: coupRulebook, // Provide rulebook context
        });
        console.log(`[handleAIAction] AI ${aiPlayer.name} raw decision: Action=${aiDecision.action}, Target=${aiDecision.target || 'N/A'}, Reasoning=${aiDecision.reasoning}`);


        // Validate AI action choice
        aiDecisionAction = aiDecision.action as ActionType; // Store for potential error log
         if (!availableActions.includes(aiDecisionAction)) {
            const warnMsg = `[handleAIAction] AI ${aiPlayer.name} chose invalid action '${aiDecisionAction}'. Available: [${availableActions.join(', ')}]. Defaulting to Income. Reasoning: ${aiDecision.reasoning}`;
            console.warn(warnMsg);
             newState = logAction(newState, warnMsg);
             stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
         } else {
              newState = logAction(newState, `AI (${aiPlayer.name}) Reasoning: ${aiDecision.reasoning}`);


              // Find target player if needed
              let targetPlayerId: string | undefined = undefined;
              const needsTarget = ['Coup', 'Assassinate', 'Steal'].includes(aiDecisionAction);

              if (needsTarget) {
                   if (!aiDecision.target) {
                        const warnMsg = `[handleAIAction] AI ${aiPlayer.name} chose ${aiDecisionAction} but provided no target. Picking random active opponent.`;
                        console.warn(warnMsg);
                        const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                        if (activeOpponents.length > 0) {
                            targetPlayerId = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].id;
                            newState = logAction(newState, `AI (${aiPlayer.name}) chose ${aiDecisionAction} without target, targeting random opponent ${getPlayerById(newState, targetPlayerId)?.name}.`);
                        } else {
                             const errorMsg = `[handleAIAction] AI ${aiPlayer.name} chose ${aiDecisionAction}, needs target, but no active opponents! Defaulting to Income.`;
                             console.error(errorMsg);
                             newState = logAction(newState, errorMsg);
                             stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
                             console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name} (Fallback Income)`);
                             return stateAfterAction;
                        }
                   } else {
                       // AI provided target name, try to find ID among *active* opponents
                       const target = getActivePlayers(newState).find(p => p.name === aiDecision.target && p.id !== aiPlayer.id);
                       if (target) {
                           targetPlayerId = target.id;
                           newState = logAction(newState, `AI (${aiPlayer.name}) chose action: ${aiDecisionAction} targeting ${target.name}`); // Log valid target
                           console.log(`[handleAIAction] Found target ${target.name} (${target.id}) for AI action ${aiDecisionAction}.`);
                       } else {
                           const warnMsg = `[handleAIAction] AI ${aiPlayer.name} target '${aiDecision.target}' not found among active opponents or is self. Picking random.`;
                           console.warn(warnMsg);
                           const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                           if (activeOpponents.length > 0) {
                               targetPlayerId = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].id;
                               newState = logAction(newState, `AI (${aiPlayer.name}) target '${aiDecision.target}' invalid, targeting random opponent ${getPlayerById(newState, targetPlayerId)?.name}.`);
                           } else {
                               const errorMsg = `[handleAIAction] AI ${aiPlayer.name} chose ${aiDecisionAction}, target invalid, and no other active opponents! Defaulting to Income.`;
                               console.error(errorMsg);
                               newState = logAction(newState, errorMsg);
                               stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
                               console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name} (Fallback Income)`);
                               return stateAfterAction;
                           }
                       }
                   }
              } else {
                   // Action does not need a target
                  newState = logAction(newState, `AI (${aiPlayer.name}) chose action: ${aiDecisionAction}`);
              }

               // Perform the chosen action - This will handle challenges/blocks and eventually call advanceTurn itself
               console.log(`[handleAIAction] --- Calling performAction for AI: PlayerID=${aiPlayer.id}, Action=${aiDecisionAction}, TargetID=${targetPlayerId || 'N/A'} ---`);
               // performAction now always returns a GameState
               stateAfterAction = await performAction(newState, aiPlayer.id, aiDecisionAction, targetPlayerId);
               console.log(`[handleAIAction] --- Returned from performAction for AI ${aiPlayer.name}'s ${aiDecisionAction}. State updated. ---`);

         }

    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsgLog = `[handleAIAction] AI action selection/execution failed for ${aiPlayer.name}: ${errorMessage}. Action: ${aiDecisionAction || 'Unknown'}. Taking Income.`;
        console.error(errorMsgLog);
        newState = logAction(newState, errorMsgLog);
        stateAfterAction = await performIncome(newState, aiPlayer.id); // Fallback action
    }
     console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name}`);
     // Ensure we always return a valid GameState
     if (!isValidGameState(stateAfterAction)) {
         console.error("[handleAIAction] Error: stateAfterAction became invalid. Reverting.");
         return createErrorState("[handleAIAction] Internal error after AI action.", stateBeforeAIAction);
     }
     return stateAfterAction;
}




// Triggers AI responses during challenge/block phases. Returns the state *after* AIs have responded.
// IMPORTANT: This function MODIFIES the state by calling handlePlayerResponse, and potentially resolveChallengeOrBlock.
// Returns a valid GameState even on error.
async function triggerAIResponses(gameState: GameState | null): Promise<GameState> {
      if (!isValidGameState(gameState)) return createErrorState("[triggerAIResponses] Error: gameState is invalid or null.");
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    let currentPhaseState = newState.challengeOrBlockPhase; // Use the phase from the current state
    let stateBeforeLoop = JSON.parse(JSON.stringify(gameState)); // Keep original state for fallback

     // Safety Check: Ensure phase exists
     if (!currentPhaseState) {
         console.log("[triggerAIResponses] No active challenge/block phase needing AI responses.");
         return newState;
     }

     console.log(`[triggerAIResponses] Phase active: Challenge/Block. Action=${currentPhaseState.action}, Stage=${currentPhaseState.stage}, Possible Responders=${currentPhaseState.possibleResponses.map(p=>p.name).join(',')}, Current Responses=${currentPhaseState.responses.length}`);

    try {
        // Loop while there's an active challenge/block phase and AI responders who haven't responded yet
        while (currentPhaseState && currentPhaseState.possibleResponses.some(p => p.isAI && !currentPhaseState?.responses.some(r => r.playerId === p.id))) {
            // Find the next AI who needs to respond *in the current phase state*
            const aiToAct = currentPhaseState.possibleResponses.find(p => p.isAI && !currentPhaseState?.responses.some(r => r.playerId === p.id));

            if (!aiToAct) {
                console.log("[triggerAIResponses] No more AI responders in this loop iteration based on current phase state.");
                break; // Should not happen if loop condition is correct, but safety break
            }

            // Get the most up-to-date state for the AI making the decision
            const aiPlayerState = getPlayerById(newState, aiToAct.id);
             if (!aiPlayerState) { // Safety check
                 console.error(`[triggerAIResponses] Error: AI Responder ${aiToAct.id} not found in state. Skipping response.`);
                 // Force allow to prevent loop?
                 const updatedResponses = [...currentPhaseState.responses, { playerId: aiToAct.id, response: 'Allow' as GameResponseType }];
                 newState.challengeOrBlockPhase = { ...currentPhaseState, responses: updatedResponses };
                 newState = logAction(newState, `[triggerAIResponses] Error: AI ${aiToAct.id} not found. Forced 'Allow'.`);
                 // Refresh phase pointer after modifying state
                 currentPhaseState = newState.challengeOrBlockPhase; // This might be null if forced allow resolves it
                  if (!currentPhaseState) {
                      console.log("[triggerAIResponses] Phase ended after forced Allow for missing AI.");
                      break; // Phase ended
                  }
                 continue; // Try next AI
             }
             console.log(`[triggerAIResponses] AI Responder: ${aiPlayerState.name} needs to respond to ${currentPhaseState.actionPlayer.name}'s claim/action ${currentPhaseState.action} (Stage: ${currentPhaseState.stage})`);

            let decision: GameResponseType = 'Allow'; // Default
            let reasoning = 'Defaulting to Allow.';
            let decidedResponseType: 'Challenge' | 'Block' | 'Allow' = 'Allow'; // For logging/control flow
            const validStageResponses = currentPhaseState.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination']; // Fallback if not set

            try {
                console.log(`[triggerAIResponses] Getting response from AI ${aiPlayerState.name} for action/block ${currentPhaseState.action}`);
                // AI evaluates options based on the current stage and action
                const actionTarget = currentPhaseState.targetPlayer;
                const actionOrBlockPerformer = currentPhaseState.actionPlayer;
                const actionOrBlockClaim = currentPhaseState.action; // The action or block being claimed/responded to
                const stage = currentPhaseState.stage;

                 // --- AI Decision Logic ---
                let challengeDecision = { shouldChallenge: false, reasoning: "Challenge not applicable/evaluated." };
                let blockDecision = { shouldBlock: false, reasoning: "Block not applicable/evaluated." };

                 // Evaluate Challenge (if possible in this stage/context)
                const canChallengeClaim = getCardForAction(actionOrBlockClaim) !== null; // Can the *current* claim be challenged?
                const shouldEvaluateChallenge = validStageResponses.includes('Challenge') && canChallengeClaim;

                if (shouldEvaluateChallenge) {
                     console.log(`[triggerAIResponses] AI ${aiPlayerState.name} evaluating Challenge against ${actionOrBlockPerformer.name}'s claim of ${actionOrBlockClaim}...`);
                    challengeDecision = await aiChallengeReasoning({
                        actionOrBlock: actionOrBlockClaim,
                        playerName: actionOrBlockPerformer.name,
                        targetPlayerName: actionTarget?.name, // Only relevant if challenging a block
                        aiInfluenceCards: aiPlayerState.influence.filter(c => !c.revealed).map(c => c.type),
                        opponentInfluenceCount: actionOrBlockPerformer.influence.filter(c => !c.revealed).length,
                        // Pass money *as it is currently* in the game state
                        opponentMoney: getPlayerById(newState, actionOrBlockPerformer.id)?.money ?? actionOrBlockPerformer.money,
                        gameState: generateGameStateDescription(newState, aiPlayerState.id),
                        rulebook: coupRulebook,
                    });
                     newState = logAction(newState, `AI (${aiPlayerState.name}) Challenge Reasoning: ${challengeDecision.reasoning}`);
                     console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Challenge decision: ${challengeDecision.shouldChallenge}`);
                }

                // Evaluate Block (if possible in this stage/context)
                const originalActionType = typeof actionOrBlockClaim === 'string' && !actionOrBlockClaim.startsWith('Block ') ? actionOrBlockClaim as ActionType : null;
                const blockTypeForOriginalAction = originalActionType ? getBlockTypeForAction(originalActionType) : null;
                 // Check if *this specific block* is a valid response in the current stage
                 const canConsiderBlock = originalActionType && blockTypeForOriginalAction && validStageResponses.includes(blockTypeForOriginalAction);
                // AI can physically block if it's a blockable action AND (it's FA OR AI is the target)
                const canPhysicallyBlock = canConsiderBlock &&
                                          (originalActionType === 'Foreign Aid' || (actionTarget?.id === aiPlayerState.id));

                 // Only evaluate block if AI can physically block and didn't decide to challenge the action claim
                if (canPhysicallyBlock && blockTypeForOriginalAction && !challengeDecision.shouldChallenge) {
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} evaluating Block (${blockTypeForOriginalAction}) against ${actionOrBlockPerformer.name}'s action ${originalActionType}...`);
                    blockDecision = await aiBlockReasoning({
                        action: originalActionType!, // Original action
                        actionPlayerName: actionOrBlockPerformer.name,
                        aiPlayerInfluenceCards: aiPlayerState.influence.filter(c => !c.revealed).map(c => c.type),
                        aiPlayerMoney: aiPlayerState.money,
                        // Pass money *as it is currently* in the game state
                        opponentInfluenceCount: actionOrBlockPerformer.influence.filter(c => !c.revealed).length,
                        opponentMoney: getPlayerById(newState, actionOrBlockPerformer.id)?.money ?? actionOrBlockPerformer.money,
                        gameState: generateGameStateDescription(newState, aiPlayerState.id),
                        rulebook: coupRulebook,
                    });
                     newState = logAction(newState, `AI (${aiPlayerState.name}) Block Reasoning: ${blockDecision.reasoning}`);
                     console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Block decision: ${blockDecision.shouldBlock}`);
                 }

                // Determine final AI response (Prioritize Challenge > Block > Allow) based on valid options for the stage
                if (shouldEvaluateChallenge && challengeDecision.shouldChallenge) {
                    decision = 'Challenge';
                    reasoning = challengeDecision.reasoning;
                    decidedResponseType = 'Challenge';
                } else if (canPhysicallyBlock && blockTypeForOriginalAction && blockDecision.shouldBlock) {
                     decision = blockTypeForOriginalAction; // Use the specific block type
                     reasoning = blockDecision.reasoning;
                     decidedResponseType = 'Block';
                } else {
                    // If neither challenge nor block is chosen/possible, Allow
                    decision = 'Allow';
                    reasoning = challengeDecision.reasoning || blockDecision.reasoning || 'Decided not to challenge or block.'; // Provide some reasoning
                    decidedResponseType = 'Allow';
                }

                // Final validation: Ensure the chosen decision is valid for the current stage
                if (!validStageResponses.includes(decision)) {
                     console.warn(`[triggerAIResponses] AI ${aiPlayerState.name} chose invalid response '${decision}' for stage '${stage}'. Valid: [${validStageResponses.join(', ')}]. Defaulting to Allow.`);
                     decision = 'Allow';
                     reasoning += ` (Forced Allow due to invalid response for stage)`;
                     decidedResponseType = 'Allow';
                 }

            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorMsgLog = `[triggerAIResponses] AI response generation failed for ${aiPlayerState.name}: ${errorMessage}. Defaulting to Allow.`;
                console.error(errorMsgLog);
                newState = logAction(newState, errorMsgLog);
                decision = 'Allow';
                reasoning = 'Error during decision process.';
                decidedResponseType = 'Allow';
                 // Ensure Allow is valid for the stage, otherwise, this could loop.
                 // If Allow is somehow invalid, we have a bigger logic problem.
                  if (!validStageResponses.includes('Allow')) {
                      console.error(`[triggerAIResponses] CRITICAL ERROR: Allow is not a valid response for stage ${stage}, but AI defaulted to it. Breaking loop.`);
                      break; // Prevent potential infinite loop
                  }
            }

            newState = logAction(newState, `AI (${aiPlayerState.name}) responds: ${decision}.`); // Only log decision for brevity in game log
            console.log(`[triggerAIResponses] AI ${aiPlayerState.name} final response: ${decision}. Reasoning: ${reasoning}`);

            // IMPORTANT: Update the state by calling handlePlayerResponse, which correctly modifies the phase state
            // and potentially resolves the phase or sets up the next challenge/stage.
             const stateAfterResponse = await handlePlayerResponse(newState, aiPlayerState.id, decision); // Await the handling
              newState = stateAfterResponse; // Update newState with the result


            // Refresh phase state *after* the response has been handled
            currentPhaseState = newState.challengeOrBlockPhase; // Phase might have changed or ended
            if (currentPhaseState) {
                 console.log(`[triggerAIResponses] Phase state after AI ${aiPlayerState.name}'s response: Stage=${currentPhaseState.stage}, Possible Responders=${currentPhaseState.possibleResponses.map(p=>p.name).join(',')}, Current Responses=${currentPhaseState.responses.length}`);
            } else {
                console.log(`[triggerAIResponses] Phase resolved after AI ${aiPlayerState.name}'s response (${decision}). Exiting response loop.`);
                break; // Phase ended, exit loop
            }


            // If the AI Challenged or Blocked, the interaction for *this specific claim* usually stops waiting for other responses.
            // The resolution logic (handleChallengeDecision, resolveChallengeOrBlock handling challenge_block stage) handles the next steps.
            if (decidedResponseType !== 'Allow') {
                console.log(`[triggerAIResponses] AI ${aiPlayerState.name} responded with ${decision}. Phase continues or resolves based on challenge/block logic. Exiting loop for this specific claim/stage.`);
                // The state returned by handlePlayerResponse is the correct state to proceed from.
                break; // Exit the loop as the phase has changed significantly or resolved for this specific claim.
            }

            // If AI Allowed, loop continues to the next AI responder if any.
            console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Allowed. Checking for more AI responders.`);
             // Update stateBeforeLoop for the next iteration's fallback
             stateBeforeLoop = JSON.parse(JSON.stringify(newState));


        } // End AI responder loop
    } catch (outerError: any) {
         const errorMsg = `[triggerAIResponses] Critical error during AI response loop: ${outerError.message}. Reverting phase.`;
         console.error(errorMsg);
        // Attempt to return the state before the loop started to prevent inconsistent state
        // Also log error to game state
         return createErrorState(errorMsg, stateBeforeLoop); // Ensure fallback state is valid
    }

    // After the loop, check if the phase *still* exists and if all *possible* responders have responded.
    const finalPhase = newState.challengeOrBlockPhase;
    if (finalPhase && finalPhase.possibleResponses.every(p => finalPhase.responses.some(r => r.playerId === p.id))) {
        console.log(`[triggerAIResponses] All responses received for stage ${finalPhase.stage}. Resolving phase...`);
        const stateAfterResolve = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
         newState = stateAfterResolve; // Update state with resolved state
    } else if (finalPhase) {
        console.log(`[triggerAIResponses] Challenge/Block phase (Stage: ${finalPhase.stage}) still requires responses (likely human). Waiting.`);
    } else {
        console.log("[triggerAIResponses] Challenge/Block phase already resolved or transitioned.");
    }

     // Final check to ensure valid state is returned
     if (!isValidGameState(newState)) {
         console.error("[triggerAIResponses] Error: newState became invalid at the end of the function. Reverting.");
         return createErrorState("[triggerAIResponses] Internal error at end of function.", stateBeforeLoop);
     }

    return newState;
}



// Async because it calls completeExchange which is async
async function handleAIExchange(gameState: GameState | null): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState("[handleAIExchange] Error: gameState is invalid or null.");
    console.log(`[handleAIExchange] Handling exchange for AI.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeExchange = JSON.parse(JSON.stringify(gameState)); // Fallback state
    const exchangeInfo = newState.pendingExchange;
     if (!exchangeInfo || !exchangeInfo.player.isAI) {
         const errorMsg = "[handleAIExchange] Error: Called without valid AI exchange phase.";
          // Try to clear invalid phase
          const stateWithError = logAction(newState, errorMsg);
          if(stateWithError) stateWithError.pendingExchange = null;
          return stateWithError || createErrorState(errorMsg, gameState);
     }

     const aiPlayer = exchangeInfo.player;
     const cardsToChooseFrom = exchangeInfo.cardsToChoose;
     const cardsToKeepCount = aiPlayer.influence.filter(c => !c.revealed).length;
     console.log(`[handleAIExchange] AI ${aiPlayer.name} choosing ${cardsToKeepCount} from ${cardsToChooseFrom.join(', ')}.`);


     // Basic AI: Keep the best cards based on a simple hierarchy or preference
     // TODO: Enhance this with LLM reasoning if desired - would need a new flow
     const cardPreference: CardType[] = ['Duke', 'Contessa', 'Assassin', 'Captain', 'Ambassador']; // Example preference

     // Sort available cards by preference, maintaining original indices
     const choicesWithIndices = cardsToChooseFrom.map((card, index) => ({ card, index }));
     choicesWithIndices.sort((a, b) => cardPreference.indexOf(a.card) - cardPreference.indexOf(b.card));


     // Select the indices of the top 'cardsToKeepCount' cards from the sorted list
     const indicesToKeep = choicesWithIndices.slice(0, cardsToKeepCount).map(item => item.index);
      const cardsKept = indicesToKeep.map(index => cardsToChooseFrom[index]);
     console.log(`[handleAIExchange] AI ${aiPlayer.name} chose to keep indices: [${indicesToKeep.join(', ')}] (${cardsKept.join(', ')})`);


    try {
        newState = logAction(newState, `AI (${aiPlayer.name}) chooses [${cardsKept.join(', ')}] for Exchange.`);
        const stateAfterCompletion = await completeExchange(newState, aiPlayer.id, indicesToKeep); // await completion using indices
         newState = stateAfterCompletion; // Update state
    } catch (error: any) {
         const errorMsg = `[handleAIExchange] Error during completeExchange: ${error.message}. Reverting exchange.`;
         console.error(errorMsg);
         newState = createErrorState(errorMsg, stateBeforeExchange); // Ensure valid state
          if(newState) newState.pendingExchange = null; // Clear broken phase
    }

     return newState;
}

// Handle AI decision for challenged player (Proceed vs Retreat)
async function handleAIChallengeDecision(gameState: GameState): Promise<GameState> {
    let newState = JSON.parse(JSON.stringify(gameState));
    const stateBeforeDecision = JSON.parse(JSON.stringify(gameState)); // Fallback
    const decisionPhase = newState.pendingChallengeDecision;
    if (!decisionPhase) {
        console.warn("[handleAIChallengeDecision] No pending decision phase found.");
        return newState; // Should not happen
    }

    const challengedPlayer = getPlayerById(newState, decisionPhase.challengedPlayerId);
    if (!challengedPlayer || !challengedPlayer.isAI) {
        console.log("[handleAIChallengeDecision] Challenged player not found or not AI.");
        return newState; // Not an AI or player not found
    }

    console.log(`[handleAIChallengeDecision] AI ${challengedPlayer.name} deciding whether to proceed or retreat from challenge by ${decisionPhase.challengerId}...`);

    // AI Logic:
    // 1. Check if they actually have the card needed for the action/block.
    const requiredCard = getCardForAction(decisionPhase.actionOrBlock);
    const canProve = requiredCard !== null && (
        challengedPlayer.influence.some(c => !c.revealed && c.type === requiredCard) ||
        (decisionPhase.actionOrBlock === 'Block Stealing' && challengedPlayer.influence.some(c => !c.revealed && c.type === getAlternateCardForStealBlock()))
    );

    let decision: ChallengeDecisionType = 'Retreat'; // Default to retreat if bluffing

    if (canProve) {
        // If AI can prove, they should almost always proceed.
        // Could add more complex logic later (e.g., maybe retreat if revealing the card is strategically bad).
        decision = 'Proceed';
        newState = logAction(newState, `AI (${challengedPlayer.name}) Reasoning: Can prove the claim, deciding to proceed.`);
    } else {
        // If AI cannot prove (bluffing), they should retreat.
        decision = 'Retreat';
         newState = logAction(newState, `AI (${challengedPlayer.name}) Reasoning: Cannot prove the claim (bluffing), deciding to retreat.`);
    }
     console.log(`[handleAIChallengeDecision] AI ${challengedPlayer.name} chose: ${decision}`);

    // Call the handler with the AI's decision
    let stateAfterHandling: GameState;
    try {
        stateAfterHandling = await handleChallengeDecision(newState, challengedPlayer.id, decision);
    } catch (error: any) {
         const errorMsg = `[handleAIChallengeDecision] Error calling handleChallengeDecision: ${error.message}. Reverting.`;
         console.error(errorMsg);
         stateAfterHandling = createErrorState(errorMsg, stateBeforeDecision);
    }

     // Final check
     if (!isValidGameState(stateAfterHandling)) {
         console.error("[handleAIChallengeDecision] Error: stateAfterHandling became invalid. Reverting.");
         return createErrorState("[handleAIChallengeDecision] Internal error after handling AI decision.", stateBeforeDecision);
     }


    return stateAfterHandling;
}

// Handle AI decision for Assassin during Contessa block confirmation (Challenge Contessa vs Accept Block)
async function handleAIAssassinationConfirmation(gameState: GameState): Promise<GameState> {
    let newState = JSON.parse(JSON.stringify(gameState));
    const stateBeforeConfirm = JSON.parse(JSON.stringify(gameState)); // Fallback
    const confirmPhase = newState.pendingAssassinationConfirmation;
    if (!confirmPhase) {
        console.warn("[handleAIAssassinationConfirmation] No pending confirmation phase found.");
        return newState; // Should not happen
    }

    const assassinPlayer = getPlayerById(newState, confirmPhase.assassinPlayerId);
    if (!assassinPlayer || !assassinPlayer.isAI) {
         console.log("[handleAIAssassinationConfirmation] Assassin player not found or not AI.");
        return newState; // Not an AI Assassin or player not found
    }

    const contessaPlayer = getPlayerById(newState, confirmPhase.contessaPlayerId);
     if (!contessaPlayer) {
          const errorMsg = `[handleAIAssassinationConfirmation] Error: Contessa player ${confirmPhase.contessaPlayerId} not found.`;
          return createErrorState(errorMsg, newState);
     }

    console.log(`[handleAIAssassinationConfirmation] AI Assassin (${assassinPlayer.name}) deciding whether to challenge ${contessaPlayer.name}'s Contessa claim...`);

    // Use AI challenge reasoning flow
    let challengeDecision = { shouldChallenge: false, reasoning: "Defaulting to not challenge." };
    try {
        challengeDecision = await aiChallengeReasoning({
            actionOrBlock: 'Block Assassination', // Challenging the block claim
            playerName: contessaPlayer.name,
            targetPlayerName: assassinPlayer.name, // Original target of the block challenge is the assassin
            aiInfluenceCards: assassinPlayer.influence.filter(c => !c.revealed).map(c => c.type),
            opponentInfluenceCount: contessaPlayer.influence.filter(c => !c.revealed).length,
            opponentMoney: contessaPlayer.money,
            gameState: generateGameStateDescription(newState, assassinPlayer.id),
            rulebook: coupRulebook,
        });
         newState = logAction(newState, `AI Assassin (${assassinPlayer.name}) Contessa Challenge Reasoning: ${challengeDecision.reasoning}`);
         console.log(`[handleAIAssassinationConfirmation] AI Assassin (${assassinPlayer.name}) challenge decision: ${challengeDecision.shouldChallenge}`);
    } catch (error: any) {
         const errorMsg = `[handleAIAssassinationConfirmation] Error calling aiChallengeReasoning: ${error.message}. Defaulting to not challenge.`;
         console.error(errorMsg);
         newState = logAction(newState, errorMsg);
         challengeDecision.shouldChallenge = false; // Ensure default on error
    }

     const decision: 'Challenge Contessa' | 'Accept Block' = challengeDecision.shouldChallenge ? 'Challenge Contessa' : 'Accept Block';
     console.log(`[handleAIAssassinationConfirmation] AI Assassin (${assassinPlayer.name}) chose: ${decision}`);


    // Call the handler with the AI's decision
    let stateAfterHandling: GameState;
    try {
        stateAfterHandling = await handleAssassinationConfirmation(newState, assassinPlayer.id, decision);
    } catch (error: any) {
         const errorMsg = `[handleAIAssassinationConfirmation] Error calling handleAssassinationConfirmation: ${error.message}. Reverting.`;
         console.error(errorMsg);
         stateAfterHandling = createErrorState(errorMsg, stateBeforeConfirm);
    }

     // Final check
     if (!isValidGameState(stateAfterHandling)) {
         console.error("[handleAIAssassinationConfirmation] Error: stateAfterHandling became invalid. Reverting.");
         return createErrorState("[handleAIAssassinationConfirmation] Internal error after handling AI confirmation.", stateBeforeConfirm);
     }

    return stateAfterHandling;
}

// --- Public API ---

// Make this async because the actions it calls are async
export async function performAction(gameState: GameState | null, playerId: string, action: ActionType, targetId?: string): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState(`[API performAction] Error: gameState is invalid or null for player ${playerId}.`);
    console.log(`[API performAction] Request: Player ${playerId}, Action ${action}, Target ${targetId || 'None'}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeAction = JSON.parse(JSON.stringify(gameState)); // For fallback on error
    const player = getPlayerById(newState, playerId);

    // --- Input Validations ---
    if (!player) {
        const errorMsg = "[API performAction] Error: Player not found.";
        return createErrorState(errorMsg, newState);
    }
    if (player.id !== newState.players[newState.currentPlayerIndex]?.id) { // Added safety check for currentPlayerIndex
         const warnMsg = `[API performAction] Warning: Not player ${playerId}'s turn (Current: ${newState.players[newState.currentPlayerIndex]?.id || 'Invalid Index'} - ${newState.players[newState.currentPlayerIndex]?.name || 'Unknown'}).`;
         console.warn(warnMsg);
        return logAction(newState, "Warning: Not your turn."); // Prevent action but don't crash
    }
     if (newState.winner) {
          const warnMsg = "[API performAction] Warning: Action attempted after game ended.";
         console.warn(warnMsg);
        return logAction(newState, "Game already over.");
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision || newState.pendingAssassinationConfirmation || newState.playerNeedsToReveal) {
          const warnMsg = "[API performAction] Warning: Action attempted during challenge/block/exchange/decision/confirmation/reveal phase.";
         console.warn(warnMsg);
        return logAction(newState, "Cannot perform action now, waiting for response or decision.");
    }
     if (!player.influence.some(c => !c.revealed)) {
          const warnMsg = `[API performAction] Warning: Player ${playerId} is eliminated.`;
         console.warn(warnMsg);
          // If eliminated player is somehow current player, advance turn to prevent deadlock
          if (player.id === newState.players[newState.currentPlayerIndex]?.id) { // Added safety check
              console.warn(`[API performAction] Eliminated player ${playerId} is current player. Advancing turn.`);
              return await advanceTurn(newState);
          }
         return logAction(newState, "You are eliminated.");
     }

    const target = targetId ? getPlayerById(newState, targetId) : undefined;

    // --- Action Specific Validations ---
    if (action === 'Coup' && player.money < 7) {
        const warnMsg = `[API performAction] Warning: ${playerId} insufficient funds for Coup.`;
        console.warn(warnMsg);
        return logAction(newState, "Not enough money for Coup (need 7).");
    }
    if (action === 'Assassinate' && player.money < 3) {
          const warnMsg = `[API performAction] Warning: ${playerId} insufficient funds for Assassinate.`;
         console.warn(warnMsg);
        return logAction(newState, "Not enough money to Assassinate (need 3).");
    }
    // Check if must Coup (and can Coup)
    if (player.money >= 10 && action !== 'Coup') {
         const canCoup = getAvailableActions(player, newState).includes('Coup');
        if (canCoup) {
              const warnMsg = `[API performAction] Warning: ${playerId} has >= 10 coins, must Coup.`;
             console.warn(warnMsg);
             return logAction(newState, "Must perform Coup with 10 or more coins.");
        } else {
            // Cannot Coup (no targets), allow other actions. Log this edge case.
             console.log(`[API performAction] Info: ${playerId} has >= 10 coins but no targets for Coup. Allowing action ${action}.`);
        }
    }
     const requiresTarget = (action === 'Coup' || action === 'Assassinate' || action === 'Steal');
     if (requiresTarget && !targetId) {
           const warnMsg = `[API performAction] Warning: Action ${action} requires a target.`;
          console.warn(warnMsg);
         return logAction(newState, `Action ${action} requires a target.`);
     }
     if (requiresTarget && !target) {
           const warnMsg = `[API performAction] Warning: Target player ${targetId} not found.`;
          console.warn(warnMsg);
         return logAction(newState, `Target player not found.`);
     }
      if (target && !getActivePlayers(newState).some(p => p.id === target.id)) {
          const warnMsg = `[API performAction] Warning: Target ${target.name} is already eliminated.`;
         console.warn(warnMsg);
         return logAction(newState, `Target ${target.name} is already eliminated.`);
     }
     if (target && target.id === player.id) {
           const warnMsg = `[API performAction] Warning: Player ${playerId} cannot target self with ${action}.`;
          console.warn(warnMsg);
         return logAction(newState, `Cannot target self with ${action}.`);
     }


    newState.currentAction = { player, action, target }; // Set current action *before* calling specific function
    console.log(`[API performAction] Validation complete. Executing ${action} for ${player.name}...`);


    // --- Execute Action ---
    let stateAfterActionExecution: GameState = newState; // Initialize with current state
    try {
        switch (action) {
            case 'Income':
                stateAfterActionExecution = await performIncome(newState, playerId);
                break;
            case 'Foreign Aid':
                stateAfterActionExecution = await performForeignAid(newState, playerId);
                break;
            case 'Coup':
                stateAfterActionExecution = await performCoup(newState, playerId, targetId!); // targetId is validated above
                break;
            case 'Tax':
                stateAfterActionExecution = await performTax(newState, playerId);
                break;
            case 'Assassinate':
                stateAfterActionExecution = await performAssassinate(newState, playerId, targetId!); // targetId is validated above
                break;
            case 'Steal':
                stateAfterActionExecution = await performSteal(newState, playerId, targetId!); // targetId is validated above
                break;
            case 'Exchange':
                stateAfterActionExecution = await performExchange(newState, playerId);
                break;
            default:
                const errorMsg = `[API performAction] Error: Unknown action type: ${action}`;
                console.error(errorMsg);
                newState = logAction(newState, errorMsg);
                // Clear invalid action state
                newState.currentAction = null;
                stateAfterActionExecution = newState; // Return the logged error state
                break;
        }
    } catch (error: any) {
          const errorMsgLog = `[API performAction] Critical error during ${action} execution: ${error.message}. Reverting action.`;
         console.error(errorMsgLog);
         // Attempt to revert to state before action, log error
         stateAfterActionExecution = createErrorState(errorMsgLog, stateBeforeAction); // Ensure valid state
         // Clear potentially inconsistent partial state changes (already done by createErrorState)
    }

     console.log(`[API performAction] Finished execution for ${action}. Returning final state.`);
     // Clear currentAction AFTER the action and potential subsequent phases are fully resolved by the functions above.
     // The advanceTurn function should handle this clearing now.
     // stateAfterActionExecution.currentAction = null;
      // Ensure we always return a valid GameState
      if (!isValidGameState(stateAfterActionExecution)) {
        console.error("[API performAction] Error: stateAfterActionExecution became invalid. Reverting.");
        return createErrorState("[API performAction] Internal error after executing action.", stateBeforeAction);
    }


     return stateAfterActionExecution;
}


// Make this async because the functions it calls (resolveChallenge/Block/etc.) are async
// Returns a valid GameState even on error.
export async function handlePlayerResponse(gameState: GameState | null, respondingPlayerId: string, response: GameResponseType): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState(`[API handlePlayerResponse] Error: gameState is invalid or null for player ${respondingPlayerId}.`);
    console.log(`[API handlePlayerResponse] Request: Player ${respondingPlayerId}, Response ${response}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeResponse = JSON.parse(JSON.stringify(gameState)); // For fallback
    const phase = newState.challengeOrBlockPhase; // Use current phase state

     // --- Input Validations ---
     if (!phase) {
           const warnMsg = "[API handlePlayerResponse] Warning: No challenge/block phase active.";
          console.warn(warnMsg);
         // Return state with log instead of error state, as this might be a race condition
         return logAction(newState, warnMsg);
     }
      const responderCanAct = phase.possibleResponses.some(p => p.id === respondingPlayerId);
      const responderHasActed = phase.responses.some(r => r.playerId === respondingPlayerId);
      const validResponsesForStage = phase.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination']; // Default if not set

     if (!responderCanAct) {
           const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} cannot respond in this phase. Possible: [${phase.possibleResponses.map(p=>p.id).join(',')}] Stage: ${phase.stage}`;
          console.warn(warnMsg);
         // Return state with log instead of error state
         return logAction(newState, warnMsg);
     }
    if (responderHasActed) {
          const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} already responded.`;
         console.warn(warnMsg);
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`); // Log, don't return error state
    }
    // Validate response against the specific valid responses for the current stage
     if (!validResponsesForStage.includes(response)) {
          const warnMsg = `[API handlePlayerResponse] Invalid response '${response}' for current stage '${phase.stage}'. Valid: [${validResponsesForStage.join(', ')}]`;
          console.warn(warnMsg);
         // Return state with log instead of error state
          return logAction(newState, `Invalid response: ${response}.`);
     }


    const respondingPlayer = getPlayerById(newState, respondingPlayerId);
     if (!respondingPlayer) { // Safety check
         const errorMsg = `[API handlePlayerResponse] Error: Responding player ${respondingPlayerId} not found.`;
         return createErrorState(errorMsg, newState);
     }

    // --- Update Phase State ---
     console.log(`[API handlePlayerResponse] Processing response ${response} from ${respondingPlayer.name} for stage ${phase.stage}`);
     // Create a *new* responses array
     const newResponses = [...phase.responses, { playerId: respondingPlayerId, response }];
     newState.challengeOrBlockPhase = { ...phase, responses: newResponses }; // Update state immutably
     newState = logAction(newState, `${respondingPlayer.name} responds: ${response}.`);


    // --- Resolve or Continue ---
    let stateAfterResponseHandling: GameState = newState; // Initialize with current state
    try {
        const currentPhase = newState.challengeOrBlockPhase!; // Use the just updated phase

        if (response === 'Challenge') {
             // A challenge was issued. Transition to Pending Challenge Decision phase.
             console.log(`[API handlePlayerResponse] Challenge issued by ${respondingPlayer.name}. Setting up pending challenge decision...`);
             const challengedPlayerId = currentPhase.actionPlayer.id; // The one whose claim was challenged
             const challengedPlayer = getPlayerById(newState, challengedPlayerId);
             if (challengedPlayer) {
                 // Clear the current challenge/block phase first
                 newState.challengeOrBlockPhase = null;
                 newState.pendingChallengeDecision = {
                     challengedPlayerId: challengedPlayerId,
                     challengerId: respondingPlayerId,
                     actionOrBlock: currentPhase.action, // The claim that was challenged
                      // Pass original context if the challenged item was a block
                      originalTargetPlayerId: currentPhase.action.startsWith('Block ') ? currentPhase.targetPlayer?.id : undefined,
                      originalActionPlayerId: currentPhase.action.startsWith('Block ') ? newState.currentAction?.player.id : undefined, // Get original player from context
                 };
                 newState = logAction(newState, `${respondingPlayer.name} challenges ${challengedPlayer.name}'s claim of ${currentPhase.action}! ${challengedPlayer.name}, do you want to proceed or retreat?`);
                  // Trigger AI decision if challenged player is AI
                 if (challengedPlayer.isAI) {
                     console.log(`[API handlePlayerResponse] Triggering AI challenge decision for ${challengedPlayer.name}.`);
                     stateAfterResponseHandling = await handleAIChallengeDecision(newState);
                 } else {
                      console.log(`[API handlePlayerResponse] Waiting for Human (${challengedPlayer.name}) challenge decision.`);
                      stateAfterResponseHandling = newState; // Return state waiting for human
                 }
             } else {
                  const errorMsg = `[API handlePlayerResponse] Error: Challenged player ${challengedPlayerId} not found during challenge response.`;
                  stateAfterResponseHandling = createErrorState(errorMsg, newState);
             }

        } else if (response.startsWith('Block')) {
            // A block was issued.
             console.log(`[API handlePlayerResponse] Block (${response}) issued by ${respondingPlayer.name}.`);
              const blocker = getPlayerById(newState, respondingPlayerId)!; // Blocker is the responder
              const blockType = response as BlockActionType;
               // The player whose original action is being blocked comes from the currentAction context
              const originalActionPlayer = newState.currentAction?.player;
              const originalAction = newState.currentAction?.action;

               if (!originalActionPlayer || !originalAction) {
                   const errorMsg = "[API handlePlayerResponse] Error: Cannot find original action context when handling block.";
                   stateAfterResponseHandling = createErrorState(errorMsg, newState);
               } else {
                    // Specific logic for Assassination block
                   if (blockType === 'Block Assassination') {
                       console.log(`[API handlePlayerResponse] Contessa block claimed. Assassin must confirm or challenge.`);
                        // Clear the current challenge/block phase
                        newState.challengeOrBlockPhase = null;
                        // Set up the confirmation phase
                        newState.pendingAssassinationConfirmation = {
                           assassinPlayerId: originalActionPlayer.id,
                           contessaPlayerId: blocker.id,
                        };
                         newState = logAction(newState, `${blocker.name} claims Contessa to block the assassination! ${originalActionPlayer.name}, do you challenge the Contessa claim or accept the block?`);
                         // Trigger AI decision if Assassin is AI
                         if (originalActionPlayer.isAI) {
                             console.log(`[API handlePlayerResponse] Triggering AI assassination confirmation for ${originalActionPlayer.name}.`);
                             stateAfterResponseHandling = await handleAIAssassinationConfirmation(newState);
                         } else {
                              console.log(`[API handlePlayerResponse] Waiting for Human Assassin (${originalActionPlayer.name}) confirmation.`);
                              stateAfterResponseHandling = newState; // Return state waiting for human
                         }

                   } else {
                       // Standard block handling: Set up challenge_block phase
                       console.log(`[API handlePlayerResponse] Standard block (${blockType}). Setting up challenge_block stage.`);
                        newState.challengeOrBlockPhase = {
                           actionPlayer: blocker, // Blocker is claiming the block card
                           action: blockType, // Claim is the block itself
                           targetPlayer: originalActionPlayer, // Target of challenge is original action player
                           possibleResponses: getActivePlayers(newState).filter(p => p.id !== blocker.id), // Others can challenge block
                           responses: [],
                           stage: 'challenge_block',
                           validResponses: ['Challenge', 'Allow'],
                       };
                        newState = logAction(newState, `${blocker.name} claims to ${blockType}. Others can challenge this claim.`);
                        stateAfterResponseHandling = await triggerAIResponses(newState); // Trigger challenges against the block
                   }
               }
        } else { // Response is 'Allow'
            console.log(`[API handlePlayerResponse] Allow received from ${respondingPlayer.name} for stage ${currentPhase.stage}.`);
            // Check if all responses for the *current stage* are now in
            const allResponded = currentPhase.possibleResponses.every(p => currentPhase.responses.some(r => r.playerId === p.id));

            if (allResponded) {
                console.log(`[API handlePlayerResponse] All responses received for stage ${currentPhase.stage}. Resolving phase/stage...`);
                stateAfterResponseHandling = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
            } else {
                console.log(`[API handlePlayerResponse] Stage ${currentPhase.stage}: Waiting for more responses...`);
                // Still waiting for more responses. Trigger remaining AIs if applicable for this stage.
                const remainingResponders = currentPhase.possibleResponses.filter(p => !currentPhase.responses.some(r => r.playerId === p.id));
                const remainingAIs = remainingResponders.filter(p => p.isAI);
                if (remainingAIs.length > 0 && remainingAIs.length === remainingResponders.length) { // Only trigger if *only* AIs remain
                    console.log(`[API handlePlayerResponse] All remaining responders for stage ${currentPhase.stage} are AI. Triggering...`);
                    stateAfterResponseHandling = await triggerAIResponses(newState); // Trigger remaining AIs
                } else {
                    console.log(`[API handlePlayerResponse] Stage ${currentPhase.stage}: Waiting for human response or mixed group.`);
                    // If only human(s) remain, return current state and wait
                    stateAfterResponseHandling = newState;
                }
            }
        }
    } catch (error: any) {
          const errorMsgLog = `[API handlePlayerResponse] Critical error during response handling for ${response}: ${error.message}. Reverting.`;
         console.error(errorMsgLog);
         stateAfterResponseHandling = createErrorState(errorMsgLog, stateBeforeResponse); // Ensure valid state
         // Clear potentially inconsistent state (already done by createErrorState)
    }

    // Final Null Check and Validation (Add explicit check)
    if (!isValidGameState(stateAfterResponseHandling)) {
        const finalErrorMsg = `[API handlePlayerResponse] stateAfterResponseHandling became null or invalid unexpectedly after processing ${response}. Reverting.`;
        console.error(finalErrorMsg);
        // Attempt to return the state *before* the error happened, or a default error state
        return createErrorState(finalErrorMsg, stateBeforeResponse);
    }


     console.log(`[API handlePlayerResponse] Finished processing response ${response}. Returning state.`);
     return stateAfterResponseHandling;
}



// Make this async because it calls completeExchange which is async
// Returns a valid GameState even on error.
export async function handleExchangeSelection(gameState: GameState | null, playerId: string, cardsToKeepIndices: number[]): Promise<GameState> {
       if (!isValidGameState(gameState)) return createErrorState(`[API handleExchangeSelection] Error: gameState is invalid or null for player ${playerId}.`);
     console.log(`[API handleExchangeSelection] Request: Player ${playerId}, Card Indices ${cardsToKeepIndices.join(', ')}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeExchange = JSON.parse(JSON.stringify(gameState)); // Fallback
    const player = getPlayerById(newState, playerId);
    const exchangeInfo = newState.pendingExchange;

    // --- Input Validations ---
    if (!player) {
        const errorMsg = "[API handleExchangeSelection] Error: Player not found.";
        return createErrorState(errorMsg, newState);
    }
    // Exchange happens *during* a player's turn, triggered by Exchange action success.
    // We don't strictly need to check currentPlayerIndex === playerIndex here,
    // but we MUST check if the pendingExchange player matches.
    if (!exchangeInfo || exchangeInfo.player.id !== playerId) {
           const warnMsg = "[API handleExchangeSelection] Warning: Not in exchange phase for this player.";
          console.warn(warnMsg);
        return createErrorState(warnMsg, newState);
    }
     if (!player.influence.some(c => !c.revealed)) {
           const warnMsg = `[API handleExchangeSelection] Warning: Player ${playerId} is eliminated.`;
          console.warn(warnMsg);
         return createErrorState(warnMsg, newState); // Should not happen if logic is correct
     }
      const requiredCount = player.influence.filter(c => !c.revealed).length;
     if (cardsToKeepIndices.length !== requiredCount) {
           const warnMsg = `[API handleExchangeSelection] Error: Player ${playerId} selected ${cardsToKeepIndices.length} cards, but needs ${requiredCount}. Indices: ${cardsToKeepIndices.join(',')}`;
          console.warn(warnMsg);
         return createErrorState(warnMsg, newState);
     }
      // Validate indices are within bounds and unique
       if (cardsToKeepIndices.some(index => index < 0 || index >= exchangeInfo.cardsToChoose.length)) {
           const warnMsg = `[API handleExchangeSelection] Error: Player ${playerId} selected out-of-bounds index. Indices: ${cardsToKeepIndices.join(',')}. Max index: ${exchangeInfo.cardsToChoose.length - 1}`;
           console.warn(warnMsg);
           return createErrorState(warnMsg, newState);
       }
       if (new Set(cardsToKeepIndices).size !== cardsToKeepIndices.length) {
           const warnMsg = `[API handleExchangeSelection] Error: Player ${playerId} selected duplicate indices: ${cardsToKeepIndices.join(',')}.`;
           console.warn(warnMsg);
           return createErrorState(warnMsg, newState);
       }


     console.log("[API handleExchangeSelection] Validation complete. Completing exchange...");
     let stateAfterExchange: GameState = newState; // Initialize
     try {
        stateAfterExchange = await completeExchange(newState, playerId, cardsToKeepIndices);
     } catch(error: any) {
         const errorMsgLog = `[API handleExchangeSelection] Critical error during completeExchange: ${error.message}. Reverting.`;
        console.error(errorMsgLog);
        stateAfterExchange = createErrorState(errorMsgLog, stateBeforeExchange); // Ensure valid state
        if (stateAfterExchange) {
            stateAfterExchange.pendingExchange = null; // Clean up phase
        }
     }
       // Final check
     if (!isValidGameState(stateAfterExchange)) {
         console.error("[API handleExchangeSelection] Error: stateAfterExchange became invalid. Reverting.");
         return createErrorState("[API handleExchangeSelection] Internal error after handling exchange.", stateBeforeExchange);
     }
     return stateAfterExchange;
}

// New handler for Assassin's decision after Contessa block
export async function handleAssassinationConfirmation(gameState: GameState | null, assassinPlayerId: string, decision: 'Challenge Contessa' | 'Accept Block'): Promise<GameState> {
     if (!isValidGameState(gameState)) return createErrorState(`[handleAssassinationConfirmation] Error: gameState is invalid or null for Assassin ${assassinPlayerId}.`);
    console.log(`[handleAssassinationConfirmation] Assassin ${assassinPlayerId} chose: ${decision}`);
    let newState = JSON.parse(JSON.stringify(gameState));
    const stateBeforeConfirm = JSON.parse(JSON.stringify(gameState));
    const confirmPhase = newState.pendingAssassinationConfirmation;

    if (!confirmPhase || confirmPhase.assassinPlayerId !== assassinPlayerId) {
        const errorMsg = `[handleAssassinationConfirmation] Error: No pending assassination confirmation found for Assassin ${assassinPlayerId}.`;
        return createErrorState(errorMsg, newState);
    }

    const assassin = getPlayerById(newState, confirmPhase.assassinPlayerId);
    const contessaPlayer = getPlayerById(newState, confirmPhase.contessaPlayerId);

    if (!assassin || !contessaPlayer) {
        const errorMsg = `[handleAssassinationConfirmation] Error: Assassin or Contessa player not found.`;
        newState.pendingAssassinationConfirmation = null; // Clear invalid phase
        return createErrorState(errorMsg, newState);
    }

    // Clear the confirmation phase
    newState.pendingAssassinationConfirmation = null;
    newState = logAction(newState, `${assassin.name} decides to ${decision === 'Challenge Contessa' ? 'challenge the Contessa claim' : 'accept the block'}.`);

    if (decision === 'Challenge Contessa') {
        console.log(`[handleAssassinationConfirmation] Challenging Contessa claim. Setting up challenge decision phase.`);
        // Initiate a challenge against the 'Block Assassination' claim
        newState.pendingChallengeDecision = {
            challengedPlayerId: contessaPlayer.id, // Contessa player is challenged
            challengerId: assassin.id, // Assassin is the challenger
            actionOrBlock: 'Block Assassination', // Challenging the block claim
            // Store original action/target context (assassin was original action taker, contessa player was target)
            originalActionPlayerId: confirmPhase.assassinPlayerId,
            originalTargetPlayerId: confirmPhase.contessaPlayerId,
        };
        newState = logAction(newState, `${assassin.name} challenges ${contessaPlayer.name}'s claim of Contessa! ${contessaPlayer.name}, do you want to proceed or retreat?`);

        // Trigger AI decision if Contessa player is AI
        if (contessaPlayer.isAI) {
             console.log(`[handleAssassinationConfirmation] Triggering AI challenge decision for Contessa player ${contessaPlayer.name}.`);
            newState = await handleAIChallengeDecision(newState);
        } else {
            console.log(`[handleAssassinationConfirmation] Waiting for Human Contessa (${contessaPlayer.name}) challenge decision.`);
        }
    } else { // Accept Block
        console.log(`[handleAssassinationConfirmation] Block accepted. Assassination fails.`);
        newState = logAction(newState, `${assassin.name} accepts the block. The assassination attempt fails.`);
        // Turn advances
        newState = await advanceTurn(newState);
    }

    if (!isValidGameState(newState)) {
        console.error("[handleAssassinationConfirmation] Error: newState became invalid. Reverting.");
        return createErrorState("[handleAssassinationConfirmation] Internal error after handling confirmation.", stateBeforeConfirm);
    }

    return newState;
}
