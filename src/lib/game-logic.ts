
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

    let deck = shuffleDeck([...DeckComposition]);

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
        console.error("Not enough cards to deal initial influence!");
        }
    });

    const initialTreasury = 50 - players.length * 2; // Assuming 50 coins total
    const startingPlayerIndex = Math.floor(Math.random() * totalPlayers);

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

    // IMPORTANT: If the starting player is AI, we need to trigger their action immediately.
    // However, since initializeGame is synchronous, we return the initial state,
    // and the calling component (page.tsx) should handle triggering the first AI turn
    // via updateGameState if needed. The logic here just sets up the state.
    // The `advanceTurn` function handles AI turns *after* the first turn.

    return initialState;
}

function drawCard(deck: CardType[]): { card: CardType | null, remainingDeck: CardType[] } {
  if (deck.length === 0) {
    return { card: null, remainingDeck: [] };
  }
  const remainingDeck = [...deck];
  const card = remainingDeck.pop();
  return { card: card || null, remainingDeck };
}

function returnCardToDeck(deck: CardType[], card: CardType): CardType[] {
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
    if (activePlayers.length <= 1) return currentIndex; // Game might be over or only one player left

    let nextIndex = (currentIndex + 1) % players.length;
    while (!players[nextIndex].influence.some(card => !card.revealed)) {
        nextIndex = (nextIndex + 1) % players.length;
         // Safety break to prevent infinite loops if logic is flawed
        if (nextIndex === currentIndex) {
            console.error("Could not find next active player.");
            return currentIndex;
        }
    }
    return nextIndex;
}

function logAction(gameState: GameState, message: string): GameState {
    console.log("[Game Log]", message); // Add console logging for server/debug
    return {
        ...gameState,
        actionLog: [...gameState.actionLog, message]
    };
}

function eliminatePlayer(gameState: GameState, playerId: string): GameState {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.players[playerIndex].influence.every(c => c.revealed)) {
        // Check if already logged elimination for this player
        if (!newState.actionLog.includes(`${newState.players[playerIndex].name} has been eliminated!`)) {
             newState = logAction(newState, `${newState.players[playerIndex].name} has been eliminated!`);
        }
        // Optionally remove player or just mark as inactive - current logic relies on checking revealed cards
    }
    return newState;
}


function checkForWinner(gameState: GameState): Player | null {
    const activePlayers = getActivePlayers(gameState);
    if (activePlayers.length === 1) {
        return activePlayers[0];
    }
    return null;
}

// Reveals influence, checks for elimination, returns new state and revealed card type
async function revealInfluence(gameState: GameState, playerId: string, cardType?: CardType): Promise<{ newState: GameState, revealedCard: CardType | null }> {
    let newState = { ...gameState };
    let revealedCardType: CardType | null = null;
    const playerIndex = newState.players.findIndex(p => p.id === playerId);

    if (playerIndex !== -1) {
        const player = newState.players[playerIndex];
        let influenceToReveal: InfluenceCard | undefined;

        // Find the specific card if provided and unrevealed
        if (cardType) {
            influenceToReveal = player.influence.find(c => c.type === cardType && !c.revealed);
        }

        // If no specific type needed, or specific type not found/already revealed, find *any* unrevealed card
        if (!influenceToReveal) {
            influenceToReveal = player.influence.find(c => !c.revealed);
        }


        if (influenceToReveal) {
             // Create a new influence array with the revealed card marked
             newState.players[playerIndex].influence = player.influence.map(card =>
                card === influenceToReveal ? { ...card, revealed: true } : card
            );
            revealedCardType = influenceToReveal.type;
            newState = logAction(newState, `${player.name} revealed a ${revealedCardType}.`);
            newState = eliminatePlayer(newState, playerId); // Check if this reveal eliminates the player
        } else {
             newState = logAction(newState, `${player.name} has no more influence to reveal!`); // Should ideally not happen if logic is correct
             newState = eliminatePlayer(newState, playerId);
        }
    }
     return { newState, revealedCard: revealedCardType };
}


// --- Action Execution ---

async function performIncome(gameState: GameState, playerId: string): Promise<GameState> {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.treasury > 0) {
        newState.players[playerIndex].money += 1;
        newState.treasury -= 1;
        newState = logAction(newState, `${newState.players[playerIndex].name} takes Income (+1 coin).`);
    }
     return await advanceTurn(newState);
}

async function performForeignAid(gameState: GameState, playerId: string): Promise<GameState> {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    if (!player) return newState;

    newState = logAction(newState, `${player.name} attempts Foreign Aid (+2 coins).`);

    const potentialBlockers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialBlockers.length > 0) {
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
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
         if (playerIndex !== -1) {
            const amount = Math.min(2, newState.treasury);
             newState.players[playerIndex].money += amount;
             newState.treasury -= amount;
             newState = logAction(newState, `${player.name}'s Foreign Aid succeeds (+${amount} coins).`);
         }
         newState = await advanceTurn(newState);
    }
     return newState;
}


async function performCoup(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (player && target && player.money >= 7) {
        player.money -= 7;
        newState.treasury += 7; // Or handle differently if coins are just removed
        newState = logAction(newState, `${player.name} performs a Coup against ${target.name}.`);

        // Coup cannot be challenged or blocked, target must reveal influence
        const { newState: revealedState } = await revealInfluence(newState, targetId); // Ensure await here
        newState = revealedState;

    } else {
        newState = logAction(newState, `${player?.name || 'Player'} cannot perform Coup (not enough money or invalid target).`);
    }
     return await advanceTurn(newState);
}

async function performTax(gameState: GameState, playerId: string): Promise<GameState> {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
     if (!player) return newState;

     newState = logAction(newState, `${player.name} attempts to Tax (+3 coins).`);
     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Tax',
            possibleResponses: potentialChallengers,
            responses: [],
        };
        newState = await triggerAIResponses(newState);
    } else {
        // No challengers, action succeeds
        const amount = Math.min(3, newState.treasury);
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
        if(playerIndex !== -1){
            newState.players[playerIndex].money += amount;
            newState.treasury -= amount;
            newState = logAction(newState, `${player.name}'s Tax succeeds (+${amount} coins).`);
        }
        newState = await advanceTurn(newState);
    }
    return newState;
}


