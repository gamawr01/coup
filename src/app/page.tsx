'use client';

import type { ChangeEvent } from 'react'; // Import ChangeEvent
import { useState, useEffect, useCallback } from 'react';
import { GameBoard } from '@/components/game-board';
import type { GameState, ActionType, CardType, GameResponseType, ChallengeDecisionType } from '@/lib/game-types';
import { initializeGame, performAction, handlePlayerResponse, handleExchangeSelection, handleAIAction, handleForceReveal, handleChallengeDecision, handleAssassinationConfirmation, processPendingActionAfterReveal, advanceTurn } from '@/lib/game-logic'; // Added handleAssassinationConfirmation, processPendingActionAfterReveal, advanceTurn
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
   const updateGameState = useCallback(async (newStateOrFn: GameState | null | (() => Promise<GameState | null> | GameState | null)) => {
       if (isProcessing) {
           console.warn("[updateGameState] Attempted to update game state while already processing.");
           // toast({ title: "Busy", description: "Please wait for the current action to complete.", variant: "destructive" });
           return;
       }
       setIsProcessing(true);
       console.log("[updateGameState] Starting state update...");
       let newState: GameState | null = null; // Start as null
       try {
           if (typeof newStateOrFn === 'function') {
               console.log("[updateGameState] Executing state update function...");
               const result = await newStateOrFn(); // Await the function which might be async
               newState = result; // Assign result (can be GameState or null)
               console.log("[updateGameState] State update function completed.");
           } else {
               console.log("[updateGameState] Resolving direct state value or promise...");
               newState = await Promise.resolve(newStateOrFn); // Resolve promise if it's one, or wrap value
               console.log("[updateGameState] State value resolved.");
           }

           // Add explicit null check here AND type check
           if (!newState || typeof newState !== 'object' || !Array.isArray(newState.players) || typeof newState.currentPlayerIndex !== 'number') {
               const invalidStateDetails = JSON.stringify(newState); // Log the invalid state structure
               console.error(`[updateGameState] Error: Received invalid state from update function/promise. State: ${invalidStateDetails}`);
               toast({ title: "Error", description: "Failed to update game state (invalid state received).", variant: "destructive" });
               setIsProcessing(false); // Reset processing flag on error
               return; // Prevent further processing with invalid state
           }


           console.log("[updateGameState] New valid state received:", JSON.stringify(newState, null, 2));
           setGameState(newState); // Update the React state

           // Check for winner after state update
           if (newState.winner) {
                toast({
                  title: "Game Over!",
                  description: `${newState.winner.name} wins!`,
                  duration: 10000, // Keep winner message longer
                });
                console.log("[updateGameState] Winner detected:", newState.winner.name);
           } else {
               // Log whose turn it is after state update
               const currentPlayer = newState.players[newState.currentPlayerIndex];
                console.log(`[updateGameState] State updated. Current turn: ${currentPlayer?.name || 'Unknown'} (${currentPlayer?.isAI ? 'AI' : 'Human'}). Needs AI trigger: ${newState.needsHumanTriggerForAI}`);
           }


       } catch (error: any) { // Catch errors during the update function execution itself
           console.error("[updateGameState] Error executing update function:", error);
           toast({ title: "Error", description: `An error occurred executing the game state update: ${error.message}`, variant: "destructive" });
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
    console.log("[startGame] Game initialized. Initial state:", JSON.stringify(initialState, null, 2));
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
      updateGameState(async () => {
           console.log(`[handlePlayerAction Callback] Calling performAction for ${action}...`);
           // Ensure gameState is passed correctly
           if (!gameState) {
                console.error("[handlePlayerAction Callback] Game state is null, cannot perform action.");
                return gameState; // Return original state as it's the best we have
            }
            try {
                const nextState = await performAction(gameState, humanPlayerId, action, targetId);
                 console.log(`[handlePlayerAction Callback] Awaited call completed.`);
                 // Validate the returned state
                 if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                     const invalidStateDetails = JSON.stringify(nextState);
                     console.error(`[handlePlayerAction Callback] performAction returned invalid state: ${invalidStateDetails}`);
                     toast({ title: "Error", description: "Action failed to process (invalid state returned).", variant: "destructive" });
                     return gameState; // Return original state on error, as the logic failed
                 }
                 console.log(`[handlePlayerAction Callback] Returning valid nextState.`);
                 return nextState;
            } catch (error: any) {
                 console.error(`[handlePlayerAction Callback] Error during game logic call: ${error.message}`, error);
                 toast({ title: "Error", description: `Failed to process action: ${error.message}`, variant: "destructive" });
                 return gameState; // Return the original state on error
            }
      });
  }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);


  const handlePlayerResponse = useCallback((response: GameResponseType) => {
      if (!gameState || isProcessing || gameState.winner) {
           console.warn(`[handlePlayerResponse] Response blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}`);
           return; // Block is fine, doesn't need to return GameState
      }
       console.log(`[handlePlayerResponse] Human response: ${response}`);
       updateGameState(async () => {
            console.log(`[handlePlayerResponse Callback] Calling handlePlayerResponse with ${response}...`);
            if (!gameState) { // Double check gameState within the async function
                console.error("[handlePlayerResponse Callback] Game state became null, cannot handle response.");
                return gameState; // Return original state
            }
             try {
                const nextState = await handlePlayerResponse(gameState, humanPlayerId, response);
                // handlePlayerResponse should now always return a GameState
                if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                    console.error("[handlePlayerResponse Callback] handlePlayerResponse from game-logic returned null/undefined or invalid state (unexpected).");
                    toast({ title: "Error", description: "Response failed to process.", variant: "destructive" });
                    return gameState; // Return original state if logic fails
                }
                console.log(`[handlePlayerResponse Callback] Returning valid nextState.`);
                return nextState; // Return the valid new state
            } catch (error: any) {
                 console.error(`[handlePlayerResponse Callback] Error during game logic call: ${error.message}`, error);
                 toast({ title: "Error", description: `Failed to process response: ${error.message}`, variant: "destructive" });
                 return gameState; // Return the original state on error
            }
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
            console.log(`[handlePlayerExchange Callback] Calling handleExchangeSelection...`);
             // Ensure gameState is passed correctly
             if (!gameState) {
                console.error("[handlePlayerExchange Callback] Game state is null, cannot handle exchange.");
                return gameState; // Return original state
             }
              try {
                 const nextState = await handleExchangeSelection(gameState, humanPlayerId, cardsToKeep);
                  // Validate the returned state
                 if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                     const invalidStateDetails = JSON.stringify(nextState);
                     console.error(`[handleExchangeSelection Callback] handleExchangeSelection returned invalid state: ${invalidStateDetails}`);
                     toast({ title: "Error", description: "Exchange failed to process (invalid state returned).", variant: "destructive" });
                     return gameState; // Return original state on error
                 }
                 return nextState;
             } catch (error: any) {
                  console.error(`[handlePlayerExchange Callback] Error during game logic call: ${error.message}`, error);
                  toast({ title: "Error", description: `Failed to process exchange: ${error.message}`, variant: "destructive" });
                  return gameState; // Return the original state on error
             }
      });
  }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

   // Handler for forced reveal confirmation (if player has multiple cards)
   const handlePlayerForceReveal = useCallback((cardToReveal: CardType) => {
       if (!gameState || isProcessing || gameState.winner || gameState.playerNeedsToReveal !== humanPlayerId) { // Use the explicit flag
             console.warn(`[handleForceReveal] Reveal blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}, needsReveal=${gameState?.playerNeedsToReveal}`);
             return;
       }
        console.log(`[handleForceReveal] Human forced reveal: ${cardToReveal}`);
        updateGameState(async () => {
             console.log(`[handleForceReveal Callback] Calling handleForceReveal...`);
             if (!gameState) {
                 console.error("[handleForceReveal Callback] Game state is null, cannot handle forced reveal.");
                 return gameState; // Return original state
             }
              try {
                 // Pass the specific card selected by the human
                 const result = await handleForceReveal(gameState, humanPlayerId, cardToReveal);
                  // Validate the returned state
                  if (!result || !result.newState || typeof result.newState !== 'object' || !Array.isArray(result.newState.players) || typeof result.newState.currentPlayerIndex !== 'number') {
                      const invalidStateDetails = JSON.stringify(result?.newState);
                     console.error(`[handleForceReveal Callback] handleForceReveal returned invalid state: ${invalidStateDetails}`);
                     toast({ title: "Error", description: "Reveal failed to process (invalid state returned).", variant: "destructive" });
                     return gameState; // Return original state on error
                  }

                 let finalState = result.newState;
                 // After reveal, check if a pending action needs to be processed
                 if (finalState.pendingActionAfterReveal) {
                     console.log("[handleForceReveal Callback] Pending action found. Processing...");
                     finalState = await processPendingActionAfterReveal(finalState);
                 } else if (!finalState.playerNeedsToReveal && !finalState.winner) { // If reveal finished and no pending action, advance turn
                     console.log("[handleForceReveal Callback] Reveal complete, advancing turn.");
                     finalState = await advanceTurn(finalState);
                 }

                 // Final validation before returning
                 if (!finalState || typeof finalState !== 'object' || !Array.isArray(finalState.players) || typeof finalState.currentPlayerIndex !== 'number') {
                      const invalidStateDetails = JSON.stringify(finalState);
                      console.error(`[handleForceReveal Callback] State became invalid after processing reveal/pending actions: ${invalidStateDetails}`);
                      toast({ title: "Error", description: "Error processing reveal aftermath.", variant: "destructive" });
                      return gameState; // Return original state
                  }

                 return finalState; // Return state (might be game over, next turn, or waiting for another reveal)

             } catch (error: any) {
                  console.error(`[handleForceReveal Callback] Error during game logic call: ${error.message}`, error);
                  toast({ title: "Error", description: `Failed to process reveal: ${error.message}`, variant: "destructive" });
                  return gameState; // Return the original state on error
             }
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
            console.log(`[handlePlayerChallengeDecision Callback] Calling handleChallengeDecision...`);
            if (!gameState) {
                console.error("[handlePlayerChallengeDecision Callback] Game state is null, cannot handle challenge decision.");
                return gameState; // Return original state
            }
             try {
                 const nextState = await handleChallengeDecision(gameState, humanPlayerId, decision);
                  // Validate the returned state
                  if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                      const invalidStateDetails = JSON.stringify(nextState);
                      console.error(`[handlePlayerChallengeDecision Callback] handleChallengeDecision returned invalid state: ${invalidStateDetails}`);
                      toast({ title: "Error", description: "Challenge decision failed to process (invalid state returned).", variant: "destructive" });
                      return gameState; // Return original state on error
                  }
                 return nextState;
             } catch (error: any) {
                  console.error(`[handlePlayerChallengeDecision Callback] Error during game logic call: ${error.message}`, error);
                  toast({ title: "Error", description: `Failed to process challenge decision: ${error.message}`, variant: "destructive" });
                  return gameState; // Return the original state on error
             }
        });
    }, [gameState, humanPlayerId, updateGameState, isProcessing, toast]);

     // Handler for the assassination confirmation (Challenge Contessa / Accept Block)
    const handlePlayerAssassinationConfirmation = useCallback((decision: 'Challenge Contessa' | 'Accept Block') => {
        if (!gameState || isProcessing || gameState.winner || !gameState.pendingAssassinationConfirmation || gameState.pendingAssassinationConfirmation.assassinPlayerId !== humanPlayerId) {
            console.warn(`[handlePlayerAssassinationConfirmation] Confirmation blocked: gameState=${!!gameState}, isProcessing=${isProcessing}, winner=${!!gameState?.winner}, pendingConfirmation=${!!gameState?.pendingAssassinationConfirmation}`);
            return;
        }
        console.log(`[handlePlayerAssassinationConfirmation] Human assassin confirmation: ${decision}`);
        updateGameState(async () => {
            console.log(`[handlePlayerAssassinationConfirmation Callback] Calling handleAssassinationConfirmation...`);
            if (!gameState) {
                console.error("[handlePlayerAssassinationConfirmation Callback] Game state is null, cannot handle confirmation.");
                return gameState; // Return original state
            }
             try {
                 const nextState = await handleAssassinationConfirmation(gameState, humanPlayerId, decision);
                  // Validate the returned state
                  if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                      const invalidStateDetails = JSON.stringify(nextState);
                      console.error(`[handlePlayerAssassinationConfirmation Callback] handleAssassinationConfirmation returned invalid state: ${invalidStateDetails}`);
                      toast({ title: "Error", description: "Assassination confirmation failed to process (invalid state returned).", variant: "destructive" });
                      return gameState; // Return original state on error
                  }
                 return nextState;
             } catch (error: any) {
                  console.error(`[handlePlayerAssassinationConfirmation Callback] Error during game logic call: ${error.message}`, error);
                  toast({ title: "Error", description: `Failed to process assassination confirmation: ${error.message}`, variant: "destructive" });
                  return gameState; // Return the original state on error
             }
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
            console.log(`[handleAIActionTrigger Callback] Calling handleAIAction...`);
             // Ensure gameState is passed correctly
            if (!gameState) {
                console.error("[handleAIActionTrigger Callback] Game state is null, cannot trigger AI action.");
                return gameState; // Return original state
            }
             try {
                  // Pass a state with the flag cleared to handleAIAction
                 const stateForAI = { ...gameState, needsHumanTriggerForAI: false };
                 const nextState = await handleAIAction(stateForAI);
                  // Validate the returned state
                  if (!nextState || typeof nextState !== 'object' || !Array.isArray(nextState.players) || typeof nextState.currentPlayerIndex !== 'number') {
                      const invalidStateDetails = JSON.stringify(nextState);
                      console.error(`[handleAIActionTrigger Callback] handleAIAction returned invalid state: ${invalidStateDetails}`);
                      toast({ title: "Error", description: "AI action failed to process (invalid state returned).", variant: "destructive" });
                      return gameState; // Return original state on error
                  }
                 return nextState;
            } catch (error: any) {
                  console.error(`[handleAIActionTrigger Callback] Error during game logic call: ${error.message}`, error);
                  toast({ title: "Error", description: `Failed to process AI turn: ${error.message}`, variant: "destructive" });
                  return gameState; // Return the original state on error
            }
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
                           onChange={(e: ChangeEvent<HTMLInputElement>) => setPlayerName(e.target.value)} // Added type annotation
                           placeholder="Enter your name"
                       />
                   </div>
                   <div className="space-y-2">
                       <Label htmlFor="aiCount">Number of AI Players ({MIN_AI_COUNT}-{MAX_AI_COUNT})</Label>
                       <Input
                           id="aiCount"
                           type="number"
                           value={aiCount}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setAiCount(Math.max(MIN_AI_COUNT, Math.min(MAX_AI_COUNT, parseInt(e.target.value, 10) || MIN_AI_COUNT)))} // Added type annotation
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
        onAssassinationConfirmation={handlePlayerAssassinationConfirmation} // Pass new handler
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
