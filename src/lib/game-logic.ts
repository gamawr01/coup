import { type GameState, type Player, type CardType, type InfluenceCard, DeckComposition, ActionType, GameResponseType, BlockActionType, ChallengeActionType } from './game-types';
import { selectAction } from '@/ai/flows/ai-action-selection';
import { aiChallengeReasoning } from '@/ai/flows/ai-challenge-reasoning';
import { aiBlockReasoning } from '@/ai/flows/ai-block-reasoning';

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
    console.log("[initializeGame] Deck shuffled.");


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

    const initialTreasury = 50 - players.length * 2; // Assuming 50 coins total
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

function getPlayerById(gameState: GameState, playerId: string): Player | undefined {
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
    while (!players[nextIndex].influence.some(card => !card.revealed)) {
        nextIndex = (nextIndex + 1) % players.length;
        safetyCounter++;
        if (safetyCounter > players.length) { // Should never happen in a valid game state
            console.error("[getNextPlayerIndex] Infinite loop detected! Could not find next active player.");
            return currentIndex; // Return current index to prevent crash
        }
    }
    // console.log(`[getNextPlayerIndex] Next index: ${nextIndex} (${players[nextIndex].name})`);
    return nextIndex;
}

function logAction(gameState: GameState, message: string): GameState {
    console.log("[Game Log]", message); // Add console logging for server/debug
    // Keep log concise for AI prompt, maybe limit size?
    const MAX_LOG_ENTRIES = 50;
    const newLog = [...gameState.actionLog, message].slice(-MAX_LOG_ENTRIES);
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
             newState = logAction(newState, `${newState.players[playerIndex].name} has been eliminated!`);
        }
        // Optionally remove player or just mark as inactive - current logic relies on checking revealed cards
    }
    return newState;
}


function checkForWinner(gameState: GameState): Player | null {
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
async function revealInfluence(gameState: GameState, playerId: string, cardType?: CardType): Promise<{ newState: GameState, revealedCard: CardType | null }> {
    console.log(`[revealInfluence] Player ${playerId} needs to reveal${cardType ? ` ${cardType}` : ''}.`);
    let newState = { ...gameState };
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
            }
        }

        // If no specific type needed, or specific type not found/already revealed, find *any* unrevealed card
        if (!influenceToReveal) {
            cardIndexToReveal = player.influence.findIndex(c => !c.revealed);
             if(cardIndexToReveal !== -1) {
                influenceToReveal = player.influence[cardIndexToReveal];
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
             newState = logAction(newState, `${player.name} has no more influence to reveal!`); // Should ideally not happen if logic is correct
             console.warn(`[revealInfluence] Could not find influence to reveal for ${player.name} (Card type: ${cardType}, Unrevealed: ${player.influence.filter(c=>!c.revealed).map(c=>c.type).join(',')})`);
             newState = eliminatePlayer(newState, playerId);
        }
    } else {
         console.error(`[revealInfluence] Player ID ${playerId} not found.`);
    }
     return { newState, revealedCard: revealedCardType };
}


// --- Action Execution ---