async function performAssassinate(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (!player || !target) return newState;

    if (player.money < 3) {
        return logAction(newState, `${player.name} cannot Assassinate (needs 3 coins).`);
    }

    newState = logAction(newState, `${player.name} attempts to Assassinate ${target.name}.`);

    const potentialResponders = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialResponders.length > 0) {
         newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Assassinate',
            targetPlayer: target,
            possibleResponses: potentialResponders,
            responses: [],
        };
         newState = await triggerAIResponses(newState);
    } else {
        // No one can challenge or block, assassination proceeds
        player.money -= 3;
        newState.treasury += 3;
        newState = logAction(newState, `${player.name}'s Assassination attempt proceeds.`);
        const { newState: revealedState } = await revealInfluence(newState, targetId);
        newState = revealedState;
        newState = await advanceTurn(newState);
    }
     return newState;
}

async function performSteal(gameState: GameState, playerId: string, targetId: string): Promise<GameState> {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (!player || !target) return newState;

    newState = logAction(newState, `${player.name} attempts to Steal from ${target.name}.`);

    const potentialResponders = getActivePlayers(newState).filter(p => p.id !== playerId);


    if (potentialResponders.length > 0) {
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
        const amount = Math.min(2, target.money);
        player.money += amount;
        target.money -= amount;
        newState = logAction(newState, `${player.name} successfully Steals ${amount} coins from ${target.name}.`);
        newState = await advanceTurn(newState);
    }
     return newState;
}


async function performExchange(gameState: GameState, playerId: string): Promise<GameState> {
     let newState = { ...gameState };
     const player = getPlayerById(newState, playerId);
     if (!player) return newState;

     newState = logAction(newState, `${player.name} attempts Exchange.`);
     const potentialChallengers = getActivePlayers(newState).filter(p => p.id !== playerId);

    if (potentialChallengers.length > 0) {
        newState.challengeOrBlockPhase = {
            actionPlayer: player,
            action: 'Exchange',
            possibleResponses: potentialChallengers,
            responses: [],
        };
        newState = await triggerAIResponses(newState);
    } else {
        // No challengers, exchange proceeds
        newState = await initiateExchange(newState, player); // Make initiateExchange async
        // Turn doesn't advance until exchange is complete
    }
    return newState;
}

async function initiateExchange(gameState: GameState, player: Player): Promise<GameState> {
    let newState = { ...gameState };
    const { card: card1, remainingDeck: deckAfter1 } = drawCard(newState.deck);
    const { card: card2, remainingDeck: deckAfter2 } = drawCard(deckAfter1);

    const cardsToChoose = player.influence.filter(c => !c.revealed).map(c => c.type);
    if (card1) cardsToChoose.push(card1);
    if (card2) cardsToChoose.push(card2);

    newState.deck = deckAfter2;
    newState.pendingExchange = {
        player,
        cardsToChoose,
    };
    newState = logAction(newState, `${player.name} draws 2 cards for Exchange.`);

    // If player is AI, trigger AI Exchange choice
    if(player.isAI) {
        newState = await handleAIExchange(newState); // Make handleAIExchange async
    }
    // If player is human, UI needs to present choice

    return newState;
}

