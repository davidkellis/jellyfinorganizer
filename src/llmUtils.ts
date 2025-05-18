import { generateObject } from "ai";
import { OpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from 'zod';

const DEBUG_MODE = process.env.JELLYFIN_ORGANIZER_DEBUG === 'true';

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

    try {
      const result = await generateObject({
        model: openrouter.chat(modelChoice),
        schema: movieInfoSchema,
        prompt: promptContent,
        temperature: 0.1, // Low temperature for more factual, less creative output
        maxTokens: 200, // Max tokens for the generated object string
        maxRetries: 2, // Retry once if generation fails (e.g. not valid JSON for schema)
        fullResponse: true,
      });

      // Check for API errors (like rate limiting) if generateObject didn't throw
      if (result.rawResponse?.status && result.rawResponse.status >= 400) {
        console.error(`    ERROR: LLM API call for '${originalFilename}' failed with status ${result.rawResponse.status} ${result.rawResponse.statusText || ''}.`);
        try {
          const errorBody = await result.rawResponse.response.json(); // Vercel AI SDK wraps the raw response
          console.error('    ERROR Body:', JSON.stringify(errorBody, null, 2));
        } catch (e) {
          // Ignore if body can't be parsed or isn't JSON
        }
        return null;
      }

      const { object: correctedInfo } = result;
      console.log(`    LLM: Received: Title='${correctedInfo.title}', Year='${correctedInfo.year}'`);
      return {
        title: correctedInfo.title,
        year: correctedInfo.year ?? null, // Convert undefined to null
      };
    } catch (error: any) {
      console.error(`    ERROR: LLM API call failed for '${originalFilename}'. Error: ${error.message}`);
      if (DEBUG_MODE) {
        console.error('    DEBUG: Full error object for movie LLM failure:', error);
      }
      return null;
    }
  } catch (error) {
    console.error(`    ERROR: LLM call failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (DEBUG_MODE) {
      console.error('    DEBUG: Full error object for movie LLM failure:', error);
    }
    return null;
  }
}

// Add this interface after CorrectedMovieInfo
export interface CorrectedShowInfo {
  seriesTitle: string;
  seriesYear: string | null; // Year the series first aired
}

// Add this Zod schema after movieInfoSchema
const showInfoSchema = z.object({
  seriesTitle: z.string().describe("The corrected, canonical title of the TV series. Focus on the main series title, excluding season/episode numbers or specific episode titles."),
  seriesYear: z
    .preprocess(
      (val) => (val === "" ? undefined : val),
      z
        .string()
        .regex(/^\d{4}$/, "Year must be a 4-digit string")
        .optional()
    )
    .describe("The 4-digit year the TV series first aired (e.g., '1999' or '2023'), or omitted if not clearly identifiable."),
});

// Add this function after getCorrectedMovieInfoFromLLM
export async function getCorrectedShowInfoFromLLM(
  originalFilename: string,
  initialParsedTitle?: string | null,
  initialParsedSeason?: number | null, // Optional, for context
  initialParsedEpisode?: number | null // Optional, for context
): Promise<CorrectedShowInfo | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("    WARN: OpenRouter API Key not found. Skipping LLM-based show title correction.");
    return null;
  }

  let promptContent = `Analyze the following TV show episode filename to determine the correct canonical TV series title and the 4-digit year the series first aired. Focus on the main series title.

Original filename: "${originalFilename}"`;

  if (initialParsedTitle) {
    promptContent += `\nAn initial parser suggested: Series Title="${initialParsedTitle}"`;
    if (initialParsedSeason !== null) promptContent += `, Season=${initialParsedSeason}`;
    if (initialParsedEpisode !== null) promptContent += `, Episode=${initialParsedEpisode}`;
    promptContent += `. This might be helpful, but prioritize your own analysis of the full original filename for the main series title and its premiere year.`;
  }

  promptContent += `\n
CRITICAL: Respond ONLY with a valid JSON object. Ensure all strings are correctly quoted and the JSON structure is perfect.
Your response MUST match this Zod schema:
{
  "seriesTitle": "string (The corrected, canonical TV series title. Be concise.)",
  "seriesYear": "string (MUST BE a 4-digit year, e.g., '2005', representing the year the series *first aired*, OR this field MUST BE OMITTED if no year is found or applicable. Do NOT put any other text in the 'seriesYear' field.)"
}

Examples of CORRECT responses:
- Filename: "Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264-DEiTY.mkv" -> {"seriesTitle": "Breaking Bad", "seriesYear": "2008"}
- Filename: "The.Office.US.S03E15.The.Merger.DVDRip.XviD-TOPAZ.avi" -> {"seriesTitle": "The Office (US)", "seriesYear": "2005"}
- Filename: "Friends - Season 2 Episode 5.mp4" -> {"seriesTitle": "Friends", "seriesYear": "1994"}
- Filename: "My.Amazing.Show.2023.S01.E04.Special.Episode.mkv" -> {"seriesTitle": "My Amazing Show", "seriesYear": "2023"}
- Filename: "Doctor.Who.(2005).S13E01.mkv" -> {"seriesTitle": "Doctor Who", "seriesYear": "2005"}


Example of an INCORRECT response (which you must avoid):
- {"seriesTitle": "Some Show", "seriesYear": "Aired in the late 90s"}  <-- INCORRECT: 'seriesYear' is not a 4-digit string.
- {"seriesTitle": "Another Show", "seriesYear": "Unknown"}             <-- INCORRECT: 'seriesYear' is not a 4-digit string.
Ensure your entire response is a single, perfectly formed JSON object.`;

  try {
    const modelChoice = process.env.OPENROUTER_MODEL_NAME || "meta-llama/llama-4-maverick:free"; // Or your preferred model

    console.log(`    LLM (Show): Querying OpenRouter model ${modelChoice} for filename '${originalFilename}'...`);

    try {
      const result = await generateObject({
        model: openrouter.chat(modelChoice),
        schema: showInfoSchema,
        prompt: promptContent,
        temperature: 0.1,
        maxTokens: 200,
        maxRetries: 2,
        fullResponse: true,
      });

      // Check for API errors (like rate limiting) if generateObject didn't throw
      if (result.rawResponse?.status && result.rawResponse.status >= 400) {
        console.error(`    ERROR: LLM (Show) API call for '${originalFilename}' failed with status ${result.rawResponse.status} ${result.rawResponse.statusText || ''}.`);
        try {
          const errorBody = await result.rawResponse.response.json();
          console.error('    ERROR Body:', JSON.stringify(errorBody, null, 2));
        } catch (e) {
          // Ignore if body can't be parsed or isn't JSON
        }
        return null;
      }

      const { object: correctedInfo } = result;
      console.log(`    LLM (Show): Received: Title='${correctedInfo.seriesTitle}', Year='${correctedInfo.seriesYear}'`);
      return {
        seriesTitle: correctedInfo.seriesTitle,
        seriesYear: correctedInfo.seriesYear ?? null,
      };
    } catch (error: any) {
      console.error(`    ERROR: LLM (Show) call failed for '${originalFilename}'. Error: ${error.message}`);
      if (DEBUG_MODE) {
        console.error('    DEBUG: Full error object for show LLM failure:', error);
      }
      return null;
    }
  } catch (error) {
    console.error(`    ERROR: LLM (Show) call failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (DEBUG_MODE) {
      console.error('    DEBUG: Full error object for show LLM failure:', error);
      console.error("    ERROR Cause:", error.cause);
    }
    return null;
  }
}
