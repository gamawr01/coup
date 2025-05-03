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
      // Should not happen with standard deck size and player count
      console.error("Not enough cards to deal initial influence!");
    }
  });

  const initialTreasury = 50 - players.length * 2; // Assuming 50 coins total

  return {
    players,
    deck,
    treasury: initialTreasury,
    currentPlayerIndex: Math.floor(Math.random() * totalPlayers), // Random start player
    currentAction: null,
    challengeOrBlockPhase: null,
    pendingExchange: null,
    actionLog: ['Game started!'],
    winner: null,
  };
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
    return {
        ...gameState,
        actionLog: [...gameState.actionLog, message]
    };
}

function eliminatePlayer(gameState: GameState, playerId: string): GameState {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.players[playerIndex].influence.every(c => c.revealed)) {
        newState = logAction(newState, `${newState.players[playerIndex].name} has been eliminated!`);
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

function revealInfluence(gameState: GameState, playerId: string, cardType?: CardType): { newState: GameState, revealedCard: CardType | null } {
    let newState = { ...gameState };
    let revealedCardType: CardType | null = null;
    const playerIndex = newState.players.findIndex(p => p.id === playerId);

    if (playerIndex !== -1) {
        const player = newState.players[playerIndex];
        let influenceToReveal: InfluenceCard | undefined;

        // If a specific card type is required (e.g., for challenge proof), try to find it
        if (cardType) {
            influenceToReveal = player.influence.find(c => c.type === cardType && !c.revealed);
        }

        // If no specific type needed, or specific type not found unrevealed, reveal any unrevealed card
        if (!influenceToReveal) {
            influenceToReveal = player.influence.find(c => !c.revealed);
        }


        if (influenceToReveal) {
            influenceToReveal.revealed = true;
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

function performIncome(gameState: GameState, playerId: string): GameState {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1 && newState.treasury > 0) {
        newState.players[playerIndex].money += 1;
        newState.treasury -= 1;
        newState = logAction(newState, `${newState.players[playerIndex].name} takes Income (+1 coin).`);
    }
     return advanceTurn(newState);
}

function performForeignAid(gameState: GameState, playerId: string): GameState {
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
         newState = triggerAIResponses(newState);
    } else {
        // No one can block, action succeeds immediately
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
         if (playerIndex !== -1) {
            const amount = Math.min(2, newState.treasury);
             newState.players[playerIndex].money += amount;
             newState.treasury -= amount;
             newState = logAction(newState, `${player.name}'s Foreign Aid succeeds (+${amount} coins).`);
         }
         newState = advanceTurn(newState);
    }
     return newState;
}


function performCoup(gameState: GameState, playerId: string, targetId: string): GameState {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const target = getPlayerById(newState, targetId);

    if (player && target && player.money >= 7) {
        player.money -= 7;
        newState.treasury += 7; // Or handle differently if coins are just removed
        newState = logAction(newState, `${player.name} performs a Coup against ${target.name}.`);

        // Coup cannot be challenged or blocked, target must reveal influence
        const { newState: revealedState } = revealInfluence(newState, targetId);
        newState = revealedState;

    } else {
        newState = logAction(newState, `${player?.name || 'Player'} cannot perform Coup (not enough money or invalid target).`);
    }
     return advanceTurn(newState);
}

function performTax(gameState: GameState, playerId: string): GameState {
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
        newState = triggerAIResponses(newState);
    } else {
        // No challengers, action succeeds
        const amount = Math.min(3, newState.treasury);
        const playerIndex = newState.players.findIndex(p => p.id === playerId);
        if(playerIndex !== -1){
            newState.players[playerIndex].money += amount;
            newState.treasury -= amount;
            newState = logAction(newState, `${player.name}'s Tax succeeds (+${amount} coins).`);
        }
        newState = advanceTurn(newState);
    }
    return newState;
}


function performAssassinate(gameState: GameState, playerId: string, targetId: string): GameState {
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
         newState = triggerAIResponses(newState);
    } else {
        // No one can challenge or block, assassination proceeds
        player.money -= 3;
        newState.treasury += 3;
        newState = logAction(newState, `${player.name}'s Assassination attempt proceeds.`);
        const { newState: revealedState } = revealInfluence(newState, targetId);
        newState = revealedState;
        newState = advanceTurn(newState);
    }
     return newState;
}

