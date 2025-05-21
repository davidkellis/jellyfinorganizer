import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

const DEBUG_MODE = process.env.JELLYFIN_ORGANIZER_DEBUG === "true";

// Initialize the OpenRouter client using the official provider
const openrouterProvider = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY, // The provider handles the baseURL
});

export interface CorrectedMovieInfo {
  title: string;
  year: number | null; // Changed to number
}

const movieInfoSchema = z.object({
  title: z.string().describe("The corrected, canonical title of the movie. If it's a multi-part series or includes an episode name, try to extract only the main movie title."),
  year: z
    .preprocess(
      (val) => {
        if (val === "" || val === null || val === undefined) return undefined;
        if (typeof val === 'string') {
          const num = parseInt(val, 10);
          return isNaN(num) ? undefined : num;
        }
        if (typeof val === 'number') {
            return Math.floor(val);
        }
        return undefined;
      },
      z.number().int().refine(year => year >= 1800 && year <= new Date().getFullYear() + 5, {
        message: "Year must be a 4-digit integer representing a plausible movie release year.",
      }).optional()
    )
    .describe("The 4-digit year of release (e.g., 1999 or 2023), or omitted if not clearly identifiable/applicable. LLM should provide a string, which will be parsed to a number."),
});

export async function getCorrectedMovieInfoFromLLM(
  originalFilename: string,
  initialParsedTitle?: string | null,
  initialParsedYear?: number | undefined // Changed to number | undefined
): Promise<CorrectedMovieInfo | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("    WARN: OpenRouter API Key not found. Skipping LLM-based title correction.");
    return null;
  }

  let promptContent = `Analyze the following movie filename to determine the correct canonical movie title and its 4-digit year of release. Focus on the main movie title, excluding extra details like 'Director's Cut', 'Extended Edition', disc numbers, or quality indicators unless they are part of a widely recognized official title variation.

Original filename: "${originalFilename}"`;

  if (initialParsedTitle) {
    promptContent += `\nAn initial parser suggested: Title="${initialParsedTitle}"${
      initialParsedYear !== undefined ? `, Year="${initialParsedYear}"` : "" // Year is now number, convert to string for prompt
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
        model: openrouterProvider(modelChoice),
        schema: movieInfoSchema, // Use the Zod schema directly
        prompt: promptContent,
        temperature: 0.1,
        maxTokens: 200,
        maxRetries: 2
      });
      // API errors (e.g., status >= 400) are expected to be thrown by generateObject
      // and caught by the catch block below.

      // result.object is already parsed and validated against movieInfoSchema
      const { object: correctedInfo } = result;
      // correctedInfo.year is now number | undefined from Zod schema
      console.log(`    LLM: Received: Title='${correctedInfo.title}', Year='${correctedInfo.year !== undefined ? correctedInfo.year : "N/A"}'`);
      return {
        title: correctedInfo.title,
        year: correctedInfo.year ?? null, // year is already number | undefined, ?? null makes it number | null
      };
    } catch (error: any) {
      console.error(`    ERROR: LLM API call failed for '${originalFilename}'.`);
      console.error(`      Error Message: ${error.message}`);
      if (error.name) {
        console.error(`      Error Name: ${error.name}`);
      }
      if (error.cause) {
        console.error(`      Error Cause:`, error.cause);
      }
      // Log additional properties if they exist, to help identify HTTP status codes or rate limits
      if (DEBUG_MODE || (error.cause && typeof error.cause === 'object' && 'status' in error.cause)) {
         // Attempt to log status from error.cause if it seems to be an HTTP error like object
        if (error.cause && typeof error.cause === 'object' && 'status' in error.cause) {
          console.error(`      Underlying Status: ${error.cause.status}`);
        }
        console.error("    DEBUG: Full error object for movie LLM failure:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      }
      return null;
    }
  } catch (error) {
    console.error(`    ERROR: LLM call failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (DEBUG_MODE) {
      console.error("    DEBUG: Full error object for movie LLM failure:", error);
    }
    return null;
  }
}

// Add this interface after CorrectedMovieInfo
export interface CorrectedShowInfo {
  seriesTitle: string;
  seriesYear: number | null; // Year the series first aired, changed to number
}

