
'use client';

import { useState, useEffect, useCallback } from 'react';
import { GameBoard } from '@/components/game-board';
import type { GameState, ActionType, CardType, GameResponseType } from '@/lib/game-types';
import { initializeGame, performAction, handlePlayerResponse, handleExchangeSelection } from '@/lib/game-logic'; // Removed forceRevealInfluence import as it's not fully implemented yet
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

  const startGame = useCallback(() => {
    if (playerName.trim() === "") {
        toast({ title: "Error", description: "Please enter a player name.", variant: "destructive" });
        return;
    }
    if (aiCount < MIN_AI_COUNT || aiCount > MAX_AI_COUNT) {
         toast({ title: "Error", description: `Number of AI players must be between ${MIN_AI_COUNT} and ${MAX_AI_COUNT}.`, variant: "destructive" });
         return;
    }
    // Use updateGameState to handle the initial state setting and potential immediate AI turn
    updateGameState(async () => {
        const initialState = initializeGame([playerName], aiCount);
        setHumanPlayerId(initialState.players.find(p => !p.isAI)?.id || 'player-0'); // Find the actual human player ID
        toast({ title: "Game Started!", description: `Playing against ${aiCount} AI opponents.` });
        setGameStarted(true); // Set gameStarted only after initialization is complete
        return initialState; // Return the initial state for updateGameState
    });

  }, [playerName, aiCount, toast]); // Removed updateGameState from dependencies as it's defined below and stable

  // Unified state update function with logging and processing flag
 const updateGameState = useCallback(async (newStateOrFn: GameState | Promise<GameState> | (() => Promise<GameState>)) => {
    if (isProcessing) {
        console.warn("Attempted to update game state while already processing.");
        toast({ title: "Busy", description: "Please wait for the current action to complete.", variant: "destructive" });
        return;
    }
    setIsProcessing(true);
    console.log("Updating game state...");
    try {
        let newState: GameState;
        if (typeof newStateOrFn === 'function') {
            newState = await newStateOrFn();
        } else {
            newState = await Promise.resolve(newStateOrFn); // Resolve promise if it's one, or wrap value
        }

        console.log("New state received:", newState);
        setGameState(newState); // Update the React state

        // Check for winner after state update
        if (newState.winner) {
             toast({
               title: "Game Over!",
               description: `${newState.winner.name} wins!`,
               duration: 10000, // Keep winner message longer
             });
        }

    } catch (error) {
        console.error("Error updating game state:", error);
         toast({ title: "Error", description: "An error occurred processing the game state.", variant: "destructive" });
    } finally {
         console.log("Finished processing state update.");
         setIsProcessing(false); // Ensure processing flag is reset
    }
  }, [isProcessing, toast]); // Add dependencies


  const handlePlayerAction = useCallback((action: ActionType, targetId?: string) => {
      if (!gameState || isProcessing || gameState.winner) return;
      console.log(`Human action: ${action}`, targetId);
      // Pass an async function to updateGameState that calls performAction
      updateGameState(() => performAction(gameState, humanPlayerId, action, targetId));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

  const handlePlayerResponse = useCallback((response: GameResponseType) => {
      if (!gameState || isProcessing || gameState.winner) return;
       console.log(`Human response: ${response}`);
       // Pass an async function to updateGameState that calls handlePlayerResponse
       updateGameState(() => handlePlayerResponse(gameState, humanPlayerId, response));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

   const handlePlayerExchange = useCallback((cardsToKeep: CardType[]) => {
      if (!gameState || isProcessing || gameState.winner) return;
      console.log(`Human exchange selection: ${cardsToKeep.join(', ')}`);
       // Pass an async function to updateGameState that calls handleExchangeSelection
      updateGameState(() => handleExchangeSelection(gameState, humanPlayerId, cardsToKeep));
  }, [gameState, humanPlayerId, updateGameState, isProcessing]);

   // Placeholder for Forced Reveal - needs proper trigger logic from game-logic
   const handleForceReveal = useCallback((cardToReveal?: CardType) => {
       if (!gameState || isProcessing || gameState.winner) return;
        console.log(`Human forced reveal: ${cardToReveal || 'auto'}`);
        // This action needs to be triggered by game-logic when a player *must* reveal.
        // Example: updateGameState(() => forceRevealInfluence(gameState, humanPlayerId, cardToReveal));
        toast({ title: "Reveal", description: `Revealing ${cardToReveal ? cardToReveal : 'influence'}. (Manual Trigger - Needs Logic Update)`, variant: "default"});
   }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);


   // Removed the useEffect hook that tried to handle AI turns.
   // This is now handled within the `advanceTurn` function in `game-logic.ts`.


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
