
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
import type { GenerateResponse } from 'genkit';
import { coupRulebook } from '@/ai/rules/coup-rulebook'; // Import rulebook content

// Define Zod schemas matching the prompt file structure
const AIBlockReasoningInputSchema = z.object({
  action: z.string().describe('The action being performed by the opponent that you might block (e.g., Foreign Aid, Steal, Assassinate).'),
  actionPlayerName: z.string().describe('The name of the player performing the action.'),
  aiPlayerInfluenceCards: z
    .array(z.string())
    .describe("The AI player's current *unrevealed* influence cards."),
  aiPlayerMoney: z.number().describe('The amount of money the AI player has.'),
  opponentInfluenceCount: z
    .number()
    .describe('The number of *unrevealed* influence cards the opponent performing the action has.'),
  opponentMoney: z.number().describe('The amount of money the opponent performing the action has.'),
  gameState: z
    .string()
    .describe('The current state of the game, as a descriptive summary including all players money and revealed cards, and recent action log summary.'),
});
export type AIBlockReasoningInput = z.infer<typeof AIBlockReasoningInputSchema>;

const AIBlockReasoningOutputSchema = z.object({
  shouldBlock: z
    .boolean()
    .describe('Whether the AI should block the action or not. Must be true or false.'),
  reasoning: z.string().describe('The AI reasoning behind the decision to block or not block.'),
});
export type AIBlockReasoningOutput = z.infer<typeof AIBlockReasoningOutputSchema>;


// Define the prompt inline
const blockReasoningPrompt = ai.definePrompt({
    name: 'aiBlockReasoningPrompt',
    input: { schema: AIBlockReasoningInputSchema },
    output: { schema: AIBlockReasoningOutputSchema },
     model: 'googleai/gemini-1.5-flash',
     response: {
        format: 'json',
    },
    prompt: `
You are an AI player in the card game Coup. An opponent has performed an action that you might be able to block. Decide whether you should attempt to block it.

**Rules Reference:**
${coupRulebook}

**Action Being Performed:**
- Action: {{action}}
- Performed by: {{actionPlayerName}}
- Opponent's Status: {{opponentInfluenceCount}} unrevealed influence, {{opponentMoney}} coins.

**Your Current Situation:**
- Your Unrevealed Influence: [{{#each aiPlayerInfluenceCards}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}]
- Your Money: {{aiPlayerMoney}}

**Current Game State Summary:**
{{gameState}}

**Your Task:**
Decide whether to block the opponent's action.
- Can you *truthfully* block this action with your current influence cards? (e.g., Duke blocks Foreign Aid, Contessa blocks Assassinate, Captain/Ambassador blocks Steal).
- Consider the strategic value of blocking vs. allowing the action. Will it significantly harm you or benefit the opponent?
- Consider the risk of being challenged if you bluff a block. How likely is the opponent to challenge? What happens if you lose the challenge?
- Consider your opponent's likely hand based on their actions and the game state.
- Provide your reasoning, explaining why you chose to block or not block.
- **CRITICAL:** Your output *must* be a valid JSON object matching the defined output schema. The 'shouldBlock' field *must* be either true or false.

Output Format (JSON):
{
  "shouldBlock": true | false,
  "reasoning": "Your detailed thought process for this decision."
}
`,
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
     let llmResponse: GenerateResponse<z.infer<typeof AIBlockReasoningOutputSchema>> | null = null;
     let output: AIBlockReasoningOutput | null = null;
     try {
         console.log("[aiBlockReasoningFlow] Input received:", JSON.stringify(input, null, 2));
         console.log("[aiBlockReasoningFlow] Checking blockReasoningPrompt object:", typeof blockReasoningPrompt);

        if (typeof blockReasoningPrompt?.generate !== 'function') {
            console.error("[aiBlockReasoningFlow] CRITICAL ERROR: blockReasoningPrompt.generate is NOT a function! Prompt definition might have failed.");
            console.error("[aiBlockReasoningFlow] blockReasoningPrompt value:", blockReasoningPrompt);
            throw new Error("Internal Server Error: AI prompt definition failed.");
        }
         console.log("[aiBlockReasoningFlow] Calling blockReasoningPrompt.generate...");
         llmResponse = await blockReasoningPrompt.generate({ input });
          console.log("[aiBlockReasoningFlow] LLM response received. Finish Reason:", llmResponse.finishReason);
          console.log("[aiBlockReasoningFlow] LLM Raw Text:", llmResponse.text);


         output = llmResponse.output;

        if (!output) {
             console.error("AI Block Reasoning Error: LLM response did not contain structured output.");
             console.error("LLM Raw Text Response:", llmResponse.text);
             console.error("LLM Finish Reason:", llmResponse.finishReason);
             console.error("LLM Usage Data:", llmResponse.usage);
            throw new Error("LLM response did not contain structured output.");
        }
         console.log("[aiBlockReasoningFlow] Raw output from LLM:", JSON.stringify(output, null, 2));

         // Validate output
         const validatedOutput = AIBlockReasoningOutputSchema.parse(output);
          console.log("AI Block Reasoning Flow: Successfully generated and validated output:", validatedOutput);
          return validatedOutput;

     } catch (e: any) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error("AI Block Reasoning Error:", errorMessage);
          console.error("Error Details:", e);
          console.error("Input Sent to AI:", JSON.stringify(input, null, 2));
        if (output) {
             console.error("Raw AI Output (before parsing/validation):", JSON.stringify(output, null, 2));
        } else if (llmResponse) {
             console.error("LLM Raw Text Response (on error):", llmResponse.text);
             console.error("LLM Finish Reason (on error):", llmResponse.finishReason);
             console.error("LLM Usage Data (on error):", llmResponse.usage);
        }
         // Fallback logic: Default to not blocking
         console.warn(`AI Block Reasoning Fallback: Defaulting to not blocking due to error: ${errorMessage}`);
         return {
             shouldBlock: false, // Safer default
             reasoning: `AI generation, parsing, or validation failed: ${errorMessage}. Raw output might be logged above. Defaulting to not blocking.`,
         };
     }
  }
);


export async function aiBlockReasoning(input: AIBlockReasoningInput): Promise<AIBlockReasoningOutput> {
   console.log("AI Block Reasoning with input:", JSON.stringify(input, null, 2));
   const mappedInput = {
       ...input,
       aiPlayerInfluenceCards: input.aiPlayerInfluenceCards || [],
   };
   try {
       const result = await aiBlockReasoningFlow(mappedInput);
       console.log("AI Block decision:", result);
       return result;
   } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error executing aiBlockReasoningFlow:", error);
        console.warn(`AI Block Reasoning Fallback (Flow Execution): Defaulting to not blocking due to error: ${errorMessage}`);
        return {
            shouldBlock: false, // Safer default
            reasoning: `An unexpected error occurred during AI block reasoning flow execution: ${errorMessage}. Defaulting to not blocking.`,
        };
   }
}
