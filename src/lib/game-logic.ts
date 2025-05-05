
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
        pendingExchange: null,
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

function getPlayerById(gameState: GameState | null, playerId: string): Player | undefined {
    if (!gameState) return undefined;
    return gameState.players.find(p => p.id === playerId);
}

function getActivePlayers(gameState: GameState): Player[] {
    return gameState.players.filter(p => p.influence.some(card => !card.revealed));
}

function getNextPlayerIndex(currentIndex: number, players: Player[]): number {
    const activePlayers = players.filter(p => p.influence.some(card => !card.revealed));
    if (activePlayers.length <= 1) {
         console.log("[getNextPlayerIndex] Only one or zero active players left.");
         return currentIndex; // Game might be over or only one player left
    }

    let nextIndex = (currentIndex + 1) % players.length;
    let safetyCounter = 0; // Prevent infinite loops
    while (!players[nextIndex]?.influence.some(card => !card.revealed)) { // Added safety check for players[nextIndex]
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


// Helper function to safely create a GameState object with an error message
// Ensures it *always* returns a valid GameState object.
function createErrorState(errorMessage: string, previousState?: GameState | null): GameState {
    // Define a minimal default structure
    const defaultState: GameState = {
        players: [],
        deck: [],
        treasury: 0,
        currentPlayerIndex: 0,
        currentAction: null,
        challengeOrBlockPhase: null,
        pendingChallengeDecision: null,
        pendingExchange: null,
        actionLog: [],
        winner: null,
        needsHumanTriggerForAI: false,
    };

    let baseState: GameState;
    // Attempt to safely parse the previous state, falling back to default if invalid or parsing fails
    try {
        if (previousState && typeof previousState === 'object') {
            // Simple validation: check for essential properties
             if (Array.isArray(previousState.players) && Array.isArray(previousState.deck) && typeof previousState.currentPlayerIndex === 'number') {
                 baseState = JSON.parse(JSON.stringify(previousState)); // Deep copy valid state
             } else {
                  console.warn("[createErrorState] Previous state provided but invalid structure. Using default state.");
                  baseState = defaultState;
             }

        } else {
            baseState = defaultState;
        }
    } catch (parseError: any) {
         console.warn(`[createErrorState] Error parsing previous state: ${parseError.message}. Using default state.`);
         baseState = defaultState;
    }


    // Log the error message
    console.error(errorMessage); // Log to console
    // Ensure actionLog is an array before pushing
    baseState.actionLog = Array.isArray(baseState.actionLog) ? baseState.actionLog : [];
    baseState.actionLog = [...baseState.actionLog, `Error: ${errorMessage}`]; // Add to game log


    // Optionally clear transient states that might be inconsistent after an error
    baseState.currentAction = null;
    baseState.challengeOrBlockPhase = null;
    baseState.pendingChallengeDecision = null;
    baseState.pendingExchange = null;


    // Reset needsHumanTriggerForAI flag in error state to avoid getting stuck
    baseState.needsHumanTriggerForAI = false;


    return baseState; // Always return a valid GameState object
}


function logAction(gameState: GameState | null, message: string): GameState {
    // If gameState is null, create a base error state first
    const validGameState = gameState ?? createErrorState(`[logAction] Received null gameState while trying to log: "${message}"`);

    console.log("[Game Log]", message); // Add console logging for server/debug
    const MAX_LOG_ENTRIES = 50;
    // Ensure actionLog exists before spreading
    const currentLog = validGameState.actionLog || [];
    const newLog = [...currentLog, message].slice(-MAX_LOG_ENTRIES);
    // Return a new object to ensure immutability
    return {
        ...validGameState,
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
    if (!gameState) {
        console.warn("[checkForWinner] Called with null gameState.");
        return null;
    }
    const activePlayers = getActivePlayers(gameState);
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
    if (!gameState) {
        const errorMsg = `[handleForceReveal] Error: Called with null gameState for player ${playerId}.`;
        return { newState: createErrorState(errorMsg), revealedCard: null };
    }
    console.log(`[handleForceReveal] Player ${playerId} needs to reveal${cardToReveal ? ` ${cardToReveal}` : ''}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy for safety
    let revealedCardType: CardType | null = null;
    const playerIndex = newState.players.findIndex(p => p.id === playerId);

    if (playerIndex !== -1) {
        const player = newState.players[playerIndex];
        let influenceToReveal: InfluenceCard | undefined;
        let cardIndexToReveal = -1;

        // Find the specific card if provided and unrevealed
        if (cardToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => c.type === cardToReveal && !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
            } else {
                 console.warn(`[handleForceReveal] Player ${playerId} asked to reveal ${cardToReveal}, but no unrevealed ${cardToReveal} found. Choosing another card.`);
            }
        }

        // If no specific type needed, or specific type not found/already revealed, find *any* unrevealed card
        if (!influenceToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
                 console.log(`[handleForceReveal] No specific card required or found, revealing first available: ${influenceToReveal?.type}`);
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
             console.warn(`[handleForceReveal] Could not find influence to reveal for ${player.name} (Card type: ${cardToReveal}, Unrevealed: ${player.influence.filter(c=>!c.revealed).map(c=>c.type).join(',')})`);
             newState = eliminatePlayer(newState, playerId);
        }
    } else {
         const errorMsg = `[handleForceReveal] Player ID ${playerId} not found.`;
         console.error(errorMsg);
         newState = logAction(newState, errorMsg); // Log error in game state
    }
     return { newState, revealedCard: revealedCardType };
}



// --- Action Execution ---

async function performIncome(gameState: GameState | null, playerId: string): Promise<GameState> {
     if (!gameState) return createErrorState("[performIncome] Error: gameState is null.");
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
     if (!gameState) return createErrorState("[performForeignAid] Error: gameState is null.");
    console.log(`[performForeignAid] ${playerId} attempts Foreign Aid.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const player = getPlayerById(newState, playerId);
    if (!player) {
        const errorMsg = `[performForeignAid] Error: Player ${playerId} not found.`;
        return createErrorState(errorMsg, newState);
    }

    newState = logAction(newState, `${player.name} attempts Foreign Aid (+2 coins).`);

    const potentialBlockers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialBlockers.length > 0) {
         console.log(`[performForeignAid] Potential blockers/challengers exist. Entering phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Foreign Aid',
            possibleResponses: potentialBlockers,
            responses: [],
            stage: 'challenge_action', // Initial stage: challenge or block the action
            validResponses: ['Challenge', 'Allow', 'Block Foreign Aid'],
        };
        // AI needs to decide to challenge or block here
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge or block, action succeeds immediately
         console.log(`[performForeignAid] No blockers/challengers. Action succeeds.`);
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
    if (!gameState) return createErrorState("[performCoup] Error: gameState is null.");
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
        const { newState: revealedState } = await handleForceReveal(newState, targetId); // Ensure await here
        newState = revealedState; // Assign revealedState directly

    } else {
        const errorMsg = `${newState.players[playerIndex]?.name || 'Player'} cannot perform Coup (not enough money or invalid target).`;
        newState = logAction(newState, errorMsg);
        console.error(`[performCoup] Failed Coup. Player: ${JSON.stringify(newState.players[playerIndex])}, Target: ${JSON.stringify(target)}`);
        // Should not advance turn if action failed pre-conditions
        return newState; // Return without advancing if failed
    }
    // Check winner before advancing
     const winner = checkForWinner(newState);
     if(winner) {
         newState.winner = winner;
         console.log(`[performCoup] Winner found after Coup: ${winner.name}`);
         return logAction(newState, `${winner.name} has won the game!`);
     }

     return await advanceTurn(newState);
}


async function performTax(gameState: GameState | null, playerId: string): Promise<GameState> {
     if (!gameState) return createErrorState("[performTax] Error: gameState is null.");
    console.log(`[performTax] ${playerId} attempts Tax.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const player = getPlayerById(newState, playerId);
     if (!player) {
          const errorMsg = `[performTax] Error: Player ${playerId} not found.`;
          return createErrorState(errorMsg, newState);
     }

     newState = logAction(newState, `${player.name} attempts to Tax (+3 coins).`);
     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
         console.log(`[performTax] Potential challengers exist. Entering challenge phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Tax',
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
     if (!gameState) return createErrorState("[performAssassinate] Error: gameState is null.");
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
        return logAction(newState, errorMsg);
    }

     // Deduct cost immediately upon attempt
     const newMoney = player.money - 3;
     const newTreasury = newState.treasury + 3;
     newState.players[playerIndex] = { ...player, money: newMoney };
     newState.treasury = newTreasury;
     newState = logAction(newState, `${player.name} attempts to Assassinate ${target.name} (-3 coins). Now has ${newMoney} coins.`);
     // Store cost in currentAction
     newState.currentAction = { ...newState.currentAction!, cost: 3 };


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
             actionPlayer: newState.players[playerIndex], // Original player
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
     if (!gameState) return createErrorState("[performSteal] Error: gameState is null.");
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

    const potentialResponders = getActivePlayers(newState).filter(p => p.id !== playerId);


    if (potentialResponders.length > 0) {
         console.log(`[performSteal] Potential responders exist. Entering challenge/block phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Steal',
            targetPlayer: target,
            possibleResponses: potentialResponders, // Includes the target who can block, others can challenge
            responses: [],
            stage: 'challenge_action', // Default stage: challenge or block
            validResponses: ['Challenge', 'Allow', 'Block Stealing'],
        };
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge or block, steal succeeds
         console.log(`[performSteal] No responders. Steal succeeds.`);
        const amount = Math.min(2, target.money);
         const playerIndex = newState.players.findIndex(p => p.id === playerId);
         const targetIndex = newState.players.findIndex(p => p.id === targetId);
         // Check indexes again in case state changed
         if (playerIndex !== -1 && targetIndex !== -1) {
            const playerNewMoney = newState.players[playerIndex].money + amount;
            const targetNewMoney = newState.players[targetIndex].money - amount;
            newState.players[playerIndex] = { ...newState.players[playerIndex], money: playerNewMoney };
            newState.players[targetIndex] = { ...newState.players[targetIndex], money: targetNewMoney };
            newState = logAction(newState, `${player.name} successfully Steals ${amount} coins from ${target.name}. ${player.name} now has ${playerNewMoney}, ${target.name} now has ${targetNewMoney}.`);
         } else {
              console.error(`[performSteal] Player or target index became invalid after potential state changes. PlayerIndex: ${playerIndex}, TargetIndex: ${targetIndex}`);
              newState = logAction(newState, "[performSteal] Error processing steal after no responders.");
         }
        newState = await advanceTurn(newState);
    }
     return newState;
}



async function performExchange(gameState: GameState | null, playerId: string): Promise<GameState> {
      if (!gameState) return createErrorState("[performExchange] Error: gameState is null.");
     console.log(`[performExchange] ${playerId} attempts Exchange.`);
     let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
     const player = getPlayerById(newState, playerId);
      if (!player) {
          const errorMsg = `[performExchange] Error: Player ${playerId} not found.`;
          return createErrorState(errorMsg, newState);
      }

     newState = logAction(newState, `${player.name} attempts Exchange.`);
     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
         console.log(`[performExchange] Potential challengers exist. Entering challenge phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Exchange',
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
     if (!gameState) return createErrorState(`[initiateExchange] Error: gameState is null for player ${player?.id}.`);
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


async function completeExchange(gameState: GameState | null, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
    if (!gameState) return createErrorState(`[completeExchange] Error: gameState is null for player ${playerId}.`);
    console.log(`[completeExchange] Player ${playerId} completes exchange, keeping: ${cardsToKeep.join(', ')}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const exchangeInfo = newState.pendingExchange;

    if (playerIndex === -1 || !exchangeInfo || exchangeInfo.player.id !== playerId) {
        const errorMsg = `[completeExchange] Invalid state for completing exchange. Phase: ${JSON.stringify(exchangeInfo)}`;
         // Attempt to clear invalid phase and return error state
         const stateWithError = logAction(newState, errorMsg);
         if(stateWithError) stateWithError.pendingExchange = null;
         return stateWithError || createErrorState(errorMsg, gameState); // Return error state or fallback
    }
    const player = newState.players[playerIndex];

    const originalUnrevealedCount = player.influence.filter(c => !c.revealed).length;

    if (cardsToKeep.length !== originalUnrevealedCount) {
        const errorMsg = `[completeExchange] Exchange error: Player ${playerId} selected ${cardsToKeep.length} cards, but needs ${originalUnrevealedCount}. Cards chosen: ${cardsToKeep.join(',')}. Cards available: ${exchangeInfo.cardsToChoose.join(',')}`;
        console.error(errorMsg);
         newState = logAction(newState, `Error: ${player.name} did not select the correct number of cards (${originalUnrevealedCount}) for exchange. Selection cancelled.`);
         // Don't advance turn, let player retry? Or handle error more gracefully.
         // For now, clear pending state to avoid getting stuck.
         newState.pendingExchange = null;
         // Maybe force turn advance to prevent deadlock?
         // return await advanceTurn(newState);
         return newState; // Return state without advancing, UI should handle retry
    }

     // Create a mutable copy of cardsToKeep to handle duplicates correctly
     let mutableCardsToKeep = [...cardsToKeep];
     const cardsToReturn = exchangeInfo.cardsToChoose.filter(card => {
        const index = mutableCardsToKeep.indexOf(card);
        if (index > -1) {
            mutableCardsToKeep.splice(index, 1); // Remove one instance if found in cardsToKeep
            return false; // Don't return this card
        }
        return true; // Return this card if not found in cardsToKeep
    });
     console.log(`[completeExchange] Cards returned to deck: ${cardsToReturn.join(', ')}`);


    // Update player influence
    const revealedInfluence = player.influence.filter(c => c.revealed);
    const newUnrevealedInfluence: InfluenceCard[] = cardsToKeep.map(type => ({ type, revealed: false })); // Use the original cardsToKeep for setting influence
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
            newState = await handleAIChallengeDecision(newState); // Handles proceed/retreat
        } else {
             console.log(`[resolveChallengeOrBlock] Waiting for Human (${challengedPlayer.name}) challenge decision.`);
        }
        // Return state, waiting for handleChallengeDecision call

    } else if (stage === 'challenge_action' && blocks.length > 0) {
         // --- Handle Block (during initial challenge_action stage) ---
         const blockerId = blocks[0].playerId;
         const blockType = blocks[0].response as BlockActionType;
         console.log(`[resolveChallengeOrBlock] Block (${blockType}) found from ${blockerId}. Setting up challenge_block phase.`);
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

         // Set up the next phase: challenging the block itself
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

    } else if (stage === 'block_decision' && blocks.length > 0) {
        // --- Handle Block (during block_decision stage for Assassination) ---
         const blockerId = blocks[0].playerId; // Should be the target
         const blockType = blocks[0].response as BlockActionType; // Should be Block Assassination
         console.log(`[resolveChallengeOrBlock] Target ${blockerId} chose to ${blockType}. Setting up challenge_block phase.`);
         const originalActionPlayer = newState.currentAction?.player; // Assassin
         if (!originalActionPlayer) {
              const errorMsg = "[resolveChallengeOrBlock] Error: Cannot find original Assassin player context when handling block.";
              return createErrorState(errorMsg, newState);
         }
          const blocker = getPlayerById(newState, blockerId); // Target/Contessa claimer
          if (!blocker) {
             const errorMsg = `[resolveChallengeOrBlock] Error: Blocker ${blockerId} (target) not found.`;
             return createErrorState(errorMsg, newState);
          }
         // Set up phase to challenge the Contessa claim
          newState.challengeOrBlockPhase = {
             actionPlayer: blocker, // Target/Blocker is claiming Contessa
             action: blockType, // Claiming 'Block Assassination'
             targetPlayer: originalActionPlayer, // Target of challenge is Assassin
             possibleResponses: getActivePlayers(newState).filter(p => p.id !== blockerId), // Anyone else can challenge
             responses: [],
             stage: 'challenge_block',
             validResponses: ['Challenge', 'Allow'],
         };
          newState = logAction(newState, `${blocker.name} claims Contessa to ${blockType}. Others can challenge this claim.`);
          newState = await triggerAIResponses(newState);

    } else if (allows.length === phase.possibleResponses.length || phase.possibleResponses.length === 0 ) {
        // --- Handle All Allows / No Responses Possible ---
         console.log(`[resolveChallengeOrBlock] No challenges or blocks received (or possible). Proceeding with claim: ${actionOrBlock}`);
         // Refresh action player state before executing
        const currentClaimer = getPlayerById(newState, phase.actionPlayer.id)!;
         const originalTarget = getPlayerById(newState, phase.targetPlayer?.id || '');

        if (actionOrBlock.startsWith('Block ')) {
             // A block claim was allowed (not challenged). Block succeeds.
             const originalAction = getActionFromBlock(actionOrBlock as BlockActionType);
             const originalActionPlayer = newState.currentAction?.player; // Get from context
             if (originalAction && originalActionPlayer) {
                 newState = logAction(newState, `No challenge to ${currentClaimer.name}'s claim of ${actionOrBlock}. Block succeeds. ${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
             } else {
                  newState = logAction(newState, `No challenge to ${currentClaimer.name}'s claim of ${actionOrBlock}. Block succeeds, original action cancelled.`);
             }
             newState = await advanceTurn(newState);
        } else {
             // An action claim was allowed (not challenged or blocked).
             newState = logAction(newState, `No challenges or blocks. ${currentClaimer.name}'s ${actionOrBlock} attempt succeeds.`);
             // For Assassination, this means the claim passed, now check block
             if (actionOrBlock === 'Assassinate' && originalTarget) {
                  console.log(`[resolveChallengeOrBlock] Assassinate claim successful. Proceeding to block_decision stage.`);
                   newState.challengeOrBlockPhase = {
                      actionPlayer: currentClaimer, // Original action player
                      action: 'Assassinate', // Original action
                      targetPlayer: originalTarget, // Target
                      possibleResponses: [originalTarget], // Only target can block
                      responses: [],
                      stage: 'block_decision',
                      validResponses: ['Block Assassination', 'Allow'],
                  };
                   newState = logAction(newState, `${originalTarget.name}, do you block with Contessa or allow the Assassination?`);
                   newState = await triggerAIResponses(newState);
              } else {
                   // Execute other successful actions
                   newState = await executeSuccessfulAction(newState, currentClaimer, actionOrBlock as ActionType, originalTarget);
              }
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
    return newState; // Return the state after resolution
}

// New function to handle the decision after being challenged
export async function handleChallengeDecision(gameState: GameState | null, challengedPlayerId: string, decision: ChallengeDecisionType): Promise<GameState> {
    if (!gameState) return createErrorState(`[handleChallengeDecision] Error: gameState is null for player ${challengedPlayerId}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeDecision = JSON.parse(JSON.stringify(gameState)); // For fallback
    const pendingDecision = newState.pendingChallengeDecision;

    if (!pendingDecision || pendingDecision.challengedPlayerId !== challengedPlayerId) {
        const errorMsg = `[handleChallengeDecision] Error: No pending challenge decision found for player ${challengedPlayerId}.`;
        return createErrorState(errorMsg, newState);
    }
    const challengedPlayer = getPlayerById(newState, challengedPlayerId);
    const challenger = getPlayerById(newState, pendingDecision.challengerId);

     if(!challengedPlayer || !challenger) {
         const errorMsg = `[handleChallengeDecision] Error: Challenged player or challenger not found.`;
          newState.pendingChallengeDecision = null; // Clear invalid phase
         return createErrorState(errorMsg, newState);
     }

    console.log(`[handleChallengeDecision] ${challengedPlayer.name} chose to ${decision} the challenge from ${challenger.name}.`);
    newState = logAction(newState, `${challengedPlayer.name} decides to ${decision}.`);
    // Clear the pending decision phase
    newState.pendingChallengeDecision = null;

    if (decision === 'Retreat') {
        console.log(`[handleChallengeDecision] ${challengedPlayer.name} retreats. Action/Block fails.`);
        newState = logAction(newState, `${challengedPlayer.name} retreats. Their claim of ${pendingDecision.actionOrBlock} fails.`);

        // Refund cost if the retreated action had one (e.g., Assassinate) - Check original action context
        const originalActionCost = newState.currentAction?.cost;
        const wasOriginalAction = newState.currentAction?.player.id === challengedPlayerId && newState.currentAction?.action === pendingDecision.actionOrBlock;

        if (originalActionCost && wasOriginalAction) {
            const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
            if (playerIndex !== -1) {
                const newMoney = newState.players[playerIndex].money + originalActionCost;
                newState.players[playerIndex] = { ...newState.players[playerIndex], money: newMoney };
                newState.treasury -= originalActionCost;
                newState = logAction(newState, `${challengedPlayer.name} is refunded ${originalActionCost} coins for the retreated action.`);
                console.log(`[handleChallengeDecision] Refunded ${originalActionCost} to ${challengedPlayer.name}.`);
            }
        }

        // If a BLOCK was challenged and retreated, the original action proceeds
        if (pendingDecision.actionOrBlock.startsWith('Block ')) {
            const originalAction = getActionFromBlock(pendingDecision.actionOrBlock as BlockActionType);
            const originalActionPlayer = getPlayerById(newState, pendingDecision.originalActionPlayerId || ''); // Use stored ID
            const originalTargetPlayer = getPlayerById(newState, pendingDecision.originalTargetPlayerId || ''); // Use stored ID

            if (originalAction && originalActionPlayer) {
                 console.log(`[handleChallengeDecision] Block retreated. Original action ${originalAction} by ${originalActionPlayer.name} proceeds.`);
                 newState = logAction(newState, `${challengedPlayer.name}'s block fails due to retreat. ${originalActionPlayer.name}'s ${originalAction} proceeds.`);
                 // For Assassinate, if block fails, execute the assassination
                 if (originalAction === 'Assassinate' && originalTargetPlayer) {
                     newState = logAction(newState, `Assassination against ${originalTargetPlayer.name} proceeds.`);
                      const { newState: revealedState } = await handleForceReveal(newState, originalTargetPlayer.id);
                      newState = revealedState;
                      newState = await advanceTurn(newState);
                 } else {
                      newState = await executeSuccessfulAction(newState, originalActionPlayer, originalAction, originalTargetPlayer);
                 }
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
        console.log(`[handleChallengeDecision] ${challengedPlayer.name} proceeds. Resolving challenge outcome...`);
        // Call the actual challenge resolution logic
        newState = await executeChallengeResolution(newState, challengedPlayerId, pendingDecision.challengerId, pendingDecision.actionOrBlock);

    }

    // Added safety check to ensure a valid GameState is returned
    if (!newState || typeof newState.players === 'undefined') {
        console.error("[handleChallengeDecision] Error: newState became invalid after processing decision. Reverting.");
        return createErrorState("[handleChallengeDecision] Internal error after processing decision.", stateBeforeDecision);
    }


    return newState;
}

// Extracted logic for actually resolving the challenge AFTER proceed/retreat decision
async function executeChallengeResolution(gameState: GameState, challengedPlayerId: string, challengerId: string, actionOrBlock: ActionType | BlockActionType): Promise<GameState> {
     // No null check needed here, called internally by functions that already check
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
               // Check for assassination block stage
               if (actionOrBlock === 'Assassinate' && originalTarget) {
                    console.log(`[executeChallengeResolution] Invalid challenge on Assassinate. Proceeding to block_decision stage.`);
                    newState.challengeOrBlockPhase = {
                        actionPlayer: challengedPlayer, // Original action player
                        action: 'Assassinate', // Original action
                        targetPlayer: originalTarget, // Target
                        possibleResponses: [originalTarget], // Only target can block
                        responses: [],
                        stage: 'block_decision',
                        validResponses: ['Block Assassination', 'Allow'],
                    };
                    newState = logAction(newState, `${originalTarget.name}, do you block with Contessa or allow the Assassination?`);
                    newState = await triggerAIResponses(newState);
               } else {
                   newState = await executeSuccessfulAction(newState, challengedPlayer, actionOrBlock as ActionType, originalTarget);
               }
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
                  const errorMsg = `Error: ${challengedPlayer.name} had ${cardToReveal} but couldn't find unrevealed instance?`;
                  newState = logAction(newState, errorMsg);
                  console.error(`[executeChallengeResolution] Logic error: Cannot find unrevealed ${cardToReveal} for ${challengedPlayer.name}`);
                   // As a fallback, reveal *any* unrevealed card to prevent game getting stuck
                  const { newState: revealFallbackState } = await handleForceReveal(newState, challengedPlayerId);
                  newState = revealFallbackState; // Use the returned state
             }
         }

         // Challenger loses influence
         newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
          console.log(`[executeChallengeResolution] Challenger ${challenger.name} must reveal.`);
         const { newState: revealedState } = await handleForceReveal(newState, challengerId); // await reveal
          newState = revealedState; // Assign revealedState directly

         // Check if challenger eliminated before proceeding
         const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);
         const challengedActionPlayer = getPlayerById(newState, challengedPlayerId); // Get potentially updated state
           if (!challengedActionPlayer) { // Safety check
                const errorMsg = `[executeChallengeResolution] Error: Challenged player ${challengedPlayerId} not found after challenger reveal.`;
                return createErrorState(errorMsg, newState);
            }
          // Retrieve original target from the original action context
           const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');


         if (!challengerStillActive) {
             console.log(`[executeChallengeResolution] Challenger ${challenger.name} eliminated by failed challenge.`);
             newState = logAction(newState, `${challenger.name} was eliminated by the failed challenge!`);
             const winner = checkForWinner(newState);
             if (winner) {
                  newState.winner = winner;
                  newState = logAction(newState, `${winner.name} has won the game!`);
                  console.log(`[executeChallengeResolution] Game Over! Winner: ${winner.name}`);
                  return newState;
             }
         }

          // If challenge failed, the original action/block proceeds
          console.log(`[executeChallengeResolution] Challenge failed. Original claim (${actionOrBlock}) by ${challengedActionPlayer.name} proceeds.`);
          if (actionOrBlock.startsWith('Block ')) {
              // Block was challenged and proven true, block succeeds, original action fails
              const originalAction = getActionFromBlock(actionOrBlock as BlockActionType);
                // Get original player from original action context
               const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
               if (originalAction && originalActionPlayer) {
                  newState = logAction(newState, `${challengedActionPlayer.name}'s block is successful. ${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
               } else {
                  newState = logAction(newState, `${challengedActionPlayer.name}'s block is successful. Original action is cancelled.`);
               }
               newState = await advanceTurn(newState);
          } else {
               // Action was challenged and proven true, action proceeds
               // If Assassination, move to block_decision stage
               if (actionOrBlock === 'Assassinate' && originalTarget) {
                   console.log(`[executeChallengeResolution] Assassinate claim successful. Proceeding to block_decision stage.`);
                   newState.challengeOrBlockPhase = {
                       actionPlayer: challengedActionPlayer, // Original action player
                       action: 'Assassinate', // Original action
                       targetPlayer: originalTarget, // Target
                       possibleResponses: [originalTarget], // Only target can block
                       responses: [],
                       stage: 'block_decision',
                       validResponses: ['Block Assassination', 'Allow'],
                   };
                   newState = logAction(newState, `${originalTarget.name}, do you block with Contessa or allow the Assassination?`);
                   newState = await triggerAIResponses(newState);
               } else {
                   newState = await executeSuccessfulAction(newState, challengedActionPlayer, actionOrBlock as ActionType, originalTarget);
               }
          }


     } else {
          // --- Challenge Successful (Challenged Player Bluffed) ---
         console.log(`[executeChallengeResolution] Challenge successful! ${challengedPlayer.name} bluffed ${actionOrBlock}.`);
         newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge with ${requiredCard} ${actionOrBlock === 'Block Stealing' ? `or ${getAlternateCardForStealBlock()}`: ''} and loses influence.`);
         // Challenged player loses influence because they bluffed
         const { newState: revealedState } = await handleForceReveal(newState, challengedPlayerId); // await reveal
         newState = revealedState; // Assign revealedState directly

         // Check if challenged player eliminated
          const challengedStillActive = getActivePlayers(newState).some(p => p.id === challengedPlayerId);

          if(!challengedStillActive) {
              console.log(`[executeChallengeResolution] Challenged player ${challengedPlayer.name} eliminated by successful challenge.`);
              newState = logAction(newState, `${challengedPlayer.name} was eliminated by the successful challenge!`);
              const winner = checkForWinner(newState);
               if (winner) {
                   newState.winner = winner;
                   newState = logAction(newState, `${winner.name} has won the game!`);
                    console.log(`[executeChallengeResolution] Game Over! Winner: ${winner.name}`);
                   return newState;
               }
          }
           // Action/Block fails because bluff was called.
           console.log(`[executeChallengeResolution] Bluff called. ${challengedPlayer.name}'s claim for ${actionOrBlock} fails.`);

          if (actionOrBlock.startsWith('Block ')) {
               // Block was challenged and failed, original action proceeds
               const originalAction = getActionFromBlock(actionOrBlock as BlockActionType);
               // Get original player/target from original action context
                const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
                const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');
                if (originalAction && originalActionPlayer) {
                    newState = logAction(newState, `${challengedPlayer.name}'s block fails. ${originalActionPlayer.name}'s ${originalAction} proceeds.`);
                    // If original action was Assassinate, execute it now
                    if (originalAction === 'Assassinate' && originalTarget) {
                        newState = logAction(newState, `Assassination against ${originalTarget.name} proceeds.`);
                         const { newState: revealAssassinationState } = await handleForceReveal(newState, originalTarget.id);
                         newState = revealAssassinationState;
                         newState = await advanceTurn(newState);
                    } else {
                         newState = await executeSuccessfulAction(newState, originalActionPlayer, originalAction, originalTarget);
                    }
                } else {
                     const errorMsg = `[executeChallengeResolution] Error retrieving original action/player after failed block challenge.`;
                     console.error(errorMsg);
                     newState = logAction(newState, errorMsg);
                     newState = await advanceTurn(newState);
                }
          } else {
              // Action was challenged and failed, turn advances
               newState = logAction(newState, `${challengedPlayer.name}'s ${actionOrBlock} is cancelled.`);
               // Refund cost if action had one (e.g., Assassinate)
               const cost = originalCurrentAction?.cost;
                if (cost) {
                    const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
                    if (playerIndex !== -1) {
                         // Ensure player still exists after potentially losing influence
                         const currentPlayerState = getPlayerById(newState, challengedPlayerId);
                         if (currentPlayerState) {
                            const newMoney = currentPlayerState.money + cost;
                            newState.players[playerIndex] = { ...currentPlayerState, money: newMoney };
                            newState.treasury -= cost;
                            newState = logAction(newState, `${challengedPlayer.name} is refunded ${cost} coins for the failed action.`);
                            console.log(`[executeChallengeResolution] Refunded ${cost} to ${challengedPlayer.name}.`);
                         }
                    }
                }
               newState = await advanceTurn(newState);
          }
     }

     return newState;
}



async function executeSuccessfulAction(gameState: GameState | null, player: Player, action: ActionType, target?: Player): Promise<GameState> {
     if (!gameState) return createErrorState(`[executeSuccessfulAction] Error: gameState is null for player ${player?.id}.`);
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
             // This case is now handled within the challenge resolution logic
             // If Assassinate gets here, it means it was allowed (not blocked or challenged)
             if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive && currentTarget) {
                 // Cost was already paid on attempt
                  console.log(`[executeSuccessfulAction] Assassination success against ${currentTarget.name}. Target must reveal.`);
                 newState = logAction(newState, `Assassination against ${currentTarget.name} succeeds.`);
                 const { newState: revealedState } = await handleForceReveal(newState, currentTarget.id); // await reveal
                 newState = revealedState; // Assign directly

             } else if (targetIndex !== -1 && (!targetStillActive || !currentTarget)) {
                  const infoMsg = `Assassination target ${target?.name || target?.id} was already eliminated or not found.`;
                  console.log(`[executeSuccessfulAction] ${infoMsg}`);
                  newState = logAction(newState, infoMsg);
             } else if (playerIndex === -1) { // Should be caught earlier, but safety check
                  const errorMsg = `[executeSuccessfulAction] Assassin ${player.id} not found.`;
                  console.error(errorMsg);
                  newState = logAction(newState, errorMsg);
             }
              newState = await advanceTurn(newState);
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
     if (!newState || typeof newState.players === 'undefined') {
         console.error("[executeSuccessfulAction] Error: newState became invalid after executing action. Reverting.");
         return createErrorState("[executeSuccessfulAction] Internal error after executing action.", stateBeforeExecute);
     }


    return newState;
}



async function advanceTurn(gameState: GameState | null): Promise<GameState> {
    if (!gameState) return createErrorState("[advanceTurn] Error: gameState is null.");
    console.log("[advanceTurn] Advancing turn...");
     // Ensure gameState is a valid object before proceeding
     if (typeof gameState !== 'object' || gameState === null || !Array.isArray(gameState.players)) {
          return createErrorState("[advanceTurn] Error: Received invalid gameState object structure.");
     }


    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy

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
        newState.pendingExchange = null;
        return newState; // Return immediately if game is over
    }

     // 2. Clear transient states
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision || newState.currentAction) {
        console.log("[advanceTurn] Clearing transient states before advancing turn.");
         newState.challengeOrBlockPhase = null;
         newState.pendingExchange = null;
         newState.pendingChallengeDecision = null;
         newState.currentAction = null;
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
        case 'Block Stealing': return 'Steal';
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
        console.log(`[getAvailableActions] Player ${player.name} is eliminated. No actions available.`);
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
         console.log(`[getAvailableActions] No active opponents for ${player.name}. Filtering target actions.`);
        return actions.filter(a => a !== 'Coup' && a !== 'Assassinate' && a !== 'Steal');
    }

    // console.log(`[getAvailableActions] Available actions for ${player.name}: ${actions.join(', ')}`);
    return actions;
}

// Generate a simple text description of the game state for the AI
// Include AI player's own cards for better context
function generateGameStateDescription(gameState: GameState, aiPlayerId: string): string {
    let description = "Current Game State:\n";
    const aiPlayer = getPlayerById(gameState, aiPlayerId);
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
         description += `Current Action Just Performed: ${gameState.currentAction.player.name} performs ${gameState.currentAction.action} ${gameState.currentAction.target ? `targeting ${gameState.currentAction.target.name}`: ''}.\n`;
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
          description += `Pending Challenge Decision: ${getPlayerById(gameState, phase.challengerId)?.name} challenged ${getPlayerById(gameState, phase.challengedPlayerId)?.name}'s claim of ${phase.actionOrBlock}. ${getPlayerById(gameState, phase.challengedPlayerId)?.name} must decide to proceed or retreat.\n`;
      }
     if(gameState.pendingExchange) {
          description += `Pending Exchange: ${gameState.pendingExchange.player.name} is choosing cards from [${gameState.pendingExchange.cardsToChoose.join(', ')}].\n`;
     }
     const logEntries = gameState.actionLog.slice(-5); // Get last 5 entries
     description += `Recent Action Log Summary (${logEntries.length} entries):\n${logEntries.map(l => `  - ${l}`).join('\n')}\n`; // Last 5 log entries
    description += `It is currently ${gameState.players[gameState.currentPlayerIndex]?.name || 'Unknown'}'s turn.\n`;
    return description;
}