async function completeExchange(gameState: GameState, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    const exchangeInfo = newState.pendingExchange;

    if (playerIndex === -1 || !exchangeInfo || exchangeInfo.player.id !== playerId) {
        console.error("Invalid state for completing exchange");
        return newState;
    }

    const originalUnrevealedCount = newState.players[playerIndex].influence.filter(c => !c.revealed).length;

    if (cardsToKeep.length !== originalUnrevealedCount) {
        console.error(`Exchange error: Player must select ${originalUnrevealedCount} cards.`);
         newState = logAction(newState, `Error: ${newState.players[playerIndex].name} did not select the correct number of cards for exchange.`);
         // Don't advance turn, let player retry? Or handle error more gracefully.
         // For now, just log and clear pending state to avoid getting stuck.
         newState.pendingExchange = null;
         return newState;
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


    // Update player influence
    const revealedInfluence = newState.players[playerIndex].influence.filter(c => c.revealed);
    newState.players[playerIndex].influence = [
        ...revealedInfluence,
        ...cardsToKeep.map(type => ({ type, revealed: false })) // Use the original cardsToKeep for setting influence
    ];

    // Return unused cards to deck
    let currentDeck = newState.deck;
    cardsToReturn.forEach(card => {
        currentDeck = returnCardToDeck(currentDeck, card);
    });
    newState.deck = currentDeck;

    newState = logAction(newState, `${newState.players[playerIndex].name} completed Exchange.`);
    newState.pendingExchange = null;

    return await advanceTurn(newState);
}

// --- Challenge/Block Resolution ---

async function resolveChallengeOrBlock(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;
    if (!phase) return newState; // Should not happen

    const actionPlayer = phase.actionPlayer;
    const action = phase.action;
    const targetPlayer = phase.targetPlayer;

    const challenges = phase.responses.filter(r => r.response === 'Challenge');
    const blocks = phase.responses.filter(r => (r.response as BlockActionType).startsWith('Block'));

    newState.challengeOrBlockPhase = null; // Clear the phase BEFORE resolving to prevent re-entry issues

    if (challenges.length > 0) {
        // Handle Challenge first (only one challenge happens)
        const challengerId = challenges[0].playerId;
        const challenger = getPlayerById(newState, challengerId);
        newState = logAction(newState, `${challenger?.name || 'Player'} challenges ${actionPlayer.name}'s attempt to ${action}!`);
        newState = await resolveChallenge(newState, actionPlayer.id, challengerId, action);
    } else if (blocks.length > 0) {
        // Handle Block (only one block happens, but it could be challenged)
        const blockerId = blocks[0].playerId;
        const blocker = getPlayerById(newState, blockerId);
        const blockType = blocks[0].response as BlockActionType;
        newState = logAction(newState, `${blocker?.name || 'Player'} blocks ${actionPlayer.name}'s ${action}!`);
        newState = await resolveBlock(newState, actionPlayer, targetPlayer, blockerId, action, blockType);
    } else {
        // No challenges or blocks, action succeeds
        newState = logAction(newState, `No challenges or blocks. ${actionPlayer.name}'s ${action} attempt succeeds.`);
        newState = await executeSuccessfulAction(newState, actionPlayer, action, targetPlayer);
    }

    return newState; // Return the state after resolution
}


async function resolveChallenge(gameState: GameState, challengedPlayerId: string, challengerId: string, action: ActionType): Promise<GameState> {
    let newState = { ...gameState };
    const challengedPlayer = getPlayerById(newState, challengedPlayerId)!;
    const challenger = getPlayerById(newState, challengerId)!;

    const requiredCard = getCardForAction(action);

    if (!requiredCard) {
         newState = logAction(newState, `Error: Action ${action} cannot be challenged (or logic error).`);
         // Action proceeds as if unchallenged? Or halt? Assuming action proceeds.
         newState = await executeSuccessfulAction(newState, challengedPlayer, action, newState.challengeOrBlockPhase?.targetPlayer);
         return newState;
    }

    const hasCard = challengedPlayer.influence.some(c => c.type === requiredCard && !c.revealed);

    if (hasCard) {
        newState = logAction(newState, `${challengedPlayer.name} reveals ${requiredCard} to prove the challenge wrong.`);
        // Player reveals the specific card, shuffles it back, draws a new one.
        const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
        if (playerIndex !== -1) {
             // Find the first instance of the required card that is not revealed
            const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === requiredCard && !c.revealed);
            if (cardIndex !== -1) {
                // Temporarily store the card type, remove from influence
                const cardTypeToShuffle = newState.players[playerIndex].influence[cardIndex].type;
                newState.players[playerIndex].influence.splice(cardIndex, 1);

                // Shuffle back and draw
                 newState.deck = returnCardToDeck(newState.deck, cardTypeToShuffle);
                 const { card: newCard, remainingDeck } = drawCard(newState.deck);
                 newState.deck = remainingDeck;
                 if (newCard) {
                     newState.players[playerIndex].influence.push({ type: newCard, revealed: false });
                     newState = logAction(newState, `${challengedPlayer.name} shuffles back ${cardTypeToShuffle} and draws a new card.`);
                 } else {
                     newState = logAction(newState, `${challengedPlayer.name} shuffles back ${cardTypeToShuffle} but could not draw a new card (deck empty?).`);
                     // Player has one less card now!
                 }

            } else {
                 newState = logAction(newState, `Error: ${challengedPlayer.name} had ${requiredCard} but couldn't find unrevealed instance?`);
            }
        }

        // Challenger loses influence
        newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
        const { newState: revealedState } = await revealInfluence(newState, challengerId); // await reveal
        newState = revealedState;

        // Check if challenger eliminated before proceeding
        const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);

        if (!challengerStillActive) {
            newState = logAction(newState, `${challenger.name} was eliminated by the failed challenge!`);
            const winner = checkForWinner(newState);
            if (winner) {
                 newState.winner = winner;
                 newState = logAction(newState, `${winner.name} has won the game!`);
                 return newState;
            }
            // If game not over, original action *still* proceeds, then turn advances
            newState = await executeSuccessfulAction(newState, challengedPlayer, action, newState.challengeOrBlockPhase?.targetPlayer);

        } else {
            // Original action proceeds, then turn advances
             newState = await executeSuccessfulAction(newState, challengedPlayer, action, newState.challengeOrBlockPhase?.targetPlayer);
        }

    } else {
        newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge with ${requiredCard} and loses influence.`);
        // Challenged player loses influence because they bluffed
        const { newState: revealedState } = await revealInfluence(newState, challengedPlayerId); // await reveal
        newState = revealedState;

        // Check if challenged player eliminated
         const challengedStillActive = getActivePlayers(newState).some(p => p.id === challengedPlayerId);

         if(!challengedStillActive) {
             newState = logAction(newState, `${challengedPlayer.name} was eliminated by the successful challenge!`);
             const winner = checkForWinner(newState);
              if (winner) {
                  newState.winner = winner;
                  newState = logAction(newState, `${winner.name} has won the game!`);
                  return newState;
              }
         }
         // Action fails, turn advances (unless game ended)
         newState = await advanceTurn(newState);
    }

    return newState;
}


async function resolveBlock(gameState: GameState, actionPlayer: Player, targetPlayer: Player | undefined, blockerId: string, action: ActionType, blockType: BlockActionType): Promise<GameState> {
    let newState = { ...gameState };
    const blocker = getPlayerById(newState, blockerId)!;

     // Block is announced, now the original actionPlayer can challenge the block
     newState = logAction(newState, `${actionPlayer.name} can now challenge ${blocker.name}'s attempt to ${blockType}.`);

     newState.challengeOrBlockPhase = {
         actionPlayer: blocker, // The blocker is now the one whose claim (block) can be challenged
         action: blockType as any, // Treat block as an action for challenge check (cast needed due to type mismatch)
         targetPlayer: actionPlayer, // The target of the "block action" challenge is the original action player
         possibleResponses: [actionPlayer], // Only the original action player can challenge the block
         responses: [],
     };

     // Trigger AI/Player response for the challenge against the block
     newState = await triggerAIResponses(newState); // Will handle both AI and Human (by waiting)

     return newState; // State waits for challenge decision against the block
}

