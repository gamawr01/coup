

import { type GameState, type Player, type CardType, type InfluenceCard, DeckComposition, ActionType, GameResponseType, BlockActionType, ChallengeActionType } from './game-types';
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
function createErrorState(errorMessage: string, previousState?: GameState | null): GameState {
    // Define a minimal default structure
    const defaultState: GameState = {
        players: [],
        deck: [],
        treasury: 0,
        currentPlayerIndex: 0,
        currentAction: null,
        challengeOrBlockPhase: null,
        pendingExchange: null,
        actionLog: [],
        winner: null,
        needsHumanTriggerForAI: false,
    };

    // Use previous state if valid, otherwise use the default
    // Ensure deep copy to avoid mutation issues
    const baseState: GameState = previousState ? JSON.parse(JSON.stringify(previousState)) : defaultState;

    // Log the error message
    console.error(errorMessage); // Log to console
    baseState.actionLog = [...(baseState.actionLog || []), `Error: ${errorMessage}`]; // Add to game log

    // Optionally clear transient states that might be inconsistent after an error
    baseState.currentAction = null;
    baseState.challengeOrBlockPhase = null;
    baseState.pendingExchange = null;

    return baseState;
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
async function revealInfluence(gameState: GameState | null, playerId: string, cardType?: CardType): Promise<{ newState: GameState, revealedCard: CardType | null }> {
    if (!gameState) {
        const errorMsg = `[revealInfluence] Error: Called with null gameState for player ${playerId}.`;
        return { newState: createErrorState(errorMsg), revealedCard: null };
    }
    console.log(`[revealInfluence] Player ${playerId} needs to reveal${cardType ? ` ${cardType}` : ''}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy for safety
    let revealedCardType: CardType | null = null;
    const playerIndex = newState.players.findIndex(p => p.id === playerId);

    if (playerIndex !== -1) {
        const player = newState.players[playerIndex];
        let influenceToReveal: InfluenceCard | undefined;
        let cardIndexToReveal = -1;

        // Find the specific card if provided and unrevealed
        if (cardType) {
            cardIndexToReveal = player.influence.findIndex(c => c.type === cardType && !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
            } else {
                 console.warn(`[revealInfluence] Player ${playerId} asked to reveal ${cardType}, but no unrevealed ${cardType} found. Choosing another card.`);
            }
        }

        // If no specific type needed, or specific type not found/already revealed, find *any* unrevealed card
        if (!influenceToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
                 console.log(`[revealInfluence] No specific card required or found, revealing first available: ${influenceToReveal?.type}`);
            }
        }


        if (influenceToReveal && cardIndexToReveal !== -1) {
             // Create a new influence array with the revealed card marked
             const newInfluence = [...player.influence];
             newInfluence[cardIndexToReveal] = { ...influenceToReveal, revealed: true };
             newState.players[playerIndex] = { ...player, influence: newInfluence }; // Update player immutably

             revealedCardType = influenceToReveal.type;
             console.log(`[revealInfluence] ${player.name} revealed ${revealedCardType}.`);
             newState = logAction(newState, `${player.name} revealed a ${revealedCardType}.`);
             newState = eliminatePlayer(newState, playerId); // Check if this reveal eliminates the player
        } else {
             const errorMsg = `${player.name} has no more influence to reveal!`;
             newState = logAction(newState, errorMsg); // Should ideally not happen if logic is correct
             console.warn(`[revealInfluence] Could not find influence to reveal for ${player.name} (Card type: ${cardType}, Unrevealed: ${player.influence.filter(c=>!c.revealed).map(c=>c.type).join(',')})`);
             newState = eliminatePlayer(newState, playerId);
        }
    } else {
         const errorMsg = `[revealInfluence] Player ID ${playerId} not found.`;
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
         console.log(`[performForeignAid] Potential blockers exist. Entering challenge/block phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Foreign Aid',
            possibleResponses: potentialBlockers,
            responses: [],
        };
        // AI needs to decide to block here if they are potential blockers
         const stateAfterTrigger = await triggerAIResponses(newState);
          // triggerAIResponses now always returns a GameState
         newState = stateAfterTrigger;

    } else {
        // No one can block, action succeeds immediately
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
        const { newState: revealedState } = await revealInfluence(newState, targetId); // Ensure await here
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
         console.log(`[performTax] Potential challengers exist. Entering challenge/block phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Tax',
            possibleResponses: potentialChallengers,
            responses: [],
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


    const potentialResponders = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialResponders.length > 0) {
         console.log(`[performAssassinate] Potential responders exist. Entering challenge/block phase.`);
         newState.challengeOrBlockPhase = {
            actionPlayer: newState.players[playerIndex], // Pass updated player state
            action: 'Assassinate',
            targetPlayer: target,
            possibleResponses: potentialResponders,
            responses: [],
        };
         const stateAfterTrigger = await triggerAIResponses(newState);
         newState = stateAfterTrigger;

    } else {
        // No one can challenge or block, assassination proceeds immediately
         console.log(`[performAssassinate] No responders. Assassination succeeds.`);
        newState = logAction(newState, `${player.name}'s Assassination attempt automatically succeeds.`);
        const { newState: revealedState } = await revealInfluence(newState, targetId);
         newState = revealedState; // Assign revealedState directly
        newState = await advanceTurn(newState);
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
            possibleResponses: potentialResponders, // Includes the target who can block
            responses: [],
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
         console.log(`[performExchange] Potential challengers exist. Entering challenge/block phase.`);
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Exchange',
            possibleResponses: potentialChallengers,
            responses: [],
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
    console.log(`[resolveChallengeOrBlock] Resolving phase for action: ${gameState.challengeOrBlockPhase?.action}`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeResolve = JSON.parse(JSON.stringify(gameState)); // For fallback
    const phase = newState.challengeOrBlockPhase;
    if (!phase) {
        console.warn("[resolveChallengeOrBlock] Phase is already null. Returning state.");
        return newState; // Should not happen if called correctly
    }

    const actionPlayer = getPlayerById(newState, phase.actionPlayer.id);
    const targetPlayer = phase.targetPlayer ? getPlayerById(newState, phase.targetPlayer.id) : undefined;
     // Safety check if players were somehow removed during the phase (unlikely)
     if (!actionPlayer) {
         const errorMsg = `[resolveChallengeOrBlock] Error: Action player ${phase.actionPlayer.id} not found during resolution.`;
         newState.challengeOrBlockPhase = null; // Clear invalid phase
         return createErrorState(errorMsg, newState);
     }


    const action = phase.action;


    const challenges = phase.responses.filter(r => r.response === 'Challenge');
    const blocks = phase.responses.filter(r => (r.response as BlockActionType).startsWith('Block'));

    // CRITICAL: Clear the phase state *before* potentially await-ing further async operations
    // to prevent re-entry issues if an AI response comes in late.
    newState.challengeOrBlockPhase = null;
    console.log("[resolveChallengeOrBlock] Phase cleared.");


    if (challenges.length > 0) {
        // Handle Challenge first (only one challenge happens)
        const challengerId = challenges[0].playerId;
        console.log(`[resolveChallengeOrBlock] Challenge found from ${challengerId}.`);
        // Pass the *original* action and players from the phase data, but use current game state
        newState = await resolveChallenge(newState, phase.actionPlayer.id, challengerId, action);

    } else if (blocks.length > 0) {
        // Handle Block (only one block happens, but it could be challenged)
        const blockerId = blocks[0].playerId;
        const blockType = blocks[0].response as BlockActionType;
        console.log(`[resolveChallengeOrBlock] Block found from ${blockerId} (${blockType}).`);
        // resolveBlock sets up the next challenge phase (challenge the block)
        // Pass the potentially updated actionPlayer state
        const currentActionPlayer = getPlayerById(newState, actionPlayer.id)!; // Refresh action player state
        newState = await resolveBlock(newState, currentActionPlayer, targetPlayer, blockerId, action as ActionType, blockType); // action must be ActionType here

    } else {
        // No challenges or blocks, action succeeds
        console.log(`[resolveChallengeOrBlock] No challenges or blocks. Action ${action} succeeds.`);
        // Refresh action player state before executing
        const currentActionPlayer = getPlayerById(newState, actionPlayer.id)!;
        newState = logAction(newState, `No challenges or blocks. ${currentActionPlayer.name}'s ${action} attempt succeeds.`);
        newState = await executeSuccessfulAction(newState, currentActionPlayer, action as ActionType, targetPlayer); // action must be ActionType here

    }

    console.log(`[resolveChallengeOrBlock] Phase resolution complete.`);
    return newState; // Return the state after resolution
}



async function resolveChallenge(gameState: GameState, challengedPlayerId: string, challengerId: string, action: ActionType | BlockActionType): Promise<GameState> {
    // No null check needed here, called internally by functions that already check
    console.log(`[resolveChallenge] ${challengerId} challenges ${challengedPlayerId}'s claim for ${action}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const stateBeforeResolve = JSON.parse(JSON.stringify(gameState)); // For fallback
    const challengedPlayer = getPlayerById(newState, challengedPlayerId);
    const challenger = getPlayerById(newState, challengerId);

     // Safety Checks
     if (!challengedPlayer || !challenger) {
         const errorMsg = `[resolveChallenge] Error: Challenged player (${challengedPlayerId}) or Challenger (${challengerId}) not found.`;
         return createErrorState(errorMsg, newState);
     }


    const requiredCard = getCardForAction(action);

    if (!requiredCard) {
         const errorMsg = `[resolveChallenge] Error: Action/Block ${action} cannot be challenged (or logic error).`;
         console.error(errorMsg);
         newState = logAction(newState, errorMsg);
         // Action proceeds as if unchallenged? Or halt? Assuming action proceeds.
         // Need to know if it was an action or block being challenged...
          // Retrieve original target from the *current action* if available, as phase is cleared
          // Use the state *before* this function call for currentAction context
          const originalCurrentAction = stateBeforeResolve.currentAction;
          const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');

         if(action.startsWith('Block ')) { // Challenged a block
              const originalAction = getActionFromBlock(action as BlockActionType);
              // Get original player from original currentAction
              const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
              if (originalAction && originalActionPlayer) {
                newState = logAction(newState, `Challenge on block failed due to error. ${challengedPlayer.name}'s block succeeds. ${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
              } else {
                newState = logAction(newState, `Challenge on block failed due to error. Block succeeds, original action cancelled.`);
              }
              newState = await advanceTurn(newState);
         } else { // Challenged an action
              newState = await executeSuccessfulAction(newState, challengedPlayer, action as ActionType, originalTarget);

         }
         return newState;
    }

     // Check if the challenged player has the required card OR the alternative card for stealing block
     const hasRequiredCard = challengedPlayer.influence.some(c => c.type === requiredCard && !c.revealed);
     const hasAlternativeStealCard = action === 'Block Stealing' && challengedPlayer.influence.some(c => c.type === getAlternateCardForStealBlock() && !c.revealed);
     const canProve = hasRequiredCard || hasAlternativeStealCard;
     const cardToReveal = hasRequiredCard ? requiredCard : (hasAlternativeStealCard ? getAlternateCardForStealBlock() : null);


    if (canProve && cardToReveal) {
        console.log(`[resolveChallenge] Challenge failed. ${challengedPlayer.name} has ${cardToReveal}.`);
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
                      console.log(`[resolveChallenge] ${challengedPlayer.name} drew ${newCard}.`);
                 } else {
                     newState = logAction(newState, `${challengedPlayer.name} shuffles back ${cardTypeToShuffle} but could not draw a new card (deck empty?).`);
                      console.warn(`[resolveChallenge] Deck empty, ${challengedPlayer.name} could not draw replacement.`);
                 }
                 // Update player state immutably
                 newState.players[playerIndex] = { ...newState.players[playerIndex], influence: currentInfluence };


            } else {
                 const errorMsg = `Error: ${challengedPlayer.name} had ${cardToReveal} but couldn't find unrevealed instance?`;
                 newState = logAction(newState, errorMsg);
                 console.error(`[resolveChallenge] Logic error: Cannot find unrevealed ${cardToReveal} for ${challengedPlayer.name}`);
                  // As a fallback, reveal *any* unrevealed card to prevent game getting stuck
                 const { newState: revealFallbackState } = await revealInfluence(newState, challengedPlayerId);
                 newState = revealFallbackState;


            }
        }

        // Challenger loses influence
        newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
         console.log(`[resolveChallenge] Challenger ${challenger.name} must reveal.`);
        const { newState: revealedState } = await revealInfluence(newState, challengerId); // await reveal
         newState = revealedState; // Assign revealedState directly

        // Check if challenger eliminated before proceeding
        const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);
        const challengedActionPlayer = getPlayerById(newState, challengedPlayerId); // Get potentially updated state
          if (!challengedActionPlayer) { // Safety check
               const errorMsg = `[resolveChallenge] Error: Challenged player ${challengedPlayerId} not found after challenger reveal.`;
               return createErrorState(errorMsg, newState);
           }
         // Retrieve original target from the *current action* if available, as phase is cleared
         // Use the state *before* this function call for currentAction context
          const originalCurrentAction = stateBeforeResolve.currentAction;
          const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');


        if (!challengerStillActive) {
            console.log(`[resolveChallenge] Challenger ${challenger.name} eliminated by failed challenge.`);
            newState = logAction(newState, `${challenger.name} was eliminated by the failed challenge!`);
            const winner = checkForWinner(newState);
            if (winner) {
                 newState.winner = winner;
                 newState = logAction(newState, `${winner.name} has won the game!`);
                 console.log(`[resolveChallenge] Game Over! Winner: ${winner.name}`);
                 return newState;
            }
        }

         // If challenge failed, the original action/block proceeds
         console.log(`[resolveChallenge] Challenge failed. Original claim (${action}) by ${challengedActionPlayer.name} proceeds.`);
         if (action.startsWith('Block ')) {
             // Block was challenged and proven true, block succeeds, original action fails
             const originalAction = getActionFromBlock(action as BlockActionType);
               // Get original player from original currentAction
              const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
              if (originalAction && originalActionPlayer) {
                 newState = logAction(newState, `${challengedActionPlayer.name}'s block is successful. ${originalActionPlayer.name}'s ${originalAction} is cancelled.`);
              } else {
                 newState = logAction(newState, `${challengedActionPlayer.name}'s block is successful. Original action is cancelled.`);
              }
              newState = await advanceTurn(newState);
         } else {
              // Action was challenged and proven true, action proceeds
              newState = await executeSuccessfulAction(newState, challengedActionPlayer, action as ActionType, originalTarget);

         }


    } else {
        console.log(`[resolveChallenge] Challenge successful! ${challengedPlayer.name} bluffed ${action}.`);
        newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge with ${requiredCard} ${action === 'Block Stealing' ? `or ${getAlternateCardForStealBlock()}`: ''} and loses influence.`);
        // Challenged player loses influence because they bluffed
        const { newState: revealedState } = await revealInfluence(newState, challengedPlayerId); // await reveal
        newState = revealedState; // Assign revealedState directly

        // Check if challenged player eliminated
         const challengedStillActive = getActivePlayers(newState).some(p => p.id === challengedPlayerId);

         if(!challengedStillActive) {
             console.log(`[resolveChallenge] Challenged player ${challengedPlayer.name} eliminated by successful challenge.`);
             newState = logAction(newState, `${challengedPlayer.name} was eliminated by the successful challenge!`);
             const winner = checkForWinner(newState);
              if (winner) {
                  newState.winner = winner;
                  newState = logAction(newState, `${winner.name} has won the game!`);
                   console.log(`[resolveChallenge] Game Over! Winner: ${winner.name}`);
                  return newState;
              }
         }
          // Action/Block fails because bluff was called.
          console.log(`[resolveChallenge] Bluff called. ${challengedPlayer.name}'s claim for ${action} fails.`);
          // Retrieve original context from state before the call
           const originalCurrentAction = stateBeforeResolve.currentAction;

         if (action.startsWith('Block ')) {
              // Block was challenged and failed, original action proceeds
              const originalAction = getActionFromBlock(action as BlockActionType);
              // Get original player/target from original currentAction
               const originalActionPlayer = getPlayerById(newState, originalCurrentAction?.player?.id || '');
               const originalTarget = getPlayerById(newState, originalCurrentAction?.target?.id || '');
               if (originalAction && originalActionPlayer) {
                   newState = logAction(newState, `${challengedPlayer.name}'s block fails. ${originalActionPlayer.name}'s ${originalAction} proceeds.`);
                   newState = await executeSuccessfulAction(newState, originalActionPlayer, originalAction, originalTarget);

               } else {
                    const errorMsg = `[resolveChallenge] Error retrieving original action/player after failed block challenge.`;
                    console.error(errorMsg);
                    newState = logAction(newState, errorMsg);
                    newState = await advanceTurn(newState);
               }
         } else {
             // Action was challenged and failed, turn advances
              newState = logAction(newState, `${challengedPlayer.name}'s ${action} is cancelled.`);
              newState = await advanceTurn(newState);
         }
    }

    return newState;
}