function performSteal(gameState: GameState, playerId: string, targetId: string): GameState {
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
         newState = triggerAIResponses(newState);
    } else {
        // No one can challenge or block, steal succeeds
        const amount = Math.min(2, target.money);
        player.money += amount;
        target.money -= amount;
        newState = logAction(newState, `${player.name} successfully Steals ${amount} coins from ${target.name}.`);
        newState = advanceTurn(newState);
    }
     return newState;
}


function performExchange(gameState: GameState, playerId: string): GameState {
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
        newState = triggerAIResponses(newState);
    } else {
        // No challengers, exchange proceeds
        newState = initiateExchange(newState, player);
        // Turn doesn't advance until exchange is complete
    }
    return newState;
}

function initiateExchange(gameState: GameState, player: Player): GameState {
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
        newState = handleAIExchange(newState);
    }
    // If player is human, UI needs to present choice

    return newState;
}

function completeExchange(gameState: GameState, playerId: string, cardsToKeep: CardType[]): GameState {
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

    const cardsToReturn = exchangeInfo.cardsToChoose.filter(card => !cardsToKeep.includes(card) || cardsToKeep.splice(cardsToKeep.indexOf(card), 1).length === 0); // Handle duplicates

    // Update player influence
    const revealedInfluence = newState.players[playerIndex].influence.filter(c => c.revealed);
    newState.players[playerIndex].influence = [
        ...revealedInfluence,
        ...cardsToKeep.map(type => ({ type, revealed: false }))
    ];

    // Return unused cards to deck
    let currentDeck = newState.deck;
    cardsToReturn.forEach(card => {
        currentDeck = returnCardToDeck(currentDeck, card);
    });
    newState.deck = currentDeck;

    newState = logAction(newState, `${newState.players[playerIndex].name} completed Exchange.`);
    newState.pendingExchange = null;

    return advanceTurn(newState);
}

// --- Challenge/Block Resolution ---

function resolveChallengeOrBlock(gameState: GameState): GameState {
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;
    if (!phase) return newState; // Should not happen

    const actionPlayer = phase.actionPlayer;
    const action = phase.action;
    const targetPlayer = phase.targetPlayer;

    const challenges = phase.responses.filter(r => r.response === 'Challenge');
    const blocks = phase.responses.filter(r => (r.response as BlockActionType).startsWith('Block'));

    if (challenges.length > 0) {
        // Handle Challenge first (only one challenge happens)
        const challengerId = challenges[0].playerId;
        const challenger = getPlayerById(newState, challengerId);
        newState = logAction(newState, `${challenger?.name || 'Player'} challenges ${actionPlayer.name}'s ${action}!`);
        newState = resolveChallenge(newState, actionPlayer.id, challengerId, action);
    } else if (blocks.length > 0) {
        // Handle Block (only one block happens, but it could be challenged)
        const blockerId = blocks[0].playerId;
        const blocker = getPlayerById(newState, blockerId);
        const blockType = blocks[0].response as BlockActionType;
        newState = logAction(newState, `${blocker?.name || 'Player'} blocks ${actionPlayer.name}'s ${action}!`);
        newState = resolveBlock(newState, actionPlayer, targetPlayer, blockerId, action, blockType);
    } else {
        // No challenges or blocks, action succeeds
        newState = logAction(newState, `No challenges or blocks. ${actionPlayer.name}'s ${action} succeeds.`);
        newState = executeSuccessfulAction(newState, actionPlayer, action, targetPlayer);
    }

    newState.challengeOrBlockPhase = null; // Clear the phase regardless of outcome
    return newState;
}


