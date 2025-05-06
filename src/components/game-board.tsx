
'use client';

import type { GameState, Player, ActionType, InfluenceCard, CardType, GameResponseType, ChallengeDecisionType, BlockActionType } from '@/lib/game-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Coins, Swords, Shield, Handshake, Skull, Replace, HandCoins, CircleDollarSign, HelpCircle, Ban, Check, ShieldAlert, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import React, { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionSummaryDialog } from '@/components/action-summary-dialog'; // Import ActionSummaryDialog
import { cardInfo } from '@/lib/card-definitions';


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

const actionIcons: Record<ActionType, React.ReactNode> = {
    Income: <Coins className="w-4 h-4" />,
    'Foreign Aid': <Coins className="w-4 h-4" />,
    Coup: <Swords className="w-4 h-4" />,
    Tax: cardInfo.Duke.icon, // Use Duke icon for Tax
    Assassinate: cardInfo.Assassin.icon, // Use Assassin icon
    Steal: cardInfo.Captain.icon, // Use Captain icon
    Exchange: cardInfo.Ambassador.icon, // Use Ambassador icon
};

const InfluenceCardDisplay: React.FC<{ card: InfluenceCard; playerId: string; humanPlayerId: string }> = ({ card, playerId, humanPlayerId }) => {
  const isHumanPlayerCard = playerId === humanPlayerId;
  const cardType = card?.type;

  const displayType = (card?.revealed || isHumanPlayerCard) && cardType ? cardInfo[cardType].name : 'Oculto';
  const baseInfo = cardType ? cardInfo[cardType] : null;

  const showDetails = (card?.revealed || isHumanPlayerCard) && baseInfo;

  const bgColor = card?.revealed ? 'bg-muted opacity-60' : (showDetails && baseInfo ? baseInfo.color : 'bg-gray-500'); // Darker gray for hidden AI cards in light mode
  const textColor = card?.revealed ? 'text-muted-foreground line-through' : (showDetails ? 'text-primary-foreground' : 'text-gray-100'); // Lighter text for hidden AI cards

  const iconToShow = showDetails && baseInfo ? React.cloneElement(baseInfo.icon as React.ReactElement, { className: "w-10 h-10" }) : <HelpCircle className="w-10 h-10 text-muted-foreground" />;


  return (
    <div
      className={`flex flex-col items-center justify-between p-3 rounded-lg border-2 border-black shadow-lg w-28 h-40 text-center ${bgColor} ${textColor} transition-all duration-300 ease-in-out transform hover:scale-105`}
      title={displayType}
    >
      <div className="flex-grow flex items-center justify-center w-full mb-2">
        {iconToShow}
      </div>
      <span className="text-sm font-bold truncate w-full">{displayType}</span>
    </div>
  );
};


