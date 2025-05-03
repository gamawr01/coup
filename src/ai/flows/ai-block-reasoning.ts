
'use server';

/**
 * @fileOverview Determines whether the AI should block an action based on reasoning.
 *
 * - aiBlockReasoning - A function that decides if the AI should block an action.
 * - AIBlockReasoningInput - The input type for the aiBlockReasoning function.
 * - AIBlockReasoningOutput - The return type for the aiBlockReasoning function.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import { join } from 'path';

// Define Zod schemas matching the prompt file structure
const AIBlockReasoningInputSchema = z.object({
  action: z.string().describe('The action being performed by the opponent that you might block.'),
   // Renamed for clarity to match prompt
  aiPlayerInfluenceCards: z
    .array(z.string())
    .describe("The AI player's current *unrevealed* influence cards."),
  aiPlayerMoney: z.number().describe('The amount of money the AI player has.'),
   // Renamed for clarity
  opponentInfluenceCount: z
    .number()
    .describe('The number of *unrevealed* influence cards the opponent performing the action has.'),
  opponentMoney: z.number().describe('The amount of money the opponent performing the action has.'),
  gameState: z
    .string()
    .describe('The current state of the game, as a descriptive summary.'),
});
export type AIBlockReasoningInput = z.infer<typeof AIBlockReasoningInputSchema>;

const AIBlockReasoningOutputSchema = z.object({
  shouldBlock: z
    .boolean()
    .describe('Whether the AI should block the action or not.'),
  reasoning: z.string().describe('The AI reasoning behind the decision.'),
});
export type AIBlockReasoningOutput = z.infer<typeof AIBlockReasoningOutputSchema>;


// Load the prompt from the external file
const blockReasoningPrompt = ai.definePrompt({
    name: 'aiBlockReasoningPrompt', // Matches name in prompt file
    promptPath: join(process.cwd(), 'src', 'ai', 'prompts', 'aiBlockReasoningPrompt.prompt'), // Correct path including rulebook context
    input: { schema: AIBlockReasoningInputSchema },
    output: { schema: AIBlockReasoningOutputSchema },
     model: 'googleai/gemini-1.5-flash',
     response: {
        format: 'json',
    },
});


// Define the flow using the loaded prompt
const aiBlockReasoningFlow = ai.defineFlow<
  typeof AIBlockReasoningInputSchema,
  typeof AIBlockReasoningOutputSchema
>(
  {
    name: 'aiBlockReasoningFlow',
    inputSchema: AIBlockReasoningInputSchema,
    outputSchema: AIBlockReasoningOutputSchema,
  },
  async (input) => {
     // Use generate instead of invoke (invoke is deprecated/changed in 1.x)
     const llmResponse = await blockReasoningPrompt.generate({ input });
     // Access output directly in 1.x
     const output = llmResponse.output;

    if (!output) {
         console.error("AI Block Reasoning Error: No output generated.");
         return {
             shouldBlock: false, // Default to not blocking on error
             reasoning: 'AI failed to generate a valid block reasoning response, defaulting to not blocking.',
         };
    }

     // Validate output
     try {
          const validatedOutput = AIBlockReasoningOutputSchema.parse(output);
          return validatedOutput;
     } catch (e) {
         console.error("AI Block Reasoning Output validation failed:", e);
         console.error("Invalid AI output:", output);
         // Fallback logic: Default to not blocking
         return {
             shouldBlock: false,
             reasoning: 'AI response validation failed, defaulting to not blocking.',
         };
     }
  }
);


export async function aiBlockReasoning(input: AIBlockReasoningInput): Promise<AIBlockReasoningOutput> {
   console.log("AI Block Reasoning with input:", JSON.stringify(input, null, 2)); // Pretty print input
   // Map the influence number back to card names if needed by the prompt - assuming prompt takes card names now
   // This check might be redundant if input always provides cards, but safe to keep.
   const mappedInput = {
       ...input,
       aiPlayerInfluenceCards: input.aiPlayerInfluenceCards || [], // Ensure it's an array
   };
   try {
       const result = await aiBlockReasoningFlow(mappedInput);
       console.log("AI Block decision:", result);
       return result;
   } catch (error) {
        console.error("Error in aiBlockReasoningFlow:", error);
        // Fallback in case the flow itself throws an error
        return {
            shouldBlock: false,
            reasoning: 'An unexpected error occurred during AI block reasoning, defaulting to not blocking.',
        };
   }
}
