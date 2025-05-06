
/**
 * @fileOverview Implements the AI's strategic decision-making logic for the Coup game.
 */

import { GameState, Player, ActionType, BlockActionType, CardType, AllCards } from '@/lib/game-types';
import { getCardForAction } from '@/lib/game-logic'; // Import helper

/**
 * Interface for AI decision output, including confidence and reasoning.
 */
interface AIDecision<T> {
  decision: T;
  confidence: number; // Percentage confidence in the decision (0-100)
  reasoning: string; // Detailed reasoning for the decision
}

// Helper function to determine the current game phase (simple version)
function getGamePhase(gameState: GameState): 'start' | 'mid' | 'end' {
    const activePlayers = getActivePlayers(gameState).length;
    const initialPlayers = gameState.players.length;
    if (activePlayers <= 2 || initialPlayers - activePlayers >= initialPlayers / 2) {
        return 'end';
    } else if (initialPlayers - activePlayers >= 1) {
        return 'mid';
    } else {
        return 'start';
    }
}

// Helper function to get revealed cards for a specific player
function getRevealedCards(player: Player): CardType[] {
    return player.influence.filter(c => c.revealed).map(c => c.type);
}

/**
 * Determines the best action for the AI player to take based on the current game state.
 * @param gameState The current game state.
 * @param aiPlayer The AI player for whom to make the decision.
 * @returns An AIDecision object containing the chosen action, confidence, and reasoning.
 */
