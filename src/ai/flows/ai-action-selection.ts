
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
import { join } from 'path'; // Import join from path
import type { GenerateResponse } from 'genkit'; // Import type for response

// Define Zod schemas matching the prompt file structure
const AIActionSelectionInputSchema = z.object({
  playerMoney: z.number().describe('The amount of money the AI player has.'),
  playerInfluenceCards: z.array(z.string()).describe("The AI player's current *unrevealed* influence cards (e.g., ['Duke', 'Assassin'])."), // Added for better context
  opponentInfo: z.array(z.object({ // Added for more context on opponents
        name: z.string(),
        money: z.number(),
        influenceCount: z.number(),
        revealedCards: z.array(z.string()),
  })).describe('Information about the active opponents.'),
  availableActions: z
    .array(z.string())
    .describe('The actions the AI player can currently take (e.g., Income, Foreign Aid, Coup).'),
  gameState: z.string().describe('A description of the current game state, including action log summary.'), // Clarify content
});
export type AIActionSelectionInput = z.infer<typeof AIActionSelectionInputSchema>;

const AIActionSelectionOutputSchema = z.object({
  action: z.string().describe('The action the AI player should take (must be one of the availableActions).'),
  target: z.string().optional().describe("The name of the target opponent player, ONLY if the action requires it (e.g., Coup, Assassinate, Steal). Must be one of the opponent names from opponentInfo."),
  reasoning: z.string().describe('The AI reasoning for selecting this action and target (if any).'),
});
export type AIActionSelectionOutput = z.infer<typeof AIActionSelectionOutputSchema>;


// Load the prompt from the external file
const selectActionPrompt = ai.definePrompt({
    name: 'selectActionPrompt', // Matches the name in the prompt file
    promptPath: join(process.cwd(), 'src', 'ai', 'prompts', 'selectActionPrompt.prompt'), // Reference the main prompt file
    // Register the rulebook as a partial prompt that can be included via {{> coupRulebook}}
    partials: { coupRulebook: {promptPath: join(process.cwd(), 'src', 'ai', 'rules', 'coup-rulebook-pt-br.txt')}},
    input: { schema: AIActionSelectionInputSchema },
    output: { schema: AIActionSelectionOutputSchema },
     model: 'googleai/gemini-1.5-flash', // Specify model if needed, otherwise uses default
     response: {
        format: 'json', // Expect JSON output
    },
    // Increase temperature slightly for more varied strategies?
    // config: { temperature: 0.7 },
});


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
        console.log("[aiActionSelectionFlow] Checking selectActionPrompt object:", typeof selectActionPrompt, Object.keys(selectActionPrompt || {}));

        if (typeof selectActionPrompt?.generate !== 'function') {
            console.error("[aiActionSelectionFlow] CRITICAL ERROR: selectActionPrompt.generate is NOT a function! Prompt definition might have failed.");
            console.error("[aiActionSelectionFlow] selectActionPrompt value:", selectActionPrompt);
            throw new Error("Internal Server Error: AI prompt definition failed."); // Throw a more specific internal error
        }

        console.log("[aiActionSelectionFlow] Calling selectActionPrompt.generate...");
        llmResponse = await selectActionPrompt.generate({ input });
        console.log("[aiActionSelectionFlow] LLM response received. Finish Reason:", llmResponse.finishReason);
        console.log("[aiActionSelectionFlow] LLM Raw Text:", llmResponse.text);

        // Access output directly in 1.x
        output = llmResponse.output; // This might be null if generation fails structurally

        if (!output) {
            console.error("AI Action Selection Error: LLM response did not contain structured output (output was null/undefined).");
            console.error("LLM Raw Text Response:", llmResponse.text);
            console.error("LLM Finish Reason:", llmResponse.finishReason);
            console.error("LLM Usage Data:", llmResponse.usage);
            throw new Error("LLM response did not contain structured output."); // Throw to be caught below
        }
        console.log("[aiActionSelectionFlow] Raw output from LLM:", JSON.stringify(output, null, 2));


        // Validate output against schema - Genkit might do this implicitly with response format 'json'
        // but explicit validation is safer.
        const validatedOutput = AIActionSelectionOutputSchema.parse(output);
        console.log("AI Action Selection Flow: Successfully generated and validated output:", validatedOutput);
        return validatedOutput;

    } catch (e: any) {
        // Catch Zod validation errors and other potential errors during generation/parsing
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("AI Action Selection Error:", errorMessage); // Log the error message
        console.error("Error Details:", e); // Log the full error object for more context
        console.error("Input Sent to AI:", JSON.stringify(input, null, 2)); // Log input on error
        if (output) { // Log the raw output if available, even if invalid
             console.error("Raw AI Output (before parsing/validation):", JSON.stringify(output, null, 2));
        } else if (llmResponse) { // Log raw text if structured output was null
             console.error("LLM Raw Text Response (on error):", llmResponse.text);
             console.error("LLM Finish Reason (on error):", llmResponse.finishReason);
             console.error("LLM Usage Data (on error):", llmResponse.usage);
        }
        // Provide a fallback even if generation technically succeeded but output is empty/null/invalid
        return {
            action: 'Income', // Safest default action
            reasoning: `AI generation, parsing, or validation failed: ${errorMessage}. Raw output might be logged above. Defaulting to Income.`,
            target: undefined, // Ensure target is undefined for Income
        };
    }
  }
);


export async function selectAction(input: AIActionSelectionInput): Promise<AIActionSelectionOutput> {
  console.log("AI Selecting Action with input:", JSON.stringify(input, null, 2)); // Pretty print input
  try {
      const result = await aiActionSelectionFlow(input);
      console.log("AI Action selected:", result);
      return result;
  } catch (error: any) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       console.error("Error executing aiActionSelectionFlow:", error);
       // Fallback in case the flow itself throws an unexpected error
       return {
           action: 'Income', // Safest default action
           reasoning: `An unexpected error occurred during AI action selection flow execution: ${errorMessage}. Defaulting to Income.`,
           target: undefined,
       };
  }
}