function resolveChallenge(gameState: GameState, challengedPlayerId: string, challengerId: string, action: ActionType): GameState {
    let newState = { ...gameState };
    const challengedPlayer = getPlayerById(newState, challengedPlayerId)!;
    const challenger = getPlayerById(newState, challengerId)!;

    const requiredCard = getCardForAction(action);

    if (!requiredCard) {
         newState = logAction(newState, `Error: Action ${action} cannot be challenged.`);
         newState.challengeOrBlockPhase = null;
         return advanceTurn(newState); // Or handle error
    }

    const hasCard = challengedPlayer.influence.some(c => c.type === requiredCard && !c.revealed);

    if (hasCard) {
        newState = logAction(newState, `${challengedPlayer.name} reveals ${requiredCard} to prove the challenge wrong.`);
        // Player reveals the specific card, shuffles it back, draws a new one.
        const playerIndex = newState.players.findIndex(p => p.id === challengedPlayerId);
        if (playerIndex !== -1) {
            const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === requiredCard && !c.revealed);
            if (cardIndex !== -1) {
                const revealedCard = newState.players[playerIndex].influence.splice(cardIndex, 1)[0];
                newState.deck = returnCardToDeck(newState.deck, revealedCard.type);
                const { card: newCard, remainingDeck } = drawCard(newState.deck);
                 newState.deck = remainingDeck;
                 if (newCard) {
                     newState.players[playerIndex].influence.push({ type: newCard, revealed: false });
                     newState = logAction(newState, `${challengedPlayer.name} draws a new card.`);
                 } else {
                     newState = logAction(newState, `${challengedPlayer.name} could not draw a new card (deck empty?).`);
                 }
            }
        }

        // Challenger loses influence
        newState = logAction(newState, `${challenger.name} loses the challenge and must reveal influence.`);
        const { newState: revealedState } = revealInfluence(newState, challengerId);
        newState = revealedState;

        // Original action proceeds if challenger didn't die
        if (getActivePlayers(newState).some(p => p.id === challengerId)) {
             newState = executeSuccessfulAction(newState, challengedPlayer, action, newState.challengeOrBlockPhase?.targetPlayer);
        } else {
             newState = logAction(newState, `${challenger.name} was eliminated by the challenge!`);
             // Check if this makes the challenged player win
             const winner = checkForWinner(newState);
             if (winner) newState.winner = winner;
             else newState = advanceTurn(newState); // If game not over, proceed
        }


    } else {
        newState = logAction(newState, `${challengedPlayer.name} cannot prove the challenge and loses influence.`);
        // Challenged player loses influence because they bluffed
        const { newState: revealedState } = revealInfluence(newState, challengedPlayerId);
        newState = revealedState;
        // Action fails, turn advances (unless challenged player was eliminated and game ends)
         if (getActivePlayers(newState).some(p => p.id === challengedPlayerId)) {
             newState = advanceTurn(newState);
        } else {
            newState = logAction(newState, `${challengedPlayer.name} was eliminated by the challenge!`);
            const winner = checkForWinner(newState);
            if (winner) newState.winner = winner;
            else newState = advanceTurn(newState);
        }

    }
    newState.challengeOrBlockPhase = null; // Challenge resolved
    return newState;
}


function resolveBlock(gameState: GameState, actionPlayer: Player, targetPlayer: Player | undefined, blockerId: string, action: ActionType, blockType: BlockActionType): GameState {
    let newState = { ...gameState };
    const blocker = getPlayerById(newState, blockerId)!;

     // Block is announced, now the original actionPlayer can challenge the block
     newState = logAction(newState, `${actionPlayer.name} can now challenge ${blocker.name}'s block.`);

     newState.challengeOrBlockPhase = {
         actionPlayer: blocker, // The blocker is now the one whose claim (block) can be challenged
         action: blockType as any, // Treat block as an action for challenge check
         targetPlayer: actionPlayer, // The target of the "block action" challenge is the original action player
         possibleResponses: [actionPlayer], // Only the original action player can challenge the block
         responses: [],
     };

     // If actionPlayer is AI, let it decide whether to challenge the block
     if (actionPlayer.isAI) {
          newState = triggerAIResponses(newState); // AI decides challenge vs block
     }
     // If actionPlayer is human, UI must prompt for challenge decision

     return newState; // State waits for challenge decision against the block
}