export function determineAIAction(gameState: GameState, aiPlayer: Player): AIDecision<ActionType> {
    const availableActions = getAvailableActions(aiPlayer, gameState);
    const gamePhase = getGamePhase(gameState);
    const activeOpponents = getActivePlayers(gameState).filter(p => p.id !== aiPlayer.id);
    const aiInfluenceCount = aiPlayer.influence.filter(c => !c.revealed).length;

    let bestAction: ActionType = 'Income'; // Default
    let highestConfidence = 0;
    let bestReasoning = 'Defaulting to Income as the safest baseline action.';

    // --- Action Prioritization & Strategic Considerations ---

    // 1. Must Coup? (Already handled by getAvailableActions)
    if (availableActions.length === 1 && availableActions[0] === 'Coup') {
        const target = activeOpponents[0]; // Target the first available opponent if forced
        return {
            decision: 'Coup',
            confidence: 100,
            reasoning: `Must perform Coup due to having ${aiPlayer.money} coins. Targeting ${target?.name || 'available opponent'}.`
        };
    }

    // 2. Consider Eliminating Weak Opponents
    const vulnerableOpponents = activeOpponents.filter(opp => opp.influence.filter(c => !c.revealed).length === 1);
    if (vulnerableOpponents.length > 0) {
        const target = vulnerableOpponents[0]; // Prioritize the first vulnerable opponent
        if (availableActions.includes('Coup') && aiPlayer.money >= 7) {
            const confidence = 95;
            if (confidence > highestConfidence) {
                highestConfidence = confidence;
                bestAction = 'Coup';
                bestReasoning = `Prioritizing Coup against vulnerable opponent ${target.name} (1 influence) to secure elimination. Confidence: ${confidence}%.`;
            }
        }
        if (availableActions.includes('Assassinate') && aiPlayer.money >= 3) {
             // Assassinate is riskier (can be blocked/challenged)
            const confidence = (gamePhase === 'end' || aiInfluenceCount > 1) ? 85 : 70;
            if (confidence > highestConfidence) {
                highestConfidence = confidence;
                bestAction = 'Assassinate';
                bestReasoning = `Prioritizing Assassinate against vulnerable opponent ${target.name} (1 influence). Confidence: ${confidence}%. Risk: Can be blocked/challenged.`;
            }
        }
    }

    // 3. Standard Action Evaluation based on Game Phase and AI State
    for (const action of availableActions) {
        let currentConfidence = 0;
        let currentReasoning = '';

        switch (action) {
            case 'Tax': // Claim Duke
                 // More confident if actually has Duke, or if need coins and bluff seems safe
                const hasDuke = aiPlayer.influence.some(c => !c.revealed && c.type === 'Duke');
                currentConfidence = hasDuke ? 90 : (gamePhase === 'start' ? 65 : 55); // Higher confidence early/if has card
                if (aiPlayer.money < 3) currentConfidence += 10; // More likely if needs coins
                currentReasoning = `Considering Tax (${hasDuke ? 'have Duke' : 'bluffing Duke'}). Confidence: ${currentConfidence}%. Need coins: ${aiPlayer.money < 3}.`;
                break;
            case 'Steal': // Claim Captain
                 const targetableOpponent = activeOpponents.find(opp => opp.money > 0);
                 if (targetableOpponent) {
                     const hasCaptain = aiPlayer.influence.some(c => !c.revealed && c.type === 'Captain');
                     currentConfidence = hasCaptain ? 85 : (gamePhase === 'start' ? 60 : 50);
                     if (targetableOpponent.money > aiPlayer.money) currentConfidence += 10;
                     currentReasoning = `Considering Steal from ${targetableOpponent.name} (${hasCaptain ? 'have Captain' : 'bluffing Captain'}). Confidence: ${currentConfidence}%. Target has more money: ${targetableOpponent.money > aiPlayer.money}.`;
                 } else {
                     currentReasoning = `Cannot Steal (no targets with money).`;
                 }
                break;
            case 'Exchange': // Claim Ambassador
                const hasAmbassador = aiPlayer.influence.some(c => !c.revealed && c.type === 'Ambassador');
                 // Good if needs better cards or wants info, riskier if low influence
                 currentConfidence = hasAmbassador ? 80 : (aiInfluenceCount > 1 ? 60 : 40);
                currentReasoning = `Considering Exchange (${hasAmbassador ? 'have Ambassador' : 'bluffing Ambassador'}). Confidence: ${currentConfidence}%. Current influence: ${aiInfluenceCount}.`;
                break;
            case 'Foreign Aid':
                 // Good early game, riskier later (block likely)
                 currentConfidence = (gamePhase === 'start' ? 75 : 50);
                 // Check if Duke block is likely (someone revealed Duke?)
                 const dukeRevealed = gameState.players.some(p => getRevealedCards(p).includes('Duke'));
                 if (dukeRevealed) currentConfidence -= 15;
                currentReasoning = `Considering Foreign Aid. Confidence: ${currentConfidence}%. Risk: Blockable by Duke (${dukeRevealed ? 'Duke revealed by someone' : 'Duke not revealed'}).`;
                break;
            case 'Income':
                currentConfidence = 40; // Baseline safe action
                currentReasoning = `Considering Income. Confidence: ${currentConfidence}%. Safest option, always succeeds.`;
                break;
             // Coup/Assassinate handled earlier for vulnerable targets, default confidence lower
             case 'Coup':
                  if (aiPlayer.money >= 7 && activeOpponents.length > 0) { // Ensure it's still possible
                     currentConfidence = 70; // General Coup confidence (overridden by priority target logic)
                     currentReasoning = `Considering Coup (general). Confidence: ${currentConfidence}%.`;
                  }
                 break;
             case 'Assassinate':
                  if (aiPlayer.money >= 3 && activeOpponents.length > 0) {
                      currentConfidence = 60; // General Assassinate confidence
                      currentReasoning = `Considering Assassinate (general). Confidence: ${currentConfidence}%.`;
                  }
                 break;
        }

        // Add random variation to avoid predictability (small amount)
        currentConfidence += Math.floor(Math.random() * 11) - 5; // +/- 5% randomness
        currentConfidence = Math.max(0, Math.min(100, currentConfidence)); // Clamp between 0-100

        if (currentConfidence > highestConfidence) {
            highestConfidence = currentConfidence;
            bestAction = action;
            bestReasoning = currentReasoning;
        }
    }

    // Final Decision Logging
    console.log(`[determineAIAction] AI: ${aiPlayer.name}, Phase: ${gamePhase}, Best Action: ${bestAction}, Confidence: ${highestConfidence}%, Reasoning: ${bestReasoning}`);

    return { decision: bestAction, confidence: highestConfidence, reasoning: bestReasoning };
}

