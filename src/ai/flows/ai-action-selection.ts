
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


// Define the prompt inline
const selectActionPrompt = ai.definePrompt(
    {
        name: 'selectActionPrompt',
        input: { schema: AIActionSelectionInputSchema },
        output: { schema: AIActionSelectionOutputSchema },
        model: 'googleai/gemini-1.5-flash', // Use a capable model
        response: {
            format: 'json', // Request JSON output
        },
        prompt: `
You are an AI player in the card game Coup. Your goal is to be the last player with influence remaining.
Analyze the current game state, your resources, your hidden cards, and opponent information to select the strategically best action from the list of currently available actions.

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
Choose the best action from the "Available Actions" list.
- Consider short-term gains (money) and long-term strategy (eliminating opponents, bluffing potential).
- If an action requires a target (Coup, Assassinate, Steal), choose the best opponent target based on their influence, money, and potential threats. Ensure the target name exactly matches one from the Opponent Information list. If multiple targets are equally viable, choose randomly among them.
- Provide your reasoning, explaining why you chose this action (and target, if applicable) over others.
- **CRITICAL:** Your output *must* be a valid JSON object matching the defined output schema. The 'action' field *must* be one of the strings from the 'availableActions' input array.

Output Format (JSON):
{
  "action": "Selected action (must be from availableActions)",
  "target": "Target player name (optional, required for Coup/Assassinate/Steal, must be from opponentInfo)",
  "reasoning": "Your detailed thought process for this decision."
}
`,
    },
   // Add prompt function immediately - This is crucial for Genkit v1.x
   async (input) => {
       console.log("[selectActionPrompt function] Prompt function called with input:", input);
       // This function *is* the generate call now in Genkit v1.x
       // No need to call .generate() separately on the prompt object itself.
       // The framework handles the LLM call based on the prompt definition.
       // The return structure is automatically handled by Genkit if response format is JSON.
       // If we needed manipulation *before* the LLM call, it would go here.
       // If we needed manipulation *after* the LLM call (before returning), we'd need a flow.
       // Since this is directly used in a flow, we let the flow handle input/output.
        return; // No explicit return needed here, Genkit handles it based on config.
    }
);


// Define the flow using the prompt
const aiActionSelectionFlow = ai.defineFlow<
  typeof AIActionSelectionInputSchema,
  typeof AIActionSelectionOutputSchema
