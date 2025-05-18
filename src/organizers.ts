// src/organizers.ts
import { scanDirectory } from "./scanner";
import { basename, extname, join as pathDirectoryJoin, dirname } from "path"; // Renamed join to pathDirectoryJoin
import { mkdir, rename } from "node:fs/promises";
// `readFileSync` and `pathJoin` for wordlist were moved to filenameParser.ts
import { ParsedMovieInfo, getWordList, parseMovieFilename } from "./filenameParser";
import { fetchTmdbMovieMetadata } from "./tmdb"; // Import TMDB fetch function
import { getCorrectedMovieInfoFromLLM } from "./llmUtils"; // Import LLM helper

// Define common movie file extensions
export const MOVIE_EXTENSIONS = [".mkv", ".m4v", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mpg", ".mpeg"];

// Removed global-like tmdbApiKeyChecked and tmdbApiKeyAvailable as apiKey is now passed directly.

// TMDB API Interfaces are now in `tmdb.ts`
// `ParsedMovieInfo` interface is imported from `./filenameParser`
// `parseMovieFilename` function is imported from `./filenameParser`
// `fetchTmdbMovieMetadata` function is now imported from `./tmdb`

/**
 * Placeholder for the movie organization logic.
 * @param sourceDirectory The directory containing movie files.
 * @param isDryRun If true, only log planned changes.
 */

export async function organizeMovies(
  sourceDirectory: string,
  movieFilesFromScanner: string[], // Renamed to avoid confusion with internal loop variable if any
  isDryRun: boolean,
  isInteractive: boolean,
  apiKey: string | null // apiKey is now passed, use it directly
) {
  getWordList(); // Prime the wordlist loading when starting movie organization
  console.log(`\nAttempting to organize MOVIES in: ${sourceDirectory} (Dry Run: ${isDryRun}, Interactive: ${isInteractive})`);

  // Use the apiKey passed as a parameter to determine TMDB availability.
  const useTmdb = !!apiKey;
  if (useTmdb) {
    console.log("    TMDB API Key available. Will attempt to use TMDB for metadata.");
  } else {
    console.warn("    TMDB API Key not provided or found. TMDB lookups will be skipped, falling back to filename parsing only.");
  }

  if (movieFilesFromScanner.length === 0) {
    console.log("No movie files provided by scanner to process.");
    console.log("\nMovie organization process complete.");
    return;
  }
  console.log(`Processing ${movieFilesFromScanner.length} movie files provided by scanner.`);

  let confirmAllCurrentCategory = false; // For 'Always' option in interactive mode for this category run
  let skipAllCurrentCategory = false; // For 'Skip All' option

  console.log("\nProcessing movie files:");
  for (const originalFilePath of movieFilesFromScanner) {
    const fileItself = basename(originalFilePath);
    const filenameStem = basename(fileItself, extname(fileItself));
    const parentDir = dirname(originalFilePath);
    const parentDirName = basename(parentDir);
    const grandParentDir = dirname(parentDir);

    // Check if already organized:
    // 1. File is in a direct subdirectory of sourceDirectory.
    // 2. Filename stem matches its parent directory's name.
    // 3. The parent directory's name is already in our canonical "Title (Year)" or "Title" format.
    if (grandParentDir === sourceDirectory && filenameStem === parentDirName) {
      // To check condition 3, parse the parentDirName and see if it reconstructs to itself.
      // We add a dummy extension because parseMovieFilename expects a full filename.
      const parsedDirAsFile = parseMovieFilename(parentDirName + extname(fileItself));
      let canonicalDirName = parsedDirAsFile.title;
      if (parsedDirAsFile.year) {
        canonicalDirName += ` (${parsedDirAsFile.year})`;
      }
      // Further, the title extracted from parentDirName should be parentDirName itself (or parentDirName minus year)
      // This ensures parentDirName doesn't contain unprocessed underscores/periods if it were a title.
      if (parentDirName === canonicalDirName) {
        console.log(`\n  Skipping (already organized): ${originalFilePath}`);
        continue; // Skip to the next file
      }
    }

    // originalFilePath is absolute
    const fileBasename = basename(originalFilePath);
    const fileExt = extname(originalFilePath);
    let usedTmdb = false;
    let parsedInfo: ParsedMovieInfo; // Declare parsedInfo

    if (useTmdb && apiKey) {
      // Attempt TMDB lookup first with a gentle parse (no wordlist splitting)
      const parsedForTmdb = parseMovieFilename(fileBasename, false);
      // console.log(`    DEBUG: Parsed for TMDB: Title='${parsedForTmdb.title}', Year='${parsedForTmdb.year}' from '${parsedForTmdb.originalFilename}'`); // Optional debug
      const tmdbInfo = await fetchTmdbMovieMetadata(parsedForTmdb.title, parsedForTmdb.year, parsedForTmdb.originalFilename, apiKey);

      if (tmdbInfo) {
        parsedInfo = tmdbInfo; // TMDB success! Use its info.
        usedTmdb = true;
        // console.log(`    DEBUG: TMDB Success: Title='${parsedInfo.title}', Year='${parsedInfo.year}'`); // Optional debug
      } else {
        // Initial TMDB lookup failed.
        console.log(`    Initial TMDB lookup for '${parsedForTmdb.originalFilename}' failed. Attempting to find a better title.`);
        let foundBetterTitle = false;

        const llmResult = await getCorrectedMovieInfoFromLLM(fileBasename, parsedForTmdb.title, parsedForTmdb.year);
        let foundBetterTitleViaLLM = false;

        if (llmResult) {
          console.log(`    LLM suggested: Title='${llmResult.title}', Year='${llmResult.year || "N/A"}'. Attempting TMDB with this info.`);
          const tmdbInfoFromLLM = await fetchTmdbMovieMetadata(llmResult.title, llmResult.year, parsedForTmdb.originalFilename, apiKey);

          if (tmdbInfoFromLLM) {
            parsedInfo = tmdbInfoFromLLM;
            usedTmdb = true;
            foundBetterTitleViaLLM = true;
            console.log(`    TMDB lookup successful using title from LLM suggestion!`);
          } else {
            console.log(`    TMDB lookup FAILED even with title from LLM suggestion for '${parsedForTmdb.originalFilename}'.`);
          }
        } else {
          console.log(`    LLM did not return a usable title correction for '${parsedForTmdb.originalFilename}'.`);
        }

        if (!foundBetterTitleViaLLM) {
          if (llmResult) {
            // LLM provided a title, but TMDB didn't find it. Use LLM's title directly.
            console.log(`    Using LLM's suggested title '${llmResult.title}' (${llmResult.year || "N/A"}) as fallback as TMDB lookup failed.`);
            parsedInfo = {
              title: llmResult.title,
              year: llmResult.year,
              originalFilename: fileBasename, // Keep original filename context
              // No source or score from LLM directly unless we adapt it
            };
            // We didn't use TMDB, so 'usedTmdb' remains false unless set prior by a direct hit
          } else {
            // LLM didn't provide a title OR LLM wasn't even called (e.g. no API key)
            console.log(`    LLM did not provide a title. Falling back to aggressive filename parsing for '${parsedForTmdb.originalFilename}'.`);
            parsedInfo = parseMovieFilename(fileBasename, true); // True aggressive fallback
          }
        }
      }
    } else {
      // TMDB not enabled or no API key, so directly use full filename parsing (with wordlist splitting)
      // console.log(`    DEBUG: TMDB not used, doing full parse.`); // Optional debug
      parsedInfo = parseMovieFilename(fileBasename, true);
    }

    let targetFolderName = parsedInfo.title;
    if (parsedInfo.year) {
      targetFolderName += ` (${parsedInfo.year})`;
    }

    // Sanitize folder and file names (basic sanitization for now)
    const sanitizedTargetFolderName = targetFolderName.replace(/[\/\?%\*:\|"<>\.]/g, "_").trim();
    if (!sanitizedTargetFolderName) {
      console.warn(`    SKIPPING: Could not determine a valid folder name for '${originalFilePath}' (parsed title: '${parsedInfo.title}')`);
      continue;
    }

    // sourceDirectory is now considered the direct parent for individual movie folders.
    const targetMovieDir = pathDirectoryJoin(sourceDirectory, sanitizedTargetFolderName);
    const targetFileName = sanitizedTargetFolderName + fileExt;
    const newTargetFilePath = pathDirectoryJoin(targetMovieDir, targetFileName);

    console.log(`\n  Original: ${originalFilePath}`);
    console.log(`    Parsed:   '${parsedInfo.title}' (${parsedInfo.year || "N/A"}) ${usedTmdb ? "[TMDB]" : "[Filename]"}`);
    console.log(`    Target:   ${newTargetFilePath}`);

    // --- BEGIN DEBUG LOGGING ---
    const oPath = originalFilePath;
    const nPath = newTargetFilePath;
    console.log(`    DEBUG: originalFilePath       = "${oPath}" (Length: ${oPath.length})`);
    console.log(`    DEBUG: newTargetFilePath      = "${nPath}" (Length: ${nPath.length})`);
    const arePathsEqual = oPath === nPath;
    console.log(`    DEBUG: Are paths equal (===)? = ${arePathsEqual}`);
    // --- END DEBUG LOGGING ---

    // If the original path is identical to the target path after all processing, skip.
    if (originalFilePath === newTargetFilePath) {
      console.log(`    INFO: File '${fileItself}' is already in the target location and correctly named. Skipping further operations.`);
      continue;
    }

    if (skipAllCurrentCategory) {
      console.log(`    SKIPPED (due to previous 'skip all' choice).`);
      continue; // Skip to the next file if 'skip all' was chosen
    }

    let proceedWithOperations = true;

    if (!isDryRun && isInteractive && !confirmAllCurrentCategory) {
      const dirActionPrompt = prompt(`  Create directory: ${targetMovieDir}? (y/n/a/s/q): `)?.toLowerCase();
      if (dirActionPrompt === "a") {
        confirmAllCurrentCategory = true;
      } else if (dirActionPrompt === "s") {
        skipAllCurrentCategory = true;
        proceedWithOperations = false;
        console.log("    Skipping all remaining operations for this category.");
      } else if (dirActionPrompt === "q") {
        console.log("    Quitting organization for this category.");
        return; // Exit organizeMovies function
      } else if (dirActionPrompt === "n") {
        proceedWithOperations = false;
        console.log("    Skipping directory creation and file move for this item.");
      } else if (dirActionPrompt !== "y") {
        console.log("    Invalid input. Skipping directory creation and file move for this item.");
        proceedWithOperations = false;
      }
    }

    if (!isDryRun && proceedWithOperations) {
      try {
        console.log(`    Ensuring directory exists: ${targetMovieDir}`);
        await mkdir(targetMovieDir, { recursive: true });
        console.log(`    Moving file...`);

        if (isInteractive && !confirmAllCurrentCategory) {
          const fileActionPrompt = prompt(`  Move file ${originalFilePath} to ${newTargetFilePath}? (y/n/a/s/q): `)?.toLowerCase();
          if (fileActionPrompt === "a") {
            confirmAllCurrentCategory = true;
          } else if (fileActionPrompt === "s") {
            skipAllCurrentCategory = true;
            console.log("    Skipping current file move and all remaining operations for this category.");
            proceedWithOperations = false; // Ensure we don't try to move if 's' was chosen here
          } else if (fileActionPrompt === "q") {
            console.log("    Quitting organization for this category.");
            return; // Exit organizeMovies function
          } else if (fileActionPrompt === "n") {
            console.log("    Skipping file move for this item.");
            proceedWithOperations = false;
          } else if (fileActionPrompt !== "y") {
            console.log("    Invalid input. Skipping file move for this item.");
            proceedWithOperations = false;
          }
        }
        if (proceedWithOperations) {
          await rename(originalFilePath, newTargetFilePath);
        } else if (!skipAllCurrentCategory) {
          // if we didn't skip all, but skipped this one specifically
          console.log(`    SKIPPED moving file: ${originalFilePath}`);
        }
        console.log(`    SUCCESS: Moved to ${newTargetFilePath}`);
      } catch (error) {
        console.error(`    ERROR moving file ${originalFilePath}:`, error);
      }
    } else if (isDryRun) {
      console.log(`    DRY RUN: Would ensure directory ${targetMovieDir} exists.`);
      console.log(`    DRY RUN: Would move file to ${newTargetFilePath}`);
    }
  }
  console.log("\nMovie organization process complete.");
}

/**
 * Placeholder for the TV show organization logic.
 * @param sourceDirectory The directory containing TV show files.
 * @param dryRun If true, only log planned changes.
 */
export async function organizeShows(sourceDirectory: string, dryRun: boolean, isInteractive: boolean): Promise<void> {
  console.log(`\nAttempting to organize TV SHOWS in: ${sourceDirectory} (Dry Run: ${dryRun}, Interactive: ${isInteractive})`);
  const allFiles = await scanDirectory(sourceDirectory);
  console.log(`Scanner found ${allFiles.length} total files.`);
  if (allFiles.length > 0) {
    console.log("First few files found (up to 5):");
    allFiles.slice(0, 5).forEach((file) => console.log(`  - ${file}`));
  }
  // TODO: Implement actual TV show organization logic
  // 1. Filter for show file types
  // 2. Parse show names, seasons, episodes
  // 3. Determine target paths
  // 4. If not dryRun, move/rename files
  console.log("TV show organization logic not yet implemented.");
}

/**
 * Placeholder for the music organization logic.
 * @param sourceDirectory The directory containing music files.
 * @param dryRun If true, only log planned changes.
 */
export async function organizeMusic(sourceDirectory: string, dryRun: boolean, isInteractive: boolean): Promise<void> {
  console.log(`\nAttempting to organize MUSIC in: ${sourceDirectory} (Dry Run: ${dryRun}, Interactive: ${isInteractive})`);
  const allFiles = await scanDirectory(sourceDirectory);
  console.log(`Scanner found ${allFiles.length} total files.`);
  if (allFiles.length > 0) {
    console.log("First few files found (up to 5):");
    allFiles.slice(0, 5).forEach((file) => console.log(`  - ${file}`));
  }
  // TODO: Implement actual music organization logic
  // 1. Filter for music file types (e.g., .mp3, .flac)
  // 2. Parse artist/album/track information (this can be complex)
  // 3. Determine target paths
  // 4. If not dryRun, move/rename files
  console.log("Music organization logic not yet implemented.");
}