/**
 * Determines whether the AI should challenge a player's action or block.
 * @param gameState The current game state.
 * @param aiPlayer The AI player for whom to make the decision.
 * @param actionOrBlock The action or block being claimed by the opponent.
 * @param opponent The player performing the action/block.
 * @param currentAction Optional: The original action context if challenging a block.
 * @returns An AIDecision object containing whether to challenge, confidence, and reasoning.
 */
export function determineAIChallenge(gameState: GameState, aiPlayer: Player, actionOrBlock: ActionType | BlockActionType, opponent: Player, currentAction?: GameState['currentAction']): AIDecision<boolean> {
    const gamePhase = getGamePhase(gameState);
    const aiInfluenceCount = aiPlayer.influence.filter(c => !c.revealed).length;
    const opponentInfluenceCount = opponent.influence.filter(c => !c.revealed).length;
    const opponentRevealedCards = getRevealedCards(opponent);
    const requiredCard = getCardForAction(actionOrBlock); // Card needed for the claim

    let shouldChallenge = false;
    let confidence = 0; // Confidence in *not* challenging initially
    let reasoning = 'Evaluating challenge... ';

    // --- Basic Checks ---
    if (!requiredCard) {
        reasoning += 'Claim cannot be challenged. ';
        return { decision: false, confidence: 100, reasoning: reasoning + "Decision: No Challenge." };
    }
    if (aiInfluenceCount === 0) {
         reasoning += 'AI is eliminated. ';
         return { decision: false, confidence: 100, reasoning: reasoning + "Decision: No Challenge." };
    }

    // --- Specific Assassination Challenge Logic (Rule 6 - if AI is target) ---
    const isTargetOfAssassination = currentAction?.action === 'Assassinate' && currentAction.target?.id === aiPlayer.id;
    if (actionOrBlock === 'Assassinate' && isTargetOfAssassination && aiInfluenceCount === 1) {
        reasoning += `AI has 1 influence and is target of Assassination. Prioritizing survival. Will not challenge Assassin claim. `;
        return { decision: false, confidence: 98, reasoning: reasoning + "Decision: No Challenge." };
    }


    // --- Coin Verification (Rule 1) ---
    let coinCheckPassed = true;
    let coinReasoning = '';
    if (currentAction && (actionOrBlock as ActionType) === currentAction.action) { // Check only if challenging original action claim
        const cost = currentAction.cost || 0;
        const opponentMoneyAfterAction = opponent.money; // Money is already updated in opponent object passed
        const opponentMoneyBeforeAction = opponentMoneyAfterAction + cost;

        if (cost > 0 && opponentMoneyBeforeAction < cost) {
            coinCheckPassed = false;
            coinReasoning = `Opponent had ${opponentMoneyBeforeAction} coins but needed ${cost} for ${actionOrBlock}. Possible bluff based on coins. `;
            confidence = 75; // Increase confidence in challenging
            shouldChallenge = true;
        } else if (cost > 0) {
            coinReasoning = `Opponent had ${opponentMoneyBeforeAction} coins, sufficient for ${actionOrBlock} (cost ${cost}). Coin check passed. `;
            confidence = 60; // Base confidence in not challenging if coins ok
        }
    } else {
         coinReasoning = 'Coin verification not applicable for this challenge (e.g., challenging a block or action with no cost). ';
         confidence = 50; // Neutral confidence if no coin check
    }
    reasoning += coinReasoning;

    // --- Memory of Revealed Cards (Rule 3) ---
    if (opponentRevealedCards.includes(requiredCard)) {
        reasoning += `Opponent previously revealed ${requiredCard}. `;
        return { decision: false, confidence: 100, reasoning: reasoning + "Decision: No Challenge." };
    }
    // Check alternate card for Steal block
     if (actionOrBlock === 'Block Stealing' && opponentRevealedCards.includes('Ambassador')) {
         reasoning += `Opponent previously revealed Ambassador (can block Steal). `;
         return { decision: false, confidence: 100, reasoning: reasoning + "Decision: No Challenge." };
     }

    // --- Risk Assessment (Rule 2 & 6) ---
    let riskFactor = 0; // 0 = neutral, positive = higher risk for AI, negative = lower risk
    if (aiInfluenceCount === 1) {
        riskFactor += 30; // High risk if AI has 1 influence
        reasoning += 'High risk (AI has 1 influence). ';
    }
    if (opponentInfluenceCount === 1) {
        riskFactor -= 20; // Lower risk (potential high reward: elimination)
        reasoning += 'High potential reward (Opponent has 1 influence). ';
    }
    if (opponent.money >= 7) {
        riskFactor += 10; // Slightly higher risk if opponent can Coup soon
        reasoning += `Opponent close to Coup (${opponent.money} coins). `;
    }

    // Adjust confidence based on risk
    confidence -= riskFactor;

    // --- Game Phase Adaptation (Rule 5) ---
    if (gamePhase === 'end' && aiInfluenceCount < opponentInfluenceCount) {
        confidence -= 15; // More likely to challenge if behind in late game
        reasoning += 'Late game and behind, increasing challenge likelihood. ';
    } else if (gamePhase === 'start') {
        confidence += 10; // Less likely to challenge early game
        reasoning += 'Early game, favoring caution. ';
    }

    // --- Opponent Style Adaptation (Rule 4 - Basic Placeholder) ---
    // TODO: Implement tracking opponent bluff frequency
    const opponentBluffFrequency = 0.5; // Placeholder: Assume 50% bluff rate
    confidence = confidence * (1 - opponentBluffFrequency) + (100 - confidence) * opponentBluffFrequency; // Adjust confidence based on assumed bluff rate
    reasoning += `Considering opponent style (Placeholder bluff rate: ${opponentBluffFrequency * 100}%). `;


    // --- Final Decision ---
    // Challenge if confidence in *opponent bluffing* is high enough (i.e., confidence in *not* challenging is low)
    const challengeThreshold = 45; // AI challenges if confidence in opponent *not* bluffing is below this %
    if (confidence < challengeThreshold && coinCheckPassed) { // Only challenge if coin check didn't already force it
        shouldChallenge = true;
    }

    // Clamp confidence
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    reasoning += `Confidence in opponent *not* bluffing: ${confidence}%. Challenge Threshold: ${challengeThreshold}%. Risk Factor: ${riskFactor}. Decision: ${shouldChallenge ? 'Challenge' : 'No Challenge'}.`;

    console.log(`[determineAIChallenge] AI: ${aiPlayer.name}, Opponent: ${opponent.name}, Claim: ${actionOrBlock}, Confidence(Not Bluffing): ${confidence}%, Risk: ${riskFactor}, ShouldChallenge: ${shouldChallenge}`);

    return { decision: shouldChallenge, confidence: shouldChallenge ? (100 - confidence) : confidence, reasoning: reasoning };
}


