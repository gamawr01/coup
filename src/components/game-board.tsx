'use client';

import type { GameState, Player, ActionType, InfluenceCard, CardType, GameResponseType } from '@/lib/game-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Coins, Swords, Shield, Handshake, Skull, Replace, HandCoins, CircleDollarSign, HelpCircle, Ban, Check } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface GameBoardProps {
  gameState: GameState;
  humanPlayerId: string;
  onAction: (action: ActionType, targetId?: string) => void;
  onResponse: (response: GameResponseType) => void;
  onExchange: (cardsToKeep: CardType[]) => void;
  onForceReveal: (cardToReveal?: CardType) => void; // Add this prop
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

    if (!isHumanTurn || !humanPlayer || gameState.challengeOrBlockPhase || gameState.pendingExchange || gameState.winner) {
        return null; // Don't show buttons if not human's turn, or waiting for response/exchange/game over
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
    if (!phase || !phase.possibleResponses.some(p => p.id === humanPlayerId) || phase.responses.some(r => r.playerId === humanPlayerId)) {
        return null; // Not in response phase for human, or human already responded
    }

    const actionPlayer = phase.actionPlayer;
    const action = phase.action;
    const targetPlayer = phase.targetPlayer; // Could be undefined (e.g., Foreign Aid)

    const canChallengeAction = action !== 'Income' && action !== 'Coup' && !action.startsWith('Block '); // Check if the original action can be challenged
    const canBlockAction =
        (action === 'Foreign Aid') || // Anyone can claim Duke
        (action === 'Steal' && targetPlayer?.id === humanPlayerId) || // Target can claim Captain/Ambassador
        (action === 'Assassinate' && targetPlayer?.id === humanPlayerId); // Target can claim Contessa

     const canChallengeBlock = action.startsWith('Block ') && phase.possibleResponses.some(p => p.id === humanPlayerId) // You are the one who can challenge the block


    let promptText = `${actionPlayer.name} is attempting to perform ${action}`;
    if (targetPlayer) {
        promptText += ` targeting ${targetPlayer.id === humanPlayerId ? 'You' : targetPlayer.name}.`;
    } else if (action === 'Foreign Aid') {
        promptText += '.';
    } else if (action.startsWith('Block ')) {
         // Adjust prompt for challenging a block
         const blockerName = actionPlayer.name; // The 'actionPlayer' in this context is the blocker
         const originalAction = phase.targetPlayer?.name || 'Unknown'; // The 'targetPlayer' here is the original action taker
         promptText = `${blockerName} is attempting to block ${originalAction}'s action. Do you want to challenge their block?`;
         // Reset flags for block/challenge action buttons below
         // canChallengeAction = false; // Cannot challenge the original action anymore
         // canBlockAction = false; // Cannot block the original action anymore
    }

    let blockType: GameResponseType | null = null;
    if (canBlockAction) {
        if (action === 'Foreign Aid') blockType = 'Block Foreign Aid';
        else if (action === 'Steal') blockType = 'Block Stealing';
        else if (action === 'Assassinate') blockType = 'Block Assassination';
    }


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
                {/* Show Challenge Action button only if the original action is challengeable */}
                {canChallengeAction && !action.startsWith('Block ') && (
                    <Button onClick={() => onResponse('Challenge')} variant="destructive">
                        <HelpCircle className="w-4 h-4 mr-1" /> Challenge Action
                    </Button>
                )}
                 {/* Show Challenge Block button only if a block is being challenged */}
                 {canChallengeBlock && action.startsWith('Block ') && (
                    <Button onClick={() => onResponse('Challenge')} variant="destructive">
                        <HelpCircle className="w-4 h-4 mr-1" /> Challenge Block
                    </Button>
                 )}
                 {/* Show Block button only if the original action is blockable by human */}
                {blockType && canBlockAction && !action.startsWith('Block ') && (
                    <Button onClick={() => onResponse(blockType)} variant="outline">
                        <Ban className="w-4 h-4 mr-1" /> {blockType}
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
            const index = prev.indexOf(card);
            if (index > -1) {
                // Deselect
                return prev.filter(c => c !== card);
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
                    {cardsToChooseFrom.map((card, index) => (
                         <Button
                            key={`${card}-${index}`} // Handle duplicate card types
                            variant={selectedCards.includes(card) ? 'default' : 'outline'}
                            onClick={() => handleCardToggle(card)}
                            className="flex items-center gap-1"
                          >
                             {cardInfo[card].icon} {card}
                          </Button>
                    ))}
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
    onForceReveal: (cardToReveal?: CardType) => void;
}> = ({ gameState, humanPlayerId, onForceReveal }) => {
     // Check if the human player needs to reveal an influence
     // This logic needs refinement. How do we signal *which* action caused the reveal?
     // For now, let's assume if it's human's turn AND they have revealed cards < total cards,
     // AND the log indicates they lost a challenge or were targeted, they might need to reveal.
     // THIS IS A HACKY WAY - Game logic should ideally have a specific state for this.
     const player = gameState.players.find(p => p.id === humanPlayerId);
     const needsToReveal = player && player.influence.some(c => !c.revealed) && player.influence.some(c => c.revealed) && player.influence.length > player.influence.filter(c => c.revealed).length; // Simplified check: Has both revealed and unrevealed cards

     // More robust check: Look at the log for specific triggers affecting the human player.
     const lastLog = gameState.actionLog[gameState.actionLog.length - 1] || "";
     const requiresHumanReveal = player && player.influence.some(c => !c.revealed) &&
                                 (lastLog.includes(`${player.name} loses the challenge and must reveal influence`) ||
                                  lastLog.includes(`${player.name} loses the block challenge and must reveal influence`) ||
                                  lastLog.includes(`performs a Coup against ${player.name}`) ||
                                  lastLog.includes(`Assassination against ${player.name} succeeds`));


    if (!requiresHumanReveal) {
        return null;
    }

    const unrevealedCards = player.influence.filter(c => !c.revealed);

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
                 {/* Add a button to reveal random if only one card left? */}
                 {unrevealedCards.length === 1 && (
                     <Button onClick={() => onForceReveal(unrevealedCards[0].type)} variant="destructive" className="flex items-center gap-1">
                       {cardInfo[unrevealedCards[0].type].icon} Reveal {unrevealedCards[0].type}
                     </Button>
                 )}
            </CardContent>
        </Card>
    );
};



export const GameBoard: React.FC<GameBoardProps> = ({ gameState, humanPlayerId, onAction, onResponse, onExchange, onForceReveal }) => {
    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId);
    const otherPlayers = gameState.players.filter(p => p.id !== humanPlayerId);

    // Determine if the human player *needs* to act (take turn, respond, exchange, reveal)
    const isHumanTurn = gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId && !gameState.challengeOrBlockPhase && !gameState.pendingExchange && !gameState.winner;
    const isHumanResponding = gameState.challengeOrBlockPhase?.possibleResponses.some(p => p.id === humanPlayerId) && !gameState.challengeOrBlockPhase?.responses.some(r => r.playerId === humanPlayerId);
    const isHumanExchanging = gameState.pendingExchange?.player.id === humanPlayerId;
     // This check for forced reveal needs improvement based on game state logic
    const isHumanForcedToReveal = false; // Replace with actual logic based on gamestate flag if possible


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
                {isHumanExchanging && <ExchangePrompt gameState={gameState} humanPlayerId={humanPlayerId} onExchange={onExchange} />}
                {/* Add ForcedRevealPrompt here - Need better logic trigger */}
                {/* <ForcedRevealPrompt gameState={gameState} humanPlayerId={humanPlayerId} onForceReveal={onForceReveal} /> */}
            </div>
        </div>
    );
};
