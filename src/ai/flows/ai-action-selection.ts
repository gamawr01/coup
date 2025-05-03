
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

// Define Zod schemas matching the prompt file structure
const AIActionSelectionInputSchema = z.object({
  playerMoney: z.number().describe('The amount of money the AI player has.'),
  playerInfluence: z.number().describe('The number of influence cards the AI player has.'),
  opponentActions: z
    .array(z.string())
    .describe('The recent actions taken by opponents in the game.'),
  availableActions: z
    .array(z.string())
    .describe('The actions the AI player can currently take (e.g., Income, Foreign Aid, Coup).'),
  gameState: z.string().describe('A description of the current game state.'),
});
export type AIActionSelectionInput = z.infer<typeof AIActionSelectionInputSchema>;

const AIActionSelectionOutputSchema = z.object({
  action: z.string().describe('The action the AI player should take.'),
  target: z.string().optional().describe('The target player\'s name, if applicable.'),
  reasoning: z.string().describe('The AI reasoning for selecting this action.'),
});
export type AIActionSelectionOutput = z.infer<typeof AIActionSelectionOutputSchema>;


// Load the prompt from the external file
const selectActionPrompt = ai.definePrompt({
    name: 'selectActionPrompt', // Matches the name in the prompt file
    promptPath: join(process.cwd(), 'src', 'ai', 'prompts', 'selectActionPrompt.prompt'), // Correct path
    input: { schema: AIActionSelectionInputSchema },
    output: { schema: AIActionSelectionOutputSchema },
     model: 'googleai/gemini-1.5-flash', // Specify model if needed, otherwise uses default
     response: {
        format: 'json', // Expect JSON output
    },
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
    const llmResponse = await selectActionPrompt.generate({ input });
    const output = llmResponse.output();

    if (!output) {
        throw new Error("AI failed to generate a valid action selection response.");
    }

     // Validate output against schema - Genkit might do this implicitly with response format 'json'
     // but explicit validation is safer.
    try {
        AIActionSelectionOutputSchema.parse(output);
        return output;
    } catch (e) {
        console.error("AI Action Selection Output validation failed:", e);
         console.error("Invalid AI output:", output); // Log the invalid output
         // Fallback logic: Return a safe default action like Income
         return {
             action: 'Income',
             reasoning: 'AI response validation failed, defaulting to Income.',
         };
    }
  }
);


export async function selectAction(input: AIActionSelectionInput): Promise<AIActionSelectionOutput> {
  console.log("AI Selecting Action with input:", input);
  const result = await aiActionSelectionFlow(input);
   console.log("AI Action selected:", result);
  return result;
}