/**
 * Determines whether the AI should block a player's action.
 * @param gameState The current game state.
 * @param aiPlayer The AI player for whom to make the decision.
 * @param action The action being performed by the opponent.
 * @param opponent The player performing the action.
 * @returns An AIDecision object containing whether to block, confidence, and reasoning.
 */
export function determineAIBlock(gameState: GameState, aiPlayer: Player, action: ActionType, opponent: Player): AIDecision<boolean> {
    let shouldBlock = false;
    let confidence = 0;
    let reasoning = 'Evaluating block... ';
    let blockCard: CardType | null = null;

    if (action === 'Foreign Aid') {
        blockCard = 'Duke';
    } else if (action === 'Assassinate') {
        blockCard = 'Contessa';
    } else if (action === 'Steal') {
        blockCard = 'Captain'; // or Ambassador
    }

    if (!blockCard) {
         reasoning += 'Action cannot be blocked. ';
         return { decision: false, confidence: 100, reasoning: reasoning + "Decision: No Block." };
    }

    const hasBlockCard = aiPlayer.influence.some(card => !card.revealed && card.type === blockCard);
    const hasAltStealBlock = action === 'Steal' && aiPlayer.influence.some(card => !card.revealed && card.type === 'Ambassador');
    const canBlockTruthfully = hasBlockCard || hasAltStealBlock;
    const aiInfluenceCount = aiPlayer.influence.filter(c => !c.revealed).length;


    // --- Specific Assassination Block Logic ---
    if (action === 'Assassinate') {
        if (aiInfluenceCount === 1) {
            if (canBlockTruthfully) { // Has Contessa
                shouldBlock = true;
                confidence = 99; // Very high confidence, survival is key
                reasoning += `AI has 1 influence and Contessa. Must block Assassination. Confidence: ${confidence}%. Decision: Block.`;
            } else { // Has 1 influence, but not Contessa
                shouldBlock = false; // Cannot bluff block, too risky
                confidence = 100; // Confidence in *not* bluffing
                reasoning += `AI has 1 influence but no Contessa. Cannot bluff block Assassination. Confidence(Not Blocking): ${confidence}%. Decision: No Block.`;
            }
        } else { // AI has 2+ influence
            if (canBlockTruthfully) {
                shouldBlock = true;
                confidence = 95;
                reasoning += `Can truthfully block Assassination with Contessa. Confidence: ${confidence}%. Decision: Block.`;
            } else {
                // Consider bluffing Contessa if AI has 2+ influence
                reasoning += `Cannot block Assassination truthfully. Evaluating bluff... `;
                confidence = 30; // Lower confidence in bluffing a block
                reasoning += `Low confidence in bluffing Contessa block. Confidence(Not Bluffing): ${100-confidence}%. Decision: No Block.`;
            }
        }
    } else if (canBlockTruthfully) { // Standard block logic for other actions
        // Generally beneficial to block if possible, unless strategically bad
        shouldBlock = true;
        confidence = 95; // High confidence if holding the card
         reasoning += `Can truthfully block ${action} with ${hasBlockCard ? blockCard : 'Ambassador'}. Confidence: ${confidence}%. Decision: Block.`;
         if(action === 'Foreign Aid' && getGamePhase(gameState) === 'start') {
            // confidence -= 10; // Slightly less confident early game
            // reasoning += " (Slightly less confident early game).";
         }
    } else {
        // --- Consider Bluffing Block (Non-Assassination) ---
        reasoning += `Cannot block ${action} truthfully. Evaluating bluff... `;
        if (aiInfluenceCount <= 1) { // Already handled for Assassination
             reasoning += 'Cannot bluff block with 1 or less influence. ';
             confidence = 0; // Confidence in *not* bluffing block
             shouldBlock = false;
        } else {
            // Bluffing is risky. Generally avoid unless necessary.
            // Low confidence in bluffing block unless opponent seems unlikely to challenge.
            confidence = 20; // Low base confidence in bluffing a block
            shouldBlock = false;
            reasoning += `Low confidence in bluffing block. Confidence(Not Bluffing): ${100-confidence}%. `;
             // TODO: Add factors like opponent's challenge history if tracked
        }
         if (!shouldBlock) reasoning += "Decision: No Block.";
    }

     console.log(`[determineAIBlock] AI: ${aiPlayer.name}, Opponent Action: ${action}, CanBlockTruthfully: ${canBlockTruthfully}, Confidence: ${confidence}%, ShouldBlock: ${shouldBlock}`);

    return { decision: shouldBlock, confidence: shouldBlock ? confidence : (100 - confidence), reasoning: reasoning };
}

// Helper function to get available actions for a player (assuming it exists)
// (Ensure this function is correctly implemented or imported)
declare function getAvailableActions(player: Player, gameState: GameState): ActionType[];
// Helper function to get active players (assuming it exists)
declare function getActivePlayers(gameState: GameState): Player[];

    
    