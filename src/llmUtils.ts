import { generateObject } from "ai";
import { OpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

// Initialize the OpenRouter client using the official provider
const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY, // The provider handles the baseURL
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/davidkellis/jellyfinorganizer",
    "X-Title": "JellyfinOrganizer",
  },
});

export interface CorrectedMovieInfo {
  title: string;
  year: string | null;
}

const movieInfoSchema = z.object({
  title: z.string().describe("The corrected, canonical title of the movie. If it's a multi-part series or includes an episode name, try to extract only the main movie title."),
  year: z
    .preprocess(
      (val) => (val === "" ? undefined : val), // If year is an empty string, treat as undefined (optional)
      z
        .string()
        .regex(/^\d{4}$/, "Year must be a 4-digit string")
        .optional() // Keep it optional for when LLM omits the field or preprocess makes it undefined
    )
    .describe("The 4-digit year of release (e.g., '1999' or '2023'), or omitted if not clearly identifiable/applicable."),
});

export async function getCorrectedMovieInfoFromLLM(
  originalFilename: string,
  initialParsedTitle?: string | null,
  initialParsedYear?: string | null
): Promise<CorrectedMovieInfo | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("    WARN: OpenRouter API Key not found. Skipping LLM-based title correction.");
    return null;
  }

  let promptContent = `Analyze the following movie filename to determine the correct canonical movie title and its 4-digit year of release. Focus on the main movie title, excluding extra details like 'Director's Cut', 'Extended Edition', disc numbers, or quality indicators unless they are part of a widely recognized official title variation.

Original filename: "${originalFilename}"`;

  if (initialParsedTitle) {
    promptContent += `\nAn initial parser suggested: Title="${initialParsedTitle}"${
      initialParsedYear ? `, Year="${initialParsedYear}"` : ""
    }. This might be helpful, but prioritize your own analysis of the full original filename.`;
  }

  promptContent += `\n
CRITICAL: Respond ONLY with a valid JSON object. Ensure all strings are correctly quoted and the JSON structure is perfect.
Your response MUST match this Zod schema:
{
  "title": "string (The corrected, canonical movie title. Be concise.)",
  "year": "string (MUST BE a 4-digit year, e.g., '1999', OR this field MUST BE OMITTED if no year is found or applicable. Do NOT put any other text in the 'year' field.)"
}

Examples of CORRECT responses:
- Filename: "The.Matrix.1999.UNCUT.1080p.BluRay.x265-RARBG.mkv" -> {"title": "The Matrix", "year": "1999"}
- Filename: "AVATAR.The.Way.of.Water.2022.IMAX.Enhanced.HDR.2160p.mkv" -> {"title": "Avatar: The Way of Water", "year": "2022"}
- Filename: "My Movie Title Without Year.mp4" -> {"title": "My Movie Title Without Year"} (year field is correctly OMITTED)
- Filename: "ROCKSHOW COMEDY DISC1.m4v" -> {"title": "Rockshow Comedy Tour", "year": "2011"}

Example of an INCORRECT response (which you must avoid):
- {"title": "Some Movie", "year": "Approximately 2005"}  <-- INCORRECT: 'year' is not a 4-digit string.
- {"title": "Another Movie", "year": "Unknown"}             <-- INCORRECT: 'year' is not a 4-digit string.
- {"title":"Title with bad JSON", "year":"2024"         <-- INCORRECT: JSON is malformed (missing closing quote and brace).
Ensure your entire response is a single, perfectly formed JSON object.`;

  try {
    // You should choose a model available on OpenRouter. Test for cost/performance.
    // Consider models like: "mistralai/mistral-7b-instruct-v0.2", "nousresearch/nous-hermes-2-mixtral-8x7b-dpo", "openai/gpt-3.5-turbo"
    // Use model from environment variable or fallback to a default.
    const modelChoice = process.env.OPENROUTER_MODEL_NAME || "meta-llama/llama-4-maverick:free";

    console.log(`    LLM: Querying OpenRouter model ${modelChoice} for filename '${originalFilename}'...`);

    const { object: correctedInfo } = await generateObject({
      model: openrouter.chat(modelChoice),
      schema: movieInfoSchema,
      prompt: promptContent,
      temperature: 0.1, // Low temperature for more factual, less creative output
      maxTokens: 200, // Max tokens for the generated object string
      maxRetries: 2, // Retry once if generation fails (e.g. not valid JSON for schema)
    });

    console.log(`    LLM: Received: Title='${correctedInfo.title}', Year='${correctedInfo.year}'`);
    return {
      title: correctedInfo.title,
      year: correctedInfo.year ?? null, // Convert undefined to null
    };
  } catch (error) {
    console.error(`    ERROR: LLM call failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (error instanceof Error && "cause" in error) {
      console.error("    ERROR Cause:", error.cause);
    }
    return null;
  }
}
