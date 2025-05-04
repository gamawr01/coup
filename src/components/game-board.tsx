'use client';

import type { GameState, Player, ActionType, InfluenceCard, CardType, GameResponseType, ChallengeDecisionType } from '@/lib/game-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Coins, Swords, Shield, Handshake, Skull, Replace, HandCoins, CircleDollarSign, HelpCircle, Ban, Check, ShieldAlert, ShieldCheck } from 'lucide-react'; // Added ShieldAlert, ShieldCheck
import React, { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface GameBoardProps {
  gameState: GameState;
  humanPlayerId: string;
  onAction: (action: ActionType, targetId?: string) => void;
  onResponse: (response: GameResponseType) => void;
  onExchange: (cardsToKeep: CardType[]) => void;
  onForceReveal: (cardToReveal: CardType) => void; // Needs card type
  onChallengeDecision: (decision: ChallengeDecisionType) => void; // Add this prop
}

// Mapping Card Types to Icons and Colors (adjust colors as needed)
const cardInfo: Record<CardType, { icon: React.ReactNode; color: string }> = {
  Duke: { icon: <CircleDollarSign className="w-4 h-4" />, color: 'bg-purple-600' },
  Assassin: { icon: <Skull className="w-4 h-4" />, color: 'bg-red-600' },
  Captain: { icon: <HandCoins className="w-4 h-4" />, color: 'bg-blue-600' },
  Ambassador: { icon: <Handshake className="w-4 h-4" />, color: 'bg-green-600' },
  Contessa: { icon: <Shield className="w-4 h-4" />, color: 'bg-yellow-600' },
};

const actionIcons: Record<ActionType, React.ReactNode> = {
    Income: <Coins className="w-4 h-4" />,
    'Foreign Aid': <Coins className="w-4 h-4" />, // Consider a different icon if needed
    Coup: <Swords className="w-4 h-4" />,
    Tax: <CircleDollarSign className="w-4 h-4" />,
    Assassinate: <Skull className="w-4 h-4" />,
    Steal: <HandCoins className="w-4 h-4" />,
    Exchange: <Replace className="w-4 h-4" />,
};

const InfluenceCardDisplay: React.FC<{ card: InfluenceCard; playerId: string; humanPlayerId: string }> = ({ card, playerId, humanPlayerId }) => {
  const isHumanPlayerCard = playerId === humanPlayerId;
  const displayType = card.revealed || isHumanPlayerCard ? card.type : 'Hidden';
  const bgColor = card.revealed ? 'bg-muted' : (isHumanPlayerCard ? cardInfo[card.type]?.color : 'bg-gray-700');
  const textColor = card.revealed ? 'text-muted-foreground line-through' : 'text-primary-foreground';
  const icon = card.revealed || isHumanPlayerCard ? cardInfo[card.type]?.icon : <HelpCircle className="w-4 h-4" />;

  return (
    <Badge variant="secondary" className={`flex items-center gap-1 px-2 py-1 ${bgColor} ${textColor}`}>
      {icon}
      <span className="text-xs">{displayType}</span>
    </Badge>
  );
};


const PlayerInfo: React.FC<{ player: Player; isCurrentPlayer: boolean; humanPlayerId: string }> = ({ player, isCurrentPlayer, humanPlayerId }) => (
  <Card className={`mb-4 ${isCurrentPlayer ? 'border-primary border-2 shadow-lg' : ''} ${player.influence.every(c => c.revealed) ? 'opacity-50' : ''}`}>
    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
      <CardTitle className="text-sm font-medium">{player.name} {player.id === humanPlayerId ? '(You)' : (player.isAI ? '(AI)' : '')}</CardTitle>
      <Avatar className="h-8 w-8">
         {/* Placeholder - replace with actual images if available */}
         <AvatarImage src={`https://picsum.photos/seed/${player.id}/40/40`} data-ai-hint="player avatar"/>
         <AvatarFallback>{player.name.substring(0, 1)}</AvatarFallback>
       </Avatar>
    </CardHeader>
    <CardContent>
      <div className="text-lg font-bold flex items-center">
        <Coins className="w-5 h-5 mr-2 text-yellow-400" /> {player.money}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {player.influence.map((card, index) => (
          <InfluenceCardDisplay key={index} card={card} playerId={player.id} humanPlayerId={humanPlayerId} />
        ))}
      </div>
       {player.influence.every(c => c.revealed) && <p className="text-xs text-destructive mt-1">Eliminated</p>}
    </CardContent>
  </Card>
);


const ActionLog: React.FC<{ logs: string[] }> = ({ logs }) => (
  <Card className="h-48">
    <CardHeader>
      <CardTitle className="text-lg">Action Log</CardTitle>
    </CardHeader>
    <CardContent className="h-full pb-6">
      <ScrollArea className="h-32 pr-4">
        {logs.slice().reverse().map((log, index) => (
          <p key={index} className="text-xs text-muted-foreground mb-1">{log}</p>
        ))}
      </ScrollArea>
    </CardContent>
  </Card>
);

const ActionButtons: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onAction: (action: ActionType, targetId?: string) => void;
}> = ({ gameState, humanPlayerId, onAction }) => {
    const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
    const [selectedTarget, setSelectedTarget] = useState<string | undefined>(undefined);
    const [showTargetDialog, setShowTargetDialog] = useState(false);

    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId);
    const isHumanTurn = gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId;
    const mustCoup = (humanPlayer?.money ?? 0) >= 10;

    // Don't show buttons if not human's turn, or waiting for response/exchange/decision/game over
    if (!isHumanTurn || !humanPlayer || gameState.challengeOrBlockPhase || gameState.pendingExchange || gameState.pendingChallengeDecision || gameState.winner) {
        return null;
    }

    const possibleActions: ActionType[] = ['Income', 'Foreign Aid'];
    if (!mustCoup) {
        if (humanPlayer.money >= 7) possibleActions.push('Coup');
        possibleActions.push('Tax');
        if (humanPlayer.money >= 3) possibleActions.push('Assassinate');
        possibleActions.push('Steal');
        possibleActions.push('Exchange');
    } else {
        possibleActions.push('Coup'); // Only Coup is allowed if money >= 10
    }


    const actionsNeedingTarget: ActionType[] = ['Coup', 'Assassinate', 'Steal'];
    const activeOpponents = gameState.players.filter(p => p.id !== humanPlayerId && p.influence.some(inf => !inf.revealed));

    const handleActionClick = (action: ActionType) => {
        if (actionsNeedingTarget.includes(action)) {
            setSelectedAction(action);
            setSelectedTarget(undefined); // Reset target selection
            setShowTargetDialog(true);
        } else {
            onAction(action);
        }
    };

     const handleTargetConfirm = () => {
        if (selectedAction && selectedTarget) {
            onAction(selectedAction, selectedTarget);
            setShowTargetDialog(false);
            setSelectedAction(null);
            setSelectedTarget(undefined);
        }
     };

    const handleTargetCancel = () => {
        setShowTargetDialog(false);
        setSelectedAction(null);
        setSelectedTarget(undefined);
    };


    return (
        <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4">
                {possibleActions.map(action => (
                    <Button
                        key={action}
                        onClick={() => handleActionClick(action)}
                        disabled={
                            (action === 'Coup' && humanPlayer.money < 7) ||
                            (action === 'Assassinate' && humanPlayer.money < 3) ||
                            (mustCoup && action !== 'Coup') ||
                            (actionsNeedingTarget.includes(action) && activeOpponents.length === 0)
                        }
                        variant={mustCoup && action !== 'Coup' ? 'outline' : 'default'}
                        className={`flex items-center justify-center gap-2 ${mustCoup && action !== 'Coup' ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                        {actionIcons[action]}
                        {action}
                         {action === 'Income' && ' (+1 coin)'}
                         {action === 'Foreign Aid' && ' (+2 coins)'}
                         {action === 'Coup' && ' (-7 coins)'}
                         {action === 'Tax' && ' (+3 coins)'}
                         {action === 'Assassinate' && ' (-3 coins)'}
                         {action === 'Steal' && ' (vs player)'}
                         {action === 'Exchange' && ' (cards)'}
                    </Button>
                ))}
            </div>

            {/* Target Selection Dialog */}
             <AlertDialog open={showTargetDialog} onOpenChange={setShowTargetDialog}>
                 <AlertDialogContent>
                     <AlertDialogHeader>
                         <AlertDialogTitle>Select Target for {selectedAction}</AlertDialogTitle>
                         <AlertDialogDescription>
                             Choose which player to target with the {selectedAction} action.
                         </AlertDialogDescription>
                     </AlertDialogHeader>
                     <Select onValueChange={setSelectedTarget} value={selectedTarget}>
                         <SelectTrigger className="w-full">
                             <SelectValue placeholder="Select a player..." />
                         </SelectTrigger>
                         <SelectContent>
                             {activeOpponents.map(opponent => (
                                 <SelectItem key={opponent.id} value={opponent.id}>
                                     {opponent.name} ({opponent.money} coins, {opponent.influence.filter(inf => !inf.revealed).length} influence)
                                 </SelectItem>
                             ))}
                         </SelectContent>
                     </Select>
                     <AlertDialogFooter>
                         <AlertDialogCancel onClick={handleTargetCancel}>Cancel</AlertDialogCancel>
                         <AlertDialogAction onClick={handleTargetConfirm} disabled={!selectedTarget}>
                             Confirm Target
                         </AlertDialogAction>
                     </AlertDialogFooter>
                 </AlertDialogContent>
             </AlertDialog>
        </>
    );
};


const ResponsePrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onResponse: (response: GameResponseType) => void;
}> = ({ gameState, humanPlayerId, onResponse }) => {
    const phase = gameState.challengeOrBlockPhase;
    // Check if it's the response phase AND it's for the human player AND they haven't responded yet
    if (!phase || !phase.possibleResponses.some(p => p.id === humanPlayerId) || phase.responses.some(r => r.playerId === humanPlayerId)) {
        return null;
    }

    // Also check if there's a pending challenge decision, if so, don't show this prompt
    if (gameState.pendingChallengeDecision) {
        return null;
    }

    const actionPlayer = phase.actionPlayer; // Player making the claim
    const actionOrBlock = phase.action; // The claim being made (action or block)
    const targetPlayer = phase.targetPlayer; // Original action target (if block)

    // Determine if the current claim is blockable by the human
    const originalActionType = actionOrBlock.startsWith('Block ') ? null : (actionOrBlock as ActionType);
    const blockTypeForOriginalAction = originalActionType ? getBlockTypeForAction(originalActionType) : null;
    const canBlockAction = blockTypeForOriginalAction &&
                           (originalActionType === 'Foreign Aid' || targetPlayer?.id === humanPlayerId);

    // Determine if the current claim is challengeable
    const canChallengeClaim = getCardForAction(actionOrBlock) !== null;

    let promptText = `${actionPlayer.name} claims ${actionOrBlock}`;
     if (actionOrBlock === 'Assassinate' || actionOrBlock === 'Steal' || actionOrBlock === 'Coup') {
        if (targetPlayer) {
             promptText += ` targeting ${targetPlayer.id === humanPlayerId ? 'You' : targetPlayer.name}.`;
        }
     } else if (actionOrBlock.startsWith('Block ')) {
          // The 'actionPlayer' is the blocker, 'targetPlayer' is the original action taker
          const blockerName = actionPlayer.name;
          const originalActionTaker = targetPlayer?.name || 'Unknown';
          const originalAction = getActionFromBlock(actionOrBlock as BlockActionType);
          promptText = `${blockerName} claims to block ${originalActionTaker}'s ${originalAction}.`;
     } else {
         promptText += '.';
     }
     promptText += " What do you do?";


    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Response Required!</CardTitle>
                <CardDescription>{promptText}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                <Button onClick={() => onResponse('Allow')} variant="secondary">
                    <Check className="w-4 h-4 mr-1" /> Allow
                </Button>
                {canChallengeClaim && (
                    <Button onClick={() => onResponse('Challenge')} variant="destructive">
                        <HelpCircle className="w-4 h-4 mr-1" /> Challenge Claim
                    </Button>
                )}
                {canBlockAction && blockTypeForOriginalAction && (
                    <Button onClick={() => onResponse(blockTypeForOriginalAction)} variant="outline">
                        <Ban className="w-4 h-4 mr-1" /> {blockTypeForOriginalAction}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
};

const ExchangePrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onExchange: (cardsToKeep: CardType[]) => void;
}> = ({ gameState, humanPlayerId, onExchange }) => {
    const exchangeInfo = gameState.pendingExchange;
    const player = gameState.players.find(p => p.id === humanPlayerId);

    if (!exchangeInfo || exchangeInfo.player.id !== humanPlayerId || !player) {
        return null;
    }

    const cardsToChooseFrom = exchangeInfo.cardsToChoose;
    const currentInfluenceCount = player.influence.filter(c => !c.revealed).length;
    const [selectedCards, setSelectedCards] = useState<CardType[]>([]);

    const handleCardToggle = (card: CardType) => {
        setSelectedCards(prev => {
            const cardIndex = prev.findIndex(c => c === card); // Find first instance
             if (cardIndex > -1) {
                 // Deselect: remove only the first instance found
                 const newSelection = [...prev];
                 newSelection.splice(cardIndex, 1);
                 return newSelection;
             } else if (prev.length < currentInfluenceCount) {
                // Select if not exceeding limit
                return [...prev, card];
            }
            return prev; // Limit reached, do nothing
        });
    };

    const canConfirm = selectedCards.length === currentInfluenceCount;

    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Exchange Cards</CardTitle>
                <CardDescription>Choose {currentInfluenceCount} card(s) to keep. The rest will be returned to the deck.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {cardsToChooseFrom.map((card, index) => {
                         // Count how many times this card type is already selected
                        const countSelected = selectedCards.filter(c => c === card).length;
                        // Count how many times this card type is available in total
                        const countAvailable = cardsToChooseFrom.filter(c => c === card).length;
                         // Determine if *this specific instance* of the card is selected
                         // This requires a more complex check or state structure if we need to differentiate identical cards visually
                         // For simplicity, we'll base 'selected' state on inclusion in the array
                         const isSelected = selectedCards.includes(card); // This might highlight all cards of the same type

                         return (
                             <Button
                                key={`${card}-${index}`} // Use index for unique key
                                variant={isSelected ? 'default' : 'outline'}
                                onClick={() => handleCardToggle(card)}
                                className="flex items-center gap-1"
                              >
                                 {cardInfo[card].icon} {card}
                              </Button>
                         );
                    })}
                </div>
                 <Button onClick={() => onExchange(selectedCards)} disabled={!canConfirm} className="w-full">
                     Confirm Selection
                 </Button>
            </CardContent>
        </Card>
    );
};

// Component to handle forced reveals (losing challenge, Coup, Assassination)
const ForcedRevealPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onForceReveal: (cardToReveal: CardType) => void; // Needs card type
}> = ({ gameState, humanPlayerId, onForceReveal }) => {
    // Determine if human player needs to reveal based on game logic flags (more robust)
    // This requires game logic to set a specific flag, e.g., `playerNeedsToReveal: playerId`
    // For now, we'll keep the simplified/less reliable log check as placeholder
    const player = gameState.players.find(p => p.id === humanPlayerId);
    const needsToReveal = player && player.influence.some(c => !c.revealed); // Player must have cards

    // Example of how a dedicated flag would work:
    // const needsToReveal = gameState.playerNeedsToReveal === humanPlayerId;

    // Placeholder log check (less reliable):
     const lastLog = gameState.actionLog[gameState.actionLog.length - 1] || "";
     const requiresHumanRevealBasedOnLog = player && player.influence.some(c => !c.revealed) &&
                                 (lastLog.includes(`${player.name} loses the challenge and must reveal influence`) ||
                                  lastLog.includes(`${player.name} loses the block challenge and must reveal influence`) ||
                                  lastLog.includes(`performs a Coup against ${player.name}`) || // Coup forces reveal *before* log usually
                                  lastLog.includes(`Assassination against ${player.name} succeeds`)); // Assassination forces reveal *before* log usually
                                  // We need a better flag in game state!

    // Combine checks (replace with proper flag check when implemented)
     if (!player || !requiresHumanRevealBasedOnLog) {
         return null;
     }

    const unrevealedCards = player.influence.filter(c => !c.revealed);

    // If only one card left, it should be revealed automatically by game logic usually.
    // This prompt is mainly for choosing *which* card when multiple are available.
    if (unrevealedCards.length <= 1) {
        // Game logic should handle auto-reveal for the last card.
        // If it gets here with 1 card, maybe call onForceReveal automatically?
        // useEffect(() => {
        //    if (unrevealedCards.length === 1) {
        //       onForceReveal(unrevealedCards[0].type);
        //    }
        // }, [unrevealedCards, onForceReveal]);
        return null; // Hide prompt if only 0 or 1 card left
    }

    return (
        <Card className="mt-4 border-destructive border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Reveal Influence</CardTitle>
                <CardDescription>You must reveal one of your influence cards.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                {unrevealedCards.map((card, index) => (
                    <Button key={index} onClick={() => onForceReveal(card.type)} variant="destructive" className="flex items-center gap-1">
                        {cardInfo[card.type].icon} Reveal {card.type}
                    </Button>
                ))}
            </CardContent>
        </Card>
    );
};

// New component for the challenge decision phase
const ChallengeDecisionPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onChallengeDecision: (decision: ChallengeDecisionType) => void;
}> = ({ gameState, humanPlayerId, onChallengeDecision }) => {
    const decisionPhase = gameState.pendingChallengeDecision;

    // Show only if it's the human player's turn to decide
    if (!decisionPhase || decisionPhase.challengedPlayerId !== humanPlayerId) {
        return null;
    }

    const challenger = gameState.players.find(p => p.id === decisionPhase.challengerId);
    const actionOrBlock = decisionPhase.actionOrBlock;

    if (!challenger) return null; // Safety check

    return (
        <Card className="mt-4 border-yellow-500 border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Challenge Decision!</CardTitle>
                <CardDescription>
                    {challenger.name} has challenged your claim of {actionOrBlock}.
                    Do you want to proceed (reveal card or lose influence if bluffing) or retreat (cancel the action/block)?
                </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                <Button onClick={() => onChallengeDecision('Proceed')} variant="default">
                    <ShieldCheck className="w-4 h-4 mr-1" /> Proceed
                </Button>
                <Button onClick={() => onChallengeDecision('Retreat')} variant="outline">
                    <ShieldAlert className="w-4 h-4 mr-1" /> Retreat
                </Button>
            </CardContent>
        </Card>
    );
};


export const GameBoard: React.FC<GameBoardProps> = ({ gameState, humanPlayerId, onAction, onResponse, onExchange, onForceReveal, onChallengeDecision }) => {
    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId);
    const otherPlayers = gameState.players.filter(p => p.id !== humanPlayerId);

    // Determine if the human player *needs* to act
    const isHumanTurn = gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId && !gameState.challengeOrBlockPhase && !gameState.pendingExchange && !gameState.pendingChallengeDecision && !gameState.winner;
    const isHumanResponding = gameState.challengeOrBlockPhase?.possibleResponses.some(p => p.id === humanPlayerId) && !gameState.challengeOrBlockPhase?.responses.some(r => r.playerId === humanPlayerId);
    const isHumanExchanging = gameState.pendingExchange?.player.id === humanPlayerId;
    const isHumanDecidingChallenge = gameState.pendingChallengeDecision?.challengedPlayerId === humanPlayerId;
    // Placeholder for forced reveal trigger
     const isHumanForcedToReveal = false; // Replace with actual flag check later


    return (
        <div className="container mx-auto p-4 max-w-4xl ">
             {gameState.winner && (
                 <Card className="mb-4 bg-primary text-primary-foreground">
                    <CardHeader>
                        <CardTitle className="text-center text-2xl">Game Over!</CardTitle>
                        <CardDescription className="text-center text-xl">{gameState.winner.name} wins!</CardDescription>
                    </CardHeader>
                 </Card>
             )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Player Info Area (Human) */}
                 <div className="md:col-span-1">
                     {humanPlayer && <PlayerInfo player={humanPlayer} isCurrentPlayer={gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId} humanPlayerId={humanPlayerId} />}
                     <ActionLog logs={gameState.actionLog} />
                 </div>

                {/* Opponent Info Area */}
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {otherPlayers.map(player => (
                         <PlayerInfo
                            key={player.id}
                            player={player}
                            isCurrentPlayer={gameState.players[gameState.currentPlayerIndex]?.id === player.id}
                            humanPlayerId={humanPlayerId}
                         />
                    ))}
                </div>


            </div>


             {/* Action/Response Area */}
            <div className="mt-6">
                {isHumanTurn && <ActionButtons gameState={gameState} humanPlayerId={humanPlayerId} onAction={onAction} />}
                {isHumanResponding && <ResponsePrompt gameState={gameState} humanPlayerId={humanPlayerId} onResponse={onResponse} />}
                 {isHumanDecidingChallenge && <ChallengeDecisionPrompt gameState={gameState} humanPlayerId={humanPlayerId} onChallengeDecision={onChallengeDecision} />}
                {isHumanExchanging && <ExchangePrompt gameState={gameState} humanPlayerId={humanPlayerId} onExchange={onExchange} />}
                {/* Add ForcedRevealPrompt here - Needs better logic trigger */}
                 {/* <ForcedRevealPrompt gameState={gameState} humanPlayerId={humanPlayerId} onForceReveal={onForceReveal} /> */}
            </div>
        </div>
    );
};

