
'use server';

/**
 * @fileOverview Provides reasoning for the AI's decision to challenge an opponent's action.
 *
 * - aiChallengeReasoning - Decides if the AI should challenge.
 * - AiChallengeReasoningInput - Input type.
 * - AiChallengeReasoningOutput - Return type.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import { join } from 'path';

// Define Zod schemas matching the prompt file structure
const AiChallengeReasoningInputSchema = z.object({
  action: z.string().describe('The action being performed by the opponent OR the block being performed.'),
  currentPlayer: z.string().describe('The name of the player performing the action/block being potentially challenged.'),
  targetPlayer: z.string().optional().describe('The name of the target player of the *original* action, if applicable.'), // Clarify this is original target
  amount: z.number().optional().describe('The amount of coins involved in the action, if applicable.'),
  aiInfluence: z.array(z.string()).describe('The AI player’s current *unrevealed* influence cards.'),
  opponentInfluenceCount: z.number().describe('The number of *unrevealed* influence cards the player performing the action/block has.'),
  gameState: z.string().describe('A summary of the current game state including player money and known/revealed card information.'),
});
export type AiChallengeReasoningInput = z.infer<typeof AiChallengeReasoningInputSchema>;

const AiChallengeReasoningOutputSchema = z.object({
  shouldChallenge: z.boolean().describe('Whether the AI should challenge the action/block.'),
  reason: z.string().describe('The AI’s reasoning for challenging or not challenging.'),
});
export type AiChallengeReasoningOutput = z.infer<typeof AiChallengeReasoningOutputSchema>;

// Load the prompt from the external file
const challengeReasoningPrompt = ai.definePrompt({
    name: 'aiChallengeReasoningPrompt', // Matches name in prompt file
    promptPath: join(process.cwd(), 'src', 'ai', 'prompts', 'aiChallengeReasoningPrompt.prompt'), // Correct path including rulebook context
    input: { schema: AiChallengeReasoningInputSchema },
    output: { schema: AiChallengeReasoningOutputSchema },
     model: 'googleai/gemini-1.5-flash',
     response: {
        format: 'json',
    },
});


// Define the flow using the loaded prompt
const aiChallengeReasoningFlow = ai.defineFlow<
  typeof AiChallengeReasoningInputSchema,
  typeof AiChallengeReasoningOutputSchema
>(
  {
    name: 'aiChallengeReasoningFlow',
    inputSchema: AiChallengeReasoningInputSchema,
    outputSchema: AiChallengeReasoningOutputSchema,
  },
  async (input) => {
     // Use generate instead of invoke (invoke is deprecated/changed in 1.x)
    const llmResponse = await challengeReasoningPrompt.generate({ input });
     // Access output directly in 1.x
    const output = llmResponse.output;

    if (!output) {
        console.error("AI Challenge Reasoning Error: No output generated.");
        return {
             shouldChallenge: false, // Default to not challenging on error
             reason: 'AI failed to generate a valid challenge reasoning response, defaulting to not challenging.',
         };
    }

    // Validate output
    try {
         const validatedOutput = AiChallengeReasoningOutputSchema.parse(output);
         return validatedOutput;
    } catch (e) {
        console.error("AI Challenge Reasoning Output validation failed:", e);
         console.error("Invalid AI output:", output);
         // Fallback logic: Default to not challenging
         return {
             shouldChallenge: false,
             reason: 'AI response validation failed, defaulting to not challenging.',
         };
    }
  }
);

export async function aiChallengeReasoning(input: AiChallengeReasoningInput): Promise<AiChallengeReasoningOutput> {
    console.log("AI Challenge Reasoning with input:", JSON.stringify(input, null, 2)); // Pretty print input
    try {
        const result = await aiChallengeReasoningFlow(input);
        console.log("AI Challenge decision:", result);
        return result;
    } catch (error) {
        console.error("Error in aiChallengeReasoningFlow:", error);
        // Fallback in case the flow itself throws an error
        return {
            shouldChallenge: false,
            reason: 'An unexpected error occurred during AI challenge reasoning, defaulting to not challenging.',
        };
    }
}