// This function is deprecated and logic is merged into resolveChallenge
// async function resolveBlockChallenge(...)


async function resolveBlock(gameState: GameState, actionPlayer: Player, targetPlayer: Player | undefined, blockerId: string, action: ActionType, blockType: BlockActionType): Promise<GameState> {
    // No null check needed here, called internally by functions that already check
    console.log(`[resolveBlock] ${blockerId} blocks ${actionPlayer.name}'s ${action} with ${blockType}.`);
    let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
    const blocker = getPlayerById(newState, blockerId);
    const currentActionPlayer = getPlayerById(newState, actionPlayer.id); // Refresh action player state

    // Safety checks
     if (!blocker || !currentActionPlayer) {
         const errorMsg = `[resolveBlock] Error: Blocker (${blockerId}) or Action Player (${actionPlayer.id}) not found.`;
         return createErrorState(errorMsg, newState);
     }


     // Block is announced, now the original actionPlayer can challenge the block claim
     newState = logAction(newState, `${currentActionPlayer.name} can now challenge ${blocker.name}'s attempt to ${blockType}.`);
      console.log(`[resolveBlock] Setting up challenge phase for the block claim.`);

     // The "action" being challenged now is the BLOCK itself
     newState.challengeOrBlockPhase = {
         actionPlayer: blocker, // The blocker is now the one whose claim (the block) can be challenged
         action: blockType as any, // Treat block as an action for challenge check (cast needed)
         targetPlayer: currentActionPlayer, // The target of the "block action" challenge is the original action player
         possibleResponses: [currentActionPlayer], // Only the original action player can challenge the block
         responses: [],
     };

     // Trigger AI/Player response for the challenge against the block
      console.log(`[resolveBlock] Triggering responses for challenge-the-block.`);
     newState = await triggerAIResponses(newState); // Will handle both AI and Human (by waiting)

     return newState; // State waits for challenge decision against the block
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
             if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive && currentTarget) {
                 // Cost was already paid on attempt
                  console.log(`[executeSuccessfulAction] Assassination success against ${currentTarget.name}. Target must reveal.`);
                 newState = logAction(newState, `Assassination against ${currentTarget.name} succeeds.`);
                 const { newState: revealedState } = await revealInfluence(newState, currentTarget.id); // await reveal
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

    return newState;
}



