
'use client';

import type { GameState, Player, ActionType, InfluenceCard, CardType, GameResponseType, ChallengeDecisionType, BlockActionType } from '@/lib/game-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Coins, Swords, Shield, Handshake, Skull, Replace, HandCoins, CircleDollarSign, HelpCircle, Ban, Check, ShieldAlert, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface GameBoardProps {
  gameState: GameState;
  humanPlayerId: string;
  onAction: (action: ActionType, targetId?: string) => void;
  onResponse: (response: GameResponseType) => void;
  onExchange: (cardsToKeepIndices: number[]) => void;
  onForceReveal: (cardToReveal: CardType) => void;
  onChallengeDecision: (decision: ChallengeDecisionType) => void;
  onAssassinationConfirmation: (decision: 'Challenge Contessa' | 'Accept Block') => void;
}

const cardInfo: Record<CardType, { icon: React.ReactNode; color: string; name: string }> = {
  Duke: { icon: <CircleDollarSign />, color: 'bg-purple-600', name: 'Duque' },
  Assassin: { icon: <Skull />, color: 'bg-red-700', name: 'Assassino' },
  Captain: { icon: <HandCoins />, color: 'bg-blue-600', name: 'Capitão' },
  Ambassador: { icon: <Handshake />, color: 'bg-green-600', name: 'Embaixador' },
  Contessa: { icon: <Shield />, color: 'bg-yellow-500', name: 'Condessa' },
};

const actionIcons: Record<ActionType, React.ReactNode> = {
    Income: <Coins className="w-4 h-4" />,
    'Foreign Aid': <Coins className="w-4 h-4" />,
    Coup: <Swords className="w-4 h-4" />,
    Tax: <CircleDollarSign className="w-4 h-4" />,
    Assassinate: <Skull className="w-4 h-4" />,
    Steal: <HandCoins className="w-4 h-4" />,
    Exchange: <Replace className="w-4 h-4" />,
};

const InfluenceCardDisplay: React.FC<{ card: InfluenceCard; playerId: string; humanPlayerId: string }> = ({ card, playerId, humanPlayerId }) => {
  const isHumanPlayerCard = playerId === humanPlayerId;
  const cardType = card?.type;

  const displayType = (card?.revealed || isHumanPlayerCard) && cardType ? cardInfo[cardType].name : 'Oculto';
  const baseInfo = cardType ? cardInfo[cardType] : null;
  
  const showDetails = (card?.revealed || isHumanPlayerCard) && baseInfo;

  const bgColor = card?.revealed ? 'bg-muted opacity-60' : (showDetails && baseInfo ? baseInfo.color : 'bg-gray-700');
  const textColor = card?.revealed ? 'text-muted-foreground line-through' : (showDetails ? 'text-white' : 'text-gray-300');
  const iconToShow = showDetails && baseInfo ? baseInfo.icon : <HelpCircle />;

  return (
    <div 
      className={`flex flex-col items-center justify-between p-2 rounded-md border shadow-md w-20 h-28 text-center ${bgColor} ${textColor}`}
      title={displayType}
    >
      <div className="flex-grow flex items-center justify-center w-full">
        {React.cloneElement(iconToShow as React.ReactElement, { className: "w-8 h-8" })}
      </div>
      <span className="text-xs font-semibold mt-1 truncate w-full">{displayType}</span>
    </div>
  );
};


const PlayerInfo: React.FC<{ player: Player; isCurrentPlayer: boolean; humanPlayerId: string }> = ({ player, isCurrentPlayer, humanPlayerId }) => (
  <Card className={`mb-4 ${isCurrentPlayer ? 'border-primary border-2 shadow-xl' : 'shadow-md'} ${player.influence.every(c => c.revealed) ? 'opacity-60 bg-muted' : ''}`}>
    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
           <AvatarImage src={`https://picsum.photos/seed/${player.id}/40/40`} data-ai-hint="player avatar"/>
           <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <CardTitle className="text-sm font-medium">{player.name} {player.id === humanPlayerId ? '(Você)' : (player.isAI ? '(IA)' : '')}</CardTitle>
      </div>
      <div className="text-lg font-bold flex items-center">
        <Coins className="w-5 h-5 mr-1 text-yellow-400" /> {player.money}
      </div>
    </CardHeader>
    <CardContent className="pt-2">
      <div className="flex flex-row gap-2 justify-center mt-1">
        {player.influence.map((card, index) => (
          <InfluenceCardDisplay key={`${player.id}-influence-${index}`} card={card} playerId={player.id} humanPlayerId={humanPlayerId} />
        ))}
      </div>
       {player.influence.every(c => c.revealed) && <p className="text-xs text-destructive mt-2 text-center font-semibold">ELIMINADO</p>}
    </CardContent>
  </Card>
);


