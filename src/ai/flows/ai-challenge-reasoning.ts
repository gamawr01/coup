
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
  action: z.string().describe('The action being performed by the opponent.'),
  currentPlayer: z.string().describe('The name of the current player performing the action.'),
  targetPlayer: z.string().optional().describe('The name of the target player, if applicable.'), // Made optional
  amount: z.number().optional().describe('The amount of coins involved in the action, if applicable.'),
  aiInfluence: z.array(z.string()).describe('The AI player’s current *unrevealed* influence cards.'),
  opponentInfluenceCount: z.number().describe('The number of *unrevealed* influence cards the opponent (currentPlayer) has.'),
  gameState: z.string().describe('A summary of the current game state including player money and known/revealed card information.'),
});
export type AiChallengeReasoningInput = z.infer<typeof AiChallengeReasoningInputSchema>;

const AiChallengeReasoningOutputSchema = z.object({
  shouldChallenge: z.boolean().describe('Whether the AI should challenge the action.'),
  reason: z.string().describe('The AI’s reasoning for challenging or not challenging the action.'),
});
export type AiChallengeReasoningOutput = z.infer<typeof AiChallengeReasoningOutputSchema>;

// Load the prompt from the external file
const challengeReasoningPrompt = ai.definePrompt({
    name: 'aiChallengeReasoningPrompt', // Matches name in prompt file
    promptPath: join(process.cwd(), 'src', 'ai', 'prompts', 'aiChallengeReasoningPrompt.prompt'), // Correct path
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
    const llmResponse = await challengeReasoningPrompt.generate({ input });
    const output = llmResponse.output();

    if (!output) {
        throw new Error("AI failed to generate a valid challenge reasoning response.");
    }

    // Validate output
    try {
        AiChallengeReasoningOutputSchema.parse(output);
        return output;
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
    console.log("AI Challenge Reasoning with input:", input);
    const result = await aiChallengeReasoningFlow(input);
    console.log("AI Challenge decision:", result);
   return result;
}