async function performIncome(gameState: GameState, playerId: string): Promise<GameState> {
    console.log(`[performIncome] ${playerId} takes Income.`);
    let newState = { ...gameState };
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

async function performForeignAid(gameState: GameState, playerId: string): Promise<GameState> {
    console.log(`[performForeignAid] ${playerId} attempts Foreign Aid.`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    if (!player) return newState;

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
         newState = await triggerAIResponses(newState);
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


async function performCoup(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    console.log(`[performCoup] ${playerId} performs Coup against ${targetId}.`);
    let newState = { ...gameState };
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
        newState = revealedState;

    } else {
        newState = logAction(newState, `${newState.players[playerIndex]?.name || 'Player'} cannot perform Coup (not enough money or invalid target).`);
         console.error(`[performCoup] Failed Coup. Player: ${JSON.stringify(newState.players[playerIndex])}, Target: ${JSON.stringify(target)}`);
         // Should not advance turn if action failed pre-conditions
         return newState; // Return without advancing if failed
    }
     return await advanceTurn(newState);
}

async function performTax(gameState: GameState, playerId: string): Promise<GameState> {
    console.log(`[performTax] ${playerId} attempts Tax.`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
     if (!player) return newState;

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
        newState = await triggerAIResponses(newState);
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


async function performAssassinate(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    console.log(`[performAssassinate] ${playerId} attempts Assassinate against ${targetId}.`);
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const target = getPlayerById(newState, targetId);

    if (playerIndex === -1 || !target) {
        console.error(`[performAssassinate] Invalid player or target. PlayerIndex: ${playerIndex}, Target: ${!!target}`);
        return newState;
    }
    const player = newState.players[playerIndex];

    if (player.money < 3) {
        console.warn(`[performAssassinate] Insufficient funds for ${playerId}.`);
        return logAction(newState, `${player.name} cannot Assassinate (needs 3 coins).`);
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
         newState = await triggerAIResponses(newState);
    } else {
        // No one can challenge or block, assassination proceeds immediately
         console.log(`[performAssassinate] No responders. Assassination succeeds.`);
        newState = logAction(newState, `${player.name}'s Assassination attempt automatically succeeds.`);
        const { newState: revealedState } = await revealInfluence(newState, targetId);
        newState = revealedState;
        newState = await advanceTurn(newState);
    }
     return newState;
}

async function performSteal(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    console.log(`[performSteal] ${playerId} attempts Steal from ${targetId}.`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (!player || !target) {
        console.error(`[performSteal] Invalid player or target. Player: ${!!player}, Target: ${!!target}`);
        return newState;
    }
     if (target.money === 0) {
         newState = logAction(newState, `${player.name} attempts to Steal from ${target.name}, but they have no money.`);
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
         newState = await triggerAIResponses(newState);
    } else {
        // No one can challenge or block, steal succeeds
         console.log(`[performSteal] No responders. Steal succeeds.`);
        const amount = Math.min(2, target.money);
         const playerIndex = newState.players.findIndex(p => p.id === playerId);
         const targetIndex = newState.players.findIndex(p => p.id === targetId);
         const playerNewMoney = newState.players[playerIndex].money + amount;
         const targetNewMoney = newState.players[targetIndex].money - amount;
         newState.players[playerIndex] = { ...newState.players[playerIndex], money: playerNewMoney };
         newState.players[targetIndex] = { ...newState.players[targetIndex], money: targetNewMoney };

        newState = logAction(newState, `${player.name} successfully Steals ${amount} coins from ${target.name}. ${player.name} now has ${playerNewMoney}, ${target.name} now has ${targetNewMoney}.`);
        newState = await advanceTurn(newState);
    }
     return newState;
}


async function performExchange(gameState: GameState, playerId: string): Promise<GameState> {
     console.log(`[performExchange] ${playerId} attempts Exchange.`);
     let newState = { ...gameState };
     const player = getPlayerById(newState, playerId);
     if (!player) return newState;

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
        newState = await triggerAIResponses(newState);
    } else {
        // No challengers, exchange proceeds
         console.log(`[performExchange] No challengers. Initiating exchange.`);
        newState = await initiateExchange(newState, player); // Make initiateExchange async
        // Turn doesn't advance until exchange is complete
    }
    return newState;
}

async function initiateExchange(gameState: GameState, player: Player): Promise<GameState> {
    console.log(`[initiateExchange] Initiating exchange for ${player.name}.`);
    let newState = { ...gameState };
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

async function completeExchange(gameState: GameState, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
    console.log(`[completeExchange] Player ${playerId} completes exchange, keeping: ${cardsToKeep.join(', ')}.`);
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const exchangeInfo = newState.pendingExchange;

    if (playerIndex === -1 || !exchangeInfo || exchangeInfo.player.id !== playerId) {
        console.error("[completeExchange] Invalid state for completing exchange. Phase:", exchangeInfo);
        return newState;
    }
    const player = newState.players[playerIndex];

    const originalUnrevealedCount = player.influence.filter(c => !c.revealed).length;

    if (cardsToKeep.length !== originalUnrevealedCount) {
        console.error(`[completeExchange] Exchange error: Player ${playerId} selected ${cardsToKeep.length} cards, but needs ${originalUnrevealedCount}. Cards chosen: ${cardsToKeep.join(',')}. Cards available: ${exchangeInfo.cardsToChoose.join(',')}`);
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
    console.log(`[resolveChallengeOrBlock] Resolving phase for action: ${gameState.challengeOrBlockPhase?.action}`);
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;
    if (!phase) {
        console.warn("[resolveChallengeOrBlock] Phase is already null. Returning state.");
        return newState; // Should not happen if called correctly
    }

    const actionPlayer = getPlayerById(newState, phase.actionPlayer.id)!; // Get updated player state
    const action = phase.action;
    const targetPlayer = phase.targetPlayer ? getPlayerById(newState, phase.targetPlayer.id) : undefined; // Get updated target state

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
        newState = await resolveBlock(newState, actionPlayer, targetPlayer, blockerId, action, blockType);
    } else {
        // No challenges or blocks, action succeeds
        console.log(`[resolveChallengeOrBlock] No challenges or blocks. Action ${action} succeeds.`);
        newState = logAction(newState, `No challenges or blocks. ${actionPlayer.name}'s ${action} attempt succeeds.`);
        newState = await executeSuccessfulAction(newState, actionPlayer, action, targetPlayer);
    }

    console.log(`[resolveChallengeOrBlock] Phase resolution complete.`);
    return newState; // Return the state after resolution
}


async function resolveChallenge(gameState: GameState, challengedPlayerId: string, challengerId: string, action: ActionType): Promise<GameState> {
    console.log(`[resolveChallenge] ${challengerId} challenges ${challengedPlayerId}'s ${action}.`);
    let newState = { ...gameState };
    const challengedPlayer = getPlayerById(newState, challengedPlayerId)!;
    const challenger = getPlayerById(newState, challengerId)!;

    const requiredCard = getCardForAction(action);

    if (!requiredCard) {
         console.error(`[resolveChallenge] Error: Action ${action} cannot be challenged (or logic error).`);
         newState = logAction(newState, `Error: Action ${action} cannot be challenged (or logic error).`);
         // Action proceeds as if unchallenged? Or halt? Assuming action proceeds.
         newState = await executeSuccessfulAction(newState, challengedPlayer, action, getPlayerById(newState, newState.currentAction?.target?.id || '')); // Use currentAction target if exists
         return newState;
    }

    const hasCard = challengedPlayer.influence.some(c => c.type === requiredCard && !c.revealed);

    if (hasCard) {
        console.log(`[resolveChallenge] Challenge failed. ${challengedPlayer.name} has ${requiredCard}.`);
        newState = logAction(newState, `${challengedPlayer.name} reveals ${requiredCard} to prove the challenge wrong.`);
        // Player reveals the specific card, shuffles it back, draws a new one.
        const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
        if (playerIndex !== -1) {
             // Find the first instance of the required card that is not revealed
            const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === requiredCard && !c.revealed);
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
                 newState = logAction(newState, `Error: ${challengedPlayer.name} had ${requiredCard} but couldn't find unrevealed instance?`);
                  console.error(`[resolveChallenge] Logic error: Cannot find unrevealed ${requiredCard} for ${challengedPlayer.name}`);
            }
        }

        // Challenger loses influence
        newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
         console.log(`[resolveChallenge] Challenger ${challenger.name} must reveal.`);
        const { newState: revealedState } = await revealInfluence(newState, challengerId); // await reveal
        newState = revealedState;

        // Check if challenger eliminated before proceeding
        const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);

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
            // If game not over, original action *still* proceeds
            console.log(`[resolveChallenge] Challenger eliminated, original action ${action} proceeds.`);
            newState = await executeSuccessfulAction(newState, getPlayerById(newState, challengedPlayerId)!, action, getPlayerById(newState, newState.currentAction?.target?.id || ''));

        } else {
            // Original action proceeds
             console.log(`[resolveChallenge] Challenger survived, original action ${action} proceeds.`);
             newState = await executeSuccessfulAction(newState, getPlayerById(newState, challengedPlayerId)!, action, getPlayerById(newState, newState.currentAction?.target?.id || ''));
        }

    } else {
        console.log(`[resolveChallenge] Challenge successful! ${challengedPlayer.name} bluffed ${requiredCard}.`);
        newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge with ${requiredCard} and loses influence.`);
        // Challenged player loses influence because they bluffed
        const { newState: revealedState } = await revealInfluence(newState, challengedPlayerId); // await reveal
        newState = revealedState;

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
              // If player eliminated, action is cancelled, advance turn
               newState = logAction(newState, `${challengedPlayer.name}'s ${action} is cancelled.`);
               newState = await advanceTurn(newState);
         } else {
             // Action fails because bluff was called, turn advances
              console.log(`[resolveChallenge] Challenged player survived, action ${action} is cancelled.`);
              newState = logAction(newState, `${challengedPlayer.name}'s ${action} is cancelled due to successful challenge.`);
              newState = await advanceTurn(newState);
         }
    }

    return newState;
}