async function resolveBlockChallenge(gameState: GameState, blockerId: string, challengerId: string, blockType: BlockActionType): Promise<GameState> {
     let newState = { ...gameState };
     const blocker = getPlayerById(newState, blockerId)!;
     const challenger = getPlayerById(newState, challengerId)!; // Original action player

     newState = logAction(newState, `${challenger.name} challenges ${blocker.name}'s ${blockType}!`);

     const requiredCard = getCardForBlock(blockType);
     if (!requiredCard) {
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
         newState = logAction(newState, `${blocker.name} reveals ${cardToReveal} to prove the block challenge wrong.`);
         // Blocker reveals the card, shuffles it back, draws a new one.
         const playerIndex = newState.players.findIndex(p => p.id === blockerId);
         if (playerIndex !== -1) {
             const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === cardToReveal && !c.revealed);
             if (cardIndex !== -1) {
                 const cardTypeToShuffle = newState.players[playerIndex].influence[cardIndex].type;
                 newState.players[playerIndex].influence.splice(cardIndex, 1);

                 newState.deck = returnCardToDeck(newState.deck, cardTypeToShuffle);
                 const { card: newCard, remainingDeck } = drawCard(newState.deck);
                  newState.deck = remainingDeck;
                  if (newCard) {
                      newState.players[playerIndex].influence.push({ type: newCard, revealed: false });
                      newState = logAction(newState, `${blocker.name} shuffles back ${cardTypeToShuffle} and draws a new card.`);
                  } else {
                      newState = logAction(newState, `${blocker.name} shuffles back ${cardTypeToShuffle} but could not draw a new card (deck empty?).`);
                  }
             } else {
                  newState = logAction(newState, `Error: ${blocker.name} had ${cardToReveal} but couldn't find unrevealed instance?`);
             }
         }

         // Challenger (original action player) loses influence
         newState = logAction(newState, `${challenger.name} loses the block challenge and must reveal influence.`);
          const { newState: revealedState } = await revealInfluence(newState, challengerId); // await reveal
         newState = revealedState;

          // Check if challenger eliminated
         const challengerStillActive = getActivePlayers(newState).some(p => p.id === challengerId);
          if(!challengerStillActive) {
              newState = logAction(newState, `${challenger.name} was eliminated by the failed block challenge!`);
              const winner = checkForWinner(newState);
              if (winner) {
                  newState.winner = winner;
                  newState = logAction(newState, `${winner.name} has won the game!`);
                  return newState;
              }
          }

         // Block succeeds, original action fails. Turn advances.
         newState = logAction(newState, `${blocker.name}'s block is successful. ${challenger.name}'s action is cancelled.`);
         newState = await advanceTurn(newState);

     } else {
         newState = logAction(newState, `${blocker.name} cannot prove the block with ${requiredCard} ${blockType === 'Block Stealing' ? `or ${getAlternateCardForStealBlock()}` : ''} and loses influence.`);
         // Blocker loses influence because they bluffed the block
         const { newState: revealedState } = await revealInfluence(newState, blockerId); // await reveal
         newState = revealedState;

         // Check if blocker eliminated
          const blockerStillActive = getActivePlayers(newState).some(p => p.id === blockerId);
          const originalAction = getActionFromBlock(blockType);
          const originalTarget = newState.challengeOrBlockPhase?.targetPlayer; // Need to retrieve original target from phase state before clearing it

          if(!blockerStillActive) {
               newState = logAction(newState, `${blocker.name} was eliminated by the successful block challenge!`);
               const winner = checkForWinner(newState);
               if (winner) {
                   newState.winner = winner;
                   newState = logAction(newState, `${winner.name} has won the game!`);
                   return newState;
               }
               // If blocker eliminated, action automatically proceeds
                if (originalAction) {
                    newState = logAction(newState, `${blocker.name} was eliminated. ${challenger.name}'s ${originalAction} proceeds.`);
                    newState = await executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
                 } else {
                     newState = logAction(newState, `Error retrieving original action after blocker eliminated.`);
                     newState = await advanceTurn(newState);
                 }
          } else {
               // Block fails, original action proceeds
                if (originalAction) {
                    newState = logAction(newState, `${blocker.name}'s block fails. ${challenger.name}'s ${originalAction} proceeds.`);
                    newState = await executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
                } else {
                    newState = logAction(newState, `Error retrieving original action for failed block.`);
                    newState = await advanceTurn(newState);
                }
          }
     }

     return newState;
}


async function executeSuccessfulAction(gameState: GameState, player: Player, action: ActionType, target?: Player): Promise<GameState> {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === player.id);
    const targetIndex = target ? newState.players.findIndex(p => p.id === target.id) : -1;

     // Ensure target is still active before applying effect
    const targetStillActive = target ? getActivePlayers(newState).some(p => p.id === target.id) : true;


    switch (action) {
        case 'Foreign Aid':
             if (playerIndex !== -1) {
                const amount = Math.min(2, newState.treasury);
                newState.players[playerIndex].money += amount;
                newState.treasury -= amount;
                // Already logged success/attempt earlier
            }
            newState = await advanceTurn(newState);
            break;
        case 'Tax':
            if (playerIndex !== -1) {
                const amount = Math.min(3, newState.treasury);
                newState.players[playerIndex].money += amount;
                newState.treasury -= amount;
                 // Already logged success/attempt earlier
            }
             newState = await advanceTurn(newState);
            break;
        case 'Assassinate':
             if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive) {
                 if (newState.players[playerIndex].money >= 3) {
                     newState.players[playerIndex].money -= 3;
                     newState.treasury += 3;
                     newState = logAction(newState, `Assassination against ${newState.players[targetIndex].name} succeeds.`);
                     const { newState: revealedState } = await revealInfluence(newState, newState.players[targetIndex].id); // await reveal
                     newState = revealedState;
                 } else {
                      newState = logAction(newState, `${player.name} cannot complete Assassination (not enough money).`);
                 }
             } else if (targetIndex !== -1 && !targetStillActive) {
                  newState = logAction(newState, `Assassination target ${newState.players[targetIndex].name} was already eliminated.`);
                  // Refund cost? Game rules vary. Let's assume cost is paid on attempt.
                  newState.players[playerIndex].money -= 3;
                  newState.treasury += 3;
             }
              newState = await advanceTurn(newState);
             break;
        case 'Steal':
            if (playerIndex !== -1 && targetIndex !== -1 && targetStillActive) {
                 const amount = Math.min(2, newState.players[targetIndex].money);
                 newState.players[playerIndex].money += amount;
                 newState.players[targetIndex].money -= amount;
                 newState = logAction(newState, `Successfully stole ${amount} coins from ${newState.players[targetIndex].name}.`);
             } else if(targetIndex !== -1 && !targetStillActive) {
                  newState = logAction(newState, `Steal target ${newState.players[targetIndex].name} was already eliminated.`);
             }
              newState = await advanceTurn(newState);
            break;
        case 'Exchange':
            newState = await initiateExchange(newState, player); // await exchange initiation
             // Turn advances after exchange completion (handled in completeExchange)
            break;
        // Income and Coup are handled directly and don't go through challenge phase
        default:
             newState = logAction(newState, `Action ${action} completed successfully (no specific execution logic needed here).`);
             newState = await advanceTurn(newState);
    }

    return newState;
}


async function advanceTurn(gameState: GameState): Promise<GameState> {
    console.log("Entering advanceTurn");
    let newState = { ...gameState };
    const winner = checkForWinner(newState);
    if (winner) {
        newState.winner = winner;
        newState = logAction(newState, `${winner.name} has won the game!`);
         console.log("advanceTurn: Winner found, returning final state.");
        return newState;
    }
     // Clear transient states ONLY if not already cleared (e.g. by resolution functions)
     if (newState.challengeOrBlockPhase) {
        console.log("advanceTurn: Clearing challenge/block phase.");
        newState.challengeOrBlockPhase = null;
     }
     if (newState.pendingExchange) {
          console.log("advanceTurn: Clearing pending exchange.");
          newState.pendingExchange = null; // Should be cleared by completeExchange, but safety check
     }
     if (newState.currentAction) {
          console.log("advanceTurn: Clearing current action.");
          newState.currentAction = null;
     }


    newState.currentPlayerIndex = getNextPlayerIndex(newState.currentPlayerIndex, newState.players);
    newState = logAction(newState, `--- ${newState.players[newState.currentPlayerIndex].name}'s turn ---`);
    console.log(`advanceTurn: New turn for ${newState.players[newState.currentPlayerIndex].name}`);


    // If the new current player is AI, trigger their action AND WAIT FOR IT
    if (newState.players[newState.currentPlayerIndex].isAI) {
        console.log(`advanceTurn: Triggering AI action for ${newState.players[newState.currentPlayerIndex].name}`);
        // IMPORTANT: Await the result of the AI's action before returning
        newState = await handleAIAction(newState);
        console.log(`advanceTurn: AI action completed for ${newState.players[newState.currentPlayerIndex].name}`);
    } else {
         console.log(`advanceTurn: New player is human (${newState.players[newState.currentPlayerIndex].name}), returning state.`);
    }

    return newState;
}