function resolveBlockChallenge(gameState: GameState, blockerId: string, challengerId: string, blockType: BlockActionType): GameState {
     let newState = { ...gameState };
     const blocker = getPlayerById(newState, blockerId)!;
     const challenger = getPlayerById(newState, challengerId)!; // Original action player

     newState = logAction(newState, `${challenger.name} challenges ${blocker.name}'s ${blockType}!`);

     const requiredCard = getCardForBlock(blockType);
     if (!requiredCard) {
        newState = logAction(newState, `Error: Block type ${blockType} is invalid.`);
        newState.challengeOrBlockPhase = null;
        return advanceTurn(newState); // Or handle error
     }

     const hasCard = blocker.influence.some(c => c.type === requiredCard && !c.revealed);

     if (hasCard) {
         newState = logAction(newState, `${blocker.name} reveals ${requiredCard} to prove the block challenge wrong.`);
         // Blocker reveals the card, shuffles it back, draws a new one.
         const playerIndex = newState.players.findIndex(p => p.id === blockerId);
        if (playerIndex !== -1) {
            const cardIndex = newState.players[playerIndex].influence.findIndex(c => c.type === requiredCard && !c.revealed);
            if (cardIndex !== -1) {
                const revealedCard = newState.players[playerIndex].influence.splice(cardIndex, 1)[0];
                newState.deck = returnCardToDeck(newState.deck, revealedCard.type);
                const { card: newCard, remainingDeck } = drawCard(newState.deck);
                 newState.deck = remainingDeck;
                 if (newCard) {
                     newState.players[playerIndex].influence.push({ type: newCard, revealed: false });
                     newState = logAction(newState, `${blocker.name} draws a new card.`);
                 } else {
                     newState = logAction(newState, `${blocker.name} could not draw a new card (deck empty?).`);
                 }
            }
        }

         // Challenger (original action player) loses influence
         newState = logAction(newState, `${challenger.name} loses the block challenge and must reveal influence.`);
          const { newState: revealedState } = revealInfluence(newState, challengerId);
         newState = revealedState;

         // Block succeeds, original action fails. Turn advances.
         newState = logAction(newState, `${blocker.name}'s block is successful. ${challenger.name}'s action is cancelled.`);
         newState = advanceTurn(newState);

     } else {
         newState = logAction(newState, `${blocker.name} cannot prove the block challenge and loses influence.`);
         // Blocker loses influence because they bluffed the block
         const { newState: revealedState } = revealInfluence(newState, blockerId);
         newState = revealedState;

         // Block fails, original action proceeds (if blocker didn't die)
         if (getActivePlayers(newState).some(p => p.id === blockerId)) {
              const originalAction = getActionFromBlock(blockType); // Need helper to get original action
              const originalTarget = newState.challengeOrBlockPhase?.targetPlayer; // Get original target if applicable
              if (originalAction) {
                 newState = logAction(newState, `${blocker.name}'s block fails. ${challenger.name}'s ${originalAction} proceeds.`);
                 newState = executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
              } else {
                  newState = logAction(newState, `Error retrieving original action for failed block.`);
                  newState = advanceTurn(newState);
              }
         } else {
              newState = logAction(newState, `${blocker.name} was eliminated by the block challenge!`);
              // Check if original action player wins now
               const winner = checkForWinner(newState);
               if (winner) newState.winner = winner;
               else {
                    // Original action proceeds as blocker is gone
                     const originalAction = getActionFromBlock(blockType);
                     const originalTarget = newState.challengeOrBlockPhase?.targetPlayer;
                     if(originalAction) {
                         newState = logAction(newState, `${challenger.name}'s ${originalAction} proceeds.`);
                         newState = executeSuccessfulAction(newState, challenger, originalAction, originalTarget);
                     } else {
                         newState = logAction(newState, `Error retrieving original action after blocker eliminated.`);
                         newState = advanceTurn(newState);
                     }
               }
         }
     }
     newState.challengeOrBlockPhase = null; // Block challenge resolved
     return newState;
}


function executeSuccessfulAction(gameState: GameState, player: Player, action: ActionType, target?: Player): GameState {
    let newState = { ...gameState };
    const playerIndex = newState.players.findIndex(p => p.id === player.id);
    const targetIndex = target ? newState.players.findIndex(p => p.id === target.id) : -1;

    switch (action) {
        case 'Foreign Aid':
             if (playerIndex !== -1) {
                const amount = Math.min(2, newState.treasury);
                newState.players[playerIndex].money += amount;
                newState.treasury -= amount;
                newState = logAction(newState, `${player.name}'s Foreign Aid succeeds (+${amount} coins).`);
            }
            newState = advanceTurn(newState);
            break;
        case 'Tax':
            if (playerIndex !== -1) {
                const amount = Math.min(3, newState.treasury);
                newState.players[playerIndex].money += amount;
                newState.treasury -= amount;
                newState = logAction(newState, `${player.name}'s Tax succeeds (+${amount} coins).`);
            }
             newState = advanceTurn(newState);
            break;
        case 'Assassinate':
             if (playerIndex !== -1 && targetIndex !== -1) {
                 if (newState.players[playerIndex].money >= 3) {
                     newState.players[playerIndex].money -= 3;
                     newState.treasury += 3;
                     newState = logAction(newState, `${player.name}'s Assassination against ${newState.players[targetIndex].name} succeeds.`);
                     const { newState: revealedState } = revealInfluence(newState, newState.players[targetIndex].id);
                     newState = revealedState;
                 } else {
                      newState = logAction(newState, `${player.name} cannot complete Assassination (not enough money).`); // Should have been caught earlier
                 }
             }
              newState = advanceTurn(newState);
             break;
        case 'Steal':
            if (playerIndex !== -1 && targetIndex !== -1) {
                 const amount = Math.min(2, newState.players[targetIndex].money);
                 newState.players[playerIndex].money += amount;
                 newState.players[targetIndex].money -= amount;
                 newState = logAction(newState, `${player.name} successfully Steals ${amount} coins from ${newState.players[targetIndex].name}.`);
             }
              newState = advanceTurn(newState);
            break;
        case 'Exchange':
            newState = initiateExchange(newState, player);
             // Turn advances after exchange completion
            break;
        // Income and Coup are handled directly and don't go through challenge phase
        default:
             newState = logAction(newState, `Action ${action} completed successfully.`);
             newState = advanceTurn(newState); // Should already be handled by calling function? Double check needed.
    }

    return newState;
}


