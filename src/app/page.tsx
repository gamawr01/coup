'use client';

import { useState, useEffect, useCallback } from 'react';
import { GameBoard } from '@/components/game-board';
import type { GameState, ActionType, CardType, GameResponseType } from '@/lib/game-types';
import { initializeGame, performAction, handlePlayerResponse, handleExchangeSelection, forceRevealInfluence } from '@/lib/game-logic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from "@/hooks/use-toast";

// Define constants for game setup
const DEFAULT_PLAYER_NAME = "Player 1";
const DEFAULT_AI_COUNT = 1;
const MIN_AI_COUNT = 1;
const MAX_AI_COUNT = 5; // Coup typically supports up to 6 players total

export default function Home() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [humanPlayerId, setHumanPlayerId] = useState<string>('player-0'); // Assuming human is always player 0 for now
  const [playerName, setPlayerName] = useState<string>(DEFAULT_PLAYER_NAME);
  const [aiCount, setAiCount] = useState<number>(DEFAULT_AI_COUNT);
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false); // To prevent duplicate actions

  const { toast } = useToast();

  const startGame = () => {
    if (playerName.trim() === "") {
        toast({ title: "Error", description: "Please enter a player name.", variant: "destructive" });
        return;
    }
    if (aiCount < MIN_AI_COUNT || aiCount > MAX_AI_COUNT) {
         toast({ title: "Error", description: `Number of AI players must be between ${MIN_AI_COUNT} and ${MAX_AI_COUNT}.`, variant: "destructive" });
         return;
    }
    const initialState = initializeGame([playerName], aiCount);
    setHumanPlayerId(initialState.players.find(p => !p.isAI)?.id || 'player-0'); // Find the actual human player ID
    setGameState(initialState);
    setGameStarted(true);
    toast({ title: "Game Started!", description: `Playing against ${aiCount} AI opponents.` });
  };

  // Unified state update function with logging and processing flag
 const updateGameState = useCallback(async (newStatePromise: GameState | Promise<GameState>) => {
    if (isProcessing) {
        console.warn("Attempted to update game state while already processing.");
        toast({ title: "Busy", description: "Please wait for the current action to complete.", variant: "destructive" });
        return;
    }
    setIsProcessing(true);
    try {
      console.log("Updating game state...");
      const newState = await newStatePromise; // Resolve promise if it's one
      console.log("New state received:", newState);
       setGameState(newState);

       // Check for winner after state update
        if (newState.winner) {
             toast({
               title: "Game Over!",
               description: `${newState.winner.name} wins!`,
               duration: 10000, // Keep winner message longer
             });
        } else if (newState.players[newState.currentPlayerIndex]?.isAI && !newState.challengeOrBlockPhase && !newState.pendingExchange) {
             // If it's now AI's turn and no pending actions, trigger AI
             // Add a small delay to allow UI to update before AI potentially updates state again quickly
              setTimeout(async () => {
                  console.log("Triggering AI action after state update...");
                  // Re-fetch the latest state before triggering AI to avoid race conditions
                  setGameState(currentState => {
                      if(currentState && currentState.players[currentState.currentPlayerIndex]?.isAI && !currentState.challengeOrBlockPhase && !currentState.pendingExchange && !currentState.winner) {
                          // Need to call the async logic handling AI turn directly from game-logic
                          // This requires handleAIAction to be exported or a wrapper function.
                          // Assuming performAction triggers AI if it's their turn (which it should)
                          // We might not need explicit trigger here if advanceTurn handles it.
                          // Let's refine this: The logic to trigger AI should be *inside* advanceTurn or state update handler.
                          // The `performAction` function itself calls `advanceTurn` which calls `handleAIAction`
                          // So, we likely don't need to explicitly call AI here. The state update *should* trigger it via useEffect dependency or direct call within logic.
                          console.log("AI turn detected, logic should handle it.");
                      }
                      return currentState; // Return current state to avoid modifying during re-fetch
                  });
                 // We previously had an explicit AI trigger here, but it might cause issues.
                 // Let's rely on the game logic's flow (advanceTurn -> handleAIAction).
                 // If AI turn doesn't trigger, investigate game-logic flow.
              }, 500); // 500ms delay
        }

    } catch (error) {
        console.error("Error updating game state:", error);
         toast({ title: "Error", description: "An error occurred processing the game state.", variant: "destructive" });
    } finally {
         console.log("Finished processing state update.");
        setIsProcessing(false);
    }
  }, [isProcessing, toast]); // Add dependencies


  const handlePlayerAction = useCallback((action: ActionType, targetId?: string) => {
      if (!gameState || isProcessing || gameState.winner) return;
      console.log(`Human action: ${action}`, targetId);
      updateGameState(performAction(gameState, humanPlayerId, action, targetId));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

  const handlePlayerResponse = useCallback((response: GameResponseType) => {
      if (!gameState || isProcessing || gameState.winner) return;
       console.log(`Human response: ${response}`);
       updateGameState(handlePlayerResponse(gameState, humanPlayerId, response));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

   const handlePlayerExchange = useCallback((cardsToKeep: CardType[]) => {
      if (!gameState || isProcessing || gameState.winner) return;
      console.log(`Human exchange selection: ${cardsToKeep.join(', ')}`);
      updateGameState(handleExchangeSelection(gameState, humanPlayerId, cardsToKeep));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

   // Placeholder for Forced Reveal - needs proper trigger logic
   const handleForceReveal = useCallback((cardToReveal?: CardType) => {
       if (!gameState || isProcessing || gameState.winner) return;
        console.log(`Human forced reveal: ${cardToReveal || 'auto'}`);
        // updateGameState(forceRevealInfluence(gameState, humanPlayerId, cardToReveal)); // Needs integration
        toast({ title: "Reveal", description: `Revealing ${cardToReveal ? cardToReveal : 'influence'}. (Logic Pending)`, variant: "default"});
   }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);


   // Effect to handle AI turn initiation when it becomes their turn
   // This might be redundant if advanceTurn handles it correctly. Test thoroughly.
    useEffect(() => {
        if (gameState && gameState.players[gameState.currentPlayerIndex]?.isAI &&
            !gameState.challengeOrBlockPhase && !gameState.pendingExchange &&
            !gameState.winner && !isProcessing) {

            // Delay slightly to let UI catch up and prevent rapid state changes
            const timer = setTimeout(async () => {
                console.log(`UseEffect triggering AI for ${gameState.players[gameState.currentPlayerIndex].name}`);
                 // IMPORTANT: Ensure updateGameState handles potential promises returned by AI logic
                 // We need game-logic to expose an async function that handles AI turn.
                 // Let's assume advanceTurn or the action functions already call the necessary async AI logic.
                 // If AI actions are not happening, the trigger point needs to be in game-logic.ts (e.g., inside advanceTurn).
                 // This useEffect might just log or ensure processing state is correct.
                 // updateGameState(handleAITurn(gameState)); // Replace handleAITurn with actual function from game-logic if needed
                 console.log("AI's turn - game logic should be handling the action.");
            }, 1000); // Delay AI action slightly

            return () => clearTimeout(timer);
        }
    }, [gameState?.currentPlayerIndex, gameState?.challengeOrBlockPhase, gameState?.pendingExchange, gameState?.winner, isProcessing, updateGameState, gameState]); // Dependencies trigger when turn changes or phases end


  if (!gameStarted) {
    return (
       <div className="flex justify-center items-center min-h-screen">
           <Card className="w-[350px]">
               <CardHeader>
                   <CardTitle>Start New Game</CardTitle>
               </CardHeader>
               <CardContent className="space-y-4">
                   <div className="space-y-2">
                       <Label htmlFor="playerName">Your Name</Label>
                       <Input
                           id="playerName"
                           value={playerName}
                           onChange={(e) => setPlayerName(e.target.value)}
                           placeholder="Enter your name"
                       />
                   </div>
                   <div className="space-y-2">
                       <Label htmlFor="aiCount">Number of AI Players ({MIN_AI_COUNT}-{MAX_AI_COUNT})</Label>
                       <Input
                           id="aiCount"
                           type="number"
                           value={aiCount}
                            onChange={(e) => setAiCount(Math.max(MIN_AI_COUNT, Math.min(MAX_AI_COUNT, parseInt(e.target.value, 10) || MIN_AI_COUNT)))}
                           min={MIN_AI_COUNT}
                           max={MAX_AI_COUNT}
                       />
                   </div>
                   <Button onClick={startGame} className="w-full" disabled={isProcessing}>
                       Start Game
                   </Button>
               </CardContent>
           </Card>
       </div>
    );
  }


  if (!gameState) {
    return <div>Loading game...</div>; // Or a loading spinner
  }

  return (
    <main className="min-h-screen bg-background py-8">
      <h1 className="text-3xl font-bold text-center mb-6 text-primary">Coup Duel</h1>
      <GameBoard
        gameState={gameState}
        humanPlayerId={humanPlayerId}
        onAction={handlePlayerAction}
        onResponse={handlePlayerResponse}
        onExchange={handlePlayerExchange}
        onForceReveal={handleForceReveal} // Pass the handler
      />
       {isProcessing && (
           <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
               <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
               <p className="text-white ml-4">Processing...</p>
           </div>
       )}
    </main>
  );
}
