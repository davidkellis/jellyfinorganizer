// src/showOrganizer.ts
import { basename, extname, join as pathJoin, dirname } from "path";
import { mkdir, rename, access } from "node:fs/promises";
import { getWordList, type ParsedShowInfo, parseShowFilename } from "./filenameParser";
import { searchTmdbShow, fetchTmdbSeasonDetails, type TmdbEpisode } from "./tmdb"; // Added TmdbEpisode
import { getCorrectedShowInfoFromLLM, type CorrectedShowInfo } from "./llmUtils"; // Added CorrectedShowInfo
import { extractVideoFileMetadata, type VideoFileMetadata } from "./metadataExtractor"; // Added for embedded metadata
// Assuming askQuestion might be in a general utils file or needs to be defined/imported
// For now, if interactive mode is used, direct prompts will be used.
// import { askQuestion } from "./utils"; // If you have a utility for this

// Define common show file extensions
export const SHOW_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".flv", ".webm", ".mpg", ".mpeg"];

// Helper to sanitize folder and file names
function sanitizeName(name: string): string {
  if (!name) return "";
  return name
    .replace(/[\/\?%\*:|"<>\.]/g, "_")
    .replace(/[\s]+$/, "")
    .replace(/^[\s]+/, "")
    .trim();
}

export async function organizeShows(
  sourceDirectory: string,
  showFilesFromScanner: string[],
  isDryRun: boolean,
  isInteractive: boolean,
  apiKey: string | null // TMDB API Key
): Promise<void> {
  getWordList(); // Prime the wordlist
  console.log(`\nAttempting to organize TV SHOWS in: ${sourceDirectory} (Dry Run: ${isDryRun}, Interactive: ${isInteractive})`);

  const useTmdb = !!apiKey;
  if (useTmdb) {
    console.log("    TMDB API Key available. Will attempt to use TMDB for metadata.");
  } else {
    console.warn("    TMDB API Key not provided. TMDB lookups will be skipped. Accuracy may be lower.");
  }

  if (showFilesFromScanner.length === 0) {
    console.log("No show files provided by scanner to process.");
    console.log("\nTV Show organization process complete.");
    return;
  }
  console.log(`Processing ${showFilesFromScanner.length} show files provided by scanner.`);

  let confirmAllCurrentCategory = false;
  let skipAllCurrentCategory = false;
  let movedFiles = 0;
  let createdDirectories = 0;
  const problematicFiles: { filePath: string; error: string }[] = [];
  const skippedFilePathsDueToMetadataUncertainty: string[] = [];
  for (const originalFilePath of showFilesFromScanner) {
    const fileBasename = basename(originalFilePath);
    const fileExt = extname(originalFilePath);
    console.log(`\n--- Processing: ${fileBasename} ---`);

    // 1. Initial Metadata Extraction (Embedded preferred, then Filename Parsing)
    const videoMetadata: VideoFileMetadata | null = await extractVideoFileMetadata(originalFilePath);
    
    let parsedShowInfoForLegacyLogic: ParsedShowInfo; // To hold the structure expected by some parts of downstream logic if needed, or just use final variables directly.

    let finalSeriesTitle: string | null = null;
    let finalSeriesYear: number | undefined = undefined; // Consistent numeric type
    let finalSeasonNumber: number | null = null;
    let finalEpisodeNumber: number | null = null;
    let finalEpisodeTitle: string | null = null;
    let metadataSourceForLog = "[Unknown]";

    if (videoMetadata) {
      console.log(`    Found embedded metadata: Series='${videoMetadata.seriesTitle || "N/A"}', Episode='${videoMetadata.episodeTitle || "N/A"}', S=${videoMetadata.seasonNumber === undefined ? "N/A" : videoMetadata.seasonNumber}, E=${videoMetadata.episodeNumber === undefined ? "N/A" : videoMetadata.episodeNumber}, Year='${videoMetadata.year === undefined ? "N/A" : videoMetadata.year}'`);
      metadataSourceForLog = "[Embedded Meta]";

      finalSeriesTitle = videoMetadata.seriesTitle || null;
      // Use videoMetadata.year as potential series year. It could also be episode air year.
      // TMDB search can often disambiguate with just title and S/E numbers.
      finalSeriesYear = videoMetadata.year;
      finalSeasonNumber = videoMetadata.seasonNumber === undefined ? null : videoMetadata.seasonNumber;
      finalEpisodeNumber = videoMetadata.episodeNumber === undefined ? null : videoMetadata.episodeNumber;
      finalEpisodeTitle = videoMetadata.episodeTitle || null;

      // If core info (Series, S, E) is missing from metadata, supplement with filename parsing
      if (!finalSeriesTitle || finalSeasonNumber === null || finalEpisodeNumber === null) {
        console.log(`    Embedded metadata missing some core series/season/episode info. Supplementing with filename parsing.`);
        const fnParsed = parseShowFilename(fileBasename);
        metadataSourceForLog = "[Embedded+Filename]";
        if (!finalSeriesTitle) finalSeriesTitle = fnParsed.seriesTitle;
        if (finalSeasonNumber === null) finalSeasonNumber = fnParsed.seasonNumber;
        if (finalEpisodeNumber === null) finalEpisodeNumber = fnParsed.episodeNumber;
        if (!finalEpisodeTitle) finalEpisodeTitle = fnParsed.episodeTitle; // Prefer metadata episode title if it existed
        // If year wasn't in metadata but was in filename, and we're using filename series title, consider filename year.
        if (finalSeriesYear === undefined && fnParsed.year !== undefined && finalSeriesTitle === fnParsed.seriesTitle) {
            finalSeriesYear = fnParsed.year;
        }
      }
    } else {
      // No video metadata found, parse from filename
      console.log(`    No embedded metadata found. Parsing from filename.`);
      const fnParsed = parseShowFilename(fileBasename);
      metadataSourceForLog = "[Filename Parse]";
      finalSeriesTitle = fnParsed.seriesTitle;
      finalSeriesYear = fnParsed.year;
      finalSeasonNumber = fnParsed.seasonNumber;
      finalEpisodeNumber = fnParsed.episodeNumber;
      finalEpisodeTitle = fnParsed.episodeTitle;
    }
    
    // Construct a ParsedShowInfo like object for downstream compatibility if needed, or refactor downstream.
    // For now, let's ensure the 'final' variables are primary.
    parsedShowInfoForLegacyLogic = {
        seriesTitle: finalSeriesTitle,
        seasonNumber: finalSeasonNumber,
        episodeNumber: finalEpisodeNumber,
        episodeTitle: finalEpisodeTitle,
        year: finalSeriesYear, 
        originalFilename: fileBasename
    };
    if (!finalSeriesTitle || finalSeasonNumber === null || finalEpisodeNumber === null) {
      console.warn(`    WARN: Could not reliably determine series, season, or episode from: '${fileBasename}' using ${metadataSourceForLog}.`);
      if (!finalSeriesTitle && finalSeasonNumber !== null && finalEpisodeNumber !== null) {
          console.log(`    Series title is missing, but season/episode numbers are present. TMDB/LLM might still work.`);
      } else { // If any of finalSeriesTitle, finalSeasonNumber, or finalEpisodeNumber is missing (and not the specific case above)
        console.warn(`    Skipping '${fileBasename}' due to missing critical Series/Season/Episode info after ${metadataSourceForLog}.`);
        skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
        continue;
      }
    }

    console.log(
      `    Using data (${metadataSourceForLog}): Title='${finalSeriesTitle || "N/A"}', S=${finalSeasonNumber === null ? "N/A" : finalSeasonNumber}, E=${finalEpisodeNumber === null ? "N/A" : finalEpisodeNumber}, EpTitle='${finalEpisodeTitle || "N/A"}', Year='${finalSeriesYear === undefined ? "N/A" : finalSeriesYear}'`
    );

    let tmdbSeriesId: number | null = null;
    // finalSeriesTitle, finalSeriesYear, finalEpisodeTitle are already initialized above with prioritized data.
    // We'll update them if TMDB/LLM provides better canonical versions.

    // 2. TMDB Series Search (and LLM correction if needed)
    let usingLlmFallbackTitle = false;
    if (useTmdb && apiKey && finalSeriesTitle) {
      let tmdbShowInfo = await searchTmdbShow(finalSeriesTitle, finalSeriesYear, fileBasename, apiKey);

      if (!tmdbShowInfo && process.env.OPENROUTER_API_KEY) {
        // Try LLM if TMDB failed
        console.log(`    Initial TMDB series search for '${finalSeriesTitle}' failed. Attempting LLM correction...`);
        const llmCorrectedShow: CorrectedShowInfo | null = await getCorrectedShowInfoFromLLM(fileBasename, finalSeriesTitle, finalSeasonNumber, finalEpisodeNumber);
        if (llmCorrectedShow?.seriesTitle) {
          console.log(`    LLM suggested: Series='${llmCorrectedShow.seriesTitle}', Year='${llmCorrectedShow.seriesYear || "N/A"}'. Retrying TMDB.`);
          tmdbShowInfo = await searchTmdbShow(llmCorrectedShow.seriesTitle, llmCorrectedShow.seriesYear ?? undefined, fileBasename, apiKey); // llmCorrectedShow.seriesYear is number|null
          if (tmdbShowInfo) {
            console.log(`    TMDB search SUCCESSFUL with LLM suggestion.`);
            finalSeriesTitle = tmdbShowInfo.name; // Use TMDB's canonical series title
            finalSeriesYear = tmdbShowInfo.year; // Use TMDB's series year (number | undefined)
            // tmdbSeriesId will be set later from this tmdbShowInfo
          } else {
            console.log(`    WARN: TMDB search FAILED for LLM-suggested title '${llmCorrectedShow.seriesTitle}'. Using LLM suggestion as fallback for series name/year.`);
            finalSeriesTitle = llmCorrectedShow.seriesTitle;
            finalSeriesYear = llmCorrectedShow.seriesYear ?? undefined; // Ensure number | undefined
            tmdbSeriesId = null; // Explicitly ensure no TMDB ID if we're using LLM fallback only
            usingLlmFallbackTitle = true;
          }
        } else {
          console.log(`    LLM correction for '${fileBasename}' failed (e.g. API error, rate limit). Skipping this file.`);
          skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
          continue;
        }
      }

      if (tmdbShowInfo) {
        tmdbSeriesId = tmdbShowInfo.id;
        finalSeriesTitle = tmdbShowInfo.name; // Prefer TMDB's title
        finalSeriesYear = tmdbShowInfo.year; // Prefer TMDB's year
        console.log(`    TMDB Series Match: '${finalSeriesTitle}' (${finalSeriesYear === undefined ? "N/A" : finalSeriesYear}), ID: ${tmdbSeriesId}`);
      } else if (usingLlmFallbackTitle) {
        // We already logged that we're using the LLM fallback title.
        // finalSeriesTitle, finalSeriesYear are set, tmdbSeriesId is null.
        console.log(`    Proceeding with LLM-suggested title: '${finalSeriesTitle}' (${finalSeriesYear === undefined ? "N/A" : finalSeriesYear}) as TMDB did not confirm.`);
      } else {
        // tmdbShowInfo is null, AND we are not using an LLM fallback title.
        // This means: initial TMDB search failed, AND either LLM was not attempted, or LLM failed to provide a usable suggestion.
        console.log(`    WARN: No definitive TMDB series match for '${finalSeriesTitle}' (Source: ${metadataSourceForLog}) and LLM correction also failed or was not applicable. Skipping file.`);
        skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
        continue;
      }
    } else if (finalSeriesTitle) {
      console.log(`    Using series title '${finalSeriesTitle}' from ${metadataSourceForLog} (${finalSeriesYear === undefined ? "N/A" : finalSeriesYear}). TMDB lookup skipped.`);
    }

    if (!finalSeriesTitle || finalSeasonNumber === null || finalEpisodeNumber === null) {
      console.error(`    ERROR: Critical information (Series Title, Season, or Episode) missing for '${fileBasename}'. Cannot proceed.`);
      skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      continue;
    }

    // 3. TMDB Episode Title Lookup (if series was found on TMDB)
    if (tmdbSeriesId && apiKey && finalSeasonNumber !== null && finalEpisodeNumber !== null) {
      const seasonDetails = await fetchTmdbSeasonDetails(tmdbSeriesId, finalSeasonNumber, apiKey, fileBasename);
      if (seasonDetails && seasonDetails.episodes) {
        const matchedEpisode: TmdbEpisode | undefined = seasonDetails.episodes.find((ep: TmdbEpisode) => ep.episode_number === finalEpisodeNumber);
        if (matchedEpisode && matchedEpisode.name) {
          finalEpisodeTitle = matchedEpisode.name; // Prefer TMDB's episode title
          console.log(`    TMDB Episode Match: S${String(finalSeasonNumber).padStart(2, "0")}E${String(finalEpisodeNumber).padStart(2, "0")} - '${finalEpisodeTitle}'`);
        } else {
          console.warn(
            `    WARN: Could not find matching episode S${String(finalSeasonNumber).padStart(2, "0")}E${String(finalEpisodeNumber).padStart(
              2,
              "0"
            )} in TMDB season data. Using current episode title ('${finalEpisodeTitle || "N/A"}') if available.`
          );
        }
      } else {
        console.warn(`    WARN: Could not fetch season details from TMDB for S${String(finalSeasonNumber).padStart(2, "0")}. Using current episode title ('${finalEpisodeTitle || "N/A"}').`);
      }
    }

    // 4. Construct Target Path and Filename
    const sanitizedSeriesTitle = sanitizeName(finalSeriesTitle);
    const seriesYearSuffix = finalSeriesYear !== undefined ? ` (${finalSeriesYear})` : "";
    const seriesFolderName = `${sanitizedSeriesTitle}${seriesYearSuffix}`;

    const seasonFolderName = `Season ${String(finalSeasonNumber).padStart(2, "0")}`;

    const episodeNumStr = String(finalEpisodeNumber).padStart(2, "0");
    // Add multi-episode handling later if parseShowFilename supports it (e.g., E01-E02)
    const episodeFileNameBase = `${sanitizedSeriesTitle} - S${String(finalSeasonNumber).padStart(2, "0")}E${episodeNumStr}`;
    const episodeTitleSuffix = finalEpisodeTitle ? ` - ${sanitizeName(finalEpisodeTitle)}` : "";
    const targetFileName = `${episodeFileNameBase}${episodeTitleSuffix}${fileExt}`;

    const targetShowSeriesPath = pathJoin(sourceDirectory, seriesFolderName);
    const targetSeasonPath = pathJoin(targetShowSeriesPath, seasonFolderName);
    const newTargetFilePath = pathJoin(targetSeasonPath, targetFileName);

    // Skip if already organized check (more robust)
    const currentFileDir = dirname(originalFilePath);
    const currentSeasonFolder = basename(currentFileDir);
    const currentSeriesFolderDir = dirname(currentFileDir);
    const currentSeriesFolder = basename(currentSeriesFolderDir);

    if (
      currentSeriesFolderDir !== sourceDirectory && // not in root source
      currentSeriesFolder === seriesFolderName &&
      currentSeasonFolder === seasonFolderName &&
      fileBasename === targetFileName
    ) {
      console.log(`    INFO: File '${fileBasename}' is already perfectly organized. Skipping.`);
      continue;
    }
    if (originalFilePath === newTargetFilePath) {
      console.log(`    INFO: File '${fileBasename}' is already in the target location and correctly named (after path normalization). Skipping.`);
      continue;
    }

    console.log(`    Proposed Target: ${newTargetFilePath}`);

    if (skipAllCurrentCategory) {
      console.log(`    SKIPPED (due to previous 'skip all' choice).`);
      continue;
    }

    let proceedWithOperations = true;

    // 5. User Interaction and File Operations
    if (isInteractive && !confirmAllCurrentCategory) {
      const answer = prompt(`  Organize '${fileBasename}' to '${newTargetFilePath}'? (y/n/a/s/q): `)?.toLowerCase();
      if (answer === "a") {
        confirmAllCurrentCategory = true;
      } else if (answer === "s") {
        skipAllCurrentCategory = true;
        proceedWithOperations = false;
        console.log("    Skipping all remaining TV shows.");
      } else if (answer === "q") {
        console.log("    Quitting TV show organization.");
        return; // Exit organizeShows entirely
      } else if (answer === "n") {
        proceedWithOperations = false;
        console.log("    Skipping this file.");
      } else if (answer !== "y") {
        console.log("    Invalid input. Skipping this file.");
        proceedWithOperations = false;
      }
    }

    // --- START OF NEW DUPLICATE HANDLING AND ACTUAL FILE OPERATIONS (including Dry Run) ---
    let finalTargetFilePath = newTargetFilePath;
    let isDuplicateRename = false; // Used to adjust logging for duplicates

    if (isDryRun) {
      if (proceedWithOperations) {
        // User didn't skip this specific file via interactive prompt
        let initialTargetExistsForDryRun = false;
        try {
          await access(newTargetFilePath); // Check original proposed target
          initialTargetExistsForDryRun = true;
        } catch {
          /* File doesn't exist, proceed with original target for logging */
        }

        let loggedTargetPath = newTargetFilePath;
        if (initialTargetExistsForDryRun) {
          console.log(`    DRY RUN: Target '${newTargetFilePath}' would collide. Simulating duplicate naming...`);
          const baseName = basename(targetFileName, fileExt);
          loggedTargetPath = pathJoin(targetSeasonPath, `${baseName}_dup_1${fileExt}`);
          // For dry run, we just log the first potential duplicate name
        }
        console.log(`    DRY RUN: Would ensure directory exists: ${targetSeasonPath}`);
        console.log(`    DRY RUN: Would move ${originalFilePath} -> ${loggedTargetPath}`);
        movedFiles++;
      } else {
        // This case implies user chose 'n' for this specific file in interactive mode OR skipAll was chosen before this file.
        console.log(`    DRY RUN: Skipped processing for ${fileBasename} (due to user choice or skipAll).`);
        skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      }
      continue; // Crucial: End processing for this file in the loop if it's a dry run.
    }

    // Actual Run (not a dry run)
    if (proceedWithOperations) {
      // Check if user decided to proceed with this file during interactive prompt
      try {
        console.log(`    Ensuring directory exists: ${targetSeasonPath}`);
        await mkdir(targetSeasonPath, { recursive: true });

        // Collision and duplicate handling for actual run
        let targetFileExists = false;
        try {
          await access(finalTargetFilePath); // finalTargetFilePath is initially newTargetFilePath
          targetFileExists = true;
        } catch (e: any) {
          if (e.code !== "ENOENT") {
            // Log unexpected errors during access check, but proceed as if file doesn't exist if unsure
            console.warn(
              `    WARNING: Could not verify initial target path ${finalTargetFilePath} due to error: ${e.message}. Assuming it might not exist or proceeding cautiously.`
            );
          }
          // If e.code === 'ENOENT', targetFileExists remains false, which is correct.
        }

        if (targetFileExists) {
          console.warn(`    WARN: Target file '${finalTargetFilePath}' already exists. Attempting to find a unique name by appending _dup_N...`);
          isDuplicateRename = true; // Not strictly needed for logic here but good for clarity if we extend logging
          let dupCount = 1;
          const baseName = basename(targetFileName, fileExt); // Use the calculated targetFileName's base
          while (true) {
            const newFileNameWithDup = `${baseName}_dup_${dupCount}${fileExt}`;
            const potentialDuplicatePath = pathJoin(targetSeasonPath, newFileNameWithDup);
            try {
              await access(potentialDuplicatePath);
              // File exists, increment and try next _dup_N
              dupCount++;
              if (dupCount > 100) {
                // Safety break to prevent infinite loops
                console.error(`    ERROR: Exceeded 100 attempts to find a unique duplicate name for '${targetFileName}'. Skipping rename for this file.`);
                finalTargetFilePath = ""; // Signal failure to find a unique name
                break;
              }
            } catch (e_dup: any) {
              if (e_dup.code === "ENOENT") {
                // This path is available
                finalTargetFilePath = potentialDuplicatePath;
                console.log(`    INFO: Will use unique name for duplicate: ${finalTargetFilePath}`);
                break;
              } else {
                // Some other error occurred while checking the existence of the duplicate path
                console.error(`    ERROR: Could not verify duplicate path ${potentialDuplicatePath} due to error: ${e_dup.message}. Skipping rename.`);
                finalTargetFilePath = ""; // Signal failure
                break;
              }
            }
          }
        }

        if (finalTargetFilePath) {
          // Proceed only if a valid target path was determined (original or _dup_N)
          await rename(originalFilePath, finalTargetFilePath);
          console.log(`    SUCCESS: Moved ${originalFilePath} -> ${finalTargetFilePath}`);
          movedFiles++;
        } else {
          // This else means finalTargetFilePath was set to '' due to failure in finding a unique name
          console.warn(`    SKIPPED: Could not determine a unique target path for '${originalFilePath}' after collision and duplicate checks.`);
          skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
        }
      } catch (error: any) {
        // This catches errors from mkdir, or the rename if finalTargetFilePath was valid but rename itself failed
        console.error(`    ERROR processing file operations for '${originalFilePath}': ${error.message}`);
        skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      }
    } else {
      // This 'else' means proceedWithOperations was false from the start (e.g. user chose 'n' or 's' earlier)
      // The 'skipAllCurrentCategory' should have been handled by a 'continue' before this block.
      // If user chose 'n' for this specific file:
      console.log(`    INFO: Skipped processing for '${fileBasename}' due to user choice.`);
      skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
    }
    // --- END OF NEW DUPLICATE HANDLING ---
  } // End of for loop

  console.log("\nShow Organization Summary:");
  console.log(`  Processed ${showFilesFromScanner.length} files.`);
  console.log(`  Moved ${movedFiles} files.`);
  console.log(`  Created ${createdDirectories} new directories.`);
  if (skippedFilePathsDueToMetadataUncertainty.length > 0) {
    console.log(`  Skipped ${skippedFilePathsDueToMetadataUncertainty.length} files due to metadata uncertainty (TMDB/LLM failure):`);
    skippedFilePathsDueToMetadataUncertainty.forEach((fp) => console.log(`    - ${fp}`));
  }
}