async function advanceTurn(gameState: GameState | null): Promise<GameState> {
    if (!gameState) return createErrorState("[advanceTurn] Error: gameState is null.");
    console.log("[advanceTurn] Advancing turn...");
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
        return newState; // Return immediately if game is over
    }

     // 2. Clear transient states (should already be clear, but safety check)
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.currentAction) {
        console.warn("[advanceTurn] Clearing unexpected transient state before advancing turn.");
         newState.challengeOrBlockPhase = null;
         newState.pendingExchange = null;
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
          description += `Challenge/Block Phase: ${phase.actionPlayer.name}'s attempt to perform/claim ${phase.action} ${phase.targetPlayer ? ` targeting ${phase.targetPlayer.name}`: ''} is being considered. Possible responses needed from: ${phase.possibleResponses.filter(p => !phase.responses.some(r => r.playerId === p.id)).map(p => p.name).join(', ')}. Current responses: ${phase.responses.map(r => `${getPlayerById(gameState, r.playerId)?.name}: ${r.response}`).join('; ') || 'None'}.\n`;
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
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.winner) {
          const infoMsg = `[handleAIAction] AI ${aiPlayer.name}'s turn skipped: Ongoing phase or game over. Phase: ${!!newState.challengeOrBlockPhase}, Exchange: ${!!newState.pendingExchange}, Winner: ${!!newState.winner}`;
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
    let currentPhase = newState.challengeOrBlockPhase; // Get the phase state *at the start*
    let stateBeforeLoop = JSON.parse(JSON.stringify(gameState)); // Keep original state for fallback

    try {
        // Loop while there's an active phase and AI responders who haven't responded yet
        while (currentPhase && currentPhase.possibleResponses.some(p => p.isAI && !currentPhase.responses.some(r => r.playerId === p.id))) {
            const aiRespondersThisLoop = currentPhase.possibleResponses.filter(p => p.isAI && !currentPhase.responses.some(r => r.playerId === p.id));
            const aiToAct = aiRespondersThisLoop[0]; // Process one AI at a time

            if (!aiToAct) {
                console.log("[triggerAIResponses] No more AI responders in this loop iteration.");
                break; // Should not happen if loop condition is correct, but safety break
            }

            // Get the most up-to-date state for the AI making the decision
            const aiPlayerState = getPlayerById(newState, aiToAct.id);
             if (!aiPlayerState) { // Safety check
                 console.error(`[triggerAIResponses] Error: AI Responder ${aiToAct.id} not found in state. Skipping response.`);
                 // Manually mark as responded to avoid infinite loop? Risky. Better to log and continue.
                 // For now, just log and let the loop try the next AI or finish.
                 // To prevent infinite loops if state is corrupt, maybe add a counter?
                 currentPhase.responses.push({ playerId: aiToAct.id, response: 'Allow' }); // Force allow to prevent loop?
                 newState = logAction(newState, `[triggerAIResponses] Error: AI ${aiToAct.id} not found. Forced 'Allow'.`);
                 currentPhase = newState.challengeOrBlockPhase; // Refresh phase state
                 continue; // Try next AI
             }
            console.log(`[triggerAIResponses] AI Responder: ${aiPlayerState.name} needs to respond to ${currentPhase.actionPlayer.name}'s claim for ${currentPhase.action}`);

            let decision: GameResponseType = 'Allow'; // Default
            let reasoning = 'Defaulting to Allow.';
            let decidedResponseType: 'Challenge' | 'Block' | 'Allow' = 'Allow'; // For logging/control flow

            try {
                console.log(`[triggerAIResponses] Getting response from AI ${aiPlayerState.name} for action/block ${currentPhase.action}`);
                // Determine if AI *can* challenge or block
                const actionTarget = currentPhase.targetPlayer; // Original action target (if any)
                const actionOrBlockPerformer = currentPhase.actionPlayer; // Player whose claim is being responded to
                const actionOrBlock = currentPhase.action; // The action/block being claimed

                // Can the AI challenge the claim? (Checks if the claim corresponds to a card)
                const canChallengeClaim = getCardForAction(actionOrBlock) !== null;

                // Can the AI block the *original* action (only relevant if actionOrBlock is an action, not a block itself)
                const originalActionType = actionOrBlock.startsWith('Block ') ? getActionFromBlock(actionOrBlock as BlockActionType) : actionOrBlock as ActionType;
                const blockTypeForOriginalAction = originalActionType ? getBlockTypeForAction(originalActionType) : null;
                // Can block if: it's a blockable action AND (it's Foreign Aid OR AI is the target)
                const canBlockOriginalAction = !actionOrBlock.startsWith('Block ') && // Cannot block a block
                                                blockTypeForOriginalAction &&
                                                (originalActionType === 'Foreign Aid' || actionTarget?.id === aiPlayerState.id);


                // AI evaluates challenge (if applicable)
                let challengeDecision = { shouldChallenge: false, reasoning: ""};
                if (canChallengeClaim) {
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} evaluating Challenge against ${actionOrBlockPerformer.name}'s claim of ${actionOrBlock}...`);
                    challengeDecision = await aiChallengeReasoning({
                        actionOrBlock: actionOrBlock, // Pass the specific claim being challenged
                        playerName: actionOrBlockPerformer.name, // Person performing the action/block being potentially challenged
                        targetPlayerName: actionTarget?.name, // Optional target of original action (relevant if challenging block)
                        aiInfluenceCards: aiPlayerState.influence.filter(c => !c.revealed).map(c => c.type), // AI's current cards
                        opponentInfluenceCount: actionOrBlockPerformer.influence.filter(c => !c.revealed).length, // Influence count of the player whose claim is being challenged
                        opponentMoney: actionOrBlockPerformer.money, // Money of the player making the claim
                        gameState: generateGameStateDescription(newState, aiPlayerState.id), // Pass current full state
                        rulebook: coupRulebook, // Provide rulebook
                    });
                    newState = logAction(newState, `AI (${aiPlayerState.name}) Challenge Reasoning: ${challengeDecision.reasoning}`);
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Challenge decision: ${challengeDecision.shouldChallenge}`);
                }

                // AI evaluates block (if applicable and didn't decide to challenge the action claim)
                let blockDecision = { shouldBlock: false, reasoning: ""};
                // Only evaluate blocking if the claim was an ACTION (not a block) and AI *can* block it
                if (canBlockOriginalAction && blockTypeForOriginalAction && !challengeDecision.shouldChallenge) {
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} evaluating Block (${blockTypeForOriginalAction}) against ${actionOrBlockPerformer.name}'s action ${originalActionType}...`);
                    blockDecision = await aiBlockReasoning({
                        action: originalActionType!, // The original action being blocked
                        actionPlayerName: actionOrBlockPerformer.name, // Player performing original action
                        aiPlayerInfluenceCards: aiPlayerState.influence.filter(c => !c.revealed).map(c => c.type), // AI's cards
                        aiPlayerMoney: aiPlayerState.money, // AI's money
                        opponentInfluenceCount: actionOrBlockPerformer.influence.filter(c => !c.revealed).length, // Original action performer's influence
                        opponentMoney: actionOrBlockPerformer.money, // Original action performer's money
                        gameState: generateGameStateDescription(newState, aiPlayerState.id),
                        rulebook: coupRulebook, // Provide rulebook
                    });
                    newState = logAction(newState, `AI (${aiPlayerState.name}) Block Reasoning: ${blockDecision.reasoning}`);
                    console.log(`[triggerAIResponses] AI ${aiPlayerState.name} Block decision: ${blockDecision.shouldBlock}`);
                }


                // Determine final AI response (Prioritize Challenge > Block > Allow)
                if (canChallengeClaim && challengeDecision.shouldChallenge) {
                    decision = 'Challenge';
                    reasoning = challengeDecision.reasoning; // Use correct reasoning
                    decidedResponseType = 'Challenge';
                } else if (canBlockOriginalAction && blockTypeForOriginalAction && blockDecision.shouldBlock) {
                    decision = blockTypeForOriginalAction; // Use the specific block type
                    reasoning = blockDecision.reasoning;
                    decidedResponseType = 'Block';
                } else {
                    decision = 'Allow';
                    // Select the most relevant reasoning if allowing
                    reasoning = challengeDecision.reasoning || blockDecision.reasoning || 'Decided not to challenge or block.';
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
            }

            newState = logAction(newState, `AI (${aiPlayerState.name}) responds: ${decision}.`); // Only log decision for brevity in game log
            console.log(`[triggerAIResponses] AI ${aiPlayerState.name} final response: ${decision}. Reasoning: ${reasoning}`);

            // IMPORTANT: Update the state by calling handlePlayerResponse, which correctly modifies the phase state
            // and potentially resolves the phase or sets up the next challenge.
             const stateAfterResponse = await handlePlayerResponse(newState, aiPlayerState.id, decision); // Await the handling
              newState = stateAfterResponse; // Update newState with the result


            // Refresh phase state *after* the response has been handled
            currentPhase = newState.challengeOrBlockPhase;

            // If phase was resolved (is null now), exit the loop
            if (!currentPhase) {
                console.log(`[triggerAIResponses] Phase resolved after AI ${aiPlayerState.name}'s response (${decision}). Exiting loop.`);
                break;
            }

            // If the AI Challenged or Blocked, the interaction for *this specific action* usually stops waiting for other responses.
            // The resolution logic (resolveChallenge, resolveBlock) handles the next steps.
            if (decidedResponseType !== 'Allow') {
                console.log(`[triggerAIResponses] AI ${aiPlayerState.name} responded with ${decision}. Phase continues or resolves based on challenge/block logic. Exiting loop for this action.`);
                // The state returned by handlePlayerResponse is the correct state to proceed from.
                break; // Exit the loop as the phase has changed significantly or resolved.
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
        return logAction(stateBeforeLoop, errorMsg);
    }

    // After the loop, check if the phase *still* exists and if all *possible* responders have responded.
    // This handles the case where all AIs allowed, and now we might need to resolve or wait for a human.
    const finalPhase = newState.challengeOrBlockPhase;
    if (finalPhase && finalPhase.possibleResponses.every(p => finalPhase.responses.some(r => r.playerId === p.id))) {
        console.log("[triggerAIResponses] All responses received (likely all 'Allow' or phase resolved differently). Resolving phase...");
        const stateAfterResolve = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
         newState = stateAfterResolve; // Update state with resolved state
    } else if (finalPhase) {
        console.log("[triggerAIResponses] Phase still requires responses (likely human). Waiting.");
    } else {
        console.log("[triggerAIResponses] Phase already resolved during AI response handling.");
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
         newState = logAction(stateBeforeExchange, errorMsg);
          if(newState) newState.pendingExchange = null; // Clear broken phase
    }

     return newState;
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
     if (newState.challengeOrBlockPhase || newState.pendingExchange) {
          const warnMsg = "[API performAction] Warning: Action attempted during challenge/block/exchange phase.";
         console.warn(warnMsg);
        return logAction(newState, "Cannot perform action now, waiting for response or exchange.");
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
         stateAfterActionExecution = logAction(stateBeforeAction, errorMsgLog);
         // Clear potentially inconsistent partial state changes
         if (stateAfterActionExecution) {
            stateAfterActionExecution.currentAction = null;
            stateAfterActionExecution.challengeOrBlockPhase = null;
            stateAfterActionExecution.pendingExchange = null;
         } else {
             // If even the fallback logging failed, return the original state to avoid null
              const fallbackErrorMsg = "[API performAction] Fallback logging failed, returning original state before action.";
             console.error(fallbackErrorMsg);
             stateAfterActionExecution = logAction(stateBeforeAction, fallbackErrorMsg); // Try logging again on fallback state
         }

    }

     console.log(`[API performAction] Finished execution for ${action}. Returning final state.`);
     // Clear currentAction AFTER the action and potential subsequent phases are fully resolved by the functions above.
     // The advanceTurn function should handle this clearing now.
     // stateAfterActionExecution.currentAction = null;
      // Ensure we always return a valid GameState
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

     if (!responderCanAct) {
           const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} cannot respond in this phase. Possible: [${phase.possibleResponses.map(p=>p.id).join(',')}]`;
          console.warn(warnMsg);
         return logAction(newState, `Invalid response: Player ${getPlayerById(newState, respondingPlayerId)?.name} cannot respond now.`);
     }
    if (responderHasActed) {
          const warnMsg = `[API handlePlayerResponse] Warning: Player ${respondingPlayerId} already responded.`;
         console.warn(warnMsg);
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`);
    }
     // Check if response type is valid for the action/block being claimed
     const claim = phase.action; // The action or block being claimed
     if (response === 'Challenge') {
         if (!getCardForAction(claim)) { // Check if claim is challengeable (has associated card)
              const warnMsg = `[API handlePlayerResponse] Invalid response: Cannot challenge the claim '${claim}'.`;
              console.warn(warnMsg);
             return logAction(newState, `Cannot challenge the claim '${claim}'.`);
         }
     } else if (response.startsWith('Block')) {
         // Can only block if the claim was an *action* (not a block itself)
         if (claim.startsWith('Block ')) {
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
         // Ensure blocker is target (if applicable) or it's Foreign Aid
         if (claim === 'Steal' || claim === 'Assassinate') {
             if (phase.targetPlayer?.id !== respondingPlayerId) {
                  const warnMsg = `[API handlePlayerResponse] Invalid response: Only target ${phase.targetPlayer?.name} can block ${claim}.`;
                  console.warn(warnMsg);
                 return logAction(newState, `Only the target can ${response}.`);
             }
         }
         // Foreign Aid can be blocked by anyone
     }


    const respondingPlayer = getPlayerById(newState, respondingPlayerId);
     if (!respondingPlayer) { // Safety check
         const errorMsg = `[API handlePlayerResponse] Error: Responding player ${respondingPlayerId} not found.`;
         return createErrorState(errorMsg, newState);
     }

    // --- Update Phase State ---
     console.log(`[API handlePlayerResponse] Processing response ${response} from ${respondingPlayer.name}`);
     // Create a *new* responses array
     const newResponses = [...phase.responses, { playerId: respondingPlayerId, response }];
     newState.challengeOrBlockPhase = { ...phase, responses: newResponses }; // Update state immutably
     newState = logAction(newState, `${respondingPlayer.name} responds: ${response}.`);


    // --- Resolve or Continue ---
    let stateAfterResponseHandling: GameState = newState; // Initialize with current state
    try {
        const currentPhase = newState.challengeOrBlockPhase!; // Use the just updated phase

        if (response === 'Challenge') {
            // Resolve immediately based on challenge logic
            console.log(`[API handlePlayerResponse] Challenge issued by ${respondingPlayer.name}. Resolving...`);
            // actionPlayer is the one making the claim, respondingPlayer is the challenger
            stateAfterResponseHandling = await resolveChallenge(newState, currentPhase.actionPlayer.id, respondingPlayerId, currentPhase.action);

        } else if (response.startsWith('Block')) {
            // A block was issued. Resolve the block attempt (which sets up the challenge-the-block phase)
            console.log(`[API handlePlayerResponse] Block issued by ${respondingPlayer.name}. Setting up challenge-the-block phase...`);
            // actionPlayer is original action taker, respondingPlayer is the blocker
            stateAfterResponseHandling = await resolveBlock(newState, currentPhase.actionPlayer, currentPhase.targetPlayer, respondingPlayerId, currentPhase.action as ActionType, response as BlockActionType);
        } else { // Response is 'Allow'
            console.log(`[API handlePlayerResponse] Allow received from ${respondingPlayer.name}.`);
            // Check if all responses are now in
            const allResponded = currentPhase.possibleResponses.every(p => currentPhase.responses.some(r => r.playerId === p.id));

            if (allResponded) {
                console.log("[API handlePlayerResponse] All responses received. Resolving phase...");
                stateAfterResponseHandling = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
            } else {
                console.log("[API handlePlayerResponse] Waiting for more responses...");
                // Still waiting for more responses. Trigger remaining AIs if applicable.
                const remainingResponders = currentPhase.possibleResponses.filter(p => !currentPhase.responses.some(r => r.playerId === p.id));
                const remainingAIs = remainingResponders.filter(p => p.isAI);
                if (remainingAIs.length > 0 && remainingAIs.length === remainingResponders.length) { // Only trigger if *only* AIs remain
                    console.log("[API handlePlayerResponse] All remaining responders are AI. Triggering remaining AI responders...");
                    stateAfterResponseHandling = await triggerAIResponses(newState); // Trigger remaining AIs
                } else {
                    console.log("[API handlePlayerResponse] Waiting for human response or mixed group.");
                    // If only human(s) remain, return current state and wait
                    stateAfterResponseHandling = newState;
                }
            }
        }
    } catch (error: any) {
          const errorMsgLog = `[API handlePlayerResponse] Critical error during response handling for ${response}: ${error.message}. Reverting.`;
         console.error(errorMsgLog);
         stateAfterResponseHandling = logAction(stateBeforeResponse, errorMsgLog);
         // Clear potentially inconsistent state
         if (stateAfterResponseHandling) {
            stateAfterResponseHandling.challengeOrBlockPhase = null;
         } else {
              const fallbackErrorMsg = "[API handlePlayerResponse] Fallback logging failed, returning original state before response.";
             console.error(fallbackErrorMsg);
             stateAfterResponseHandling = logAction(stateBeforeResponse, fallbackErrorMsg); // Try logging again on fallback state
         }
    }

    // Final Null Check (Although functions should now always return a state)
    if (!stateAfterResponseHandling) {
        const finalErrorMsg = `[API handlePlayerResponse] stateAfterResponseHandling became null unexpectedly after processing ${response}. Reverting.`;
        console.error(finalErrorMsg);
        stateAfterResponseHandling = logAction(stateBeforeResponse, finalErrorMsg);
        if (stateAfterResponseHandling) stateAfterResponseHandling.challengeOrBlockPhase = null;
        else stateAfterResponseHandling = stateBeforeResponse; // Absolute fallback
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
        stateAfterExchange = logAction(stateBeforeExchange, errorMsgLog);
        if (stateAfterExchange) {
            stateAfterExchange.pendingExchange = null; // Clean up phase
        } else {
             const fallbackErrorMsg = "[API handleExchangeSelection] Fallback logging failed, returning original state before exchange.";
             console.error(fallbackErrorMsg);
             stateAfterExchange = logAction(stateBeforeExchange, fallbackErrorMsg); // Try logging again on fallback state
        }
     }
     return stateAfterExchange;
}