async function resolveBlock(gameState: GameState, actionPlayer: Player, targetPlayer: Player | undefined, blockerId: string, action: ActionType, blockType: BlockActionType): Promise<GameState> {
    console.log(`[resolveBlock] ${blockerId} blocks ${actionPlayer.name}'s ${action} with ${blockType}.`);
    let newState = { ...gameState };
    const blocker = getPlayerById(newState, blockerId)!;

     // Block is announced, now the original actionPlayer can challenge the block
     newState = logAction(newState, `${actionPlayer.name} can now challenge ${blocker.name}'s attempt to ${blockType}.`);
      console.log(`[resolveBlock] Setting up challenge phase for the block.`);

     // Need to pass the *current* state of the blocker and action player
     const currentBlocker = getPlayerById(newState, blockerId)!;
     const currentActionPlayer = getPlayerById(newState, actionPlayer.id)!;

     newState.challengeOrBlockPhase = {
         actionPlayer: currentBlocker, // The blocker is now the one whose claim (block) can be challenged
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

// This function is called when someone challenges a block.
async function resolveBlockChallenge(gameState: GameState, blockerId: string, challengerId: string, blockType: BlockActionType): Promise<GameState> {
     console.log(`[resolveBlockChallenge] ${challengerId} challenges ${blockerId}'s ${blockType}.`);
     let newState = { ...gameState };
     const blocker = getPlayerById(newState, blockerId)!;
     const challenger = getPlayerById(newState, challengerId)!; // Original action player

     newState = logAction(newState, `${challenger.name} challenges ${blocker.name}'s ${blockType}!`);

     const requiredCard = getCardForBlock(blockType);
     if (!requiredCard) {
        console.error(`[resolveBlockChallenge] Error: Block type ${blockType} is invalid.`);
        newState = logAction(newState, `Error: Block type ${blockType} is invalid.`);
        newState = await advanceTurn(newState); // Or handle error
        return newState;
     }

      // Check if the blocker has the required card OR the alternative card for stealing block
     const hasRequiredCard = blocker.influence.some(c => c.type === requiredCard && !c.revealed);
     const hasAlternativeStealCard = blockType === 'Block Stealing' && blocker.influence.some(c => c.type === getAlternateCardForStealBlock() && !c.revealed);
     const canProveBlock = hasRequiredCard || hasAlternativeStealCard;
     const cardToReveal = hasRequiredCard ? requiredCard : (hasAlternativeStealCard ? getAlternateCardForStealBlock() : null);


     if (canProveBlock && cardToReveal) {
          console.log(`[resolveBlockChallenge] Block challenge failed. ${blocker.name} has ${cardToReveal}.`);
         newState = logAction(newState, `${blocker.name} reveals ${cardToReveal} to prove the block challenge wrong.`);
         // Blocker reveals the card, shuffles it back, draws a new one.
         const playerIndex = newState.players.findIndex(p => p.id === blockerId);
         if (playerIndex !== -1) {
             const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === cardToReveal && !c.revealed);
             if (cardIndex !== -1) {
                 const cardTypeToShuffle = newState.players[playerIndex].influence[cardIndex].type;
                  let currentInfluence = [...newState.players[playerIndex].influence];
                 currentInfluence.splice(cardIndex, 1); // Remove card

                 newState.deck = returnCardToDeck(newState.deck, cardTypeToShuffle);
                 const { card: newCard, remainingDeck } = drawCard(newState.deck);
                  newState.deck = remainingDeck;
                  if (newCard) {
                      currentInfluence.push({ type: newCard, revealed: false }); // Add new card
                      newState = logAction(newState, `${blocker.name} shuffles back ${cardTypeToShuffle} and draws a new card.`);
                       console.log(`[resolveBlockChallenge] ${blocker.name} drew ${newCard}.`);
                  } else {
                      newState = logAction(newState, `${blocker.name} shuffles back ${cardTypeToShuffle} but could not draw a new card (deck empty?).`);
                       console.warn(`[resolveBlockChallenge] Deck empty, ${blocker.name} could not draw replacement.`);
                  }
                   // Update player state immutably
                  newState.players[playerIndex] = { ...newState.players[playerIndex], influence: currentInfluence };
             } else {
                  newState = logAction(newState, `Error: ${blocker.name} had ${cardToReveal} but couldn't find unrevealed instance?`);
                   console.error(`[resolveBlockChallenge] Logic error: Cannot find unrevealed ${cardToReveal} for ${blocker.name}`);
             }
         }

         // Challenger (original action player) loses influence
         newState = logAction(newState, `${challenger.name} loses the block challenge and must reveal influence.`);
           console.log(`[resolveBlockChallenge] Challenger ${challenger.name} must reveal.`);
          const { newState: revealedState } = await revealInfluence(newState, challengerId); // await reveal
         newState = revealedState;

          // Check if challenger eliminated
         const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);
          if(!challengerStillActive) {
               console.log(`[resolveBlockChallenge] Challenger ${challenger.name} eliminated by failed block challenge.`);
              newState = logAction(newState, `${challenger.name} was eliminated by the failed block challenge!`);
              const winner = checkForWinner(newState);
              if (winner) {
                  newState.winner = winner;
                  newState = logAction(newState, `${winner.name} has won the game!`);
                   console.log(`[resolveBlockChallenge] Game Over! Winner: ${winner.name}`);
                  return newState;
              }
          }

         // Block succeeds, original action fails. Turn advances.
          console.log(`[resolveBlockChallenge] Block successful. Original action cancelled.`);
         newState = logAction(newState, `${blocker.name}'s block is successful. ${challenger.name}'s action is cancelled.`);
         newState = await advanceTurn(newState);

     } else {
         console.log(`[resolveBlockChallenge] Block challenge successful! ${blocker.name} bluffed the block.`);
         newState = logAction(newState, `${blocker.name} cannot prove the block with ${requiredCard} ${blockType === 'Block Stealing' ? `or ${getAlternateCardForStealBlock()}` : ''} and loses influence.`);
         // Blocker loses influence because they bluffed the block
         const { newState: revealedState } = await revealInfluence(newState, blockerId); // await reveal
         newState = revealedState;

         // Check if blocker eliminated
          const blockerStillActive = getActivePlayers(newState).some(p => p.id === blockerId);
          const originalAction = getActionFromBlock(blockType);
          // Retrieve original target from the *current action* if available, as phase is cleared
          const originalTarget = getPlayerById(newState, newState.currentAction?.target?.id || '');


          if(!blockerStillActive) {
               console.log(`[resolveBlockChallenge] Blocker ${blocker.name} eliminated by successful block challenge.`);
               newState = logAction(newState, `${blocker.name} was eliminated by the successful block challenge!`);
               const winner = checkForWinner(newState);
               if (winner) {
                   newState.winner = winner;
                   newState = logAction(newState, `${winner.name} has won the game!`);
                    console.log(`[resolveBlockChallenge] Game Over! Winner: ${winner.name}`);
                   return newState;
               }
               // If blocker eliminated, action automatically proceeds
                if (originalAction) {
                     console.log(`[resolveBlockChallenge] Blocker eliminated, original action ${originalAction} proceeds.`);
                    newState = logAction(newState, `${blocker.name} was eliminated. ${challenger.name}'s ${originalAction} proceeds.`);
                    newState = await executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
                 } else {
                     console.error(`[resolveBlockChallenge] Error retrieving original action after blocker eliminated.`);
                     newState = logAction(newState, `Error retrieving original action after blocker eliminated.`);
                     newState = await advanceTurn(newState);
                 }
          } else {
               // Block fails, original action proceeds
                if (originalAction) {
                     console.log(`[resolveBlockChallenge] Block failed, original action ${originalAction} proceeds.`);
                    newState = logAction(newState, `${blocker.name}'s block fails. ${challenger.name}'s ${originalAction} proceeds.`);
                    newState = await executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
                } else {
                     console.error(`[resolveBlockChallenge] Error retrieving original action for failed block.`);
                    newState = logAction(newState, `Error retrieving original action for failed block.`);
                    newState = await advanceTurn(newState);
                }
          }
     }

     return newState;
}