>(
  {
    name: 'aiActionSelectionFlow',
    inputSchema: AIActionSelectionInputSchema,
    outputSchema: AIActionSelectionOutputSchema,
  },
  async (input) => {
    let llmResponse: GenerateResponse<z.infer<typeof AIActionSelectionOutputSchema>> | null = null;
    let output: AIActionSelectionOutput | null = null;
    try {
        console.log("[aiActionSelectionFlow] Input received:", JSON.stringify(input, null, 2));

        // === Enhanced Logging Start ===
        console.log("[aiActionSelectionFlow] --- Debugging Prompt Object ---");
        console.log("[aiActionSelectionFlow] typeof selectActionPrompt:", typeof selectActionPrompt);
        if (selectActionPrompt) {
            console.log("[aiActionSelectionFlow] selectActionPrompt keys:", Object.keys(selectActionPrompt).join(', '));
            console.log("[aiActionSelectionFlow] selectActionPrompt itself:", selectActionPrompt); // Log the function object itself
            // Check if it's a function as expected in Genkit v1.x flow definition
            if (typeof selectActionPrompt === 'function') {
                 console.log("[aiActionSelectionFlow] selectActionPrompt IS a function. Correct for Genkit v1.x flow.");
            } else {
                 console.error("[aiActionSelectionFlow] CRITICAL ERROR: selectActionPrompt is NOT a function!");
            }
        } else {
            console.error("[aiActionSelectionFlow] CRITICAL ERROR: selectActionPrompt is null or undefined!");
        }
        console.log("[aiActionSelectionFlow] --- End Debugging Prompt Object ---");
        // === Enhanced Logging End ===


        // In Genkit v1.x, the defined prompt *is* the function to call.
        console.log("[aiActionSelectionFlow] Calling the selectActionPrompt function (which triggers generation)...");
        // The flow passes the input to the prompt function directly.
        // The prompt definition itself handles the generation.
        llmResponse = await selectActionPrompt.generate({ input }); // CORRECT: Use generate method on the prompt *object*

        console.log("[aiActionSelectionFlow] LLM response received. Finish Reason:", llmResponse.finishReason);

        output = llmResponse.output;

        if (!output) {
            console.error("AI Action Selection Error: LLM response did not contain structured output (output was null/undefined).");
            console.error("LLM Raw Text Response:", llmResponse.text);
            console.error("LLM Finish Reason:", llmResponse.finishReason);
            console.error("LLM Usage Data:", llmResponse.usage);
            throw new Error("LLM response did not contain structured output.");
        }
        console.log("[aiActionSelectionFlow] Raw output from LLM:", JSON.stringify(output, null, 2));

        // Validate output against schema
        const validatedOutput = AIActionSelectionOutputSchema.parse(output);

        // Additional validation: Ensure action is one of the available actions
        if (!input.availableActions.includes(validatedOutput.action)) {
             console.error(`AI Action Selection Error: Chosen action "${validatedOutput.action}" is not in the available list: [${input.availableActions.join(', ')}]`);
             // Attempt to find the closest valid action? For now, throw error.
             throw new Error(`Chosen action "${validatedOutput.action}" is not available. Available: [${input.availableActions.join(', ')}]`);
        }

        // Additional validation: Ensure target is valid if provided
        if (validatedOutput.target) {
             const targetValid = input.opponentInfo.some(opp => opp.name === validatedOutput.target);
             if (!targetValid) {
                 console.error(`AI Action Selection Error: Target "${validatedOutput.target}" is not a valid opponent name. Valid: [${input.opponentInfo.map(o=>o.name).join(', ')}]`);
                 // Attempt to pick a valid random target? For now, throw error.
                 throw new Error(`Target "${validatedOutput.target}" is not valid.`);
             }
             // Ensure action actually requires a target
             const actionsNeedingTarget: string[] = ['Coup', 'Assassinate', 'Steal'];
              if (!actionsNeedingTarget.includes(validatedOutput.action)) {
                  console.warn(`AI Action Selection Warning: Target "${validatedOutput.target}" provided for action "${validatedOutput.action}" which doesn't require one. Ignoring target.`);
                  validatedOutput.target = undefined; // Clear the target
              }

        } else {
            // Ensure no target is provided if action *does* need one (and targets exist)
             const actionsNeedingTarget: string[] = ['Coup', 'Assassinate', 'Steal'];
             const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
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
         console.error("Error Stack:", errorStack); // Log stack trace
         console.error("Error Details:", e); // Log the full error object
        console.error("Input Sent to AI:", JSON.stringify(input, null, 2));
        if (output) {
             console.error("Raw AI Output (before parsing/validation):", JSON.stringify(output, null, 2));
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
             const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
             if (canCoup && activeOpponents.length > 0) {
                fallbackAction = 'Coup';
                fallbackTarget = activeOpponents[Math.floor(Math.random() * activeOpponents.length)].name;
                 fallbackReasoning += ` Must Coup, fallback target selected.`;
                console.warn(`AI Action Selection Fallback: Must Coup, targeting random opponent ${fallbackTarget} due to error: ${errorMessage}`);
             } else if (!canCoup && activeOpponents.length > 0) {
                 // Should not happen if logic is correct, but handle it
                 console.warn(`AI Action Selection Fallback: Must Coup, but Coup not available? Defaulting to Income.`);
                 fallbackReasoning += ` Must Coup but action unavailable. Defaulting to ${fallbackAction}.`;
             } else { // Cannot Coup because no targets
                 console.warn(`AI Action Selection Fallback: Must Coup, but no targets available. Defaulting to Income due to error: ${errorMessage}`);
                 fallbackReasoning += ` Must Coup but no targets. Defaulting to ${fallbackAction}.`;
             }
         } else {
             console.warn(`AI Action Selection Fallback: Defaulting to Income due to error: ${errorMessage}`);
              fallbackReasoning += ` Defaulting to ${fallbackAction}.`;
         }


         return {
             action: fallbackAction,
             reasoning: fallbackReasoning,
             target: fallbackTarget,
         };
    }
  }
);


export async function selectAction(input: AIActionSelectionInput): Promise<AIActionSelectionOutput> {
  console.log("[selectAction Export] AI Selecting Action with input:", JSON.stringify(input, null, 2));
  try {
      // Add rulebook content dynamically to the input for the flow
      const flowInput = { ...input, rulebook: coupRulebook };
      const result = await aiActionSelectionFlow(flowInput); // Call the defined flow
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
                 console.warn(`AI Action Selection Fallback (Flow Execution): Must Coup, but cannot (unavailable or no targets). Defaulting to Income due to error: ${errorMessage}`);
                 fallbackReasoning += ` Must Coup but cannot perform. Defaulting to ${fallbackAction}.`;
             }
         } else {
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