const ActionLog: React.FC<{ logs: string[] }> = ({ logs }) => (
  <Card className="h-48">
    <CardHeader>
      <CardTitle className="text-lg">Registro de Ações</CardTitle>
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

    if (!isHumanTurn || !humanPlayer || gameState.challengeOrBlockPhase || gameState.pendingExchange || gameState.pendingChallengeDecision || gameState.pendingAssassinationConfirmation || gameState.winner || gameState.playerNeedsToReveal) {
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
        possibleActions.push('Coup');
    }


    const actionsNeedingTarget: ActionType[] = ['Coup', 'Assassinate', 'Steal'];
    const activeOpponents = gameState.players.filter(p => p.id !== humanPlayerId && p.influence.some(inf => !inf.revealed));

    const handleActionClick = (action: ActionType) => {
        if (actionsNeedingTarget.includes(action)) {
            setSelectedAction(action);
            setSelectedTarget(undefined);
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

             <AlertDialog open={showTargetDialog} onOpenChange={setShowTargetDialog}>
                 <AlertDialogContent>
                     <AlertDialogHeader>
                         <AlertDialogTitle>Selecionar Alvo para {selectedAction}</AlertDialogTitle>
                         <AlertDialogDescription>
                             Escolha qual jogador será alvo da ação {selectedAction}.
                         </AlertDialogDescription>
                     </AlertDialogHeader>
                     <Select onValueChange={setSelectedTarget} value={selectedTarget}>
                         <SelectTrigger className="w-full">
                             <SelectValue placeholder="Selecione um jogador..." />
                         </SelectTrigger>
                         <SelectContent>
                             {activeOpponents.map(opponent => (
                                 <SelectItem key={opponent.id} value={opponent.id}>
                                     {opponent.name} ({opponent.money} moedas, {opponent.influence.filter(inf => !inf.revealed).length} influência)
                                 </SelectItem>
                             ))}
                         </SelectContent>
                     </Select>
                     <AlertDialogFooter>
                         <AlertDialogCancel onClick={handleTargetCancel}>Cancelar</AlertDialogCancel>
                         <AlertDialogAction onClick={handleTargetConfirm} disabled={!selectedTarget}>
                             Confirmar Alvo
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
    if (!phase || !phase.possibleResponses.some(p => p.id === humanPlayerId) || phase.responses.some(r => r.playerId === humanPlayerId) || gameState.pendingChallengeDecision || gameState.pendingAssassinationConfirmation) {
        return null;
    }


    const claimer = phase.actionPlayer;
    const claim = phase.action;
    const originalActionTarget = phase.targetPlayer;
    const stage = phase.stage || 'challenge_action';
    const validResponses = phase.validResponses || ['Challenge', 'Allow', 'Block Foreign Aid', 'Block Stealing', 'Block Assassination'];


    let promptText = "";
    let title = "Resposta Necessária!";

     switch (stage) {
        case 'challenge_action':
            promptText = `${claimer.name} alega ${claim}`;
            if (originalActionTarget) {
                promptText += ` mirando ${originalActionTarget.id === humanPlayerId ? 'Você' : originalActionTarget.name}.`;
            } else {
                promptText += ".";
            }
             promptText += " O que você faz?";
            break;
         case 'block_decision':
             title = "Bloquear ou Permitir?";
             if (claim === 'Assassinate') {
                promptText = `${claimer.name} está tentando te Assassinar. Você alega Condessa para bloquear, ou permite o assassinato?`;
             } else if (claim === 'Steal') {
                promptText = `${claimer.name} está tentando Roubar de Você. Você alega Capitão ou Embaixador para bloquear, ou permite o roubo?`;
             } else if (claim === 'Foreign Aid') {
                promptText = `${claimer.name} está tentando usar Ajuda Externa. Você alega Duque para bloquear, ou permite?`;
             }
              else {
                 promptText = `${claimer.name} está tentando ${claim} mirando Você. Você bloqueia ou permite?`;
             }
             break;
        case 'challenge_block':
            const blockerName = claimer.name;
            const originalActionTakerPlayer = gameState.currentAction?.player;
            const originalActionTakerName = originalActionTakerPlayer?.name || 'Desconhecido';
             const originalAction = getActionFromBlock(claim as BlockActionType);
             promptText = `${blockerName} alega ${claim} contra ${originalActionTakerName}'s ${originalAction}. Você desafia a alegação?`;
            break;
        default:
             promptText = `${claimer.name} alega ${claim}. O que você faz?`;
    }


    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{promptText}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center flex-wrap">
                 {validResponses.includes('Allow') && (
                    <Button onClick={() => onResponse('Allow')} variant="secondary">
                        <Check className="w-4 h-4 mr-1" /> Permitir
                    </Button>
                 )}
                 {validResponses.includes('Challenge') && (
                     <Button onClick={() => onResponse('Challenge')} variant="destructive">
                         <HelpCircle className="w-4 h-4 mr-1" /> Desafiar Alegação
                     </Button>
                 )}
                 {validResponses.filter(r => r.startsWith('Block')).map(blockResponse => (
                     <Button key={blockResponse} onClick={() => onResponse(blockResponse as GameResponseType)} variant="outline">
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
    onExchange: (cardsToKeepIndices: number[]) => void;
}> = ({ gameState, humanPlayerId, onExchange }) => {
    const exchangeInfo = gameState.pendingExchange;
    const player = gameState.players.find(p => p.id === humanPlayerId);

    if (!exchangeInfo || exchangeInfo.player.id !== humanPlayerId || !player) {
        return null;
    }

    const cardsToChooseFrom = exchangeInfo.cardsToChoose;
    const currentInfluenceCount = player.influence.filter(c => !c.revealed).length;
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

    const handleCardToggle = (index: number) => {
        setSelectedIndices(prev => {
            const isSelected = prev.includes(index);
             if (isSelected) {
                 return prev.filter(i => i !== index);
             } else if (prev.length < currentInfluenceCount) {
                return [...prev, index];
            }
            return prev;
        });
    };

    const canConfirm = selectedIndices.length === currentInfluenceCount;

    const handleConfirm = () => {
         if (canConfirm) {
            onExchange(selectedIndices);
         }
     };

    return (
        <Card className="mt-4 border-primary border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Trocar Cartas</CardTitle>
                <CardDescription>Escolha {currentInfluenceCount} carta(s) para manter. O resto será devolvido ao baralho.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {cardsToChooseFrom.map((card, index) => {
                         const isSelected = selectedIndices.includes(index);
                         const info = card ? cardInfo[card] : null;
                         return (
                             <Button
                                key={`${card}-${index}`} // Ensure unique key even with duplicate cards
                                variant={isSelected ? 'default' : 'outline'}
                                onClick={() => handleCardToggle(index)}
                                className="flex items-center gap-1"
                              >
                                 {info?.icon || <HelpCircle className="w-4 h-4"/>} {info?.name || 'Desconhecido'}
                              </Button>
                         );
                    })}
                </div>
                 <Button onClick={handleConfirm} disabled={!canConfirm} className="w-full">
                     Confirmar Seleção
                 </Button>
            </CardContent>
        </Card>
    );
};

const ForcedRevealPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onForceReveal: (cardToReveal: CardType) => void;
}> = ({ gameState, humanPlayerId, onForceReveal }) => {
    const needsToReveal = gameState.playerNeedsToReveal === humanPlayerId;
    const player = gameState.players.find(p => p.id === humanPlayerId);

    if (!needsToReveal || !player) {
         return null;
     }

    const unrevealedCards = player.influence.filter(c => !c.revealed);

    if (unrevealedCards.length <= 1) {
        return null;
    }

    return (
        <Card className="mt-4 border-destructive border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Revelar Influência</CardTitle>
                <CardDescription>Você deve revelar uma de suas cartas de influência.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                {unrevealedCards.map((card, index) => {
                     const info = card?.type ? cardInfo[card.type] : null;
                     return (
                         <Button key={index} onClick={() => card.type && onForceReveal(card.type)} variant="destructive" className="flex items-center gap-1" disabled={!card.type}>
                            {info?.icon || <HelpCircle className="w-4 h-4"/>} Revelar {info?.name || 'Desconhecido'}
                         </Button>
                     )
                })}
            </CardContent>
        </Card>
    );
};

const ChallengeDecisionPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onChallengeDecision: (decision: ChallengeDecisionType) => void;
}> = ({ gameState, humanPlayerId, onChallengeDecision }) => {
    const decisionPhase = gameState.pendingChallengeDecision;

    if (!decisionPhase || decisionPhase.challengedPlayerId !== humanPlayerId) {
        return null;
    }

    const challenger = gameState.players.find(p => p.id === decisionPhase.challengerId);
    const actionOrBlock = decisionPhase.actionOrBlock;
    const actionOrBlockDisplayName = typeof actionOrBlock === 'string' && actionOrBlock.startsWith('Block ') ? actionOrBlock : (cardInfo[actionOrBlock as CardType]?.name || actionOrBlock);


    if (!challenger) return null;

    return (
        <Card className="mt-4 border-yellow-500 border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Decisão de Desafio!</CardTitle>
                <CardDescription>
                    {challenger.name} desafiou sua alegação de {actionOrBlockDisplayName}.
                    Você quer prosseguir (revelar carta ou perder influência se estiver blefando) ou recuar (cancelar a ação/bloqueio)?
                </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                <Button onClick={() => onChallengeDecision('Proceed')} variant="default">
                    <ShieldCheck className="w-4 h-4 mr-1" /> Prosseguir
                </Button>
                <Button onClick={() => onChallengeDecision('Retreat')} variant="outline">
                    <ShieldAlert className="w-4 h-4 mr-1" /> Recuar
                </Button>
            </CardContent>
        </Card>
    );
};

const AssassinationConfirmationPrompt: React.FC<{
    gameState: GameState;
    humanPlayerId: string;
    onAssassinationConfirmation: (decision: 'Challenge Contessa' | 'Accept Block') => void;
}> = ({ gameState, humanPlayerId, onAssassinationConfirmation }) => {
    const confirmPhase = gameState.pendingAssassinationConfirmation;

    if (!confirmPhase || confirmPhase.assassinPlayerId !== humanPlayerId) {
        return null;
    }

    const contessaPlayer = gameState.players.find(p => p.id === confirmPhase.contessaPlayerId);

    if (!contessaPlayer) return null;

    return (
        <Card className="mt-4 border-orange-500 border-2 shadow-lg">
            <CardHeader>
                <CardTitle>Assassinato Bloqueado!</CardTitle>
                <CardDescription>
                    {contessaPlayer.name} alega Condessa para bloquear seu assassinato.
                    Você desafia a alegação de Condessa ou aceita o bloqueio?
                </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 justify-center">
                <Button onClick={() => onAssassinationConfirmation('Challenge Contessa')} variant="destructive">
                    <UserX className="w-4 h-4 mr-1" /> Desafiar Condessa
                </Button>
                <Button onClick={() => onAssassinationConfirmation('Accept Block')} variant="secondary">
                    <UserCheck className="w-4 h-4 mr-1" /> Aceitar Bloqueio
                </Button>
            </CardContent>
        </Card>
    );
};


export const GameBoard: React.FC<GameBoardProps> = ({ gameState, humanPlayerId, onAction, onResponse, onExchange, onForceReveal, onChallengeDecision, onAssassinationConfirmation }) => {
    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId);
    const otherPlayers = gameState.players.filter(p => p.id !== humanPlayerId);

    const isHumanTurn = gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId && !gameState.challengeOrBlockPhase && !gameState.pendingExchange && !gameState.pendingChallengeDecision && !gameState.pendingAssassinationConfirmation && !gameState.winner && !gameState.playerNeedsToReveal;
    const isHumanResponding = gameState.challengeOrBlockPhase?.possibleResponses.some(p => p.id === humanPlayerId) && !gameState.challengeOrBlockPhase?.responses.some(r => r.playerId === humanPlayerId) && !gameState.pendingChallengeDecision && !gameState.pendingAssassinationConfirmation;
    const isHumanExchanging = gameState.pendingExchange?.player.id === humanPlayerId;
    const isHumanDecidingChallenge = gameState.pendingChallengeDecision?.challengedPlayerId === humanPlayerId;
    const isHumanConfirmingAssassination = gameState.pendingAssassinationConfirmation?.assassinPlayerId === humanPlayerId;
    const isHumanForcedToReveal = gameState.playerNeedsToReveal === humanPlayerId;

    return (
        <div className="container mx-auto p-4 max-w-5xl ">
             {gameState.winner && (
                 <Card className="mb-4 bg-primary text-primary-foreground">
                    <CardHeader>
                        <CardTitle className="text-center text-2xl">Fim de Jogo!</CardTitle>
                        <CardDescription className="text-center text-xl">{gameState.winner.name} venceu!</CardDescription>
                    </CardHeader>
                 </Card>
             )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="md:col-span-1">
                     {humanPlayer && <PlayerInfo player={humanPlayer} isCurrentPlayer={gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId} humanPlayerId={humanPlayerId} />}
                     <ActionLog logs={gameState.actionLog} />
                 </div>

                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

function getActionFromBlock(block: BlockActionType): ActionType | null {
    switch (block) {
       case 'Block Foreign Aid': return 'Foreign Aid';
       case 'Block Stealing': return 'Steal';
       case 'Block Assassination': return 'Assassinate';
       default: return null;
   }
}

function getBlockTypeForAction(action: ActionType): BlockActionType | null {
     switch (action) {
        case 'Foreign Aid': return 'Block Foreign Aid';
        case 'Steal': return 'Block Stealing';
        case 'Assassinate': return 'Block Assassination';
        default: return null;
    }
}
