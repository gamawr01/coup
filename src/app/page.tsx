

'use client';

import { useState, useEffect, useCallback } from 'react';
import { GameBoard } from '@/components/game-board';
import type { GameState, ActionType, CardType, GameResponseType, ChallengeDecisionType } from '@/lib/game-types';
import { initializeGame, performAction, handlePlayerResponse, handleExchangeSelection, handleAIAction, handleForceReveal, handleChallengeDecision } from '@/lib/game-logic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from 'lucide-react'; // Import loader icon

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

   // Unified state update function with logging and processing flag
   const updateGameState = useCallback(async (newStateOrFn: GameState | Promise<GameState> | (() => Promise<GameState> | GameState)) => {
    if (isProcessing) {
        console.warn("[updateGameState] Attempted to update game state while already processing.");
        // toast({ title: "Busy", description: "Please wait for the current action to complete.", variant: "destructive" });
        return;
    }
    setIsProcessing(true);
    console.log("[updateGameState] Starting state update...");
    try {
        let newState: GameState | null = null; // Start as null
        let resolvedState: GameState | null = null; // Variable to hold the final state

        if (typeof newStateOrFn === 'function') {
            console.log("[updateGameState] Executing state update function...");
            const result = await newStateOrFn(); // Await the function which might be async
            resolvedState = result; // Assign result (should always be GameState now)
            console.log("[updateGameState] State update function completed.");
        } else {
            console.log("[updateGameState] Resolving direct state value or promise...");
            resolvedState = await Promise.resolve(newStateOrFn); // Resolve promise if it's one, or wrap value
            console.log("[updateGameState] State value resolved.");
        }

        // Ensure a valid GameState object is returned
         if (!resolvedState) {
           console.error("[updateGameState] Error: Received invalid (null or undefined) state from update function/promise.");
           toast({ title: "Error", description: "Failed to update game state. State might be out of sync.", variant: "destructive" });
           setIsProcessing(false); // Reset processing flag on error
           return; // Prevent further processing with invalid state
         }

        newState = resolvedState; // Assign the valid state

        console.log("[updateGameState] New state received:", newState);
        setGameState(newState); // Update the React state

        // Check for winner after state update
        // Check if newState exists before accessing properties
        if (newState.winner) {
             toast({
               title: "Game Over!",
               description: `${newState.winner.name} wins!`,
               duration: 10000, // Keep winner message longer
             });
             console.log("[updateGameState] Winner detected:", newState.winner.name);
        } else { // Check newState exists before logging whose turn it is
            // Log whose turn it is after state update
            const currentPlayer = newState.players[newState.currentPlayerIndex];
             console.log(`[updateGameState] State updated. Current turn: ${currentPlayer?.name || 'Unknown'} (${currentPlayer?.isAI ? 'AI' : 'Human'}). Needs AI trigger: ${newState.needsHumanTriggerForAI}`);
        }


    } catch (error) {
        console.error("[updateGameState] Error updating game state:", error);
         toast({ title: "Error", description: "An error occurred processing the game state.", variant: "destructive" });
    } finally {
         console.log("[updateGameState] Finished processing state update.");
         setIsProcessing(false); // Ensure processing flag is reset
    }
  }, [isProcessing, toast]); // Add dependencies

  const startGame = useCallback(() => {
    if (playerName.trim() === "") {
        toast({ title: "Error", description: "Please enter a player name.", variant: "destructive" });
        return;
    }
    if (aiCount < MIN_AI_COUNT || aiCount > MAX_AI_COUNT) {
         toast({ title: "Error", description: `Number of AI players must be between ${MIN_AI_COUNT} and ${MAX_AI_COUNT}.`, variant: "destructive" });
         return;
    }

    console.log("[startGame] Initializing game...");
    let initialState = initializeGame([playerName], aiCount);
    const initialPlayer = initialState.players[initialState.currentPlayerIndex];
    setHumanPlayerId(initialState.players.find(p => !p.isAI)?.id || 'player-0');
    toast({ title: "Game Started!", description: `Playing against ${aiCount} AI opponents. ${initialPlayer?.name}'s turn.` });
    setGameStarted(true);
    console.log("[startGame] Game initialized. Initial state:", initialState);
    console.log(`[startGame] First turn: ${initialPlayer?.name} (${initialPlayer?.isAI ? 'AI' : 'Human'})`);

    // If the first player is AI, set the flag to wait for the trigger button.
    if (initialPlayer?.isAI) {
        console.log(`[startGame] Initial player ${initialPlayer.name} is AI. Setting needsHumanTriggerForAI flag.`);
        initialState = { ...initialState, needsHumanTriggerForAI: true };
    }

    // Update state with the initial setup (potentially with the flag set)
    updateGameState(() => initialState);

  }, [playerName, aiCount, toast, updateGameState]); // Added updateGameState dependency


  const handlePlayerAction = useCallback((action: ActionType, targetId?: string) => {
      if (!gameState || isProcessing || gameState.winner || gameState.needsHumanTriggerForAI) {
          console.warn(`[handlePlayerAction] Action blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}, needsAITrigger=${gameState?.needsHumanTriggerForAI}`);
          if (gameState?.needsHumanTriggerForAI) {
                toast({ title: "Wait", description: "Click 'Next AI Turn' to let the AI play.", variant: "destructive" });
          }
          return;
      }
      console.log(`[handlePlayerAction] Human action: ${action}`, targetId || '');
      // Pass an async function to updateGameState that calls performAction
      updateGameState(async () => { // Make sure the function passed is async
           console.log(`[handlePlayerAction] Calling performAction for ${action}...`);
           // Ensure gameState is passed correctly
           if (!gameState) {
                console.error("[handlePlayerAction] Game state is null, cannot perform action.");
                // Although performAction handles null, return the current state to avoid updating with null
                // This shouldn't happen due to the block above, but safety first.
                return gameState!;
            }
           const nextState = await performAction(gameState, humanPlayerId, action, targetId);
           // performAction should now always return a GameState
           return nextState;
      });
  }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

  const handlePlayerResponse = useCallback((response: GameResponseType) => {
      if (!gameState || isProcessing || gameState.winner) {
           console.warn(`[handlePlayerResponse] Response blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}`);
           return;
      }
       console.log(`[handlePlayerResponse] Human response: ${response}`);
       // Pass an async function to updateGameState that calls handlePlayerResponse
       updateGameState(async () => { // Make sure the function passed is async
            console.log(`[handlePlayerResponse] Calling handlePlayerResponse with ${response}...`);
             // Ensure gameState is passed correctly
            if (!gameState) {
                console.error("[handlePlayerResponse] Game state is null, cannot handle response.");
                return gameState!; // Return current state
            }
            const nextState = await handlePlayerResponse(gameState, humanPlayerId, response);
             // handlePlayerResponse should now always return a GameState
             if (!nextState) {
                 console.error("[handlePlayerResponse] handlePlayerResponse returned null (unexpected).");
                 toast({ title: "Error", description: "Response failed to process.", variant: "destructive" });
                 return gameState; // Return current state on unexpected null
             }
             return nextState;
       });
  }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

   const handlePlayerExchange = useCallback((cardsToKeep: CardType[]) => {
      if (!gameState || isProcessing || gameState.winner) {
            console.warn(`[handlePlayerExchange] Exchange blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}`);
            return;
      }
      console.log(`[handlePlayerExchange] Human exchange selection: ${cardsToKeep.join(', ')}`);
       // Pass an async function to updateGameState that calls handleExchangeSelection
      updateGameState(async () => { // Make sure the function passed is async
            console.log(`[handlePlayerExchange] Calling handleExchangeSelection...`);
             // Ensure gameState is passed correctly
             if (!gameState) {
                console.error("[handlePlayerExchange] Game state is null, cannot handle exchange.");
                return gameState!; // Return current state
             }
            const nextState = await handleExchangeSelection(gameState, humanPlayerId, cardsToKeep);
             // handleExchangeSelection should always return GameState
             if (!nextState) {
                 console.error("[handlePlayerExchange] handleExchangeSelection returned null (unexpected).");
                 toast({ title: "Error", description: "Exchange failed to process.", variant: "destructive" });
                 return gameState; // Return current state on unexpected null
             }
             return nextState;
      });
  }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

   // Handler for forced reveal confirmation (if player has multiple cards)
   const handlePlayerForceReveal = useCallback((cardToReveal: CardType) => {
       if (!gameState || isProcessing || gameState.winner /* || !gameState.forceRevealPlayerId || gameState.forceRevealPlayerId !== humanPlayerId */) { // Simplified check for now
             console.warn(`[handleForceReveal] Reveal blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}`); // , forceReveal=${gameState?.forceRevealPlayerId}`);
             return;
       }
        console.log(`[handleForceReveal] Human forced reveal: ${cardToReveal}`);
        updateGameState(async () => {
             console.log(`[handleForceReveal] Calling handleForceReveal...`);
             if (!gameState) {
                 console.error("[handleForceReveal] Game state is null, cannot handle forced reveal.");
                 return gameState!;
             }
             // Pass the specific card selected by the human
             const result = await handleForceReveal(gameState, humanPlayerId, cardToReveal);
              // handleForceReveal should always return GameState
              if (!result.newState) {
                 console.error("[handleForceReveal] handleForceReveal returned null state (unexpected).");
                 toast({ title: "Error", description: "Reveal failed to process.", variant: "destructive" });
                 return gameState;
              }
             return result.newState;
        });
   }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

    // Handler for the challenge decision (Proceed/Retreat)
    const handlePlayerChallengeDecision = useCallback((decision: ChallengeDecisionType) => {
        if (!gameState || isProcessing || gameState.winner || !gameState.pendingChallengeDecision || gameState.pendingChallengeDecision.challengedPlayerId !== humanPlayerId) {
            console.warn(`[handlePlayerChallengeDecision] Decision blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}, pendingDecision=${!!gameState?.pendingChallengeDecision}`);
            return;
        }
        console.log(`[handlePlayerChallengeDecision] Human challenge decision: ${decision}`);
        updateGameState(async () => {
            console.log(`[handlePlayerChallengeDecision] Calling handleChallengeDecision...`);
            if (!gameState) {
                console.error("[handlePlayerChallengeDecision] Game state is null, cannot handle challenge decision.");
                return gameState!;
            }
            const nextState = await handleChallengeDecision(gameState, humanPlayerId, decision);
            if (!nextState) {
                 console.error("[handlePlayerChallengeDecision] handleChallengeDecision returned null state (unexpected).");
                 toast({ title: "Error", description: "Challenge decision failed to process.", variant: "destructive" });
                 return gameState;
            }
            return nextState;
        });
    }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

   // Handler for the "Next AI Turn" button
    const handleAIActionTrigger = useCallback(async () => {
        if (!gameState || isProcessing || !gameState.needsHumanTriggerForAI || gameState.winner) {
            console.warn(`[handleAIActionTrigger] Trigger blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, needsTrigger=${gameState?.needsHumanTriggerForAI}, winner=${!!gameState?.winner}`);
            return;
        }
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (!currentPlayer) {
            console.error("[handleAIActionTrigger] Current player not found in game state.");
            return;
        }
        console.log(`[handleAIActionTrigger] Triggering AI action for ${currentPlayer.name}`);

        // Update the state immediately to clear the flag and show processing state
        // Then, call the actual handleAIAction function.
        updateGameState(async () => { // Make sure the function passed is async
            console.log(`[handleAIActionTrigger] Calling handleAIAction...`);
             // Ensure gameState is passed correctly
            if (!gameState) {
                console.error("[handleAIActionTrigger] Game state is null, cannot trigger AI action.");
                return gameState!; // Return current state
            }
             // Pass a state with the flag cleared to handleAIAction
            const stateForAI = { ...gameState, needsHumanTriggerForAI: false };
            const nextState = await handleAIAction(stateForAI);
             // handleAIAction should always return GameState
             if (!nextState) {
                 console.error("[handleAIActionTrigger] handleAIAction returned null (unexpected).");
                 toast({ title: "Error", description: "AI action failed to process.", variant: "destructive" });
                 return gameState; // Return current state on unexpected null
             }
             return nextState;
        });
    }, [gameState, updateGameState, isProcessing, toast]);


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
                       {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                       Start Game
                   </Button>
               </CardContent>
           </Card>
       </div>
    );
  }


  if (!gameState) {
    return (
        <div className="flex justify-center items-center min-h-screen">
             <Loader2 className="h-16 w-16 animate-spin text-primary" />
             <p className="text-primary ml-4">Loading game...</p>
         </div>
    ); // Loading spinner
  }

   const currentPlayer = gameState.players[gameState.currentPlayerIndex];

  return (
    <main className="min-h-screen bg-background py-8">
      <h1 className="text-3xl font-bold text-center mb-6 text-primary">Coup Duel</h1>
      <GameBoard
        gameState={gameState}
        humanPlayerId={humanPlayerId}
        onAction={handlePlayerAction}
        onResponse={handlePlayerResponse}
        onExchange={handlePlayerExchange}
        onForceReveal={handlePlayerForceReveal} // Pass the handler
        onChallengeDecision={handlePlayerChallengeDecision} // Pass new handler
      />
       {/* Button to trigger AI turn */}
       {gameState.needsHumanTriggerForAI && !gameState.winner && currentPlayer && currentPlayer.isAI && (
           <div className="text-center mt-4">
               <Button onClick={handleAIActionTrigger} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Next AI Turn ({currentPlayer.name})
                </Button>
           </div>
       )}

       {/* Global Processing Overlay */}
       {isProcessing && (
           <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
               <Loader2 className="h-16 w-16 animate-spin text-primary" />
               <p className="text-white ml-4">Processing...</p>
           </div>
       )}
    </main>
  );
}