function advanceTurn(gameState: GameState): GameState {
    let newState = { ...gameState };
    const winner = checkForWinner(newState);
    if (winner) {
        newState.winner = winner;
        newState = logAction(newState, `${winner.name} has won the game!`);
        return newState;
    }

    newState.currentAction = null;
    newState.challengeOrBlockPhase = null;
    newState.pendingExchange = null;
    newState.currentPlayerIndex = getNextPlayerIndex(newState.currentPlayerIndex, newState.players);
    newState = logAction(newState, `--- ${newState.players[newState.currentPlayerIndex].name}'s turn ---`);

    // If the new current player is AI, trigger their action
    if (newState.players[newState.currentPlayerIndex].isAI) {
       return handleAIAction(newState);
    }

    return newState;
}

function getCardForAction(action: ActionType): CardType | null {
    switch (action) {
        case 'Tax': return 'Duke';
        case 'Assassinate': return 'Assassin';
        case 'Steal': return 'Captain';
        case 'Exchange': return 'Ambassador';
        default: return null; // Income, Foreign Aid, Coup cannot be challenged based on card
    }
}

function getCardForBlock(block: BlockActionType): CardType | null {
    switch (block) {
        case 'Block Foreign Aid': return 'Duke';
        case 'Block Stealing': return 'Ambassador'; // Or Captain
        case 'Block Assassination': return 'Contessa';
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
    const actions: ActionType[] = ['Income', 'Foreign Aid'];
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
    description += `You are ${getPlayerById(gameState, aiPlayerId)?.name}.\n`;
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
          description += `Challenge/Block Phase: ${gameState.challengeOrBlockPhase.actionPlayer.name}'s ${gameState.challengeOrBlockPhase.action} is being considered. Possible responses from: ${gameState.challengeOrBlockPhase.possibleResponses.map(p => p.name).join(', ')}.\n`;
     }
     if(gameState.pendingExchange) {
          description += `Pending Exchange: ${gameState.pendingExchange.player.name} is choosing cards.\n`;
     }
    description += `Action Log:\n${gameState.actionLog.slice(-5).join('\n')}\n`; // Last 5 log entries
    return description;
}


async function handleAIAction(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const aiPlayer = newState.players[newState.currentPlayerIndex];
    if (!aiPlayer || !aiPlayer.isAI) return newState; // Should not happen

    const availableActions = getAvailableActions(aiPlayer, newState);
    const opponentActions = newState.actionLog.slice(-3); // Simple recent history
    const gameStateDescription = generateGameStateDescription(newState, aiPlayer.id);

    try {
        const aiDecision = await selectAction({
            playerMoney: aiPlayer.money,
            playerInfluence: aiPlayer.influence.filter(c => !c.revealed).length,
            opponentActions,
            availableActions,
            gameState: gameStateDescription,
        });

        newState = logAction(newState, `AI (${aiPlayer.name}) Reasoning: ${aiDecision.reasoning}`);
        newState = logAction(newState, `AI (${aiPlayer.name}) chose action: ${aiDecision.action} ${aiDecision.target ? `targeting ${aiDecision.target}` : ''}`);


         // Find target player if needed
         let targetPlayer : Player | undefined = undefined;
         if (aiDecision.target) {
            // AI output might be name or ID, try to find based on name first
            targetPlayer = getActivePlayers(newState).find(p => p.name === aiDecision.target && p.id !== aiPlayer.id);
             if (!targetPlayer) { // Fallback if name matching fails or target is inactive/self
                 // Maybe AI provided ID? Or just pick a random active opponent?
                 const activeOpponents = getActivePlayers(newState).filter(p => p.id !== aiPlayer.id);
                 if(activeOpponents.length > 0) {
                     targetPlayer = activeOpponents[Math.floor(Math.random() * activeOpponents.length)];
                      newState = logAction(newState, `AI (${aiPlayer.name}) adjusted target to ${targetPlayer.name}.`);
                 } else {
                     newState = logAction(newState, `AI (${aiPlayer.name}) has no valid targets for ${aiDecision.action}. Choosing Income instead.`);
                     return performIncome(newState, aiPlayer.id); // Default safe action
                 }
             }
         }


        newState = performAction(newState, aiPlayer.id, aiDecision.action as ActionType, targetPlayer?.id);

    } catch (error) {
        console.error("AI action selection failed:", error);
        newState = logAction(newState, `AI (${aiPlayer.name}) encountered an error. Taking Income.`);
        newState = performIncome(newState, aiPlayer.id); // Fallback action
    }

    return newState;
}