const PlayerInfo: React.FC<{ player: Player; isCurrentPlayer: boolean; humanPlayerId: string }> = ({ player, isCurrentPlayer, humanPlayerId }) => (
  <Card className={`mb-4 rounded-xl ${isCurrentPlayer ? 'border-primary border-4 shadow-2xl ring-4 ring-primary ring-opacity-50' : 'shadow-lg border-2 border-black'} ${player.influence.every(c => c.revealed) ? 'opacity-50 bg-muted' : 'bg-card'} transition-all duration-300`}>
    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 pt-4 px-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12 border-2 border-border">
           <AvatarImage src={`https://picsum.photos/seed/${player.id}/48/48`} data-ai-hint="player avatar"/>
           <AvatarFallback className="bg-primary text-primary-foreground font-bold">{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <CardTitle className="text-xl font-bold text-card-foreground">{player.name} {player.id === humanPlayerId ? <Badge variant="secondary" className="ml-1">Você</Badge> : (player.isAI ? <Badge variant="outline" className="ml-1">IA</Badge> : '')}</CardTitle>
      </div>
      <div className="text-2xl font-bold flex items-center text-card-foreground">
        <Coins className="w-7 h-7 mr-1.5 text-yellow-500" /> {player.money}
      </div>
    </CardHeader>
    <CardContent className="pt-3 pb-4 px-4">
      <div className="flex flex-row gap-3 justify-center mt-2">
        {player.influence.map((card, index) => (
          <InfluenceCardDisplay key={`${player.id}-influence-${index}`} card={card} playerId={player.id} humanPlayerId={humanPlayerId} />
        ))}
      </div>
       {player.influence.every(c => c.revealed) && <p className="text-base text-destructive mt-3 text-center font-extrabold tracking-wider uppercase">Eliminado</p>}
    </CardContent>
  </Card>
);


const ActionLog: React.FC<{ logs: string[] }> = ({ logs }) => (
  <Card className="h-64 bg-card border-2 border-black shadow-lg rounded-xl">
    <CardHeader className="pt-4 pb-2 px-4">
      <CardTitle className="text-xl text-card-foreground">Registro de Ações</CardTitle>
    </CardHeader>
    <CardContent className="h-full pb-4 px-4">
      <ScrollArea className="h-40 pr-4">
        {logs.slice().reverse().map((log, index) => (
          <p key={index} className="text-sm text-muted-foreground mb-1.5 leading-relaxed border-b border-border/50 pb-1">{log}</p>
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
        const activeOpponents = getActivePlayers(gameState).filter(p => p.id !== humanPlayerId && p.influence.some(inf => !inf.revealed));
        if (activeOpponents.length > 0) { // Can only Coup if targets exist
            possibleActions.push('Coup');
        } else { // No targets for Coup, can do other actions
            possibleActions.push('Income'); // Can still take income if no Coup targets
            // Add other non-target actions if desired, but Income is safest
        }
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {possibleActions.map(action => (
                    <Button
                        key={action}
                        onClick={() => handleActionClick(action)}
                        disabled={
                            (action === 'Coup' && humanPlayer.money < 7) ||
                            (action === 'Assassinate' && humanPlayer.money < 3) ||
                            (mustCoup && action !== 'Coup') || // Player must Coup if money >= 10 (and targets exist)
                            (actionsNeedingTarget.includes(action) && activeOpponents.length === 0)
                        }
                        variant={mustCoup && action !== 'Coup' ? 'outline' : 'default'}
                         className={`flex items-center justify-start gap-2 text-base py-3 pl-4 rounded-lg border-2 border-black shadow-md hover:shadow-lg transition-all duration-200 ${
                           mustCoup && action !== 'Coup' ? 'cursor-not-allowed opacity-60 bg-gray-400' : ''
                        }`} // Adjusted disabled style for light theme
                        size="lg"
                    >
                        <div className="w-5 h-5 flex items-center justify-center">
                            {React.cloneElement(actionIcons[action] as React.ReactElement, { className: "w-5 h-5" })}
                        </div>
                        <span className="flex-1 text-left font-semibold">{action}</span>
                         {action === 'Income' && <Badge variant="secondary" className="ml-auto">+1</Badge>}
                         {action === 'Foreign Aid' && <Badge variant="secondary" className="ml-auto">+2</Badge>}
                         {action === 'Coup' && <Badge variant="destructive" className="ml-auto">-7</Badge>}
                         {action === 'Tax' && <Badge variant="secondary" className="ml-auto">+3</Badge>}
                         {action === 'Assassinate' && <Badge variant="destructive" className="ml-auto">-3</Badge>}
                         {action === 'Steal' && <Badge variant="outline" className="ml-auto">vs</Badge>}
                         {action === 'Exchange' && <Badge variant="outline" className="ml-auto">Swap</Badge>}
                    </Button>
                ))}
            </div>

             <AlertDialog open={showTargetDialog} onOpenChange={setShowTargetDialog}>
                 <AlertDialogContent className="bg-background border-black text-foreground">
                     <AlertDialogHeader>
                         <AlertDialogTitle className="text-primary">Selecionar Alvo para {selectedAction}</AlertDialogTitle>
                         <AlertDialogDescription className="text-muted-foreground">
                             Escolha qual jogador será alvo da ação {selectedAction}.
                         </AlertDialogDescription>
                     </AlertDialogHeader>
                     <Select onValueChange={setSelectedTarget} value={selectedTarget}>
                         <SelectTrigger className="w-full bg-input border-black text-foreground">
                             <SelectValue placeholder="Selecione um jogador..." />
                         </SelectTrigger>
                         <SelectContent className="bg-popover border-black text-popover-foreground">
                             {activeOpponents.map(opponent => (
                                 <SelectItem key={opponent.id} value={opponent.id} className="hover:bg-accent focus:bg-accent">
                                     {opponent.name} ({opponent.money} moedas, {opponent.influence.filter(inf => !inf.revealed).length} influência)
                                 </SelectItem>
                             ))}
                         </SelectContent>
                     </Select>
                     <AlertDialogFooter>
                         <AlertDialogCancel onClick={handleTargetCancel} className="bg-muted hover:bg-muted/90 border-black text-muted-foreground">Cancelar</AlertDialogCancel>
                         <AlertDialogAction onClick={handleTargetConfirm} disabled={!selectedTarget} className="bg-primary hover:bg-primary/90 text-primary-foreground">
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
             title = "Desafiar ou Permitir?";
            promptText = `${claimer.name} alega ${claim}`;
            if (originalActionTarget) {
                promptText += ` mirando ${originalActionTarget.id === humanPlayerId ? 'Você' : originalActionTarget.name}.`;
            } else {
                promptText += ".";
            }
             promptText += " Você desafia a alegação ou permite a ação?";
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
             title = "Desafiar Bloqueio?";
            const blockerName = claimer.name; // In this stage, actionPlayer is the blocker
            const originalActionPlayerContext = gameState.currentAction?.player;
            const originalActionTakerName = originalActionPlayerContext?.name || 'Desconhecido';
             const originalAction = getActionFromBlock(claim as BlockActionType); // 'claim' here is the block action
             promptText = `${blockerName} alega ${claim} contra ${originalActionTakerName}'s ${originalAction || 'ação'}. Você desafia a alegação de ${blockerName}?`;
            break;
        default:
             promptText = `${claimer.name} alega ${claim}. O que você faz?`;
    }


    return (
        <Card className="mt-4 border-border border-4 shadow-lg bg-card rounded-xl p-5">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-xl text-primary">{title}</CardTitle>
                <CardDescription className="text-base text-card-foreground">{promptText}</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex gap-3 justify-center flex-wrap">
                 {validResponses.includes('Allow') && (
                    <Button onClick={() => onResponse('Allow')} variant="secondary" size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground border-black border-2">
                        <Check className="w-5 h-5 mr-2" /> Permitir
                    </Button>
                 )}
                 {validResponses.includes('Challenge') && (
                     <Button onClick={() => onResponse('Challenge')} variant="destructive" size="lg" className="bg-destructive hover:bg-destructive/90 text-destructive-foreground border-black border-2">
                         <HelpCircle className="w-5 h-5 mr-2" /> Desafiar
                     </Button>
                 )}
                 {validResponses.filter(r => r.startsWith('Block')).map(blockResponse => (
                     <Button key={blockResponse} onClick={() => onResponse(blockResponse as GameResponseType)} variant="outline" size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground border-black border-2">
                         <Ban className="w-5 h-5 mr-2" /> {blockResponse}
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
        <Card className="mt-4 border-secondary border-4 shadow-lg bg-card rounded-xl p-5">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-xl text-secondary">Trocar Cartas</CardTitle>
                <CardDescription className="text-base text-card-foreground">Escolha {currentInfluenceCount} carta(s) para manter. O resto será devolvido ao baralho.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <div className="flex flex-wrap gap-3 justify-center mb-4">
                    {cardsToChooseFrom.map((card, originalIndex) => {
                         const isSelected = selectedIndices.includes(originalIndex);
                         const info = card ? cardInfo[card] : null;
                         return (
                             <Button
                                key={`${card}-${originalIndex}`}
                                variant={isSelected ? 'default' : 'outline'}
                                onClick={() => handleCardToggle(originalIndex)}
                                 className={`flex items-center gap-2 text-base py-3 px-4 rounded-lg border-2 border-black ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/90'}`}
                                size="lg"
                              >
                                 {info ? React.cloneElement(info.icon as React.ReactElement, { className: "w-5 h-5" }) : <HelpCircle className="w-5 h-5"/>} {info?.name || 'Desconhecido'}
                              </Button>
                         );
                    })}
                </div>
                 <Button onClick={handleConfirm} disabled={!canConfirm} className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground border-black border-2" size="lg">
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

    // If only one unrevealed card, it's revealed automatically, so no prompt needed from UI.
    // The game logic should handle this forced reveal directly.
    if (unrevealedCards.length <= 1) {
        return null;
    }

    return (
        <Card className="mt-4 border-destructive border-4 shadow-lg bg-card rounded-xl p-5">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-xl text-destructive">Revelar Influência</CardTitle>
                <CardDescription className="text-base text-card-foreground">Você perdeu um desafio ou foi alvo de um Coup/Assassinato bem-sucedido. Escolha qual influência revelar.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex gap-3 justify-center">
                {unrevealedCards.map((card, index) => {
                     const info = card?.type ? cardInfo[card.type] : null;
                     return (
                         <Button key={index} onClick={() => card.type && onForceReveal(card.type)} variant="destructive" className="flex items-center gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground border-black border-2" size="lg" disabled={!card.type}>
                            {info ? React.cloneElement(info.icon as React.ReactElement, { className: "w-5 h-5" }) : <HelpCircle className="w-5 h-5"/>} Revelar {info?.name || 'Desconhecido'}
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
    // Try to get a friendly name for the action/block
    const actionOrBlockDisplayName = (typeof actionOrBlock === 'string' && (actionOrBlock.startsWith('Block ') || actionOrBlock === 'Challenge'))
                                        ? actionOrBlock
                                        : (cardInfo[actionOrBlock as CardType]?.name || actionOrBlock);


    if (!challenger) return null;

    return (
        <Card className="mt-4 border-orange-500 border-4 shadow-lg bg-card rounded-xl p-5">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-xl text-orange-500">Decisão de Desafio!</CardTitle>
                <CardDescription className="text-base text-card-foreground">
                    {challenger.name} desafiou sua alegação de {actionOrBlockDisplayName}.
                    Você quer prosseguir (revelar carta ou perder influência se estiver blefando) ou recuar (cancelar a ação/bloqueio)?
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex gap-3 justify-center">
                <Button onClick={() => onChallengeDecision('Proceed')} variant="default" size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground border-black border-2">
                    <ShieldCheck className="w-5 h-5 mr-2" /> Prosseguir
                </Button>
                <Button onClick={() => onChallengeDecision('Retreat')} variant="outline" size="lg" className="bg-muted hover:bg-muted/90 text-muted-foreground border-black border-2">
                    <ShieldAlert className="w-5 h-5 mr-2" /> Recuar
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
        <Card className="mt-4 border-destructive border-4 shadow-lg bg-card rounded-xl p-5">
            <CardHeader className="p-0 mb-4">
                <CardTitle className="text-xl text-destructive">Assassinato Bloqueado!</CardTitle>
                <CardDescription className="text-base text-card-foreground">
                    {contessaPlayer.name} alega Condessa para bloquear seu assassinato.
                    Você desafia a alegação de Condessa ou aceita o bloqueio (e a ação falha)?
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex gap-3 justify-center">
                <Button onClick={() => onAssassinationConfirmation('Challenge Contessa')} variant="destructive" size="lg" className="bg-destructive hover:bg-destructive/90 text-destructive-foreground border-black border-2">
                    <UserX className="w-5 h-5 mr-2" /> Desafiar Condessa
                </Button>
                <Button onClick={() => onAssassinationConfirmation('Accept Block')} variant="secondary" size="lg" className="bg-muted hover:bg-muted/90 text-muted-foreground border-black border-2">
                    <UserCheck className="w-5 h-5 mr-2" /> Aceitar Bloqueio
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
    const isHumanForcedToReveal = gameState.playerNeedsToReveal === humanPlayerId && (gameState.players.find(p => p.id === humanPlayerId)?.influence.filter(inf => !inf.revealed).length ?? 0) > 1;


    return (
        <div className="container mx-auto p-4 max-w-7xl ">
             {gameState.winner && (
                 <Card className="mb-6 bg-primary text-primary-foreground text-center py-6 rounded-xl border-4 border-black shadow-2xl">
                    <CardHeader className="p-0">
                        <CardTitle className="text-3xl font-bold">Fim de Jogo!</CardTitle>
                        <CardDescription className="text-2xl text-primary-foreground/90 mt-1">{gameState.winner.name} venceu!</CardDescription>
                    </CardHeader>
                 </Card>
             )}
            {/* Render ActionSummaryDialog - it positions itself */}
            <ActionSummaryDialog />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="md:col-span-1 space-y-6">
                     {humanPlayer && <PlayerInfo player={humanPlayer} isCurrentPlayer={gameState.players[gameState.currentPlayerIndex]?.id === humanPlayerId} humanPlayerId={humanPlayerId} />}
                     <ActionLog logs={gameState.actionLog} />
                 </div>

                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
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

            <div className="mt-8 max-w-2xl mx-auto"> {/* Center prompts/buttons */}
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

// Helper function to safely get active players
function getActivePlayers(gameState: GameState): Player[] {
   if (!gameState || !Array.isArray(gameState.players)) {
        console.error("[getActivePlayers] Error: Invalid gameState provided.");
        return [];
    }
    return gameState.players.filter(p => p.influence.some(card => !card.revealed));
}

