'use client';

import type { GameState, Player, ActionType, InfluenceCard, CardType, GameResponseType, ChallengeDecisionType, BlockActionType } from '@/lib/game-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Coins, Swords, Shield, Handshake, Skull, Replace, HandCoins, CircleDollarSign, HelpCircle, Ban, Check, ShieldAlert, ShieldCheck, UserCheck, UserX } from 'lucide-react'; // Added ShieldAlert, ShieldCheck, UserCheck, UserX
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
  onAssassinationConfirmation: (decision: 'Challenge Contessa' | 'Accept Block') => void; // Add this prop
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

    // Don't show buttons if not human's turn, or waiting for response/exchange/decision/confirmation/game over
    if (!isHumanTurn || !humanPlayer || gameState.challengeOrBlockPhase || gameState.pendingExchange || gameState.pendingChallengeDecision || gameState.pendingAssassinationConfirmation || gameState.winner) {
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
    // Check if it's the response phase AND the human is one of the possible responders AND hasn't responded yet
    // AND ensure no other pending decision/confirmation is active
    if (!phase || !phase.possibleResponses.some(p => p.id === humanPlayerId) || phase.responses.some(r => r.playerId === humanPlayerId) || gameState.pendingChallengeDecision || gameState.pendingAssassinationConfirmation) {
        return null;
    }


    const claimer = phase.actionPlayer; // Player making the current claim (action or block)
    const claim = phase.action; // The action OR block being claimed
    const originalActionTarget = phase.targetPlayer; // Original action target (if applicable)
    const stage = phase.stage || 'challenge_action'; // Default to challenge_action if stage not set
    const validResponses = phase.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination']; // Use valid responses defined in the phase


    let promptText = "";
    let title = "Response Required!";

     switch (stage) {
        case 'challenge_action':
            // Someone claimed an action (e.g., Tax, Steal, Assassinate, Foreign Aid, Exchange)
            promptText = `${claimer.name} claims ${claim}`;
            if (originalActionTarget) {
                promptText += ` targeting ${originalActionTarget.id === humanPlayerId ? 'You' : originalActionTarget.name}.`;
            } else {
                promptText += ".";
            }
             promptText += " What do you do?";
            break;
         case 'block_decision':
             // Specifically for Assassination: Target (human) decides whether to block or allow
             title = "Block or Allow?";
             promptText = `${claimer.name} is attempting to Assassinate You. Do you claim Contessa to block, or allow the assassination?`;
             break;
        case 'challenge_block':
            // Someone claimed a block (e.g., Block Foreign Aid, Block Stealing, Block Assassination)
            const blockerName = claimer.name; // actionPlayer is the blocker in this stage
            const originalActionTakerPlayer = gameState.currentAction?.player; // Get original action taker from context
            const originalActionTakerName = originalActionTakerPlayer?.name || 'Unknown';
             const originalAction = getActionFromBlock(claim as BlockActionType); // Get the action that was blocked
             promptText = `${blockerName} claims to ${claim} against ${originalActionTakerName}'s ${originalAction}. Do you challenge their claim?`;
            break;
        default:
             promptText = `${claimer.name} claims ${claim}. What do you do?`; // Fallback
    }


    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{promptText}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center flex-wrap">
                 {/* Always show Allow if it's a valid response */}
                 {validResponses.includes('Allow') && (
                    <Button onClick={() => onResponse('Allow')} variant="secondary">
                        <Check className="w-4 h-4 mr-1" /> Allow
                    </Button>
                 )}
                 {/* Show Challenge if it's a valid response */}
                 {validResponses.includes('Challenge') && (
                     <Button onClick={() => onResponse('Challenge')} variant="destructive">
                         <HelpCircle className="w-4 h-4 mr-1" /> Challenge Claim
                     </Button>
                 )}
                 {/* Show relevant Block button(s) if valid */}
                 {validResponses.filter(r => r.startsWith('Block')).map(blockResponse => (
                     <Button key={blockResponse} onClick={() => onResponse(blockResponse)} variant="outline">
                         <Ban className="w-4 h-4 mr-1" /> {blockResponse}
                     </Button>
                 ))}
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
    // State now stores the indices of selected cards from the `cardsToChooseFrom` array
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

    const handleCardToggle = (index: number) => {
        setSelectedIndices(prev => {
            const isSelected = prev.includes(index);
             if (isSelected) {
                 // Deselect: remove the index
                 return prev.filter(i => i !== index);
             } else if (prev.length < currentInfluenceCount) {
                // Select if not exceeding limit
                return [...prev, index];
            }
            return prev; // Limit reached, do nothing
        });
    };

    const canConfirm = selectedIndices.length === currentInfluenceCount;

    // Map selected indices back to card types for the onExchange callback
    const handleConfirm = () => {
         if (canConfirm) {
            const cardsToKeep = selectedIndices.map(index => cardsToChooseFrom[index]);
            onExchange(cardsToKeep);
         }
     };

    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Exchange Cards</CardTitle>
                <CardDescription>Choose {currentInfluenceCount} card(s) to keep. The rest will be returned to the deck.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {cardsToChooseFrom.map((card, index) => {
                         const isSelected = selectedIndices.includes(index);
                         return (
                             <Button
                                key={index} // Use index as the unique key
                                variant={isSelected ? 'default' : 'outline'}
                                onClick={() => handleCardToggle(index)}
                                className="flex items-center gap-1"
                              >
                                 {cardInfo[card].icon} {card}
                              </Button>
                         );
                    })}
                </div>
                 <Button onClick={handleConfirm} disabled={!canConfirm} className="w-full">
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
    // Use the dedicated flag from game state
    const needsToReveal = gameState.playerNeedsToReveal === humanPlayerId;
    const player = gameState.players.find(p => p.id === humanPlayerId);

    if (!needsToReveal || !player) {
         return null;
     }

    const unrevealedCards = player.influence.filter(c => !c.revealed);

    // If only one card left, it should be revealed automatically by game logic usually.
     // Auto-reveal is handled in handleForceReveal now
    if (unrevealedCards.length <= 1) {
        return null; // Hide prompt if only 0 or 1 card left, logic handles it
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
    console.log("[ChallengeDecisionPrompt] Rendering. Phase:", decisionPhase, "Human ID:", humanPlayerId);


    // Show only if it's the human player's turn to decide
    if (!decisionPhase || decisionPhase.challengedPlayerId !== humanPlayerId) {
        return null;
    }

    const challenger = gameState.players.find(p => p.id === decisionPhase.challengerId);
    const actionOrBlock = decisionPhase.actionOrBlock;

    if (!challenger) return null; // Safety check

     console.log("[ChallengeDecisionPrompt] Displaying prompt for human.");

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

// New component for the Assassin's confirmation after Contessa block
const AssassinationConfirmationPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onAssassinationConfirmation: (decision: 'Challenge Contessa' | 'Accept Block') => void;
}> = ({ gameState, humanPlayerId, onAssassinationConfirmation }) => {
    const confirmPhase = gameState.pendingAssassinationConfirmation;
     console.log("[AssassinationConfirmationPrompt] Rendering. Phase:", confirmPhase, "Human ID:", humanPlayerId);

    // Show only if it's the human player's (Assassin) turn to confirm
    if (!confirmPhase || confirmPhase.assassinPlayerId !== humanPlayerId) {
        return null;
    }

    const contessaPlayer = gameState.players.find(p => p.id === confirmPhase.contessaPlayerId);

    if (!contessaPlayer) return null; // Safety check

    console.log("[AssassinationConfirmationPrompt] Displaying prompt for human Assassin.");

    return (
        <Card className="mt-4 border-orange-500 border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Assassination Blocked!</CardTitle>
                <CardDescription>
                    {contessaPlayer.name} claims Contessa to block your assassination.
                    Do you challenge their Contessa claim or accept the block?
                </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                <Button onClick={() => onAssassinationConfirmation('Challenge Contessa')} variant="destructive">
                    <UserX className="w-4 h-4 mr-1" /> Challenge Contessa
                </Button>
                <Button onClick={() => onAssassinationConfirmation('Accept Block')} variant="secondary">
                    <UserCheck className="w-4 h-4 mr-1" /> Accept Block
                </Button>
            </CardContent>
        </Card>
    );
};


export const GameBoard: React.FC<GameBoardProps> = ({ gameState, humanPlayerId, onAction, onResponse, onExchange, onForceReveal, onChallengeDecision, onAssassinationConfirmation }) => {
    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId);
    const otherPlayers = gameState.players.filter(p => p.id !== humanPlayerId);
     console.log("[GameBoard] Rendering. GameState:", gameState, "Human ID:", humanPlayerId); // Add top-level log


    // Determine if the human player *needs* to act
    const isHumanTurn = gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId && !gameState.challengeOrBlockPhase && !gameState.pendingExchange && !gameState.pendingChallengeDecision && !gameState.pendingAssassinationConfirmation && !gameState.winner;
    const isHumanResponding = gameState.challengeOrBlockPhase?.possibleResponses.some(p => p.id === humanPlayerId) && !gameState.challengeOrBlockPhase?.responses.some(r => r.playerId === humanPlayerId) && !gameState.pendingChallengeDecision && !gameState.pendingAssassinationConfirmation;
    const isHumanExchanging = gameState.pendingExchange?.player.id === humanPlayerId;
    const isHumanDecidingChallenge = gameState.pendingChallengeDecision?.challengedPlayerId === humanPlayerId;
    const isHumanConfirmingAssassination = gameState.pendingAssassinationConfirmation?.assassinPlayerId === humanPlayerId;
    const isHumanForcedToReveal = gameState.playerNeedsToReveal === humanPlayerId; // Use the direct flag

      // Log which prompt should be active
      console.log("[GameBoard] Active States:", {
         isHumanTurn,
         isHumanResponding,
         isHumanExchanging,
         isHumanDecidingChallenge,
         isHumanConfirmingAssassination,
         isHumanForcedToReveal
       });


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
                 {isHumanConfirmingAssassination && <AssassinationConfirmationPrompt gameState={gameState} humanPlayerId={humanPlayerId} onAssassinationConfirmation={onAssassinationConfirmation} />}
                {isHumanExchanging && <ExchangePrompt gameState={gameState} humanPlayerId={humanPlayerId} onExchange={onExchange} />}
                {isHumanForcedToReveal && <ForcedRevealPrompt gameState={gameState} humanPlayerId={humanPlayerId} onForceReveal={onForceReveal} />}
            </div>
        </div>
    );
};

// Helper to get original action if a block is claimed
function getActionFromBlock(block: BlockActionType): ActionType | null {
    switch (block) {
       case 'Block Foreign Aid': return 'Foreign Aid';
       case 'Block Stealing': return 'Steal';
       case 'Block Assassination': return 'Assassinate';
       default: return null;
   }
}

// Helper to find which block corresponds to an action
function getBlockTypeForAction(action: ActionType): BlockActionType | null {
     switch (action) {
        case 'Foreign Aid': return 'Block Foreign Aid';
        case 'Steal': return 'Block Stealing';
        case 'Assassinate': return 'Block Assassination';
        default: return null;
    }
}
