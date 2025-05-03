
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
const selectActionPrompt = ai.definePrompt({
    name: 'selectActionPrompt',
    input: { schema: AIActionSelectionInputSchema },
    output: { schema: AIActionSelectionOutputSchema },
     model: 'googleai/gemini-1.5-flash',
     response: {
        format: 'json',
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
- If an action requires a target (Coup, Assassinate, Steal), choose the best opponent target based on their influence, money, and potential threats. Ensure the target name exactly matches one from the Opponent Information list.
- Provide your reasoning, explaining why you chose this action (and target, if applicable) over others.
- **CRITICAL:** Your output *must* be a valid JSON object matching the defined output schema. The 'action' field *must* be one of the strings from the 'availableActions' input array.

Output Format (JSON):
{
  "action": "Selected action (must be from availableActions)",
  "target": "Target player name (optional, required for Coup/Assassinate/Steal, must be from opponentInfo)",
  "reasoning": "Your detailed thought process for this decision."
}
`,
});

// --- Logging after prompt definition ---
console.log("[aiActionSelectionFlow] Logging selectActionPrompt object immediately after definition:");
console.log(`[aiActionSelectionFlow] typeof selectActionPrompt: ${typeof selectActionPrompt}`);
console.log(`[aiActionSelectionFlow] selectActionPrompt keys: ${selectActionPrompt ? Object.keys(selectActionPrompt).join(', ') : 'null/undefined'}`);
console.log(`[aiActionSelectionFlow] typeof selectActionPrompt.generate: ${typeof selectActionPrompt?.generate}`);
// --- End Logging ---


// Define the flow using the loaded prompt
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
        console.log("[aiActionSelectionFlow] Checking selectActionPrompt object inside flow:", typeof selectActionPrompt);

        if (typeof selectActionPrompt !== 'function' || typeof selectActionPrompt?.generate !== 'function') {
             console.error("[aiActionSelectionFlow] CRITICAL ERROR: selectActionPrompt.generate is NOT a function! Prompt definition might have failed.");
             console.error("[aiActionSelectionFlow] selectActionPrompt value:", selectActionPrompt);
             // Capture more details about the prompt object if it exists but lacks generate
             if(selectActionPrompt) {
                console.error("[aiActionSelectionFlow] selectActionPrompt keys inside error check:", Object.keys(selectActionPrompt).join(', '));
             }
            throw new Error("Internal Server Error: AI prompt definition failed."); // More specific error
        }

        console.log("[aiActionSelectionFlow] Calling selectActionPrompt.generate...");
        // Pass input directly to the prompt function, as definePrompt wraps generate
        llmResponse = await selectActionPrompt.generate({ input });
        console.log("[aiActionSelectionFlow] LLM response received. Finish Reason:", llmResponse.finishReason);
        // console.log("[aiActionSelectionFlow] LLM Raw Text:", llmResponse.text); // Less verbose logging

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
             throw new Error(`Chosen action "${validatedOutput.action}" is not available.`);
        }

        // Additional validation: Ensure target is valid if provided
        if (validatedOutput.target) {
             const targetValid = input.opponentInfo.some(opp => opp.name === validatedOutput.target);
             if (!targetValid) {
                 console.error(`AI Action Selection Error: Target "${validatedOutput.target}" is not a valid opponent name.`);
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
         console.error("AI Action Selection Error:", errorMessage);
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
        let fallbackReasoning = `AI generation/parsing/validation failed: ${errorMessage}.`;

         if (input.playerMoney >= 10 && input.availableActions.includes('Coup')) {
            // Must coup if possible
            fallbackAction = 'Coup';
            // Try to pick a random target if must Coup
             const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
             fallbackTarget = activeOpponents.length > 0 ? activeOpponents[Math.floor(Math.random() * activeOpponents.length)].name : undefined;
             fallbackReasoning += ` Must Coup, fallback target selected.`;
            console.warn(`AI Action Selection Fallback: Must Coup, targeting random opponent ${fallbackTarget || 'N/A'} due to error: ${errorMessage}`);
         } else if (input.playerMoney >= 10 && !input.availableActions.includes('Coup')) {
             // Must Coup but cannot (no targets). Default to Income.
             console.warn(`AI Action Selection Fallback: Must Coup, but no targets available. Defaulting to Income due to error: ${errorMessage}`);
             fallbackAction = 'Income';
             fallbackReasoning += ` Must Coup but no targets. Defaulting to ${fallbackAction}.`;
         } else {
              // Default to Income
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
  console.log("AI Selecting Action with input:", JSON.stringify(input, null, 2));
  try {
      // Add rulebook content dynamically to the input for the flow
      const flowInput = { ...input, rulebook: coupRulebook };
      const result = await aiActionSelectionFlow(flowInput);
      console.log("AI Action selected:", result);
      return result;
  } catch (error: any) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       const errorStack = error instanceof Error ? error.stack : 'No stack available';
       console.error("Error executing aiActionSelectionFlow:", errorMessage);
       console.error("Flow Execution Error Stack:", errorStack); // Log stack trace of flow execution error
        // Fallback: Default to Income, as it's always safe and available (unless must Coup and cannot)
        let fallbackAction: string = 'Income';
        let fallbackTarget: string | undefined = undefined;
        let fallbackReasoning = `An unexpected error occurred during AI action selection flow execution: ${errorMessage}.`;

         if (input.playerMoney >= 10 && input.availableActions.includes('Coup')) {
            // Must coup if possible
            fallbackAction = 'Coup';
            const activeOpponents = input.opponentInfo.filter(o => o.influenceCount > 0);
            fallbackTarget = activeOpponents.length > 0 ? activeOpponents[Math.floor(Math.random() * activeOpponents.length)].name : undefined;
            fallbackReasoning += ` Must Coup, fallback target selected.`;
            console.warn(`AI Action Selection Fallback (Flow Execution): Must Coup, targeting random opponent ${fallbackTarget || 'N/A'} due to error: ${errorMessage}`);
         } else if (input.playerMoney >= 10 && !input.availableActions.includes('Coup')) {
             console.warn(`AI Action Selection Fallback (Flow Execution): Must Coup, but no targets available. Defaulting to Income due to error: ${errorMessage}`);
             fallbackAction = 'Income';
             fallbackReasoning += ` Must Coup but no targets. Defaulting to ${fallbackAction}.`;
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