async function executeSuccessfulAction(gameState: GameState, player: Player, action: ActionType, target?: Player): Promise<GameState> {
    console.log(`[executeSuccessfulAction] Executing successful ${action} for ${player.name}${target ? ` targeting ${target.name}`: ''}.`);
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === player.id);
    const targetIndex = target ? newState.players.findIndex(p => p.id === target.id) : -1;

     // Ensure target is still active before applying effect
     // Refresh target player state from potentially modified newState
     const currentTarget = targetIndex !== -1 ? newState.players[targetIndex] : undefined;
     const targetStillActive = currentTarget ? getActivePlayers(newState).some(p => p.id === currentTarget.id) : true; // Assume true if no target

    // Refresh player state
    const currentPlayer = playerIndex !== -1 ? newState.players[playerIndex] : undefined;
     if (!currentPlayer) {
         console.error(`[executeSuccessfulAction] Player ${player.id} not found in current state.`);
         return newState;
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
                 newState = revealedState;
             } else if (targetIndex !== -1 && (!targetStillActive || !currentTarget)) {
                  console.log(`[executeSuccessfulAction] Assassination target ${target?.name || targetId} was already eliminated or not found.`);
                  newState = logAction(newState, `Assassination target ${target?.name || targetId} was already eliminated.`);
             } else if (playerIndex === -1) {
                 console.error(`[executeSuccessfulAction] Assassin ${player.id} not found.`);
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
                      newState = logAction(newState, `${currentPlayer.name} successfully stole from ${currentTarget.name}, but they had no coins.`);
                      console.log(`[executeSuccessfulAction] Steal success, but target ${currentTarget.name} had 0 coins.`);
                 }
             } else if(targetIndex !== -1 && (!targetStillActive || !currentTarget)) {
                  console.log(`[executeSuccessfulAction] Steal target ${target?.name || targetId} was already eliminated or not found.`);
                  newState = logAction(newState, `Steal target ${target?.name || targetId} was already eliminated.`);
             } else if (playerIndex === -1) {
                  console.error(`[executeSuccessfulAction] Stealer ${player.id} not found.`);
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
             console.warn(`[executeSuccessfulAction] Action ${action} completed successfully (no specific execution logic needed here).`);
             newState = logAction(newState, `Action ${action} completed successfully.`);
             newState = await advanceTurn(newState);
    }

    return newState;
}


async function advanceTurn(gameState: GameState): Promise<GameState> {
    console.log("[advanceTurn] Advancing turn...");
    let newState = { ...gameState };

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
    newState = logAction(newState, `--- ${nextPlayer.name}'s turn ---`);
    console.log(`[advanceTurn] New turn for player index ${nextPlayerIndex}: ${nextPlayer.name} (${nextPlayer.isAI ? 'AI' : 'Human'})`);


    // 4. If the new current player is AI, trigger their action AND return the state *after* their action is processed.
    if (nextPlayer.isAI) {
        console.log(`[advanceTurn] New player ${nextPlayer.name} is AI. Triggering handleAIAction...`);
        // IMPORTANT: We await handleAIAction which performs the AI's action and any subsequent phases/turn advances.
        // It should return the state *after* the AI's entire turn sequence is complete.
        const stateAfterAITurn = await handleAIAction(newState); // handleAIAction itself calls advanceTurn if needed
        console.log(`[advanceTurn] handleAIAction completed for ${nextPlayer.name}. Returning state.`);
        return stateAfterAITurn; // Return the state returned by handleAIAction
    } else {
         // 5. If the new player is Human, simply return the updated state. The UI will wait for input.
         console.log(`[advanceTurn] New player ${nextPlayer.name} is Human. Returning state.`);
         return newState;
    }
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
        case 'Block Stealing': return 'Captain'; // Can also be Ambassador, handled in resolveBlockChallenge
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
        return ['Coup']; // Must Coup if money is 10 or more
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
function generateGameStateDescription(gameState: GameState, aiPlayerId: string): string {
    let description = "Current Game State:\n";
    const aiPlayer = getPlayerById(gameState, aiPlayerId);
    if (aiPlayer) {
        const revealedCards = aiPlayer.influence.filter(c => c.revealed).map(c => c.type);
        description += `You are ${aiPlayer.name}. Money: ${aiPlayer.money}. Unrevealed Influence: [${aiPlayer.influence.filter(c => !c.revealed).map(c => c.type).join(', ')}]. Revealed Influence: [${revealedCards.join(', ') || 'None'}].\n`;
    } else {
         description += `Generating context (not specific to one AI player).\n`; // For general context scenarios
    }
    description += "Players:\n";
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
          description += `Challenge/Block Phase: ${phase.actionPlayer.name}'s attempt to ${phase.action} ${phase.targetPlayer ? ` targeting ${phase.targetPlayer.name}`: ''} is being considered. Possible responses needed from: ${phase.possibleResponses.filter(p => !phase.responses.some(r => r.playerId === p.id)).map(p => p.name).join(', ')}. Current responses: ${phase.responses.map(r => `${getPlayerById(gameState, r.playerId)?.name}: ${r.response}`).join('; ') || 'None'}.\n`;
     }
     if(gameState.pendingExchange) {
          description += `Pending Exchange: ${gameState.pendingExchange.player.name} is choosing cards from [${gameState.pendingExchange.cardsToChoose.join(', ')}].\n`;
     }
    description += `Last 5 Action Log Entries:\n${gameState.actionLog.slice(-5).map(l => `  - ${l}`).join('\n')}\n`; // Last 5 log entries
    description += `It is currently ${gameState.players[gameState.currentPlayerIndex].name}'s turn.\n`;
    return description;
}


