// src/movieOrganizer.ts
import { basename, extname, join as pathDirectoryJoin, dirname } from "path";
import { mkdir, rename, access } from "node:fs/promises";
import type { ParsedMovieInfo } from "./filenameParser";
import { getWordList, parseMovieFilename } from "./filenameParser";
import { fetchTmdbMovieMetadata } from "./tmdb";
import { getCorrectedMovieInfoFromLLM } from "./llmUtils";
import { extractVideoFileMetadata, type VideoFileMetadata } from "../src/metadataExtractor";

// Define common movie file extensions
export const MOVIE_EXTENSIONS = [".mkv", ".m4v", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mpg", ".mpeg"];

export async function organizeMovies(
  sourceDirectory: string,
  movieFilesFromScanner: string[],
  isDryRun: boolean,
  isInteractive: boolean,
  apiKey: string | null
) {
  getWordList(); // Prime the wordlist loading when starting movie organization
  console.log(`\nAttempting to organize MOVIES in: ${sourceDirectory} (Dry Run: ${isDryRun}, Interactive: ${isInteractive})`);

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

  let confirmAllCurrentCategory = false;
  let skipAllCurrentCategory = false;
  let movedFiles = 0;
  let createdDirectories = 0;
  const problematicFiles: { filePath: string; error: string }[] = [];
  const skippedFilePathsDueToMetadataUncertainty: string[] = [];

  console.log("\nProcessing movie files:");
  for (const originalFilePath of movieFilesFromScanner) {
    const fileItself = basename(originalFilePath);
    const filenameStem = basename(fileItself, extname(fileItself));
    const parentDir = dirname(originalFilePath);
    const parentDirName = basename(parentDir);
    const grandParentDir = dirname(parentDir);

    if (grandParentDir === sourceDirectory && filenameStem === parentDirName) {
      const parsedDirAsFile = parseMovieFilename(parentDirName + extname(fileItself));
      let canonicalDirName = parsedDirAsFile.title;
      if (parsedDirAsFile.year) {
        canonicalDirName += ` (${parsedDirAsFile.year})`;
      }
      if (parentDirName === canonicalDirName) {
        console.log(`\n  Skipping (already organized): ${originalFilePath}`);
        continue;
      }
    }

    const fileBasename = basename(originalFilePath);
    const fileExt = extname(originalFilePath);
    let usedTmdb = false;
    let parsedInfo: ParsedMovieInfo;
    let parsedInfoSourceForLog = "[Filename]"; // Default source

    // Attempt to extract metadata from the file first
    const videoMetadata = await extractVideoFileMetadata(originalFilePath);
    const initialTitleFromMetadata: string | undefined = videoMetadata?.title;
    const initialYearFromMetadata: number | undefined = videoMetadata?.year;

    if (initialTitleFromMetadata) {
      console.log(`    Found embedded metadata: Title='${initialTitleFromMetadata}', Year='${initialYearFromMetadata || "N/A"}'.`);
    }

    if (useTmdb && apiKey) {
      let titleForTmdb: string;
      let yearForTmdb: number | undefined;
      let sourceForTmdbAttempt = "filename";

      if (initialTitleFromMetadata) {
        titleForTmdb = initialTitleFromMetadata;
        yearForTmdb = initialYearFromMetadata;
        sourceForTmdbAttempt = "embedded metadata";
      } else {
        const parsedFromFile = parseMovieFilename(fileBasename, false);
        titleForTmdb = parsedFromFile.title;
        yearForTmdb = parsedFromFile.year;
      }
      console.log(`    Attempting TMDB lookup using ${sourceForTmdbAttempt} (Title: '${titleForTmdb}', Year: ${yearForTmdb || "N/A"}).`);
      const tmdbInfo = await fetchTmdbMovieMetadata(titleForTmdb, yearForTmdb, fileBasename, apiKey);

      if (tmdbInfo) {
        parsedInfo = tmdbInfo;
        usedTmdb = true;
        parsedInfoSourceForLog = "[TMDB]";
      } else {
        console.log(`    Initial TMDB lookup (using ${sourceForTmdbAttempt}) failed. Attempting LLM correction based on filename.`);
        const parsedFromFileForLlm = parseMovieFilename(fileBasename, false); // LLM always uses filename parse
        const llmResult = await getCorrectedMovieInfoFromLLM(fileBasename, parsedFromFileForLlm.title, parsedFromFileForLlm.year);

        if (llmResult) {
          console.log(`    LLM suggested: Title='${llmResult.title}', Year='${llmResult.year || "N/A"}'. Attempting TMDB with this info.`);
          const tmdbInfoFromLLM = await fetchTmdbMovieMetadata(llmResult.title, llmResult.year === null ? undefined : llmResult.year, fileBasename, apiKey);

          if (tmdbInfoFromLLM) {
            parsedInfo = tmdbInfoFromLLM;
            usedTmdb = true;
            parsedInfoSourceForLog = "[TMDB]"; // TMDB via LLM
            console.log(`    TMDB lookup successful using title from LLM suggestion!`);
          } else {
            console.log(`    WARN: TMDB search failed for LLM-corrected title '${llmResult.title}'. Using LLM suggestion as fallback.`);
            parsedInfo = {
              title: llmResult.title,
              year: llmResult.year,
              originalFilename: fileBasename,
            };
            // usedTmdb remains false
            parsedInfoSourceForLog = "[LLM Fallback]";
          }
        } else {
          console.log(`    WARN: LLM correction for '${fileBasename}' failed. Skipping this file.`);
          skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
          continue; // Skip to next file
        }
      }
    } else { // Not using TMDB
      if (initialTitleFromMetadata) {
        console.log(`    Using embedded metadata as TMDB is disabled (Title: '${initialTitleFromMetadata}', Year: ${initialYearFromMetadata || 'N/A'}).`);
        parsedInfo = {
          title: initialTitleFromMetadata,
          year: initialYearFromMetadata,
          originalFilename: fileBasename,
        };
        parsedInfoSourceForLog = "[Embedded Meta]";
      } else {
        console.log(`    No embedded metadata found and TMDB is disabled. Using filename parsing.`);
        parsedInfo = parseMovieFilename(fileBasename, true);
        parsedInfoSourceForLog = "[Filename]"; // Already default, but explicit here
      }
    }

    let targetFolderName = parsedInfo.title;
    if (parsedInfo.year) {
      targetFolderName += ` (${parsedInfo.year})`;
    }

    const sanitizedTargetFolderName = targetFolderName.replace(/[\/\?%\*:|"<>\.]/g, "_").trim();
    if (!sanitizedTargetFolderName) {
      console.warn(`    SKIPPING: Could not determine a valid folder name for '${originalFilePath}' (parsed title: '${parsedInfo.title}')`);
      continue;
    }

    const targetMovieDir = pathDirectoryJoin(sourceDirectory, sanitizedTargetFolderName);
    const targetFileName = sanitizedTargetFolderName + fileExt;
    const newTargetFilePath = pathDirectoryJoin(targetMovieDir, targetFileName);

    console.log(`\n  Original: ${originalFilePath}`);
    console.log(`    Parsed:   '${parsedInfo.title}' (${parsedInfo.year || "N/A"}) ${parsedInfoSourceForLog}`);
    console.log(`    Target:   ${newTargetFilePath}`);

    const oPath = originalFilePath;
    const nPath = newTargetFilePath;
    console.log(`    DEBUG: originalFilePath       = "${oPath}" (Length: ${oPath.length})`);
    console.log(`    DEBUG: newTargetFilePath      = "${nPath}" (Length: ${nPath.length})`);
    const arePathsEqual = oPath === nPath;
    console.log(`    DEBUG: Are paths equal (===)? = ${arePathsEqual}`);

    if (originalFilePath === newTargetFilePath) {
      console.log(`    INFO: File '${fileItself}' is already in the target location and correctly named. Skipping further operations.`);
      continue;
    }

    if (skipAllCurrentCategory) {
      console.log(`    SKIPPED (due to previous 'skip all' choice).`);
      continue;
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
        return;
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
        console.log(`    Attempting to process file for move: ${originalFilePath} -> ${newTargetFilePath}`);

        if (isInteractive && !confirmAllCurrentCategory) {
          const fileActionPrompt = prompt(`  Move file ${originalFilePath} to ${newTargetFilePath}? (y/n/a/s/q): `)?.toLowerCase();
          if (fileActionPrompt === "a") {
            confirmAllCurrentCategory = true;
          } else if (fileActionPrompt === "s") {
            skipAllCurrentCategory = true;
            console.log("    Skipping current file move and all remaining operations for this category.");
            proceedWithOperations = false;
          } else if (fileActionPrompt === "q") {
            console.log("    Quitting organization for this category.");
            return;
          } else if (fileActionPrompt === "n") {
            console.log("    Skipping file move for this item based on user input.");
            proceedWithOperations = false;
          } else if (fileActionPrompt !== "y") {
            console.log("    Invalid input. Skipping file move for this item.");
            proceedWithOperations = false;
          }
        }

        if (proceedWithOperations) {
          // --- START OF MODIFIED LOGIC FOR DUPLICATE HANDLING ---
          let finalTargetFilePath = newTargetFilePath; // Initial proposed path
          let isDuplicateRename = false;

          if (!isDryRun) { // Only check for existing files if not a dry run
            let targetFileExists = false;
            try {
              await access(finalTargetFilePath);
              targetFileExists = true;
            } catch (e: any) {
              if (e.code !== 'ENOENT') {
                console.warn(`    WARNING: Could not verify initial target path ${finalTargetFilePath} due to error: ${e.message}.`);
              }
              // if ENOENT, targetFileExists remains false
            }

            if (targetFileExists) {
              console.warn(`    WARN: Target file '${finalTargetFilePath}' already exists. Attempting to find a unique name...`);
              isDuplicateRename = true;
              let dupCount = 1;
              const baseName = basename(targetFileName, fileExt); // Original target name without extension
              
              while (true) {
                const newFileNameWithDup = `${baseName}_dup_${dupCount}${fileExt}`;
                const potentialDuplicatePath = pathDirectoryJoin(targetMovieDir, newFileNameWithDup);
                try {
                  await access(potentialDuplicatePath);
                  // File exists, try next dup_N
                  dupCount++;
                  if (dupCount > 100) { // Safety break
                    console.error(`    ERROR: Exceeded 100 attempts to find a unique duplicate name for '${targetFileName}'. Skipping rename for this file.`);
                    finalTargetFilePath = ''; // Signal failure
                    break;
                  }
                } catch (e_dup: any) {
                  if (e_dup.code === 'ENOENT') {
                    // This path is available
                    finalTargetFilePath = potentialDuplicatePath;
                    console.log(`    INFO: Will use unique name for duplicate: ${finalTargetFilePath}`);
                    break;
                  } else {
                    // Some other error checking existence of duplicate path
                    console.error(`    ERROR: Could not verify duplicate path ${potentialDuplicatePath} due to error: ${e_dup.message}. Skipping rename.`);
                    finalTargetFilePath = ''; // Signal failure
                    break;
                  }
                }
              }
            }
          } else { // Handling for Dry Run
            let initialTargetExistsForDryRun = false;
            try {
              await access(newTargetFilePath); // Check original target
              initialTargetExistsForDryRun = true;
            } catch { /* Do nothing, file doesn't exist */ }

            if (initialTargetExistsForDryRun) {
               console.log(`    DRY RUN: Target '${newTargetFilePath}' exists. In a real run, would attempt rename to a _dup_N file.`);
               const baseName = basename(targetFileName, fileExt);
               finalTargetFilePath = pathDirectoryJoin(targetMovieDir, `${baseName}_dup_1${fileExt}`);
               isDuplicateRename = true; 
            }
          }

          if (isDryRun) {
            if (finalTargetFilePath) { 
              console.log(`    DRY RUN: Would ensure directory exists: ${targetMovieDir}`);
              if (isDuplicateRename) {
                console.log(`    DRY RUN: Would move ${originalFilePath} -> ${finalTargetFilePath} (as duplicate)`);
              } else {
                console.log(`    DRY RUN: Would move ${originalFilePath} -> ${finalTargetFilePath}`);
              }
            } else {
                console.log(`    DRY RUN: SKIPPED ${fileBasename} (due to error determining unique name in simulation).`);
            }
          } else { // Actual run
            if (finalTargetFilePath) { 
              try {
                await rename(originalFilePath, finalTargetFilePath);
                console.log(`    SUCCESS: Moved ${originalFilePath} -> ${finalTargetFilePath}`);
              } catch (renameError: any) {
                console.error(`    ERROR: Failed to move '${originalFilePath}' to '${finalTargetFilePath}': ${renameError.message}`);
              }
            } else { // This 'else' is for when finalTargetFilePath was not determined (e.g., _dup_100 exceeded)
              console.warn(`    SKIPPED: Could not determine a unique target path for '${originalFilePath}' after collision checks.`);
            }
          }
          // --- END OF MODIFIED LOGIC ---
        } else if (!skipAllCurrentCategory) {
          console.log(`    SKIPPED moving file: ${originalFilePath} (due to user choice or skip_all).`);
        }
      } catch (error) {
        console.error(`    ERROR processing file operations for ${originalFilePath}:`, error);
      }
    } else if (isDryRun) {
      console.log(`    DRY RUN: Would ensure directory ${targetMovieDir} exists.`);
      console.log(`    DRY RUN: Would move file to ${newTargetFilePath}`);
    }
  }
  console.log("\nMovie organization process complete.");
}