async function triggerAIResponses(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;
    if (!phase) return newState;

    const aiResponders = phase.possibleResponses.filter(p => p.isAI);
    const gameStateDescription = generateGameStateDescription(newState, ''); // Provide general context

    for (const aiPlayer of aiResponders) {
         // Skip if AI already responded (e.g., due to async overlap - unlikely here but good practice)
        if(phase.responses.some(r => r.playerId === aiPlayer.id)) continue;

        let decision: GameResponseType = 'Allow'; // Default to allowing
        let reasoning = 'No reason to challenge or block.';

        const canChallenge = getCardForAction(phase.action) !== null; // Check if action itself is challengeable
        const canBlock =
            (phase.action === 'Foreign Aid' && aiPlayer.influence.some(c => !c.revealed && c.type === 'Duke')) || // Simplified check - AI *could* bluff
            (phase.action === 'Steal' && phase.targetPlayer?.id === aiPlayer.id && aiPlayer.influence.some(c => !c.revealed && (c.type === 'Captain' || c.type === 'Ambassador'))) ||
            (phase.action === 'Assassinate' && phase.targetPlayer?.id === aiPlayer.id && aiPlayer.influence.some(c => !c.revealed && c.type === 'Contessa'));

        // AI needs to decide between Challenge, Block (if applicable), or Allow

        // 1. Should AI challenge the action? (Only if action is challengeable)
        let challengeDecision = { shouldChallenge: false, reason: ""};
        if (canChallenge) {
            try {
                 challengeDecision = await aiChallengeReasoning({
                    action: phase.action,
                    currentPlayer: phase.actionPlayer.name,
                    targetPlayer: phase.targetPlayer?.name || '',
                    aiInfluence: aiPlayer.influence.filter(c => !c.revealed).map(c => c.type),
                    opponentInfluenceCount: phase.actionPlayer.influence.filter(c => !c.revealed).length,
                    gameState: generateGameStateDescription(newState, aiPlayer.id), // Context for this AI
                });
                 newState = logAction(newState, `AI (${aiPlayer.name}) Challenge Reasoning: ${challengeDecision.reason}`);
            } catch (error) {
                 console.error(`AI challenge reasoning failed for ${aiPlayer.name}:`, error);
                 newState = logAction(newState, `AI (${aiPlayer.name}) challenge reasoning error.`);
            }
        }


        // 2. Should AI block the action? (Only if action is blockable by AI)
        let blockDecision = { shouldBlock: false, reasoning: ""};
        const blockType = getBlockTypeForAction(phase.action); // Determine potential block type
         if (blockType && phase.targetPlayer?.id === aiPlayer.id) { // AI can only block if targetted or Foreign Aid
            try {
                 blockDecision = await aiBlockReasoning({
                     action: phase.action,
                     aiPlayerInfluence: aiPlayer.influence.filter(c => !c.revealed).length,
                     aiPlayerMoney: aiPlayer.money,
                     opponentInfluence: phase.actionPlayer.influence.filter(c => !c.revealed).length,
                     opponentMoney: phase.actionPlayer.money,
                     gameState: generateGameStateDescription(newState, aiPlayer.id),
                 });
                 newState = logAction(newState, `AI (${aiPlayer.name}) Block Reasoning: ${blockDecision.reasoning}`);
             } catch (error) {
                 console.error(`AI block reasoning failed for ${aiPlayer.name}:`, error);
                 newState = logAction(newState, `AI (${aiPlayer.name}) block reasoning error.`);
             }
         }


         // 3. Determine final AI response (Prioritize Challenge > Block > Allow)
         if (challengeDecision.shouldChallenge) {
             decision = 'Challenge';
             reasoning = challengeDecision.reason;
         } else if (blockType && phase.targetPlayer?.id === aiPlayer.id && blockDecision.shouldBlock) {
             decision = blockType; // Use the specific block type
             reasoning = blockDecision.reasoning;
         } else if (phase.action === 'Foreign Aid' && blockDecision.shouldBlock) {
              // Special case for blocking Foreign Aid (not targeted)
              decision = 'Block Foreign Aid';
              reasoning = blockDecision.reasoning;
         }


         newState = logAction(newState, `AI (${aiPlayer.name}) responds: ${decision}. ${reasoning}`);
         newState = handlePlayerResponse(newState, aiPlayer.id, decision);

         // If AI Challenged or Blocked, stop processing further AI responses for this phase
         if (decision !== 'Allow') {
            break;
         }
    }

    // After all AIs have had a chance (or one responded non-Allow), check if phase is resolved
    // This check might be redundant if handlePlayerResponse already resolves it
    if (newState.challengeOrBlockPhase && newState.challengeOrBlockPhase.responses.length === newState.challengeOrBlockPhase.possibleResponses.length) {
        newState = resolveChallengeOrBlock(newState);
    }


    return newState;
}