// Export handleAIAction so it can be called by page.tsx for the first turn if needed
export async function handleAIAction(gameState: GameState): Promise<GameState> {
    console.log(`[handleAIAction] >>> Entering for ${gameState.players[gameState.currentPlayerIndex].name}`);
    let newState = { ...gameState };
    const aiPlayer = newState.players[newState.currentPlayerIndex];

    // Safety checks
    if (!aiPlayer || !aiPlayer.isAI) {
         console.error(`[handleAIAction] Error: Called for non-AI player (${aiPlayer?.name}) or invalid player index (${newState.currentPlayerIndex}).`);
         return newState; // Return unchanged state
    }
     if (!aiPlayer.influence.some(c => !c.revealed)) {
         console.log(`[handleAIAction] AI ${aiPlayer.name} is eliminated. Advancing turn.`);
         // Need to advance turn *from* this state
         return await advanceTurn(newState); // Skip turn if AI is eliminated
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.winner) {
         console.log(`[handleAIAction] AI ${aiPlayer.name}'s turn skipped: Ongoing phase or game over. Phase: ${!!newState.challengeOrBlockPhase}, Exchange: ${!!newState.pendingExchange}, Winner: ${!!newState.winner}`);
         return newState; // Don't act if in another phase
     }


    const availableActions = getAvailableActions(aiPlayer, newState);
     if (availableActions.length === 0) {
         // This should theoretically only happen if must Coup but no targets, or eliminated.
         console.log(`[handleAIAction] AI ${aiPlayer.name} has no available actions (Eliminated or no Coup targets?). Advancing turn.`);
         return await advanceTurn(newState);
     }

    const opponentActions = newState.actionLog.slice(-5); // Give slightly more history
    const gameStateDescription = generateGameStateDescription(newState, aiPlayer.id);

    let stateAfterAction: GameState; // To store the result of performAction

    try {
        console.log(`[handleAIAction] Requesting action selection for ${aiPlayer.name} from AI service...`);
        const aiDecision = await selectAction({
            playerMoney: aiPlayer.money,
            playerInfluence: aiPlayer.influence.filter(c => !c.revealed).length,
            opponentActions,
            availableActions,
            gameState: gameStateDescription,
        });
        console.log(`[handleAIAction] AI ${aiPlayer.name} raw decision: Action=${aiDecision.action}, Target=${aiDecision.target || 'N/A'}, Reasoning=${aiDecision.reasoning}`);


        // Validate AI action choice
        const chosenAction = aiDecision.action as ActionType;
         if (!availableActions.includes(chosenAction)) {
            console.warn(`[handleAIAction] AI ${aiPlayer.name} chose invalid action '${chosenAction}'. Available: [${availableActions.join(', ')}]. Defaulting to Income.`);
             newState = logAction(newState, `AI (${aiPlayer.name}) chose invalid action '${chosenAction}'. Defaulting to Income.`);
             stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
         } else {
              newState = logAction(newState, `AI (${aiPlayer.name}) Reasoning: ${aiDecision.reasoning}`);
              newState = logAction(newState, `AI (${aiPlayer.name}) chose action: ${chosenAction} ${aiDecision.target ? `targeting ${aiDecision.target}` : ''}`);

              // Find target player if needed
              let targetPlayerId: string | undefined = undefined;
              const needsTarget = ['Coup', 'Assassinate', 'Steal'].includes(chosenAction);

              if (needsTarget) {
                   if (!aiDecision.target) {
                        console.warn(`[handleAIAction] AI ${aiPlayer.name} chose ${chosenAction} but provided no target. Picking random.`);
                        const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                        if (activeOpponents.length > 0) {
                            targetPlayerId = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].id;
                            newState = logAction(newState, `AI (${aiPlayer.name}) chose ${chosenAction} without target, targeting random opponent ${getPlayerById(newState, targetPlayerId)?.name}.`);
                        } else {
                             console.error(`[handleAIAction] AI ${aiPlayer.name} chose ${chosenAction}, needs target, but no active opponents! Defaulting to Income.`);
                             newState = logAction(newState, `AI (${aiPlayer.name}) has no valid targets for ${chosenAction}. Choosing Income instead.`);
                             stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
                             console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name} (Fallback Income)`);
                             return stateAfterAction;
                        }
                   } else {
                       // AI provided target name, try to find ID among *active* opponents
                       const target = getActivePlayers(newState).find(p => p.name === aiDecision.target && p.id !== aiPlayer.id);
                       if (target) {
                           targetPlayerId = target.id;
                           console.log(`[handleAIAction] Found target ${target.name} (${target.id}) for AI action ${chosenAction}.`);
                       } else {
                           console.warn(`[handleAIAction] AI ${aiPlayer.name} target '${aiDecision.target}' not found among active opponents or is self. Picking random.`);
                           const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                           if (activeOpponents.length > 0) {
                               targetPlayerId = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].id;
                               newState = logAction(newState, `AI (${aiPlayer.name}) target '${aiDecision.target}' invalid, targeting random opponent ${getPlayerById(newState, targetPlayerId)?.name}.`);
                           } else {
                               console.error(`[handleAIAction] AI ${aiPlayer.name} chose ${chosenAction}, target invalid, and no other active opponents! Defaulting to Income.`);
                               newState = logAction(newState, `AI (${aiPlayer.name}) has no valid targets for ${chosenAction}. Choosing Income instead.`);
                               stateAfterAction = await performIncome(newState, aiPlayer.id); // Default safe action
                               console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name} (Fallback Income)`);
                               return stateAfterAction;
                           }
                       }
                   }
              }

               // Perform the chosen action - This will handle challenges/blocks and eventually call advanceTurn itself
               console.log(`[handleAIAction] Calling performAction for AI: Action=${chosenAction}, TargetID=${targetPlayerId || 'N/A'}`);
               stateAfterAction = await performAction(newState, aiPlayer.id, chosenAction, targetPlayerId);
         }

    } catch (error) {
        console.error(`[handleAIAction] AI action selection/execution failed for ${aiPlayer.name}:`, error);
        newState = logAction(newState, `AI (${aiPlayer.name}) encountered an error. Taking Income.`);
        stateAfterAction = await performIncome(newState, aiPlayer.id); // Fallback action
    }
     console.log(`[handleAIAction] <<< Exiting for ${aiPlayer.name}`);
    return stateAfterAction; // Return the state *after* the action (and subsequent turn advances) have resolved
}



