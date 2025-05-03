
'use server';

/**
 * @fileOverview Provides reasoning for the AI's decision to challenge an opponent's action or block.
 *
 * - aiChallengeReasoning - Decides if the AI should challenge.
 * - AiChallengeReasoningInput - Input type.
 * - AiChallengeReasoningOutput - Return type.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import type { GenerateResponse } from 'genkit';
import { coupRulebook } from '@/ai/rules/coup-rulebook'; // Import rulebook content

// Define Zod schemas matching the prompt file structure
const AiChallengeReasoningInputSchema = z.object({
  actionOrBlock: z.string().describe('The action (e.g., Tax, Steal) OR the block (e.g., Block Foreign Aid, Block Assassination) being performed by the opponent that you might challenge.'),
  playerName: z.string().describe('The name of the player performing the action/block being potentially challenged.'),
  targetPlayerName: z.string().optional().describe('The name of the target player of the *original* action, if the thing being challenged is a block.'),
  aiInfluenceCards: z.array(z.string()).describe("The AI player’s current *unrevealed* influence cards (e.g., ['Duke', 'Assassin'])."),
  opponentInfluenceCount: z.number().describe('The number of *unrevealed* influence cards the player performing the action/block has.'),
  opponentMoney: z.number().describe('The amount of money the opponent performing the action/block has.'),
  gameState: z.string().describe('A summary of the current game state including all players money and revealed cards, and recent action log summary.'),
});
export type AiChallengeReasoningInput = z.infer<typeof AiChallengeReasoningInputSchema>;

const AiChallengeReasoningOutputSchema = z.object({
  shouldChallenge: z.boolean().describe('Whether the AI should challenge the action/block. Must be true or false.'),
  reasoning: z.string().describe('The AI’s reasoning for challenging or not challenging.'),
});
export type AiChallengeReasoningOutput = z.infer<typeof AiChallengeReasoningOutputSchema>;

// Define the prompt inline
const challengeReasoningPrompt = ai.definePrompt({
    name: 'aiChallengeReasoningPrompt',
    input: { schema: AiChallengeReasoningInputSchema },
    output: { schema: AiChallengeReasoningOutputSchema },
     model: 'googleai/gemini-1.5-flash',
     response: {
        format: 'json',
    },
    prompt: `
You are an AI player in the card game Coup. An opponent has declared an action or a block that you can potentially challenge. Decide whether you should challenge their claim.

**Rules Reference:**
${coupRulebook}

**Claim Being Made:**
- Action or Block: {{actionOrBlock}}
- Claimed by: {{playerName}}
- Opponent's Status: {{opponentInfluenceCount}} unrevealed influence, {{opponentMoney}} coins.
{{#if targetPlayerName}}
- (If blocking) Original Action Target: {{targetPlayerName}}
{{/if}}

**Your Current Situation:**
- Your Unrevealed Influence: [{{#each aiInfluenceCards}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]

**Current Game State Summary:**
{{gameState}}

**Your Task:**
Decide whether to challenge the opponent's claim (that they possess the necessary influence card for the declared {{actionOrBlock}}).
- Assess the likelihood the opponent is bluffing based on their previous actions, current money, remaining influence, and overall game state.
- Consider the consequences of a successful challenge (opponent loses influence) vs. a failed challenge (you lose influence). Is the potential gain worth the risk?
- Does challenging benefit you strategically, even if you might lose? (e.g., gaining information, forcing a card reveal).
- Provide your reasoning, explaining why you chose to challenge or not challenge.
- **CRITICAL:** Your output *must* be a valid JSON object matching the defined output schema. The 'shouldChallenge' field *must* be either true or false.

Output Format (JSON):
{
  "shouldChallenge": true | false,
  "reasoning": "Your detailed thought process for this decision."
}
`,
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
    let llmResponse: GenerateResponse<z.infer<typeof AiChallengeReasoningOutputSchema>> | null = null;
    let output: AiChallengeReasoningOutput | null = null;
     try {
         console.log("[aiChallengeReasoningFlow] Input received:", JSON.stringify(input, null, 2));
         console.log("[aiChallengeReasoningFlow] Checking challengeReasoningPrompt object:", typeof challengeReasoningPrompt);

         if (typeof challengeReasoningPrompt?.generate !== 'function') {
            console.error("[aiChallengeReasoningFlow] CRITICAL ERROR: challengeReasoningPrompt.generate is NOT a function! Prompt definition might have failed.");
            console.error("[aiChallengeReasoningFlow] challengeReasoningPrompt value:", challengeReasoningPrompt);
            throw new Error("Internal Server Error: AI prompt definition failed.");
         }
          console.log("[aiChallengeReasoningFlow] Calling challengeReasoningPrompt.generate...");
        llmResponse = await challengeReasoningPrompt.generate({ input });
         console.log("[aiChallengeReasoningFlow] LLM response received. Finish Reason:", llmResponse.finishReason);
         console.log("[aiChallengeReasoningFlow] LLM Raw Text:", llmResponse.text);


        output = llmResponse.output;

        if (!output) {
             console.error("AI Challenge Reasoning Error: LLM response did not contain structured output.");
             console.error("LLM Raw Text Response:", llmResponse.text);
             console.error("LLM Finish Reason:", llmResponse.finishReason);
             console.error("LLM Usage Data:", llmResponse.usage);
            throw new Error("LLM response did not contain structured output.");
        }
         console.log("[aiChallengeReasoningFlow] Raw output from LLM:", JSON.stringify(output, null, 2));

        // Validate output
        const validatedOutput = AiChallengeReasoningOutputSchema.parse(output);
        console.log("AI Challenge Reasoning Flow: Successfully generated and validated output:", validatedOutput);
        return validatedOutput;

     } catch (e: any) {
         const errorMessage = e instanceof Error ? e.message : String(e);
         console.error("AI Challenge Reasoning Error:", errorMessage);
         console.error("Error Details:", e);
         console.error("Input Sent to AI:", JSON.stringify(input, null, 2));
        if (output) {
             console.error("Raw AI Output (before parsing/validation):", JSON.stringify(output, null, 2));
        } else if (llmResponse) {
             console.error("LLM Raw Text Response (on error):", llmResponse.text);
             console.error("LLM Finish Reason (on error):", llmResponse.finishReason);
             console.error("LLM Usage Data (on error):", llmResponse.usage);
        }
         // Fallback logic: Default to not challenging
         console.warn(`AI Challenge Reasoning Fallback: Defaulting to not challenging due to error: ${errorMessage}`);
         return {
             shouldChallenge: false, // Safer default
             reasoning: `AI generation, parsing, or validation failed: ${errorMessage}. Raw output might be logged above. Defaulting to not challenging.`,
         };
     }
  }
);

export async function aiChallengeReasoning(input: AiChallengeReasoningInput): Promise<AiChallengeReasoningOutput> {
    console.log("AI Challenge Reasoning with input:", JSON.stringify(input, null, 2));
    try {
        const result = await aiChallengeReasoningFlow(input);
        console.log("AI Challenge decision:", result);
        return result;
    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error executing aiChallengeReasoningFlow:", error);
        console.warn(`AI Challenge Reasoning Fallback (Flow Execution): Defaulting to not challenging due to error: ${errorMessage}`);
        // Fallback in case the flow itself throws an unexpected error
        return {
            shouldChallenge: false, // Safer default
            reasoning: `An unexpected error occurred during AI challenge reasoning flow execution: ${errorMessage}. Defaulting to not challenging.`,
        };
    }
}