function getBlockTypeForAction(action: ActionType): BlockActionType | null {
    switch(action) {
        case 'Foreign Aid': return 'Block Foreign Aid';
        case 'Steal': return 'Block Stealing';
        case 'Assassinate': return 'Block Assassination';
        default: return null;
    }
}


async function handleAIExchange(gameState: GameState): Promise<GameState> {
    let newState = { ...gameState };
    const exchangeInfo = newState.pendingExchange;
     if (!exchangeInfo || !exchangeInfo.player.isAI) return newState; // Should not happen

     const aiPlayer = exchangeInfo.player;
     const cardsToChooseFrom = exchangeInfo.cardsToChoose;
     const cardsToKeepCount = aiPlayer.influence.filter(c => !c.revealed).length;

     // Basic AI: Keep the best cards based on a simple hierarchy or preference
     // TODO: Enhance this with LLM reasoning if desired
     const cardPreference: CardType[] = ['Duke', 'Contessa', 'Captain', 'Assassin', 'Ambassador']; // Example preference
     const sortedChoices = cardsToChooseFrom.sort((a, b) => cardPreference.indexOf(a) - cardPreference.indexOf(b));
     const cardsToKeep = sortedChoices.slice(0, cardsToKeepCount);

     newState = logAction(newState, `AI (${aiPlayer.name}) chooses cards for Exchange.`);
     newState = completeExchange(newState, aiPlayer.id, cardsToKeep);

     return newState;
}



// --- Public API ---

export function performAction(gameState: GameState, playerId: string, action: ActionType, targetId?: string): GameState {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);

    if (!player || player.id !== newState.players[newState.currentPlayerIndex].id) {
        return logAction(newState, "Not player's turn or player not found.");
    }
     if (newState.challengeOrBlockPhase || newState.pendingExchange || newState.winner) {
        return logAction(newState, "Cannot perform action during challenge/block phase, exchange, or after game end.");
    }

    const target = targetId ? getPlayerById(newState, targetId) : undefined;

    // Validate action based on player money etc.
    if (action === 'Coup' && player.money < 7) return logAction(newState, "Not enough money for Coup.");
    if (action === 'Assassinate' && player.money < 3) return logAction(newState, "Not enough money to Assassinate.");
    if (player.money >= 10 && action !== 'Coup') return logAction(newState, "Must perform Coup with 10 or more coins.");
     if ((action === 'Coup' || action === 'Assassinate' || action === 'Steal') && !target) return logAction(newState, `Action ${action} requires a target.`);
     if (target && !getActivePlayers(newState).some(p => p.id === target.id)) return logAction(newState, `Target ${target.name} is already eliminated.`);
     if (target && target.id === player.id) return logAction(newState, `Cannot target self with ${action}.`);


    newState.currentAction = { player, action, target };

    switch (action) {
        case 'Income':
            return performIncome(newState, playerId);
        case 'Foreign Aid':
            return performForeignAid(newState, playerId);
        case 'Coup':
            return performCoup(newState, playerId, targetId!);
        case 'Tax':
            return performTax(newState, playerId);
        case 'Assassinate':
            return performAssassinate(newState, playerId, targetId!);
        case 'Steal':
            return performSteal(newState, playerId, targetId!);
        case 'Exchange':
            return performExchange(newState, playerId);
        default:
            return logAction(newState, `Unknown action: ${action}`);
    }
}