// Triggers AI responses during challenge/block phases. Returns the state *after* AIs have responded.
// IMPORTANT: This function MODIFIES the state by calling handlePlayerResponse, and potentially resolveChallengeOrBlock.
async function triggerAIResponses(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    let currentPhase = newState.challengeOrBlockPhase; // Get the phase state *at the start*

    // Loop while there's an active phase and AI responders who haven't responded yet
    while (currentPhase && currentPhase.possibleResponses.some(p => p.isAI && !currentPhase.responses.some(r => r.playerId === p.id))) {
        const aiRespondersThisLoop = currentPhase.possibleResponses.filter(p => p.isAI && !currentPhase.responses.some(r => r.playerId === p.id));
        const aiToAct = aiRespondersThisLoop[0]; // Process one AI at a time

        if (!aiToAct) {
             console.log("[triggerAIResponses] No more AI responders in this loop iteration.");
            break; // Should not happen if loop condition is correct, but safety break
        }

        console.log(`[triggerAIResponses] AI Responder: ${aiToAct.name} needs to respond to ${currentPhase.action}`);

        let decision: GameResponseType = 'Allow'; // Default
        let reasoning = 'Defaulting to Allow.';
        let decidedResponseType: 'Challenge' | 'Block' | 'Allow' = 'Allow'; // For logging/control flow

        try {
             console.log(`[triggerAIResponses] Getting response from AI ${aiToAct.name} for action ${currentPhase.action}`);
             // Determine if AI *can* challenge or block
             const actionTarget = currentPhase.targetPlayer;
             const actionPerformer = currentPhase.actionPlayer;
             const actionType = currentPhase.action;

             // Can challenge the action itself (unless it's Income/Coup, or a Block action)
             const canChallengeAction = getCardForAction(actionType) !== null && !actionType.startsWith('Block');
             // Can challenge a block action
             const canChallengeBlock = actionType.startsWith('Block');

             // Can block the action (only specific actions against self, or Foreign Aid)
             const blockType = getBlockTypeForAction(actionType);
             const canBlock = !!blockType && (actionType === 'Foreign Aid' || actionTarget?.id === aiToAct.id);

              // AI evaluates challenge (if applicable)
             let challengeDecision = { shouldChallenge: false, reason: ""};
             if (canChallengeAction || canChallengeBlock) {
                 console.log(`[triggerAIResponses] AI ${aiToAct.name} evaluating Challenge (${canChallengeAction ? 'Action' : 'Block'})...`);
                  challengeDecision = await aiChallengeReasoning({
                     action: actionType,
                     currentPlayer: actionPerformer.name, // Person performing the action/block being challenged
                     targetPlayer: actionTarget?.name, // Optional target of original action
                      // Use actual cards for better reasoning
                     aiInfluence: getPlayerById(newState, aiToAct.id)?.influence.filter(c => !c.revealed).map(c => c.type) || [],
                     // Influence count of the player whose action/block is being challenged
                     opponentInfluenceCount: actionPerformer.influence.filter(c => !c.revealed).length,
                     gameState: generateGameStateDescription(newState, aiToAct.id),
                 });
                  newState = logAction(newState, `AI (${aiToAct.name}) Challenge Reasoning: ${challengeDecision.reason}`);
                 console.log(`[triggerAIResponses] AI ${aiToAct.name} Challenge decision: ${challengeDecision.shouldChallenge}`);
             }

              // AI evaluates block (if applicable and didn't decide to challenge action)
             let blockDecision = { shouldBlock: false, reasoning: ""};
             if (canBlock && blockType && !challengeDecision.shouldChallenge) { // Don't bother evaluating block if challenging action
                 console.log(`[triggerAIResponses] AI ${aiToAct.name} evaluating Block (${blockType})...`);
                  blockDecision = await aiBlockReasoning({
                     action: actionType, // The original action being blocked
                      aiPlayerInfluenceCards: getPlayerById(newState, aiToAct.id)?.influence.filter(c => !c.revealed).map(c => c.type) || [],
                      aiPlayerMoney: getPlayerById(newState, aiToAct.id)?.money || 0,
                      opponentInfluenceCount: actionPerformer.influence.filter(c => !c.revealed).length, // Original action performer's influence
                      opponentMoney: actionPerformer.money, // Original action performer's money
                     gameState: generateGameStateDescription(newState, aiToAct.id),
                 });
                  newState = logAction(newState, `AI (${aiToAct.name}) Block Reasoning: ${blockDecision.reasoning}`);
                  console.log(`[triggerAIResponses] AI ${aiToAct.name} Block decision: ${blockDecision.shouldBlock}`);
             }


             // Determine final AI response (Prioritize Challenge > Block > Allow)
             if ((canChallengeAction || canChallengeBlock) && challengeDecision.shouldChallenge) {
                 decision = 'Challenge';
                 reasoning = challengeDecision.reason;
                 decidedResponseType = 'Challenge';
             } else if (canBlock && blockType && blockDecision.shouldBlock) {
                 decision = blockType; // Use the specific block type
                 reasoning = blockDecision.reasoning;
                 decidedResponseType = 'Block';
             } else {
                  decision = 'Allow';
                  reasoning = 'Decided to allow the action.'; // Provide clearer default reasoning
                  decidedResponseType = 'Allow';
             }

        } catch (error) {
             console.error(`AI response generation failed for ${aiToAct.name}:`, error);
             newState = logAction(newState, `AI (${aiToAct.name}) encountered an error during response. Defaulting to Allow.`);
             decision = 'Allow';
             reasoning = 'Error during decision process.';
             decidedResponseType = 'Allow';
        }

        newState = logAction(newState, `AI (${aiToAct.name}) responds: ${decision}. Reasoning: ${reasoning}`);
        console.log(`[triggerAIResponses] AI ${aiToAct.name} final response: ${decision}`);

        // IMPORTANT: Update the state by calling handlePlayerResponse, which correctly modifies the phase state
        // and potentially resolves the phase or sets up the next challenge.
        newState = await handlePlayerResponse(newState, aiToAct.id, decision); // Await the handling


        // Refresh phase state *after* the response has been handled
        currentPhase = newState.challengeOrBlockPhase;

        // If phase was resolved (is null now), exit the loop
        if (!currentPhase) {
            console.log(`[triggerAIResponses] Phase resolved after AI ${aiToAct.name}'s response (${decision}). Exiting loop.`);
            break;
        }

        // If the AI Challenged or Blocked, the interaction for *this specific action* usually stops waiting for other responses.
        // The resolution logic (resolveChallenge, resolveBlock, resolveBlockChallenge) handles the next steps.
        if (decidedResponseType !== 'Allow') {
             console.log(`[triggerAIResponses] AI ${aiToAct.name} responded with ${decision}. Phase continues or resolves based on challenge/block logic. Exiting loop for this action.`);
             // The state returned by handlePlayerResponse is the correct state to proceed from.
             break; // Exit the loop as the phase has changed significantly or resolved.
         }

        // If AI Allowed, loop continues to the next AI responder if any.
        console.log(`[triggerAIResponses] AI ${aiToAct.name} Allowed. Checking for more AI responders.`);

    } // End AI responder loop

    // After the loop, check if the phase *still* exists and if all *possible* responders have responded.
    // This handles the case where all AIs allowed, and now we might need to resolve or wait for a human.
    const finalPhase = newState.challengeOrBlockPhase;
    if (finalPhase && finalPhase.possibleResponses.every(p => finalPhase.responses.some(r => r.playerId === p.id))) {
        console.log("[triggerAIResponses] All responses received (likely all 'Allow' or phase resolved differently). Resolving phase...");
        newState = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
    } else if (finalPhase) {
        console.log("[triggerAIResponses] Phase still requires responses (likely human). Waiting.");
    } else {
        console.log("[triggerAIResponses] Phase already resolved during AI response handling.");
    }

    return newState;
}