// Add this Zod schema after movieInfoSchema
const showInfoSchema = z.object({
  seriesTitle: z.string().describe("The corrected, canonical title of the TV series. Focus on the main series title, excluding season/episode numbers or specific episode titles."),
  seriesYear: z
    .preprocess(
      (val) => {
        if (val === "" || val === null || val === undefined) return undefined;
        if (typeof val === 'string') {
          const num = parseInt(val, 10);
          return isNaN(num) ? undefined : num;
        }
        if (typeof val === 'number') {
            return Math.floor(val);
        }
        return undefined;
      },
      z.number().int().refine(year => year >= 1800 && year <= new Date().getFullYear() + 5, {
        message: "Year must be a 4-digit integer representing a plausible series premiere year.",
      }).optional()
    )
    .describe("The 4-digit year the TV series first aired (e.g., 1999 or 2023), or omitted if not clearly identifiable. LLM should provide a string, which will be parsed to a number."),
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
        model: openrouterProvider(modelChoice),
        schema: showInfoSchema, // Use the Zod schema directly
        prompt: promptContent,
        temperature: 0.1,
        maxTokens: 200,
        maxRetries: 2
      });
      // API errors (e.g., status >= 400) are expected to be thrown by generateObject
      // and caught by the catch block below.

      // result.object is already parsed and validated against showInfoSchema
      const { object: correctedInfo } = result;
      console.log(`    LLM (Show): Received: Series Title='${correctedInfo.seriesTitle}', Series Year='${correctedInfo.seriesYear !== undefined ? correctedInfo.seriesYear : "N/A"}'`);
      return {
        seriesTitle: correctedInfo.seriesTitle,
        seriesYear: correctedInfo.seriesYear ?? null, // seriesYear is already number | undefined, ?? null makes it number | null
      };
    } catch (error: any) {
      console.error(`    ERROR: LLM (Show) API call failed for '${originalFilename}'.`);
      console.error(`      Error Message: ${error.message}`);
      if (error.name) {
        console.error(`      Error Name: ${error.name}`);
      }
      if (error.cause) {
        console.error(`      Error Cause:`, error.cause);
      }
      // Log additional properties if they exist, to help identify HTTP status codes or rate limits
      if (DEBUG_MODE || (error.cause && typeof error.cause === 'object' && 'status' in error.cause)) {
        // Attempt to log status from error.cause if it seems to be an HTTP error like object
        if (error.cause && typeof error.cause === 'object' && 'status' in error.cause) {
          console.error(`      Underlying Status: ${error.cause.status}`);
        }
        console.error("    DEBUG: Full error object for show LLM failure:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      }
      return null;
    }
  } catch (error) {
    console.error(`    ERROR: LLM (Show) call failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (DEBUG_MODE) {
      console.error("    DEBUG: Full error object for show LLM failure:", error);
      console.error("    ERROR Cause:", (error as any).cause);
    }
    return null;
  }
}

// Added for Music Organization
// Added for Music Organization
export interface LocalMusicTags {
  artist?: string | null;
  album?: string | null;
  title?: string | null;
  year?: number | null;
  trackNumber?: number | null;
}

export interface CorrectedMusicInfo {
  artist?: string | null;
  album?: string | null;
  title?: string | null;
  year?: number | null; // Release year of the album, as a number
  trackNumber?: number | null;
}

const musicInfoSchema = z.object({
  artist: z.string().describe("The name of the recording artist or band. Provide an empty string if not clearly identifiable."),
  album: z.string().describe("The title of the album. Provide an empty string if not clearly identifiable."),
  title: z.string().describe("The title of the track. Provide an empty string if not clearly identifiable."),
  year: z.number().int().min(1000).max(9999).optional().nullable()
    .describe("The four-digit release year of the album or track, as an integer (e.g., 1998). Use null if not found."),
  trackNumber: z.preprocess(
    (val) => (typeof val === 'number' && val === 0 ? null : val),
    z.number()
      .int()
      .positive()
      .optional()
      .nullable()
      .describe("The track number on the album, as an integer. Interpreted as null if 0 is provided or if not found.")
  )
});

export async function getCorrectedMusicInfoFromLLM(
  originalFilename: string,
  localTags?: LocalMusicTags | null // New parameter
): Promise<CorrectedMusicInfo | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    if (DEBUG_MODE) console.log("    LLM (Music): OPENROUTER_API_KEY not set. Skipping LLM correction.");
    return null;
  }

  let promptContent = `Your task is to extract and correct music metadata (artist, album, title, release year, track number) based on a filename and potentially existing, possibly incomplete or generic, metadata tags.
Filename: "${originalFilename}"\n`;

  if (localTags) {
    promptContent += `\nExisting Metadata (use as hints, prioritize correcting/completing this):
- Artist: ${localTags.artist || "Not available"}
- Album: ${localTags.album || "Not available"}
- Title: ${localTags.title || "Not available"}
- Year: ${localTags.year || "Not available"}
- Track: ${localTags.trackNumber || "Not available"}\n`;

    if (localTags.artist && localTags.title && localTags.album && /^(misc|various artists|unknown|greatest hits|compilation)$/i.test(localTags.album)) {
      promptContent += `\nIMPORTANT: The existing album tag ("${localTags.album}") appears generic. If you recognize the Artist ("${localTags.artist}") and Title ("${localTags.title}"), try to identify a more common or canonical studio album or well-known compilation for this track. If unsure, it's better to leave the album as derived from the filename or as an empty string than to guess wildly.\n`;
    }
  }

  promptContent += `
CRITICAL INSTRUCTIONS:
1. Your response MUST be a single, perfectly formed JSON object.
2. The JSON object MUST include all five keys: 'artist', 'album', 'title', 'year', and 'trackNumber'.
3. For 'artist', 'album', and 'title':
    - If information is clearly present or inferable (from filename and/or by correcting/completing local tags), provide it.
    - If existing local metadata provides a strong clue (e.g., Artist="The Beatles" from local tags), use that.
    - If, after considering all information, a field cannot be determined, provide an EMPTY STRING ("").
4. For 'year' and 'trackNumber':
    - If inferable, provide the integer value.
    - If not clearly present or inferable, you MUST use the value null.
   - 'year' should be a 4-digit integer (e.g., 1998) or null.
   - 'trackNumber' should be an integer or null.

Schema Reference:
{
  "artist": "string",
  "album": "string",
  "title": "string",
  "year": "number | null (4-digit integer)",
  "trackNumber": "number | null (integer)"
}

Example - Correcting generic album:
Filename: "07 - Eleanor Rigby.mp3"
Existing Metadata: Artist="The Beatles", Album="Misc", Title="Eleanor Rigby"
Output: {"artist":"The Beatles","album":"Revolver","title":"Eleanor Rigby","year":1966,"trackNumber":7}

Example - Filename only:
Filename: "01 - Some Great Song.flac"
Output: {"artist":"","album":"","title":"Some Great Song","year":null,"trackNumber":1}

Example - Full info in filename:
Filename: "Led Zeppelin - Stairway to Heaven - Led Zeppelin IV - 1971 - 04.mp3"
Output: {"artist":"Led Zeppelin", "album":"Led Zeppelin IV", "title":"Stairway to Heaven", "year":1971, "trackNumber":4}`;


  try {
    const modelChoice = process.env.OPENROUTER_MODEL_NAME || "meta-llama/llama-4-maverick:free";
    const logMessage = `    LLM (Music): Querying OpenRouter model ${modelChoice} for filename '${originalFilename}'`;
    const logSuffix = localTags ? ` with local tags: Artist='${localTags.artist || "N/A"}', Album='${localTags.album || "N/A"}', Title='${localTags.title || "N/A"}'` : '';
    console.log(logMessage + logSuffix + '...');

    try {
      const result = await generateObject({
        model: openrouterProvider(modelChoice),
        schema: musicInfoSchema,
        prompt: promptContent,
        temperature: 0.2, // Slightly increased temperature
        maxTokens: 800, // Significantly increased tokens
        maxRetries: 2,
      });

      const { object: correctedInfo } = result;
      console.log(`    LLM (Music): Received: Artist='${correctedInfo.artist}', Album='${correctedInfo.album}', Title='${correctedInfo.title}', Year=${correctedInfo.year}, Track=${correctedInfo.trackNumber}`);
      return correctedInfo;
    } catch (error: any) {
      console.error(`    ERROR: LLM (Music) API call failed for '${originalFilename}'.`);
      console.error(`      Error Message: ${error.message}`);
      if (error.name) {
        console.error(`      Error Name: ${error.name}`);
      }
      if (error.cause) {
        console.error(`      Error Cause:`, error.cause);
      }
      if (DEBUG_MODE || (error.cause && typeof error.cause === 'object' && 'status' in error.cause)) {
        if (error.cause && typeof error.cause === 'object' && 'status' in error.cause) {
          console.error(`      Underlying Status: ${error.cause.status}`);
        }
        console.error("    DEBUG: Full error object for music LLM failure:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      }
      return null;
    }
  } catch (error) {
    console.error(`    ERROR: LLM (Music) call setup failed for '${originalFilename}':`, error instanceof Error ? error.message : String(error));
    if (DEBUG_MODE) {
      console.error("    DEBUG: Full error object for music LLM setup failure:", error);
    }
    return null;
  }
}