export function handlePlayerResponse(gameState: GameState, respondingPlayerId: string, response: GameResponseType): GameState {
    let newState = { ...gameState };
    const phase = newState.challengeOrBlockPhase;

    if (!phase || !phase.possibleResponses.some(p => p.id === respondingPlayerId)) {
        return logAction(newState, `Invalid response: Not in challenge/block phase or player cannot respond.`);
    }

    // Check if player already responded
    if (phase.responses.some(r => r.playerId === respondingPlayerId)) {
        return logAction(newState, `${getPlayerById(newState, respondingPlayerId)?.name} has already responded.`);
    }

    const respondingPlayer = getPlayerById(newState, respondingPlayerId)!;

    phase.responses.push({ playerId: respondingPlayerId, response });
    newState = logAction(newState, `${respondingPlayer.name} responds: ${response}.`);


    // Resolve immediately if Challenge or Block is issued
    if (response === 'Challenge') {
         // If the challenge is against a block
         if (phase.action.startsWith('Block ')) {
              return resolveBlockChallenge(newState, phase.actionPlayer.id, respondingPlayerId, phase.action as BlockActionType);
         } else {
              // Challenge against a normal action
              return resolveChallenge(newState, phase.actionPlayer.id, respondingPlayerId, phase.action);
         }
    } else if (response.startsWith('Block')) {
        // A block was issued, now need to see if the original action player challenges the block
        return resolveBlock(newState, phase.actionPlayer, phase.targetPlayer, respondingPlayerId, phase.action, response as BlockActionType);
    }

    // If response is 'Allow' and all possible responders have responded, resolve the phase
    const allResponded = phase.possibleResponses.every(p => phase.responses.some(r => r.playerId === p.id));
    if (allResponded) {
         newState = resolveChallengeOrBlock(newState); // Resolve based on collected responses (should all be 'Allow' here)
    } else {
        // Still waiting for more responses. If remaining responders are AI, trigger them?
        const remainingResponders = phase.possibleResponses.filter(p => !phase.responses.some(r => r.playerId === p.id));
        if (remainingResponders.every(p => p.isAI)) {
           newState = triggerAIResponses(newState); // Trigger remaining AIs
        }
        // Otherwise, wait for human input
    }

    return newState;
}


export function handleExchangeSelection(gameState: GameState, playerId: string, cardsToKeep: CardType[]): GameState {
    let newState = { ...gameState };
    const player = getPlayerById(newState, playerId);
    const exchangeInfo = newState.pendingExchange;

    if (!player || player.id !== newState.players[newState.currentPlayerIndex].id) {
        return logAction(newState, "Not player's turn or player not found.");
    }
    if (!exchangeInfo || exchangeInfo.player.id !== playerId) {
        return logAction(newState, "Not in exchange phase for this player.");
    }

    return completeExchange(newState, playerId, cardsToKeep);
}

// Add a function to reveal influence when forced (e.g., losing a challenge, being Couped/Assassinated)
export function forceRevealInfluence(gameState: GameState, playerId: string, cardToReveal?: CardType): GameState {
     let newState = { ...gameState };
     const player = getPlayerById(newState, playerId);
     if (!player) return newState;

     const { newState: revealedState, revealedCard } = revealInfluence(newState, playerId, cardToReveal);
     newState = revealedState;

     if(revealedCard === null) {
         newState = logAction(newState, `${player.name} had no influence left to reveal.`);
     }

      // Check for winner after forced reveal
      const winner = checkForWinner(newState);
      if (winner) {
          newState.winner = winner;
          newState = logAction(newState, `${winner.name} has won the game!`);
      } else if (gameState.currentAction) {
           // If an action was in progress (like coup/assassinate), advance turn now
           // This check might be complex depending on exact flow.
           // Simplified: If someone was forced to reveal, and the game isn't over, advance.
           // Careful not to advance if reveal was part of challenge resolution that already advanced.
           // Maybe advanceTurn should be called more explicitly after coup/assassinate execution.
           // Re-evaluating: advanceTurn is called within performCoup/executeSuccessfulAction(Assassinate)
           // It should handle the post-reveal state correctly.
      }


     return newState;
}