// Export handleAIAction so it can be called by page.tsx for the first turn or via button trigger
export async function handleAIAction(gameState: GameState | null): Promise<GameState> {
    if (!gameState) return createErrorState("[handleAIAction] Error: gameState is null.");
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
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision || newState.winner) {
          const infoMsg = `[handleAIAction] AI ${aiPlayer.name}'s turn skipped: Ongoing phase or game over. Phase: ${!!newState.challengeOrBlockPhase}, Exchange: ${!!newState.pendingExchange}, ChallengeDecision: ${!!newState.pendingChallengeDecision}, Winner: ${!!newState.winner}`;
         console.log(infoMsg);
         newState.needsHumanTriggerForAI = false; // Ensure flag is off
         return newState; // Don't act if in another phase
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
            const warnMsg = `[handleAIAction] AI ${aiPlayer.name} chose invalid action '${aiDecisionAction}'. Available: [${availableActions.join(', ')}]. Defaulting to Income.`;
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
     return stateAfterAction;
}




// Triggers AI responses during challenge/block phases. Returns the state *after* AIs have responded.
// IMPORTANT: This function MODIFIES the state by calling handlePlayerResponse, and potentially resolveChallengeOrBlock.
// Returns a valid GameState even on error.
async function triggerAIResponses(gameState: GameState | null): Promise<GameState> {
     if (!gameState) return createErrorState("[triggerAIResponses] Error: gameState is null.");
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    let currentPhase = newState.challengeOrBlockPhase; // Use challenge/block phase only
    let stateBeforeLoop = JSON.parse(JSON.stringify(gameState)); // Keep original state for fallback


    // Determine which list of possible responders to use
    let possibleResponders: Player[] = [];
    let currentResponses: {playerId: string, response: GameResponseType | ChallengeDecisionType}[] = [];


     if (newState.challengeOrBlockPhase) {
        currentPhase = newState.challengeOrBlockPhase;
         possibleResponders = currentPhase.possibleResponses;
         currentResponses = currentPhase.responses;
         console.log(`[triggerAIResponses] Phase active: Action=${currentPhase.action}, Stage=${currentPhase.stage}, Possible Responders=${possibleResponders.map(p=>p.name).join(',')}, Current Responses=${currentResponses.length}`);
     } else {
          console.log("[triggerAIResponses] No active challenge/block phase needing AI responses.");
         return newState; // No relevant phase active
     }

    try {
        // Loop while there's an active phase and AI responders who haven't responded yet
         while (currentPhase && possibleResponders.some(p => p.isAI && !currentResponses.some(r => r.playerId === p.id))) {
            const aiRespondersThisLoop = possibleResponders.filter(p => p.isAI && !currentResponses.some(r => r.playerId === p.id));
            const aiToAct = aiRespondersThisLoop[0]; // Process one AI at a time

            if (!aiToAct) {
                console.log("[triggerAIResponses] No more AI responders in this loop iteration.");
                break; // Should not happen if loop condition is correct, but safety break
            }

            // Get the most up-to-date state for the AI making the decision
            const aiPlayerState = getPlayerById(newState, aiToAct.id);
             if (!aiPlayerState) { // Safety check
                 console.error(`[triggerAIResponses] Error: AI Responder ${aiToAct.id} not found in state. Skipping response.`);
                  if (newState.challengeOrBlockPhase) {
                     newState.challengeOrBlockPhase.responses.push({ playerId: aiToAct.id, response: 'Allow' }); // Force allow to prevent loop?
                  } else {
                      console.error("[triggerAIResponses] Error: challengeOrBlockPhase is null when trying to force 'Allow'.");
                      break; // Break loop if phase disappeared
                  }
                 newState = logAction(newState, `[triggerAIResponses] Error: AI ${aiToAct.id} not found. Forced 'Allow'.`);
                  // Refresh phase pointers after modifying state
                 currentPhase = newState.challengeOrBlockPhase;
                  if (currentPhase) { // Check if phase still exists
                      possibleResponders = currentPhase.possibleResponses;
                      currentResponses = currentPhase.responses;
                  } else {
                      console.log("[triggerAIResponses] Phase ended after forced Allow for missing AI.");
                      break; // Phase ended
                  }
                 continue; // Try next AI
             }
            console.log(`[triggerAIResponses] AI Responder: ${aiPlayerState.name} needs to respond to ${currentPhase.actionPlayer.name}'s claim/action ${currentPhase.action} (Stage: ${currentPhase.stage})`);

            let decision: GameResponseType = 'Allow'; // Default
            let reasoning = 'Defaulting to Allow.';
            let decidedResponseType: 'Challenge' | 'Block' | 'Allow' = 'Allow'; // For logging/control flow
            const validStageResponses = currentPhase.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination']; // Fallback if not set

            try {
                console.log(`[triggerAIResponses] Getting response from AI ${aiPlayerState.name} for action/block ${currentPhase.action}`);
                // AI evaluates options based on the current stage and action
                const actionTarget = currentPhase.targetPlayer;
                const actionOrBlockPerformer = currentPhase.actionPlayer;
                const actionOrBlockClaim = currentPhase.action; // The action or block being claimed/responded to
                const stage = currentPhase.stage;

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
                        opponentMoney: actionOrBlockPerformer.money,
                        gameState: generateGameStateDescription(newState, aiPlayerState.id),
                        rulebook: coupRulebook,
                    });
                     newState = logAction(newState, `AI (${aiPlayerState.name}) Challenge Reasoning: ${challengeDecision.reasoning}`);
                     console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Challenge decision: ${challengeDecision.shouldChallenge}`);
                }

                // Evaluate Block (if possible in this stage/context)
                // Block is possible if the claim is an ACTION (not block) and AI is target or it's Foreign Aid/Assassination
                const originalActionType = typeof actionOrBlockClaim === 'string' && !actionOrBlockClaim.startsWith('Block ') ? actionOrBlockClaim as ActionType : null;
                const blockTypeForOriginalAction = originalActionType ? getBlockTypeForAction(originalActionType) : null;
                 // Check if *this specific block* is a valid response in the current stage
                 const canConsiderBlock = originalActionType && blockTypeForOriginalAction && validStageResponses.includes(blockTypeForOriginalAction);
                // AI can physically block if it's a blockable action AND (it's FA/Assassinate OR AI is the target)
                const canPhysicallyBlock = canConsiderBlock &&
                                          (originalActionType === 'Foreign Aid' || (originalActionType === 'Assassinate' && actionTarget?.id === aiPlayerState.id) || (originalActionType === 'Steal' && actionTarget?.id === aiPlayerState.id));

                 // Only evaluate block if AI can physically block and didn't decide to challenge the action claim
                if (canPhysicallyBlock && blockTypeForOriginalAction && !challengeDecision.shouldChallenge) {
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} evaluating Block (${blockTypeForOriginalAction}) against ${actionOrBlockPerformer.name}'s action ${originalActionType}...`);
                    blockDecision = await aiBlockReasoning({
                        action: originalActionType!, // Original action
                        actionPlayerName: actionOrBlockPerformer.name,
                        aiPlayerInfluenceCards: aiPlayerState.influence.filter(c => !c.revealed).map(c => c.type),
                        aiPlayerMoney: aiPlayerState.money,
                        opponentInfluenceCount: actionOrBlockPerformer.influence.filter(c => !c.revealed).length,
                        opponentMoney: actionOrBlockPerformer.money,
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
            currentPhase = newState.challengeOrBlockPhase; // Phase might have changed or ended
            if (currentPhase) {
                possibleResponders = currentPhase.possibleResponses;
                currentResponses = currentPhase.responses;
                 console.log(`[triggerAIResponses] Phase state after AI ${aiPlayerState.name}'s response: Stage=${currentPhase.stage}, Possible Responders=${possibleResponders.map(p=>p.name).join(',')}, Current Responses=${currentResponses.length}`);
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
     if (!newState || typeof newState.players === 'undefined') {
         console.error("[triggerAIResponses] Error: newState became invalid at the end of the function. Reverting.");
         return createErrorState("[triggerAIResponses] Internal error at end of function.", stateBeforeLoop);
     }

    return newState;
}



// Async because it calls completeExchange which is async
async function handleAIExchange(gameState: GameState | null): Promise<GameState> {
    if (!gameState) return createErrorState("[handleAIExchange] Error: gameState is null.");
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

     // Sort available cards by preference
     const sortedChoices = [...cardsToChooseFrom].sort((a, b) => cardPreference.indexOf(a) - cardPreference.indexOf(b));

     // Select the top 'cardsToKeepCount' cards from the sorted list
     const cardsToKeep = sortedChoices.slice(0, cardsToKeepCount);
     console.log(`[handleAIExchange] AI ${aiPlayer.name} chose to keep: ${cardsToKeep.join(', ')}.`);

    try {
        newState = logAction(newState, `AI (${aiPlayer.name}) chooses [${cardsToKeep.join(', ')}] for Exchange.`);
        const stateAfterCompletion = await completeExchange(newState, aiPlayer.id, cardsToKeep); // await completion
         newState = stateAfterCompletion; // Update state
    } catch (error: any) {
         const errorMsg = `[handleAIExchange] Error during completeExchange: ${error.message}. Reverting exchange.`;
         console.error(errorMsg);
         newState = createErrorState(errorMsg, stateBeforeExchange); // Ensure valid state
          if(newState) newState.pendingExchange = null; // Clear broken phase
    }

     return newState;
}

// TODO: Implement AI logic for challenge decision (Proceed vs Retreat)
async function handleAIChallengeDecision(gameState: GameState): Promise<GameState> {
    let newState = JSON.parse(JSON.stringify(gameState));
    const stateBeforeDecision = JSON.parse(JSON.stringify(gameState)); // Fallback
    const decisionPhase = newState.pendingChallengeDecision;
    if (!decisionPhase) return newState; // Should not happen

    const challengedPlayer = getPlayerById(newState, decisionPhase.challengedPlayerId);
    if (!challengedPlayer || !challengedPlayer.isAI) return newState; // Not an AI or player not found

    console.log(`[handleAIChallengeDecision] AI ${challengedPlayer.name} deciding whether to proceed or retreat from challenge...`);

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
     if (!stateAfterHandling || typeof stateAfterHandling.players === 'undefined') {
         console.error("[handleAIChallengeDecision] Error: stateAfterHandling became invalid. Reverting.");
         return createErrorState("[handleAIChallengeDecision] Internal error after handling AI decision.", stateBeforeDecision);
     }


    return stateAfterHandling;
}

// --- Public API ---

// Make this async because the actions it calls are async
export async function performAction(gameState: GameState | null, playerId: string, action: ActionType, targetId?: string): Promise<GameState> {
     if (!gameState) return createErrorState(`[API performAction] Error: gameState is null for player ${playerId}.`);
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
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.pendingChallengeDecision) {
          const warnMsg = "[API performAction] Warning: Action attempted during challenge/block/exchange/decision phase.";
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
      if (!stateAfterActionExecution || typeof stateAfterActionExecution.players === 'undefined') {
        console.error("[API performAction] Error: stateAfterActionExecution became invalid. Reverting.");
        return createErrorState("[API performAction] Internal error after executing action.", stateBeforeAction);
    }


     return stateAfterActionExecution;
}


// Make this async because the functions it calls (resolveChallenge/Block/etc.) are async
// Returns a valid GameState even on error.
export async function handlePlayerResponse(gameState: GameState | null, respondingPlayerId: string, response: GameResponseType): Promise<GameState> {
     if (!gameState) return createErrorState(`[API handlePlayerResponse] Error: gameState is null for player ${respondingPlayerId}.`);
    console.log(`[API handlePlayerResponse] Request: Player ${respondingPlayerId}, Response ${response}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeResponse = JSON.parse(JSON.stringify(gameState)); // For fallback
    const phase = newState.challengeOrBlockPhase; // Use current phase state

     // --- Input Validations ---
     if (!phase) {
           const warnMsg = "[API handlePlayerResponse] Warning: No challenge/block phase active.";
          console.warn(warnMsg);
         return logAction(newState, "Invalid response: Not in challenge/block phase.");
     }
      const responderCanAct = phase.possibleResponses.some(p => p.id === respondingPlayerId);
      const responderHasActed = phase.responses.some(r => r.playerId === respondingPlayerId);
      const validResponsesForStage = phase.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination']; // Default if not set

     if (!responderCanAct) {
           const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} cannot respond in this phase. Possible: [${phase.possibleResponses.map(p=>p.id).join(',')}] Stage: ${phase.stage}`;
          console.warn(warnMsg);
         return logAction(newState, `Invalid response: Player ${getPlayerById(newState, respondingPlayerId)?.name} cannot respond now.`);
     }
    if (responderHasActed) {
          const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} already responded.`;
         console.warn(warnMsg);
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`);
    }
    // Validate response against the specific valid responses for the current stage
     if (!validResponsesForStage.includes(response)) {
          const warnMsg = `[API handlePlayerResponse] Invalid response '${response}' for current stage '${phase.stage}'. Valid: [${validResponsesForStage.join(', ')}]`;
          console.warn(warnMsg);
          return logAction(newState, `Invalid response: '${response}'. Valid options are: ${validResponsesForStage.join(', ')}.`);
     }


     // --- Legacy Validation (keeping for now, but stage validation is primary) ---
     // Check if response type is valid for the action/block being claimed
     const claim = phase.action; // The action or block being claimed/responded to
     if (response === 'Challenge') {
         if (!getCardForAction(claim)) { // Check if claim is challengeable (has associated card)
              const warnMsg = `[API handlePlayerResponse] Invalid response: Cannot challenge the claim '${claim}'.`;
              console.warn(warnMsg);
             return logAction(newState, `Cannot challenge the claim '${claim}'.`);
         }
     } else if (response.startsWith('Block')) {
          // Can only block if the claim was an *action* (not a block itself)
         if (typeof claim !== 'string' || claim.startsWith('Block ')) {
               const warnMsg = `[API handlePlayerResponse] Invalid response: Cannot block a block claim ('${claim}').`;
               console.warn(warnMsg);
              return logAction(newState, `Cannot block a block claim.`);
         }
         // Check if the block type is valid for the original action
         const blockType = getBlockTypeForAction(claim as ActionType);
         if (response !== blockType) {
              const warnMsg = `[API handlePlayerResponse] Invalid response: Cannot use ${response} to block ${claim}. Expected ${blockType || 'no block'}.`;
              console.warn(warnMsg);
              return logAction(newState, `Cannot use ${response} to block ${claim}.`);
         }
         // Ensure blocker is target (if applicable) or it's Foreign Aid/Assassination
          if (claim === 'Steal' || claim === 'Assassinate') {
             if (phase.targetPlayer?.id !== respondingPlayerId) {
                  const warnMsg = `[API handlePlayerResponse] Invalid response: Only target ${phase.targetPlayer?.name} can block ${claim}.`;
                  console.warn(warnMsg);
                 return logAction(newState, `Only the target can ${response}.`);
             }
         }
          // Foreign Aid can be blocked by anyone (if Duke claim is valid)
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
             // If stage was 'challenge_action', this block is against the original action.
             // If stage was 'block_decision', this block is the target deciding to block (e.g., Assassination).
             console.log(`[API handlePlayerResponse] Block (${response}) issued by ${respondingPlayer.name}. Setting up challenge_block phase...`);
              const blocker = getPlayerById(newState, respondingPlayerId)!; // Blocker is the responder
              const blockType = response as BlockActionType;
               // The player whose original action is being blocked comes from the currentAction context
              const originalActionPlayer = newState.currentAction?.player;
               if (!originalActionPlayer) {
                   const errorMsg = "[API handlePlayerResponse] Error: Cannot find original action player context when handling block.";
                   stateAfterResponseHandling = createErrorState(errorMsg, newState);
               } else {
                    // Set up the phase to challenge the block claim
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

    // Final Null Check (Although functions should now always return a state)
    if (!stateAfterResponseHandling || typeof stateAfterResponseHandling.players === 'undefined') {
        const finalErrorMsg = `[API handlePlayerResponse] stateAfterResponseHandling became null unexpectedly after processing ${response}. Reverting.`;
        console.error(finalErrorMsg);
        stateAfterResponseHandling = createErrorState(finalErrorMsg, stateBeforeResponse); // Ensure valid state
    }


     console.log(`[API handlePlayerResponse] Finished processing response ${response}. Returning state.`);
     return stateAfterResponseHandling;
}



// Make this async because it calls completeExchange which is async
// Returns a valid GameState even on error.
export async function handleExchangeSelection(gameState: GameState | null, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
      if (!gameState) return createErrorState(`[API handleExchangeSelection] Error: gameState is null for player ${playerId}.`);
     console.log(`[API handleExchangeSelection] Request: Player ${playerId}, Cards ${cardsToKeep.join(', ')}`);
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
        return logAction(newState, "Not in exchange phase for this player.");
    }
     if (!player.influence.some(c => !c.revealed)) {
           const warnMsg = `[API handleExchangeSelection] Warning: Player ${playerId} is eliminated.`;
          console.warn(warnMsg);
         return logAction(newState, "You are eliminated."); // Should not happen if logic is correct
     }
      const requiredCount = player.influence.filter(c => !c.revealed).length;
     if (cardsToKeep.length !== requiredCount) {
           const warnMsg = `[API handleExchangeSelection] Error: Player ${playerId} selected ${cardsToKeep.length} cards, but needs ${requiredCount}.`;
          console.warn(warnMsg);
         return logAction(newState, `Error: Must select exactly ${requiredCount} card(s) to keep.`);
     }
      // Verify selected cards are from the available choices
      let tempCardsToKeep = [...cardsToKeep];
      let tempCardsToChoose = [...exchangeInfo.cardsToChoose] // Copy choices
      let validSelection = true;
      for(const card of cardsToKeep) {
           const indexInChoices = tempCardsToChoose.indexOf(card);
           if(indexInChoices === -1) {
               validSelection = false;
               const warnMsg = `[API handleExchangeSelection] Error: Player ${playerId} selected invalid card: ${card}. Choices were: ${exchangeInfo.cardsToChoose.join(',')}`;
               console.warn(warnMsg);
               return logAction(newState, `Error: Invalid card selected: ${card}.`);
           }
           tempCardsToChoose.splice(indexInChoices, 1); // Remove the card from choices to handle duplicates correctly
      }


     console.log("[API handleExchangeSelection] Validation complete. Completing exchange...");
     let stateAfterExchange: GameState = newState; // Initialize
     try {
        stateAfterExchange = await completeExchange(newState, playerId, cardsToKeep);
     } catch(error: any) {
         const errorMsgLog = `[API handleExchangeSelection] Critical error during completeExchange: ${error.message}. Reverting.`;
        console.error(errorMsgLog);
        stateAfterExchange = createErrorState(errorMsgLog, stateBeforeExchange); // Ensure valid state
        if (stateAfterExchange) {
            stateAfterExchange.pendingExchange = null; // Clean up phase
        }
     }
       // Final check
     if (!stateAfterExchange || typeof stateAfterExchange.players === 'undefined') {
         console.error("[API handleExchangeSelection] Error: stateAfterExchange became invalid. Reverting.");
         return createErrorState("[API handleExchangeSelection] Internal error after handling exchange.", stateBeforeExchange);
     }
     return stateAfterExchange;
}