function getCardForAction(action: ActionType): CardType | null {
    switch (action) {
        case 'Tax': return 'Duke';
        case 'Assassinate': return 'Assassin';
        case 'Steal': return 'Captain';
        case 'Exchange': return 'Ambassador';
         // Handle challenge against blocks
        case 'Block Foreign Aid': return 'Duke';
        case 'Block Stealing': return 'Captain'; // Primary card for blocking steal
        case 'Block Assassination': return 'Contessa';
        default: return null; // Income, Foreign Aid, Coup cannot be challenged based on card
    }
}

// Use this specifically for resolving block challenges
function getCardForBlock(block: BlockActionType): CardType | null {
    switch (block) {
        case 'Block Foreign Aid': return 'Duke';
        case 'Block Stealing': return 'Captain'; // Can also be Ambassador, handle separately in logic
        case 'Block Assassination': return 'Contessa';
        default: return null;
    }
}

function getAlternateCardForStealBlock(): CardType {
    return 'Ambassador';
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
    const actions: ActionType[] = ['Income', 'Foreign Aid'];
     // Check if eliminated
    if (!player.influence.some(c => !c.revealed)) {
        return [];
    }

    if (player.money >= 10) {
        return ['Coup']; // Must Coup if money is 10 or more
    }
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
        return actions.filter(a => a !== 'Coup' && a !== 'Assassinate' && a !== 'Steal');
    }

    return actions;
}

// Generate a simple text description of the game state for the AI
function generateGameStateDescription(gameState: GameState, aiPlayerId: string): string {
    let description = "Current Game State:\n";
    const aiPlayer = getPlayerById(gameState, aiPlayerId);
    if (aiPlayer) {
        description += `You are ${aiPlayer.name}. Your money: ${aiPlayer.money}. Your unrevealed influence: [${aiPlayer.influence.filter(c => !c.revealed).map(c => c.type).join(', ')}].\n`;
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
         description += `Current Action: ${gameState.currentAction.player.name} performs ${gameState.currentAction.action} ${gameState.currentAction.target ? `targeting ${gameState.currentAction.target.name}`: ''}.\n`;
     }
     if(gameState.challengeOrBlockPhase) {
          const phase = gameState.challengeOrBlockPhase;
          description += `Challenge/Block Phase: ${phase.actionPlayer.name}'s attempt to ${phase.action} ${phase.targetPlayer ? ` targeting ${phase.targetPlayer.name}`: ''} is being considered. Possible responses from: ${phase.possibleResponses.map(p => p.name).join(', ')}. Current responses: ${phase.responses.map(r => `${getPlayerById(gameState, r.playerId)?.name}: ${r.response}`).join(', ') || 'None'}.\n`;
     }
     if(gameState.pendingExchange) {
          description += `Pending Exchange: ${gameState.pendingExchange.player.name} is choosing cards.\n`;
     }
    description += `Last 5 Action Log Entries:\n${gameState.actionLog.slice(-5).join('\n')}\n`; // Last 5 log entries
    description += `It is currently ${gameState.players[gameState.currentPlayerIndex].name}'s turn.\n`;
    return description;
}


async function handleAIAction(gameState: GameState): Promise<GameState> {
    console.log(`Entering handleAIAction for ${gameState.players[gameState.currentPlayerIndex].name}`);
    let newState = { ...gameState };
    const aiPlayer = newState.players[newState.currentPlayerIndex];

    // Safety checks
    if (!aiPlayer || !aiPlayer.isAI) {
         console.error("handleAIAction called for non-AI player or invalid player index.");
         return newState;
    }
     if (!aiPlayer.influence.some(c => !c.revealed)) {
         console.log(`handleAIAction: AI ${aiPlayer.name} is eliminated, advancing turn.`);
         return await advanceTurn(newState); // Skip turn if AI is eliminated
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.winner) {
         console.log(`handleAIAction: AI ${aiPlayer.name}'s turn skipped due to ongoing phase or game over.`);
         return newState; // Don't act if in another phase
     }


    const availableActions = getAvailableActions(aiPlayer, newState);
     if (availableActions.length === 0) {
         console.log(`handleAIAction: AI ${aiPlayer.name} has no available actions (likely eliminated), advancing turn.`);
         return await advanceTurn(newState);
     }

    const opponentActions = newState.actionLog.slice(-3); // Simple recent history
    const gameStateDescription = generateGameStateDescription(newState, aiPlayer.id);

    try {
        console.log(`handleAIAction: Requesting action selection for ${aiPlayer.name}...`);
        const aiDecision = await selectAction({
            playerMoney: aiPlayer.money,
            playerInfluence: aiPlayer.influence.filter(c => !c.revealed).length,
            opponentActions,
            availableActions,
            gameState: gameStateDescription,
        });
        console.log(`handleAIAction: AI ${aiPlayer.name} decided action: ${aiDecision.action}, Target: ${aiDecision.target}, Reasoning: ${aiDecision.reasoning}`);

        newState = logAction(newState, `AI (${aiPlayer.name}) Reasoning: ${aiDecision.reasoning}`);
        newState = logAction(newState, `AI (${aiPlayer.name}) chose action: ${aiDecision.action} ${aiDecision.target ? `targeting ${aiDecision.target}` : ''}`);


         // Find target player if needed
         let targetPlayer : Player | undefined = undefined;
         if (aiDecision.target && (aiDecision.action === 'Coup' || aiDecision.action === 'Assassinate' || aiDecision.action === 'Steal')) {
            // AI output might be name or ID, try to find based on name first among ACTIVE opponents
            targetPlayer = getActivePlayers(newState).find(p => p.name === aiDecision.target && p.id !== aiPlayer.id);
             if (!targetPlayer) { // Fallback if name matching fails or target is inactive/self
                 const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                 if(activeOpponents.length > 0) {
                     // If AI specified *any* target, but it wasn't found/valid, pick random active opponent
                     targetPlayer = activeOpponents[Math.floor(Math.random() * activeOpponents.length)];
                     newState = logAction(newState, `AI (${aiPlayer.name}) adjusted target for ${aiDecision.action} to ${targetPlayer.name}.`);
                 } else {
                     // No valid targets exist, default to safe action
                     newState = logAction(newState, `AI (${aiPlayer.name}) has no valid targets for ${aiDecision.action}. Choosing Income instead.`);
                     return await performIncome(newState, aiPlayer.id); // Default safe action
                 }
             }
         }

        // Perform the chosen action - This will handle challenges/blocks and eventually call advanceTurn
        newState = await performAction(newState, aiPlayer.id, aiDecision.action as ActionType, targetPlayer?.id);

    } catch (error) {
        console.error(`AI action selection failed for ${aiPlayer.name}:`, error);
        newState = logAction(newState, `AI (${aiPlayer.name}) encountered an error. Taking Income.`);
        newState = await performIncome(newState, aiPlayer.id); // Fallback action
    }
     console.log(`Exiting handleAIAction for ${aiPlayer.name}`);
    return newState;
}


