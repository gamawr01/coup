
'use server';

/**
 * @fileOverview Implements the AI action selection logic for the Coup game.
 *
 * - selectAction - Determines the best action for the AI player to take.
 * - AIActionSelectionInput - The input type for the selectAction function.
 * - AIActionSelectionOutput - The return type for the selectAction function.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import type { GenerateResponse } from 'genkit';
import { coupRulebook } from '@/ai/rules/coup-rulebook'; // Import rulebook content

// Define Zod schemas matching the prompt file structure
const AIActionSelectionInputSchema = z.object({
  playerMoney: z.number().describe('The amount of money the AI player has.'),
  playerInfluenceCards: z.array(z.string()).describe("The AI player's current *unrevealed* influence cards (e.g., ['Duke', 'Assassin'])."),
  opponentInfo: z.array(z.object({
        name: z.string(),
        money: z.number(),
        influenceCount: z.number(),
        revealedCards: z.array(z.string()),
  })).describe('Information about the active opponents.'),
  availableActions: z
    .array(z.string())
    .describe('The actions the AI player can currently take (e.g., Income, Foreign Aid, Coup). Must choose one of these.'), // Emphasize choosing from this list
  gameState: z.string().describe('A description of the current game state, including action log summary.'),
  rulebook: z.string().optional().describe('Reference text of the Coup rulebook.'), // Add rulebook to input
});
export type AIActionSelectionInput = z.infer<typeof AIActionSelectionInputSchema>;

const AIActionSelectionOutputSchema = z.object({
  action: z.string().describe('The action the AI player should take (must be one of the availableActions).'),
  target: z.string().optional().describe("The name of the target opponent player, ONLY if the action requires it (e.g., Coup, Assassinate, Steal). Must be one of the opponent names from opponentInfo."),
  reasoning: z.string().describe('The AI reasoning for selecting this action and target (if any).'),
});
export type AIActionSelectionOutput = z.infer<typeof AIActionSelectionOutputSchema>;


// Define the prompt inline, as a prompt, not a function
const selectActionPrompt = ai.definePrompt(
    {
        name: 'selectActionPrompt',
        input: { schema: AIActionSelectionInputSchema },
        output: { schema: AIActionSelectionOutputSchema },
        model: 'googleai/gemini-1.5-flash', // Use a capable model
        response: {
            format: 'json', // Request JSON output
        },
        prompt: `You are an AI player in the card game Coup. Your goal is to be the last player with influence remaining.
Analyze the current game state, your resources, your hidden cards, and opponent information to select the best strategic action from the currently available actions list.

**Rules Reference:**
{{{rulebook}}}

**Your Current Situation:**
- Money: {{playerMoney}}
- Your Unrevealed Influence: [{{#each playerInfluenceCards}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]

**Opponent Information:**
{{#each opponentInfo}}
- {{name}}: {{money}} coins, {{influenceCount}} unrevealed influence, Revealed: [{{#each revealedCards}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]
{{/each}}

**Current Game State Summary:**
{{{gameState}}}

**Available Actions You Can Take Right Now:**
[{{#each availableActions}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]

**Your Task:**
Choose the *single best* action from the "Available Actions" list.
- Consider short-term gains (money) and long-term strategy (eliminating opponents, bluffing potential).
- If an action requires a target (Coup, Assassinate, Steal), choose the best opponent target based on their influence, money, and potential threat. Ensure the target name *exactly* matches one from the Opponent Information list. If multiple targets are equally viable, choose one.
- Provide your reasoning, explaining why you chose this action (and target, if applicable) over others.
- **CRITICAL:** Your output *must* be a valid JSON object matching the defined output schema. The 'action' field *must* be exactly one of the strings from the 'availableActions' input array. If the action requires a target, the 'target' field must be the exact name of an opponent from the 'opponentInfo' list.

Output Format (JSON):
{
  "action": "Selected action (must be in availableActions)",
  "target": "Target player name (optional, required for Coup/Assassinate/Steal, must be in opponentInfo)",
  "reasoning": "Your detailed thought process for this decision."
}
`,
    },
);

// Define the flow
const aiActionSelectionFlow = ai.defineFlow({
    name: 'aiActionSelectionFlow',
    inputSchema: AIActionSelectionInputSchema,
    outputSchema: AIActionSelectionOutputSchema,
}, async (input) => {
    let llmResponse: GenerateResponse<AIActionSelectionOutput> | null = null;
    let output: AIActionSelectionOutput | null = null;

    try {
        console.log("[aiActionSelectionFlow] Input for LLM:", JSON.stringify(input, null, 2));

        // Correct Genkit v1.x invocation: call the prompt object directly
        console.log("[aiActionSelectionFlow] Calling selectActionPrompt...");
        llmResponse = await selectActionPrompt(input);
        console.log("[aiActionSelectionFlow] LLM response received. Finish Reason:", llmResponse.finishReason);
        // console.log("[aiActionSelectionFlow] Raw Text Response from LLM:", llmResponse.text); // Uncomment for deep debug

        output = llmResponse.output; // Genkit attempts parsing based on outputSchema and format: 'json'

        if (!output) {
            console.error("AI Action Selection Error: LLM response did not contain valid structured output (output is null/undefined).");
            console.error("LLM Raw Text Response:", llmResponse?.text); // Log raw text on failure
            console.error("LLM Finish Reason:", llmResponse?.finishReason);
             // Attempt to parse manually as a fallback (sometimes Genkit parsing might fail unexpectedly)
             try {
                if (llmResponse?.text) {
                     output = JSON.parse(llmResponse.text) as AIActionSelectionOutput;
                     console.log("[aiActionSelectionFlow] Manual JSON parse successful:", output);
                     // Manually validate against schema if parsed manually
                     output = AIActionSelectionOutputSchema.parse(output);
                     console.log("[aiActionSelectionFlow] Manual parse validated.");
                } else {
                    throw new Error("LLM response text was empty.");
                }
             } catch(parseError: any) {
                 console.error("AI Action Selection Error: Manual JSON parse/validation failed.", parseError?.message);
                 throw new Error(`LLM response could not be parsed as valid JSON matching the schema. Raw text: ${llmResponse?.text}`);
             }
        }

        // --- Validation ---
        const validatedOutput = output; // Already parsed by Genkit or manually validated

        if (!validatedOutput || validatedOutput.action === null || validatedOutput.action === undefined) {
            console.error(`AI Action Selection Error: Chosen action is null or undefined after parsing.`);
            throw new Error(`Chosen action is null or undefined.`);
        }

        if (!input.availableActions.includes(validatedOutput.action)) {
            console.error(`AI Action Selection Error: Chosen action "${validatedOutput.action}" is not in the available list: [${input.availableActions.join(', ')}]`);
            // Attempt to find the closest valid action? For now, throw error.
            throw new Error(`Chosen action "${validatedOutput.action}" is not available. Available: [${input.availableActions.join(', ')}]`);
        }

        // Additional validation: Ensure target is valid if provided
        const actionsNeedingTarget: string[] = ['Coup', 'Assassinate', 'Steal'];
        const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);

        if (validatedOutput.target) {
            const targetValid = input.opponentInfo.some(opp => opp.name === validatedOutput.target);
            if (!targetValid) {
                console.error(`AI Action Selection Error: Target "${validatedOutput.target}" is not a valid opponent name. Valid: [${input.opponentInfo.map(o=>o.name).join(', ')}]`);
                // Attempt to pick a valid random target? For now, throw error.
                throw new Error(`Target "${validatedOutput.target}" is not valid.`);
            }
            // Ensure action actually requires a target
            if (!actionsNeedingTarget.includes(validatedOutput.action)) {
                console.warn(`AI Action Selection Warning: Target "${validatedOutput.target}" provided for action "${validatedOutput.action}" which doesn't require one. Ignoring target.`);
                validatedOutput.target = undefined; // Clear the target
            }
        } else {
            // Ensure no target is provided if action *does* need one (and targets exist)
            if (actionsNeedingTarget.includes(validatedOutput.action) && activeOpponents.length > 0) {
                 console.error(`AI Action Selection Error: Action "${validatedOutput.action}" requires a target, but none was provided and targets exist.`);
                throw new Error(`Action "${validatedOutput.action}" requires a target.`);
            }
        }

        console.log("AI Action Selection Flow: Successfully generated and validated output:", validatedOutput);
        return validatedOutput;

    } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
         const errorStack = e instanceof Error ? e.stack : 'No stack available';
         console.error("AI Action Selection Error in Flow:", errorMessage);
         console.error("Error Stack:", errorStack);
         console.error("Input Sent to AI:", JSON.stringify(input, null, 2));
        if (output) {
            console.error("Parsed AI Output (before error):", JSON.stringify(output, null, 2));
        } else if (llmResponse) {
            console.error("LLM Raw Text Response (on error):", llmResponse.text);
            console.error("LLM Finish Reason (on error):", llmResponse.finishReason);
            console.error("LLM Usage Data (on error):", llmResponse.usage);
        }

        // Fallback: Default to Income, as it's always safe and available (unless must Coup and cannot)
        let fallbackAction: string = 'Income';
        let fallbackTarget: string | undefined = undefined;
        let fallbackReasoning = `AI generation/parsing/validation failed: ${errorMessage}. Raw output might be logged above.`;

         // Must Coup logic in fallback
         if (input.playerMoney >= 10) {
             const canCoup = input.availableActions.includes('Coup');
             const activeOpponentsForFallback = input.opponentInfo.filter(o => o.influenceCount > 0);
             if (canCoup && activeOpponentsForFallback.length > 0) {
                fallbackAction = 'Coup';
                fallbackTarget = activeOpponentsForFallback[Math.floor(Math.random() * activeOpponentsForFallback.length)].name;
                 fallbackReasoning += ` Must Coup, fallback target selected.`;
                console.warn(`AI Action Selection Fallback: Must Coup, targeting random opponent ${fallbackTarget} due to error: ${errorMessage}`);
             } else if (!canCoup && activeOpponentsForFallback.length > 0) {
                 // Should not happen if logic is correct, but handle it
                 fallbackAction = 'Income'; // Can't coup, so income is safest bet
                 console.warn(`AI Action Selection Fallback: Must Coup, but Coup not available? Defaulting to Income.`);
                 fallbackReasoning += ` Must Coup but action unavailable. Defaulting to ${fallbackAction}.`;
             } else { // Cannot Coup because no targets
                  fallbackAction = 'Income'; // Can't coup, so income is safest bet
                 console.warn(`AI Action Selection Fallback: Must Coup, but no targets available. Defaulting to Income due to error: ${errorMessage}`);
                 fallbackReasoning += ` Must Coup but no targets. Defaulting to ${fallbackAction}.`;
             }
         } else if (!input.availableActions.includes('Income')) {
             // If Income somehow isn't available (e.g., must Coup was chosen above, but failed target check)
             // Find *any* available action as a last resort
             fallbackAction = input.availableActions[0] || 'Coup'; // Desperation fallback
             fallbackReasoning += ` Defaulting to ${fallbackAction} as Income unavailable.`;
             console.warn(`AI Action Selection Fallback: Income not available? Defaulting to ${fallbackAction} due to error: ${errorMessage}`);
             // If this fallback needs a target, we might still fail later, but it's better than crashing
             if (['Coup', 'Assassinate', 'Steal'].includes(fallbackAction)) {
                  const activeOpponentsForFallback = input.opponentInfo.filter(o => o.influenceCount > 0);
                  if(activeOpponentsForFallback.length > 0) {
                     fallbackTarget = activeOpponentsForFallback[Math.floor(Math.random() * activeOpponentsForFallback.length)].name;
                     fallbackReasoning += ` Selecting random target ${fallbackTarget}.`;
                  } else {
                       // If even the fallback action needs a target and there are none, we're stuck.
                       // This case should be prevented by earlier logic.
                       console.error(`AI Action Selection Fallback: Fallback action ${fallbackAction} needs target but none exist!`);
                       // Let the game logic handle this impossible state?
                  }
             }

         } else {
             // Default to Income is the standard fallback
             console.warn(`AI Action Selection Fallback: Defaulting to Income due to error: ${errorMessage}`);
              fallbackReasoning += ` Defaulting to ${fallbackAction}.`;
         }


         return {
             action: fallbackAction,
             reasoning: fallbackReasoning,
             target: fallbackTarget
         };
    }
});


export async function selectAction(input: AIActionSelectionInput): Promise<AIActionSelectionOutput> {
    console.log("[selectAction Export] AI Selecting Action with input:", JSON.stringify(input, null, 2));
    try {
        // Add rulebook dynamically if not already present (optional chaining just in case)
        const flowInput = { ...input, rulebook: input.rulebook ?? coupRulebook };
        // Call the defined flow with the input
        const result = await aiActionSelectionFlow(flowInput); // Await the flow execution
        console.log("[selectAction Export] AI Action selected:", result);
        return result;
    } catch (error: any) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         const errorStack = error instanceof Error ? error.stack : 'No stack available';
         console.error("[selectAction Export] Error executing aiActionSelectionFlow:", errorMessage);
         console.error("[selectAction Export] Flow Execution Error Stack:", errorStack); // Log stack trace of flow execution error

        // Fallback logic duplicated here for safety, in case flow execution fails catastrophically
        let fallbackAction: string = 'Income';
        let fallbackTarget: string | undefined = undefined;
        let fallbackReasoning = `An unexpected error occurred during AI action selection flow execution: ${errorMessage}.`;

         if (input.playerMoney >= 10) {
             const canCoup = input.availableActions.includes('Coup');
             const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
             if (canCoup && activeOpponents.length > 0) {
                 fallbackAction = 'Coup';
                 fallbackTarget = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].name;
                 fallbackReasoning += ` Must Coup, fallback target selected.`;
                 console.warn(`AI Action Selection Fallback (Flow Execution): Must Coup, targeting random opponent ${fallbackTarget} due to error: ${errorMessage}`);
             } else {
                  fallbackAction = 'Income'; // Can't Coup (no targets or action unavailable)
                 console.warn(`AI Action Selection Fallback (Flow Execution): Must Coup, but cannot (unavailable or no targets). Defaulting to Income due to error: ${errorMessage}`);
                 fallbackReasoning += ` Must Coup but cannot perform. Defaulting to ${fallbackAction}.`;
             }
         } else if (!input.availableActions.includes('Income')) {
              fallbackAction = input.availableActions[0] || 'Coup'; // Desperation
              fallbackReasoning += ` Defaulting to ${fallbackAction} as Income unavailable.`;
              console.warn(`AI Action Selection Fallback (Flow Execution): Income not available? Defaulting to ${fallbackAction} due to error: ${errorMessage}`);
              if (['Coup', 'Assassinate', 'Steal'].includes(fallbackAction)) {
                    const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
                    if(activeOpponents.length > 0) {
                       fallbackTarget = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].name;
                       fallbackReasoning += ` Selecting random target ${fallbackTarget}.`;
                    } else {
                        console.error(`AI Action Selection Fallback (Flow Execution): Fallback action ${fallbackAction} needs target but none exist!`);
                    }
              }
         } else {
            // Default to Income
            console.warn(`AI Action Selection Fallback (Flow Execution): Defaulting to Income due to error: ${errorMessage}`);
             fallbackReasoning += ` Defaulting to ${fallbackAction}.`;
         }

       return {
           action: fallbackAction,
           reasoning: fallbackReasoning,
           target: fallbackTarget,
       };
    }
}