// Async because it calls completeExchange which is async
async function handleAIExchange(gameState: GameState): Promise<GameState> {
    console.log(`[handleAIExchange] Handling exchange for AI.`);
    let newState = { ...gameState };
    const exchangeInfo = newState.pendingExchange;
     if (!exchangeInfo || !exchangeInfo.player.isAI) {
         console.error("[handleAIExchange] Error: Called without valid AI exchange phase.");
         return newState;
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

     newState = logAction(newState, `AI (${aiPlayer.name}) chooses [${cardsToKeep.join(', ')}] for Exchange.`);
     newState = await completeExchange(newState, aiPlayer.id, cardsToKeep); // await completion

     return newState;
}



// --- Public API ---

// Make this async because the actions it calls are async
export async function performAction(gameState: GameState, playerId: string, action: ActionType, targetId?: string): Promise<GameState> {
    console.log(`[API performAction] Request: Player ${playerId}, Action ${action}, Target ${targetId || 'None'}`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);

    // --- Input Validations ---
    if (!player) {
        console.error("[API performAction] Error: Player not found.");
        return logAction(newState, "Error: Player not found.");
    }
    if (player.id !== newState.players[newState.currentPlayerIndex].id) {
         console.warn(`[API performAction] Warning: Not player ${playerId}'s turn (Current: ${newState.players[newState.currentPlayerIndex].id} - ${newState.players[newState.currentPlayerIndex].name}).`);
        return logAction(newState, "Warning: Not your turn."); // Prevent action but don't crash
    }
     if (newState.winner) {
         console.warn("[API performAction] Warning: Action attempted after game ended.");
        return logAction(newState, "Game already over.");
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange) {
         console.warn("[API performAction] Warning: Action attempted during challenge/block/exchange phase.");
        return logAction(newState, "Cannot perform action now, waiting for response or exchange.");
    }
     if (!player.influence.some(c => !c.revealed)) {
         console.warn(`[API performAction] Warning: Player ${playerId} is eliminated.`);
          // If eliminated player is somehow current player, advance turn to prevent deadlock
          if (player.id === newState.players[newState.currentPlayerIndex].id) {
              console.warn(`[API performAction] Eliminated player ${playerId} is current player. Advancing turn.`);
              return await advanceTurn(newState);
          }
         return logAction(newState, "You are eliminated.");
     }

    const target = targetId ? getPlayerById(newState, targetId) : undefined;

    // --- Action Specific Validations ---
    if (action === 'Coup' && player.money < 7) {
        console.warn(`[API performAction] Warning: ${playerId} insufficient funds for Coup.`);
        return logAction(newState, "Not enough money for Coup (need 7).");
    }
    if (action === 'Assassinate' && player.money < 3) {
         console.warn(`[API performAction] Warning: ${playerId} insufficient funds for Assassinate.`);
        return logAction(newState, "Not enough money to Assassinate (need 3).");
    }
    if (player.money >= 10 && action !== 'Coup') {
         console.warn(`[API performAction] Warning: ${playerId} has >= 10 coins, must Coup.`);
        return logAction(newState, "Must perform Coup with 10 or more coins.");
    }
     const requiresTarget = (action === 'Coup' || action === 'Assassinate' || action === 'Steal');
     if (requiresTarget && !targetId) {
          console.warn(`[API performAction] Warning: Action ${action} requires a target.`);
         return logAction(newState, `Action ${action} requires a target.`);
     }
     if (requiresTarget && !target) {
          console.warn(`[API performAction] Warning: Target player ${targetId} not found.`);
         return logAction(newState, `Target player not found.`);
     }
      if (target && !getActivePlayers(newState).some(p => p.id === target.id)) {
          console.warn(`[API performAction] Warning: Target ${target.name} is already eliminated.`);
         return logAction(newState, `Target ${target.name} is already eliminated.`);
     }
     if (target && target.id === player.id) {
          console.warn(`[API performAction] Warning: Player ${playerId} cannot target self with ${action}.`);
         return logAction(newState, `Cannot target self with ${action}.`);
     }


    newState.currentAction = { player, action, target }; // Set current action *before* calling specific function
    console.log(`[API performAction] Validation complete. Executing ${action} for ${player.name}...`);


    // --- Execute Action ---
    let stateAfterActionExecution: GameState;
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
            console.error(`[API performAction] Error: Unknown action type: ${action}`);
            stateAfterActionExecution = logAction(newState, `Error: Unknown action: ${action}`);
            break; // Return the logged error state
    }
     console.log(`[API performAction] Finished execution for ${action}. Returning final state.`);
     // Clear currentAction AFTER the action and potential subsequent phases are fully resolved by the functions above.
     // The advanceTurn function should handle this clearing now.
     // stateAfterActionExecution.currentAction = null;
     return stateAfterActionExecution;
}