// Triggers AI responses during challenge/block phases. Returns the state *after* AIs have responded.
async function triggerAIResponses(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;
    if (!phase) return newState;

    const aiResponders = phase.possibleResponses.filter(p => p.isAI && !phase.responses.some(r => r.playerId === p.id));
    console.log(`triggerAIResponses: AI Responders: [${aiResponders.map(p=>p.name).join(', ')}] for action ${phase.action}`);

    let shouldResolvePhase = false; // Flag to resolve phase after loop if needed

    for (const aiPlayer of aiResponders) {
        // Refresh phase state in case previous AI response modified it
         const currentPhase = newState.challengeOrBlockPhase;
         if (!currentPhase || currentPhase.responses.some(r => r.playerId === aiPlayer.id)) {
             console.log(`triggerAIResponses: Skipping AI ${aiPlayer.name} as phase ended or already responded.`);
             continue; // Phase might have resolved, or AI already responded
         }

        let decision: GameResponseType = 'Allow'; // Default
        let reasoning = 'Defaulting to Allow.';
        let decidedResponseType: 'Challenge' | 'Block' | 'Allow' = 'Allow'; // For logging/control flow

        try {
             console.log(`triggerAIResponses: Getting response from AI ${aiPlayer.name} for action ${currentPhase.action}`);
             // Determine if AI *can* challenge or block
             const actionRequiresCard = getCardForAction(currentPhase.action);
             const canChallenge = actionRequiresCard !== null;
             const blockType = getBlockTypeForAction(currentPhase.action);
             const canBlock = !!blockType && (currentPhase.action === 'Foreign Aid' || currentPhase.targetPlayer?.id === aiPlayer.id);

             let challengeDecision = { shouldChallenge: false, reason: ""};
             if (canChallenge) {
                 console.log(`triggerAIResponses: AI ${aiPlayer.name} evaluating Challenge...`);
                  challengeDecision = await aiChallengeReasoning({
                     action: currentPhase.action,
                     currentPlayer: currentPhase.actionPlayer.name,
                     targetPlayer: currentPhase.targetPlayer?.name, // Optional chaining
                     aiInfluence: aiPlayer.influence.filter(c => !c.revealed).map(c => c.type),
                     opponentInfluenceCount: currentPhase.actionPlayer.influence.filter(c => !c.revealed).length,
                     gameState: generateGameStateDescription(newState, aiPlayer.id),
                 });
                  newState = logAction(newState, `AI (${aiPlayer.name}) Challenge Reasoning: ${challengeDecision.reason}`);
                 console.log(`triggerAIResponses: AI ${aiPlayer.name} Challenge decision: ${challengeDecision.shouldChallenge}`);
             }


             let blockDecision = { shouldBlock: false, reasoning: ""};
             if (canBlock && blockType) { // Ensure blockType is valid if canBlock is true
                 console.log(`triggerAIResponses: AI ${aiPlayer.name} evaluating Block (${blockType})...`);
                  blockDecision = await aiBlockReasoning({
                     action: currentPhase.action,
                      // Pass actual cards for better reasoning potential
                      aiPlayerInfluenceCards: aiPlayer.influence.filter(c => !c.revealed).map(c => c.type),
                      aiPlayerMoney: aiPlayer.money,
                      // Pass opponent's details accurately
                      opponentInfluenceCount: currentPhase.actionPlayer.influence.filter(c => !c.revealed).length,
                      opponentMoney: currentPhase.actionPlayer.money,
                     gameState: generateGameStateDescription(newState, aiPlayer.id),
                 });
                  newState = logAction(newState, `AI (${aiPlayer.name}) Block Reasoning: ${blockDecision.reasoning}`);
                  console.log(`triggerAIResponses: AI ${aiPlayer.name} Block decision: ${blockDecision.shouldBlock}`);
             }


             // Determine final AI response (Prioritize Challenge > Block > Allow)
             if (canChallenge && challengeDecision.shouldChallenge) {
                 decision = 'Challenge';
                 reasoning = challengeDecision.reason;
                 decidedResponseType = 'Challenge';
             } else if (canBlock && blockType && blockDecision.shouldBlock) {
                 decision = blockType; // Use the specific block type
                 reasoning = blockDecision.reasoning;
                 decidedResponseType = 'Block';
             } else {
                  decision = 'Allow';
                  reasoning = 'Decided to allow the action.';
                  decidedResponseType = 'Allow';
             }

        } catch (error) {
             console.error(`AI response generation failed for ${aiPlayer.name}:`, error);
             newState = logAction(newState, `AI (${aiPlayer.name}) encountered an error during response. Defaulting to Allow.`);
             decision = 'Allow';
             reasoning = 'Error during decision process.';
             decidedResponseType = 'Allow';
        }

        newState = logAction(newState, `AI (${aiPlayer.name}) responds: ${decision}. Reasoning: ${reasoning}`);
        console.log(`triggerAIResponses: AI ${aiPlayer.name} final response: ${decision}`);

        // IMPORTANT: Update the state by calling handlePlayerResponse, which correctly modifies the phase state
        newState = await handlePlayerResponse(newState, aiPlayer.id, decision); // Await the handling


        // If AI Challenged or Blocked, the phase resolution is handled within handlePlayerResponse/resolve functions.
        // We break the loop as no further responses are needed for *this* action.
        if (decidedResponseType !== 'Allow') {
            console.log(`triggerAIResponses: AI ${aiPlayer.name} responded with ${decision}. Breaking response loop.`);
            shouldResolvePhase = false; // Resolution handled by handlePlayerResponse flow
            break;
        } else {
             // If AI Allowed, check if all responses are now in
             const latestPhase = newState.challengeOrBlockPhase; // Get potentially updated phase state
             if (latestPhase && latestPhase.possibleResponses.every(p => latestPhase.responses.some(r => r.playerId === p.id))) {
                 console.log("triggerAIResponses: All responses received (all Allow). Flagging for resolution.");
                 shouldResolvePhase = true; // Mark that phase needs resolution after loop
             } else {
                 console.log("triggerAIResponses: More responses pending.");
             }
        }
    } // End AI responder loop

    // After all AIs have had a chance (and only if resolution wasn't triggered by a Challenge/Block)
     if (shouldResolvePhase && newState.challengeOrBlockPhase) {
         console.log("triggerAIResponses: Resolving phase after all AIs Allowed.");
         newState = await resolveChallengeOrBlock(newState);
     } else if (!newState.challengeOrBlockPhase) {
         console.log("triggerAIResponses: Phase was already resolved by a Challenge/Block.");
     } else {
          console.log("triggerAIResponses: Phase still requires human response or encountered unexpected state.");
     }


    return newState;
}