// This function should ONLY be called by the game logic internally when a reveal is mandated.
// It's not a player action. The UI might call it *in response* to a game state flag indicating a reveal is needed.
// Make async as it calls revealInfluence
// Returns a valid GameState even on error.
export async function forceRevealInfluence(gameState: GameState | null, playerId: string, cardToReveal?: CardType): Promise<GameState> {
     if (!gameState) return createErrorState(`[API forceRevealInfluence] Error: gameState is null for player ${playerId}.`);
     console.log(`[API forceRevealInfluence] Request: Player ${playerId}, Card ${cardToReveal || 'auto'}`);
     let newState = JSON.parse(JSON.stringify(gameState)); // Deep copy
     const stateBeforeReveal = JSON.parse(JSON.stringify(gameState)); // Fallback
     const player = getPlayerById(newState, playerId);
     if (!player) {
           const errorMsg = "[API forceRevealInfluence] Error: Player not found.";
          return createErrorState(errorMsg, newState);
     }

     console.log(`[API forceRevealInfluence] Processing forced reveal for ${player.name}.`);
     let revealedState: GameState = newState;
     let revealedCard: CardType | null = null;

     try {
         const result = await revealInfluence(newState, playerId, cardToReveal); // await reveal
         revealedState = result.newState;
         revealedCard = result.revealedCard;
     } catch (error: any) {
         const errorMsgLog = `[API forceRevealInfluence] Critical error during revealInfluence: ${error.message}. Reverting.`;
         console.error(errorMsgLog);
         revealedState = logAction(stateBeforeReveal, errorMsgLog);
         // Attempt to clear potentially inconsistent state? Maybe not safe here.
     }
      newState = revealedState || stateBeforeReveal; // Use revealed state or fallback


     if(revealedCard === null && player.influence.some(c => !c.revealed)) { // Check if player *should* have cards left
          const errorMsg = `[API forceRevealInfluence] ${player.name} had influence left but revealInfluence returned null.`;
         console.error(errorMsg);
         newState = logAction(newState, errorMsg);
     } else if (revealedCard === null && !player.influence.some(c => !c.revealed)) {
          console.log(`[API forceRevealInfluence] ${player.name} had no influence left to reveal.`);
          // Log might already happen in revealInfluence
     }

      // Check for winner immediately after forced reveal
      const winner = checkForWinner(newState);
      if (winner && !newState.winner) { // Only set winner if not already set
           console.log(`[API forceRevealInfluence] Winner detected after reveal: ${winner.name}`);
          newState.winner = winner;
          newState = logAction(newState, `${winner.name} has won the game!`);
      }
       // Do NOT advance turn here. The logic that *caused* the forced reveal (Coup, Assassinate, Challenge Loss)
       // is responsible for calling advanceTurn *after* this reveal is complete.
        console.log(`[API forceRevealInfluence] Forced reveal complete for ${playerId}. Returning state.`);
     return newState;
}

