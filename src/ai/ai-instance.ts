import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

export const ai = genkit({
  promptDir: './src/ai/prompts', // Specify prompt directory
  plugins: [
    googleAI({
      apiKey: process.env.GOOGLE_GENAI_API_KEY,
    }),
  ],
  logLevel: 'debug', // Optional: Enable debug logging
  enableTracing: true, // Optional: Enable tracing
  model: 'googleai/gemini-1.5-flash', // Updated model
});