// Async because it calls completeExchange which is async
async function handleAIExchange(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const exchangeInfo = newState.pendingExchange;
     if (!exchangeInfo || !exchangeInfo.player.isAI) return newState; // Should not happen

     const aiPlayer = exchangeInfo.player;
     const cardsToChooseFrom = exchangeInfo.cardsToChoose;
     const cardsToKeepCount = aiPlayer.influence.filter(c => !c.revealed).length;

     // Basic AI: Keep the best cards based on a simple hierarchy or preference
     // TODO: Enhance this with LLM reasoning if desired
     const cardPreference: CardType[] = ['Duke', 'Contessa', 'Assassin', 'Captain', 'Ambassador']; // Example preference

     // Count occurrences of each card type
     const counts: { [key in CardType]?: number } = {};
     cardsToChooseFrom.forEach(card => {
         counts[card] = (counts[card] || 0) + 1;
     });

     // Sort choices based on preference, keeping track of original index for stability if needed (though sort is stable)
     const sortedChoices = [...cardsToChooseFrom].sort((a, b) => cardPreference.indexOf(a) - cardPreference.indexOf(b));

     // Select the top 'cardsToKeepCount' cards from the sorted list
     const cardsToKeep = sortedChoices.slice(0, cardsToKeepCount);

     newState = logAction(newState, `AI (${aiPlayer.name}) chooses [${cardsToKeep.join(', ')}] for Exchange.`);
     newState = await completeExchange(newState, aiPlayer.id, cardsToKeep); // await completion

     return newState;
}



// --- Public API ---

// Make this async because the actions it calls are async
export async function performAction(gameState: GameState, playerId: string, action: ActionType, targetId?: string): Promise<GameState> {
    console.log(`API performAction: Player ${playerId}, Action ${action}, Target ${targetId}`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);

    // --- Input Validations ---
    if (!player) {
        console.error("performAction Error: Player not found.");
        return logAction(newState, "Error: Player not found.");
    }
    if (player.id !== newState.players[newState.currentPlayerIndex].id) {
         console.warn(`performAction Warning: Not player ${playerId}'s turn (Current: ${newState.players[newState.currentPlayerIndex].id}).`);
        return logAction(newState, "Warning: Not your turn.");
    }
     if (newState.winner) {
         console.warn("performAction Warning: Action attempted after game ended.");
        return logAction(newState, "Game already over.");
     }
     if (newState.challengeOrBlockPhase || newState.pendingExchange) {
         console.warn("performAction Warning: Action attempted during challenge/block/exchange phase.");
        return logAction(newState, "Cannot perform action now, waiting for response or exchange.");
    }
     if (!player.influence.some(c => !c.revealed)) {
         console.warn(`performAction Warning: Player ${playerId} is eliminated.`);
         return logAction(newState, "You are eliminated.");
     }

    const target = targetId ? getPlayerById(newState, targetId) : undefined;

    // --- Action Specific Validations ---
    if (action === 'Coup' && player.money < 7) {
        console.warn(`performAction Warning: ${playerId} insufficient funds for Coup.`);
        return logAction(newState, "Not enough money for Coup (need 7).");
    }
    if (action === 'Assassinate' && player.money < 3) {
         console.warn(`performAction Warning: ${playerId} insufficient funds for Assassinate.`);
        return logAction(newState, "Not enough money to Assassinate (need 3).");
    }
    if (player.money >= 10 && action !== 'Coup') {
         console.warn(`performAction Warning: ${playerId} has >= 10 coins, must Coup.`);
        return logAction(newState, "Must perform Coup with 10 or more coins.");
    }
     const requiresTarget = (action === 'Coup' || action === 'Assassinate' || action === 'Steal');
     if (requiresTarget && !targetId) {
          console.warn(`performAction Warning: Action ${action} requires a target.`);
         return logAction(newState, `Action ${action} requires a target.`);
     }
     if (requiresTarget && !target) {
          console.warn(`performAction Warning: Target player ${targetId} not found.`);
         return logAction(newState, `Target player not found.`);
     }
     if (target && !getActivePlayers(newState).some(p => p.id === target.id)) {
          console.warn(`performAction Warning: Target ${target.name} is already eliminated.`);
         return logAction(newState, `Target ${target.name} is already eliminated.`);
     }
     if (target && target.id === player.id) {
          console.warn(`performAction Warning: Player ${playerId} cannot target self with ${action}.`);
         return logAction(newState, `Cannot target self with ${action}.`);
     }


    newState.currentAction = { player, action, target }; // Set current action *before* calling specific function

    console.log(`performAction: Executing ${action} for ${player.name}`);
    switch (action) {
        case 'Income':
            return await performIncome(newState, playerId);
        case 'Foreign Aid':
            return await performForeignAid(newState, playerId);
        case 'Coup':
            return await performCoup(newState, playerId, targetId!); // targetId is validated above
        case 'Tax':
            return await performTax(newState, playerId);
        case 'Assassinate':
            return await performAssassinate(newState, playerId, targetId!); // targetId is validated above
        case 'Steal':
            return await performSteal(newState, playerId, targetId!); // targetId is validated above
        case 'Exchange':
            return await performExchange(newState, playerId);
        default:
            console.error(`performAction Error: Unknown action type: ${action}`);
            return logAction(newState, `Error: Unknown action: ${action}`);
    }
}