// Make this async because the functions it calls (resolveChallenge/Block/etc.) are async
export async function handlePlayerResponse(gameState: GameState, respondingPlayerId: string, response: GameResponseType): Promise<GameState> {
    console.log(`[API handlePlayerResponse] Request: Player ${respondingPlayerId}, Response ${response}`);
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase; // Use current phase state

     // --- Input Validations ---
     if (!phase) {
          console.warn("[API handlePlayerResponse] Warning: No challenge/block phase active.");
         return logAction(newState, "Invalid response: Not in challenge/block phase.");
     }
      const responderCanAct = phase.possibleResponses.some(p => p.id === respondingPlayerId);
      const responderHasActed = phase.responses.some(r => r.playerId === respondingPlayerId);

     if (!responderCanAct) {
          console.warn(`[API handlePlayerResponse] Warning: Player ${respondingPlayerId} cannot respond in this phase. Possible: [${phase.possibleResponses.map(p=>p.id).join(',')}]`);
         return logAction(newState, `Invalid response: Player ${getPlayerById(newState, respondingPlayerId)?.name} cannot respond now.`);
     }
    if (responderHasActed) {
         console.warn(`[API handlePlayerResponse] Warning: Player ${respondingPlayerId} already responded.`);
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`);
    }
     // Check if response type is valid for the action
     // e.g., cannot block Tax, cannot challenge Income/Coup
     const action = phase.action;
     if (response === 'Challenge') {
         if (action === 'Income' || action === 'Coup') {
             console.warn(`[API handlePlayerResponse] Invalid response: Cannot challenge ${action}.`);
             return logAction(newState, `Cannot challenge ${action}.`);
         }
     } else if (response.startsWith('Block')) {
         const blockType = getBlockTypeForAction(action);
         if (response !== blockType) {
             console.warn(`[API handlePlayerResponse] Invalid response: Cannot use ${response} to block ${action}.`);
              return logAction(newState, `Cannot use ${response} to block ${action}.`);
         }
         // Ensure blocker is target (if applicable)
         if (action === 'Steal' || action === 'Assassinate') {
             if (phase.targetPlayer?.id !== respondingPlayerId) {
                 console.warn(`[API handlePlayerResponse] Invalid response: Only target ${phase.targetPlayer?.name} can block ${action}.`);
                 return logAction(newState, `Only the target can ${response}.`);
             }
         }
     }


    const respondingPlayer = getPlayerById(newState, respondingPlayerId)!;

    // --- Update Phase State ---
     console.log(`[API handlePlayerResponse] Processing response ${response} from ${respondingPlayer.name}`);
     // Create a *new* responses array
     const newResponses = [...phase.responses, { playerId: respondingPlayerId, response }];
     newState.challengeOrBlockPhase = { ...phase, responses: newResponses }; // Update state immutably
     newState = logAction(newState, `${respondingPlayer.name} responds: ${response}.`);


    // --- Resolve or Continue ---
    let stateAfterResponseHandling: GameState = newState;

    if (response === 'Challenge') {
        // Resolve immediately based on whether it's a challenge against an action or a block
         console.log(`[API handlePlayerResponse] Challenge issued by ${respondingPlayer.name}. Resolving...`);
         const currentPhase = newState.challengeOrBlockPhase!; // Use the just updated phase
         if (currentPhase.action.startsWith('Block ')) { // Challenging a block
              console.log(`[API handlePlayerResponse] Challenge is against a block (${currentPhase.action}). Calling resolveBlockChallenge.`);
              // actionPlayer is the blocker, respondingPlayer is the challenger (original action taker)
              stateAfterResponseHandling = await resolveBlockChallenge(newState, currentPhase.actionPlayer.id, respondingPlayerId, currentPhase.action as BlockActionType);
         } else { // Challenging a regular action
              console.log(`[API handlePlayerResponse] Challenge is against an action (${currentPhase.action}). Calling resolveChallenge.`);
               // actionPlayer is the action taker, respondingPlayer is the challenger
              stateAfterResponseHandling = await resolveChallenge(newState, currentPhase.actionPlayer.id, respondingPlayerId, currentPhase.action);
         }
    } else if (response.startsWith('Block')) {
        // A block was issued. Resolve the block attempt (which sets up the challenge-the-block phase)
         console.log(`[API handlePlayerResponse] Block issued by ${respondingPlayer.name}. Setting up challenge-the-block phase...`);
         const currentPhase = newState.challengeOrBlockPhase!; // Use the just updated phase
         // actionPlayer is original action taker, respondingPlayer is the blocker
         stateAfterResponseHandling = await resolveBlock(newState, currentPhase.actionPlayer, currentPhase.targetPlayer, respondingPlayerId, currentPhase.action, response as BlockActionType);
    } else { // Response is 'Allow'
         console.log(`[API handlePlayerResponse] Allow received from ${respondingPlayer.name}.`);
         // Check if all responses are now in
        const currentPhase = newState.challengeOrBlockPhase!; // Use updated state
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
     console.log(`[API handlePlayerResponse] Finished processing response ${response}. Returning state.`);
    return stateAfterResponseHandling;
}


// Make this async because it calls completeExchange which is async
export async function handleExchangeSelection(gameState: GameState, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
     console.log(`[API handleExchangeSelection] Request: Player ${playerId}, Cards ${cardsToKeep.join(', ')}`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const exchangeInfo = newState.pendingExchange;

    // --- Input Validations ---
    if (!player) {
        console.error("[API handleExchangeSelection] Error: Player not found.");
        return logAction(newState, "Error: Player not found.");
    }
    // Exchange happens *during* a player's turn, triggered by Exchange action success.
    // We don't strictly need to check currentPlayerIndex === playerIndex here,
    // but we MUST check if the pendingExchange player matches.
    if (!exchangeInfo || exchangeInfo.player.id !== playerId) {
         console.warn("[API handleExchangeSelection] Warning: Not in exchange phase for this player.");
        return logAction(newState, "Not in exchange phase for this player.");
    }
     if (!player.influence.some(c => !c.revealed)) {
          console.warn(`[API handleExchangeSelection] Warning: Player ${playerId} is eliminated.`);
         return logAction(newState, "You are eliminated."); // Should not happen if logic is correct
     }
      const requiredCount = player.influence.filter(c => !c.revealed).length;
     if (cardsToKeep.length !== requiredCount) {
         console.warn(`[API handleExchangeSelection] Error: Player ${playerId} selected ${cardsToKeep.length} cards, but needs ${requiredCount}.`);
         return logAction(newState, `Error: Must select exactly ${requiredCount} card(s) to keep.`);
     }
      // Verify selected cards are from the available choices
      let tempCardsToKeep = [...cardsToKeep];
      for(const choice of exchangeInfo.cardsToChoose) {
          const index = tempCardsToKeep.indexOf(choice);
          if (index > -1) {
              tempCardsToKeep.splice(index, 1);
          }
      }
      if (tempCardsToKeep.length > 0) {
          console.warn(`[API handleExchangeSelection] Error: Player ${playerId} selected invalid cards: ${tempCardsToKeep.join(',')}. Choices were: ${exchangeInfo.cardsToChoose.join(',')}`);
           return logAction(newState, `Error: Invalid card(s) selected: ${tempCardsToKeep.join(',')}.`);
      }


     console.log("[API handleExchangeSelection] Validation complete. Completing exchange...");
    return await completeExchange(newState, playerId, cardsToKeep);
}

// This function should ONLY be called by the game logic internally when a reveal is mandated.
// It's not a player action. The UI might call it *in response* to a game state flag indicating a reveal is needed.
// Make async as it calls revealInfluence
export async function forceRevealInfluence(gameState: GameState, playerId: string, cardToReveal?: CardType): Promise<GameState> {
     console.log(`[API forceRevealInfluence] Request: Player ${playerId}, Card ${cardToReveal || 'auto'}`);
     let newState = { ...gameState };
     const player = getPlayerById(newState, playerId);
     if (!player) {
          console.error("[API forceRevealInfluence] Error: Player not found.");
          return newState;
     }

     console.log(`[API forceRevealInfluence] Processing forced reveal for ${player.name}.`);
     const { newState: revealedState, revealedCard } = await revealInfluence(newState, playerId, cardToReveal); // await reveal
     newState = revealedState;

     if(revealedCard === null) {
         console.log(`[API forceRevealInfluence] ${player.name} had no influence left to reveal.`);
         newState = logAction(newState, `${player.name} had no influence left to reveal.`);
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