// Make this async because the functions it calls (resolveChallenge/Block/etc.) are async
export async function handlePlayerResponse(gameState: GameState, respondingPlayerId: string, response: GameResponseType): Promise<GameState> {
    console.log(`API handlePlayerResponse: Player ${respondingPlayerId}, Response ${response}`);
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase; // Use current phase state

     // --- Input Validations ---
     if (!phase) {
          console.warn("handlePlayerResponse Warning: No challenge/block phase active.");
         return logAction(newState, "Invalid response: Not in challenge/block phase.");
     }
     if (!phase.possibleResponses.some(p => p.id === respondingPlayerId)) {
          console.warn(`handlePlayerResponse Warning: Player ${respondingPlayerId} cannot respond in this phase.`);
         return logAction(newState, `Invalid response: Player ${getPlayerById(newState, respondingPlayerId)?.name} cannot respond now.`);
     }
     // Check if player already responded
    if (phase.responses.some(r => r.playerId === respondingPlayerId)) {
         console.warn(`handlePlayerResponse Warning: Player ${respondingPlayerId} already responded.`);
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`);
    }

    const respondingPlayer = getPlayerById(newState, respondingPlayerId)!;

    // --- Update Phase State ---
     // Create a *new* responses array
     const newResponses = [...phase.responses, { playerId: respondingPlayerId, response }];
     newState.challengeOrBlockPhase = { ...phase, responses: newResponses }; // Update state immutably
     newState = logAction(newState, `${respondingPlayer.name} responds: ${response}.`);


    // --- Resolve or Continue ---
    if (response === 'Challenge') {
        // Resolve immediately based on whether it's a challenge against an action or a block
         console.log(`handlePlayerResponse: Challenge issued by ${respondingPlayer.name}. Resolving...`);
         if (phase.action.startsWith('Block ')) { // Challenging a block
              // actionPlayer is the blocker, respondingPlayer is the challenger (original action taker)
              return await resolveBlockChallenge(newState, phase.actionPlayer.id, respondingPlayerId, phase.action as BlockActionType);
         } else { // Challenging a regular action
               // actionPlayer is the action taker, respondingPlayer is the challenger
              return await resolveChallenge(newState, phase.actionPlayer.id, respondingPlayerId, phase.action);
         }
    } else if (response.startsWith('Block')) {
        // A block was issued. Resolve the block attempt (which sets up the challenge-the-block phase)
         console.log(`handlePlayerResponse: Block issued by ${respondingPlayer.name}. Setting up challenge-block phase...`);
         // actionPlayer is original action taker, respondingPlayer is the blocker
         return await resolveBlock(newState, phase.actionPlayer, phase.targetPlayer, respondingPlayerId, phase.action, response as BlockActionType);
    } else { // Response is 'Allow'
         console.log(`handlePlayerResponse: Allow received from ${respondingPlayer.name}.`);
         // Check if all responses are now in
        const currentPhase = newState.challengeOrBlockPhase; // Use updated state
        const allResponded = currentPhase.possibleResponses.every(p => currentPhase.responses.some(r => r.playerId === p.id));

        if (allResponded) {
             console.log("handlePlayerResponse: All responses received. Resolving phase...");
             newState = await resolveChallengeOrBlock(newState); // Resolve based on collected responses
        } else {
            console.log("handlePlayerResponse: Waiting for more responses...");
            // Still waiting for more responses. Trigger remaining AIs if applicable.
            const remainingResponders = currentPhase.possibleResponses.filter(p => !currentPhase.responses.some(r => r.playerId === p.id));
            if (remainingResponders.length > 0 && remainingResponders.every(p => p.isAI)) {
                console.log("handlePlayerResponse: Triggering remaining AI responders...");
                newState = await triggerAIResponses(newState); // Trigger remaining AIs
            }
            // Otherwise, wait for human input - return current state
        }
    }

    return newState;
}


// Make this async because it calls completeExchange which is async
export async function handleExchangeSelection(gameState: GameState, playerId: string, cardsToKeep: CardType[]): Promise<GameState> {
     console.log(`API handleExchangeSelection: Player ${playerId}, Cards ${cardsToKeep.join(', ')}`);
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const exchangeInfo = newState.pendingExchange;

    if (!player || player.id !== newState.players[newState.currentPlayerIndex].id) {
         console.warn("handleExchangeSelection Warning: Not player's turn or player not found.");
        return logAction(newState, "Not player's turn or player not found.");
    }
    if (!exchangeInfo || exchangeInfo.player.id !== playerId) {
         console.warn("handleExchangeSelection Warning: Not in exchange phase for this player.");
        return logAction(newState, "Not in exchange phase for this player.");
    }
     if (!player.influence.some(c => !c.revealed)) {
          console.warn(`handleExchangeSelection Warning: Player ${playerId} is eliminated.`);
         return logAction(newState, "You are eliminated."); // Should not happen if turn logic is correct
     }

    return await completeExchange(newState, playerId, cardsToKeep);
}

// This function should ONLY be called by the game logic internally when a reveal is mandated.
// It's not a player action. The UI might call it *in response* to a game state flag indicating a reveal is needed.
// Make async as it calls revealInfluence
export async function forceRevealInfluence(gameState: GameState, playerId: string, cardToReveal?: CardType): Promise<GameState> {
     console.log(`API forceRevealInfluence: Player ${playerId}, Card ${cardToReveal || 'auto'}`);
     let newState = { ...gameState };
     const player = getPlayerById(newState, playerId);
     if (!player) {
          console.error("forceRevealInfluence Error: Player not found.");
          return newState;
     }

     const { newState: revealedState, revealedCard } = await revealInfluence(newState, playerId, cardToReveal); // await reveal
     newState = revealedState;

     if(revealedCard === null) {
         newState = logAction(newState, `${player.name} had no influence left to reveal.`);
     }

      // Check for winner immediately after forced reveal
      const winner = checkForWinner(newState);
      if (winner && !newState.winner) { // Only set winner if not already set
          newState.winner = winner;
          newState = logAction(newState, `${winner.name} has won the game!`);
      }
       // Do NOT advance turn here. The logic that *caused* the forced reveal (Coup, Assassinate, Challenge Loss)
       // is responsible for calling advanceTurn after the reveal is complete.

     return newState;
}
