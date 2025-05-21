// src/musicOrganizer.ts
import { basename, extname, join as pathJoin, dirname } from 'path';

const MIN_MB_SCORE_FROM_TAGS = 70; // Minimum score for a MusicBrainz match when using local file tags
// const MIN_MB_SCORE_NO_TAGS = 60;   // Minimum score if searching MB without strong local tags (e.g. just filename based, not currently used but good to have)
const MIN_MB_SCORE_AFTER_LLM_FALLBACK = 65; // Minimum score for MB search after LLM correction/suggestion
import { mkdir, rename, access } from 'node:fs/promises';
import { extractMusicFileMetadata, type MusicFileMetadata } from './metadataExtractor';
import { searchMusicBrainzReleases, lookupMusicBrainzReleaseTracks, type MusicBrainzRelease, type MusicBrainzTrack } from './musicbrainzClient';
import { getCorrectedMusicInfoFromLLM, type CorrectedMusicInfo } from './llmUtils'; // Added for LLM fallback

// Helper to sanitize folder and file names (adapted from showOrganizer)
function sanitizeName(name: string): string {
  if (!name) return "";
  return name.replace(/[\/?%*:|"<>\.]/g, "_").replace(/\s+$/,'').replace(/^\s+/,'').trim();
}

interface MusicPathComponents {
  targetArtistFolder: string;
  targetAlbumFolder: string;
  targetAlbumPath: string; // Full path to the album directory: destination/Artist/Album (Year)
  targetFileName: string;
  targetFullPath: string; // Full path to the target file: targetAlbumPath/TrackFileName.ext
  originalFilePath: string;
  fileBasename: string;
  fileExt: string;
}

// Helper function to find the best matching track within a MusicBrainz release's tracklist
function findMatchingTrackInRelease(
  tracks: MusicBrainzTrack[], 
  searchTitle: string | null | undefined, 
  searchTrackNumber?: string | number | null
): MusicBrainzTrack | undefined {
  if (!tracks || tracks.length === 0) return undefined;
  if (!searchTitle && !searchTrackNumber) return undefined; // Need at least something to match

  const normalizedSearchTitle = searchTitle ? sanitizeName(searchTitle).toLowerCase() : null;
  const searchTrackNum = typeof searchTrackNumber === 'string' ? parseInt(searchTrackNumber, 10) : searchTrackNumber;

  let bestMatch: MusicBrainzTrack | undefined = undefined;
  let bestMatchScore = -1; // Higher is better

  // First pass: Try to match by track number and title similarity
  if (searchTrackNum != null && !isNaN(searchTrackNum)) {
    for (const track of tracks) {
      const trackNumFromMB = typeof track.number === 'string' ? parseInt(track.number, 10) : track.number;
      if (trackNumFromMB === searchTrackNum) {
        const normalizedTrackTitle = sanitizeName(track.title).toLowerCase();
        if (normalizedSearchTitle && normalizedTrackTitle === normalizedSearchTitle) {
          return track; // Perfect match on track number and title
        }
        // If title doesn't match perfectly but track number does, consider it a candidate
        if (!bestMatch || (normalizedSearchTitle && normalizedTrackTitle.includes(normalizedSearchTitle))) {
          bestMatch = track;
          bestMatchScore = normalizedSearchTitle && normalizedTrackTitle === normalizedSearchTitle ? 2 : 1; // Title match is better
        }
      }
    }
    if (bestMatch && bestMatchScore > 0) return bestMatch; // Return if track number match found, even if title not perfect
  }

  // Second pass: If no track number match or no track number provided, try title matching
  // Reset for title-only matching if first pass didn't yield a definitive result
  bestMatch = undefined;
  bestMatchScore = -1;

  if (normalizedSearchTitle) {
    for (const track of tracks) {
      const normalizedTrackTitle = sanitizeName(track.title).toLowerCase();
      if (normalizedTrackTitle === normalizedSearchTitle) {
        return track; // Exact title match
      }
      if (normalizedTrackTitle.includes(normalizedSearchTitle)) {
        // Prefer shorter tracks if it's an inclusion, to avoid matching a short search title against a long track title
        if (!bestMatch || normalizedTrackTitle.length < sanitizeName(bestMatch.title).toLowerCase().length) {
          bestMatch = track;
          bestMatchScore = 0; // Mark as an inclusion match
        }
      }
    }
  }
  return bestMatch; // Could be undefined if no good match found
}

// Function to determine all necessary path components for a music file
function determineMusicPathComponents(
  filePath: string,
  metadata: MusicFileMetadata,
  destinationDirectory: string,
  mbReleaseDetails?: MusicBrainzRelease,
  mbMatchedTrack?: MusicBrainzTrack,
  mbReleaseArtistFromSearch?: string 
): MusicPathComponents | null {
  const fileBasename = basename(filePath);
  const fileExt = extname(filePath);

  let finalAlbumArtist: string;
  let finalAlbumTitle: string;
  let finalAlbumYear: string | undefined;
  let finalTrackTitle: string;
  let finalTrackNumberStr: string;
  let isCompilation = false;
  let sourceDescription: string;

  if (mbReleaseDetails) {
    sourceDescription = "MusicBrainz";
    // Prioritize MusicBrainz data
    finalAlbumArtist = mbReleaseArtistFromSearch || metadata.albumArtist || metadata.artist || 'Unknown Artist';
    finalAlbumTitle = mbReleaseDetails.title;
    finalAlbumYear = mbReleaseDetails.date?.substring(0, 4) || metadata.year?.toString();
    const primaryTypeIsCompilation = mbReleaseDetails.releaseGroup?.primaryType?.toLowerCase() === 'compilation';
    const artistCreditIsVarious = mbReleaseDetails.artistCredit?.some(ac => ac.artist.name.toLowerCase() === 'various artists') ?? false;
    isCompilation = primaryTypeIsCompilation || artistCreditIsVarious;

    finalTrackTitle = mbMatchedTrack?.title || metadata.title || 'Unknown Track';
    finalTrackNumberStr = (mbMatchedTrack?.number || metadata.trackNumber?.toString() || '00').padStart(2, '0');
    // Artist for the specific track, could be different from album artist, especially on compilations
    const trackSpecificArtist = mbMatchedTrack?.artistCredit?.map(ac => ac.artist.name).join(', '); 

    if (isCompilation) {
      finalAlbumArtist = 'Various Artists'; // Standard folder for compilations
    }
    // Sanitize all components that will form parts of paths
    finalAlbumArtist = sanitizeName(finalAlbumArtist);
    finalAlbumTitle = sanitizeName(finalAlbumTitle);
    finalTrackTitle = sanitizeName(finalTrackTitle);
    const sanitizedTrackSpecificArtist = sanitizeName(trackSpecificArtist || metadata.artist || '');

    const targetArtistFolder = finalAlbumArtist;
    const targetAlbumFolder = `${finalAlbumTitle}${finalAlbumYear ? ` (${finalAlbumYear})` : ''}`;
    
    let trackFilenameBase = `${finalTrackNumberStr} - ${finalTrackTitle}`;
    // For compilations, if the track artist is known and different from 'Various Artists', include it in the filename
    if (isCompilation && sanitizedTrackSpecificArtist && sanitizedTrackSpecificArtist.toLowerCase() !== 'various artists') {
      trackFilenameBase = `${finalTrackNumberStr} - ${sanitizedTrackSpecificArtist} - ${finalTrackTitle}`;
    }
    const targetFileName = `${trackFilenameBase}${fileExt}`;
    const targetAlbumPath = pathJoin(destinationDirectory, targetArtistFolder, targetAlbumFolder);
    const targetFullPath = pathJoin(targetAlbumPath, targetFileName);

    console.log(`    Path determined using ${sourceDescription}:`);
    console.log(`      Artist Folder: ${targetArtistFolder}`);
    console.log(`      Album Folder:  ${targetAlbumFolder}`);
    console.log(`      Track File:    ${targetFileName}`);
    console.log(`      Full Target:   ${targetFullPath}`);

    return { targetArtistFolder, targetAlbumFolder, targetAlbumPath, targetFileName, targetFullPath, originalFilePath: filePath, fileBasename, fileExt };

  } else {
    // Fallback: Use local metadata only
    sourceDescription = "Local Metadata Fallback";
    finalAlbumArtist = sanitizeName(metadata.albumArtist || metadata.artist || 'Unknown Artist');
    finalAlbumTitle = sanitizeName(metadata.album || 'Unknown Album');
    finalAlbumYear = metadata.year?.toString();
    finalTrackTitle = sanitizeName(metadata.title || 'Unknown Track');
    finalTrackNumberStr = (metadata.trackNumber?.toString() || '00').padStart(2, '0');

    isCompilation = finalAlbumArtist.toLowerCase().includes('various artists'); // Simple check for fallback
    const sanitizedTrackArtist = sanitizeName(metadata.artist || '');

    let trackFilenameBase = `${finalTrackNumberStr} - ${finalTrackTitle}`;
    if (isCompilation && sanitizedTrackArtist && sanitizedTrackArtist.toLowerCase() !== 'various artists' && sanitizedTrackArtist.toLowerCase() !== finalAlbumArtist.toLowerCase()) {
        trackFilenameBase = `${finalTrackNumberStr} - ${sanitizedTrackArtist} - ${finalTrackTitle}`;
    }

    const targetArtistFolder = finalAlbumArtist;
    const targetAlbumFolder = `${finalAlbumTitle}${finalAlbumYear ? ` (${finalAlbumYear})` : ''}`;
    const targetFileName = `${trackFilenameBase}${fileExt}`;
    const targetAlbumPath = pathJoin(destinationDirectory, targetArtistFolder, targetAlbumFolder);
    const targetFullPath = pathJoin(targetAlbumPath, targetFileName);

    console.log(`    Path determined using ${sourceDescription} for ${fileBasename}:`);
    console.log(`      Artist Folder: ${targetArtistFolder}`);
    console.log(`      Album Folder:  ${targetAlbumFolder}`);
    console.log(`      Track File:    ${targetFileName}`);
    console.log(`      Full Target:   ${targetFullPath}`);
    
    return { targetArtistFolder, targetAlbumFolder, targetAlbumPath, targetFileName, targetFullPath, originalFilePath: filePath, fileBasename, fileExt };
  }
}

// Define common music file extensions
export const MUSIC_EXTENSIONS: string[] = [
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus', '.aiff', '.dsf', '.wma'
];

export interface MusicOrganizationOptions {
  dryRun: boolean;
  interactive: boolean;
  // apiKey is not used for music directly yet, but kept for structural consistency
  // and potential future use (e.g., if MusicBrainz needs one via a proxy)
  apiKey?: string | null; 
}

/**
 * Organizes music files into a Jellyfin-compatible structure.
 * @param sourceDirectory Absolute path to the source directory containing music files.
 * @param musicFilesFromScanner Absolute paths to the music files to process.
 * @param isDryRun Whether to simulate file operations without actually moving files.
 * @param isInteractive Whether to prompt the user for confirmation before moving files.
 * @param destinationDirectory Absolute path to the destination directory for organized music files.
 */
export async function organizeMusic(
  sourceDirectory: string, 
  musicFilesFromScanner: string[], 
  isDryRun: boolean, 
  isInteractive: boolean
) {
  console.log(`\nAttempting to organize MUSIC files (within Source: ${sourceDirectory}, Dry Run: ${isDryRun}, Interactive: ${isInteractive})`);

  if (musicFilesFromScanner.length === 0) {
    console.log("No music files provided by scanner to process.");
    console.log("\nMusic organization pass complete.");
    return;
  }
  console.log(`Processing ${musicFilesFromScanner.length} music files provided by scanner.`);

  let confirmAllCurrentCategory = false;
  let skipAllCurrentCategory = false;
  let movedFiles = 0;
  const problematicFiles: { filePath: string; error: string }[] = [];
  const skippedFilePathsDueToMetadataUncertainty: string[] = [];

  for (const originalFilePath of musicFilesFromScanner) {
    const localMetadata = await extractMusicFileMetadata(originalFilePath);
    const fileBasenameForLoop = basename(originalFilePath); // Use this for logging within the loop for this file
    console.log(`\n--- Processing Music File: ${fileBasenameForLoop} ---`);

    if (!localMetadata) {
      console.warn(`  WARN: Could not extract any local metadata for ${fileBasenameForLoop}. Skipping.`);
      skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      continue;
    }
    console.log(`  Local Meta: Artist='${localMetadata.artist}', Album='${localMetadata.album}', Title='${localMetadata.title}', Track='${localMetadata.trackNumber}', Year='${localMetadata.year}'`);

    let pathComponents: MusicPathComponents | null = null;
    let mbReleaseDetails: MusicBrainzRelease | undefined = undefined;
    let mbMatchedTrack: MusicBrainzTrack | undefined = undefined;
    let mbReleaseArtistFromSearch: string | undefined = undefined;
    let attemptSource = "None"; // To track where the successful MB info came from

    // --- Initial MusicBrainz Search using Local Metadata ---
    if (localMetadata.album) {
      console.log(`  Attempting MusicBrainz search with local tags: Album='${localMetadata.album}', Artist='${localMetadata.artist}'`);
      let searchQuery = `release:"${sanitizeName(localMetadata.album)}"`; // Sanitize inputs for query
      if (localMetadata.artist) searchQuery += ` AND artist:"${sanitizeName(localMetadata.artist)}"`;
      if (localMetadata.year) searchQuery += ` AND date:${localMetadata.year}`;
      
      const searchResults = await searchMusicBrainzReleases(searchQuery);

      if (searchResults && searchResults.length > 0) {
        for (const potentialRelease of searchResults) {
          if (potentialRelease.id && typeof potentialRelease.score === 'number' && potentialRelease.score >= MIN_MB_SCORE_FROM_TAGS) {
            const releaseArtistCredit = potentialRelease.artistCredit?.map(ac => ac.artist.name).join(', ') || 'Unknown Artist';
            console.log(`    Found potential release (Score: ${potentialRelease.score}): '${potentialRelease.title}' by ${releaseArtistCredit} (ID: ${potentialRelease.id})`);
            const releaseWithTracks = await lookupMusicBrainzReleaseTracks(potentialRelease.id);

            if (releaseWithTracks && releaseWithTracks.media && releaseWithTracks.media.length > 0) {
              const allTracksFromMedia: MusicBrainzTrack[] = releaseWithTracks.media.flatMap(m => m.tracks || []).filter(track => track != null);
              if (allTracksFromMedia.length > 0) {
                const matchedTrackAttempt = findMatchingTrackInRelease(allTracksFromMedia, localMetadata.title, localMetadata.trackNumber?.toString());
                if (matchedTrackAttempt) {
                  console.log(`      SUCCESS (Local Tags): Matched track '${matchedTrackAttempt.title}' (TrackNo: ${matchedTrackAttempt.number}) in release '${releaseWithTracks.title}'.`);
                  mbReleaseDetails = releaseWithTracks;
                  mbMatchedTrack = matchedTrackAttempt;
                  mbReleaseArtistFromSearch = releaseArtistCredit;
                  attemptSource = "Local Tags";
                  break; // Found a good match, exit this inner loop (potentialRelease loop)
                }
              } else {
                console.log(`      INFO (Local Tags): Release '${potentialRelease.title}' (ID: ${potentialRelease.id}) has media, but no tracks found within the media objects after processing.`);
              }
            } else {
              console.log(`      INFO (Local Tags): Release '${potentialRelease.title}' (ID: ${potentialRelease.id}) found, but no media information or lookup failed to return tracks.`);
            }
          }
          if (mbReleaseDetails) break; // Exit outer loop (searchResults loop) if match found
        }
      }
      if (!mbReleaseDetails) {
        console.log(`  MusicBrainz search with local tags did not yield a high-confidence match for album '${localMetadata.album}'.`);
      }
    } else {
      console.log(`  Skipping initial MusicBrainz search: No local album tag for ${fileBasenameForLoop}.`);
    }

    // --- LLM Fallback Search (if initial search failed) ---
    if (!mbReleaseDetails) {
      console.log(`  INFO: Initial MusicBrainz lookup unsuccessful. Attempting LLM fallback for filename: ${fileBasenameForLoop}`);
      const llmMusicInfo = await getCorrectedMusicInfoFromLLM(fileBasenameForLoop, localMetadata);

      if (llmMusicInfo && llmMusicInfo.artist && (llmMusicInfo.album || llmMusicInfo.title)) {
        console.log(`    LLM Suggestion: Artist='${llmMusicInfo.artist}', Album='${llmMusicInfo.album}', Title='${llmMusicInfo.title}', Year='${llmMusicInfo.year}', TrackNo='${llmMusicInfo.trackNumber}'`);
        
        let llmArtist = llmMusicInfo.artist;
        let llmAlbum = llmMusicInfo.album;
        let llmTitle = llmMusicInfo.title;
        let llmYear = llmMusicInfo.year ? String(llmMusicInfo.year) : undefined;
        let llmTrackNumber = llmMusicInfo.trackNumber ?? undefined;
        
        let llmSearchQuery = ``;
        const searchArtist = sanitizeName(llmArtist);
        let searchAlbum: string | null = null;
        let searchTitleForReleaseContext: string | null = null;

        if (llmMusicInfo.album) {
          searchAlbum = sanitizeName(llmMusicInfo.album);
          llmSearchQuery = `release:"${searchAlbum}" AND artist:"${searchArtist}"`;
        } else if (llmMusicInfo.title && !llmMusicInfo.album && localMetadata.album) {
          // LLM gave title, no album, but we have a local album tag - try LLM title with local album
          searchAlbum = sanitizeName(localMetadata.album);
          searchTitleForReleaseContext = sanitizeName(llmMusicInfo.title);
          console.log(`    LLM gave title but no album. Using local album '${searchAlbum}' with LLM artist '${searchArtist}' for release search.`);
          llmSearchQuery = `release:"${searchAlbum}" AND artist:"${searchArtist}"`;
        } else if (llmMusicInfo.title) {
          // LLM gave title, no album from LLM, no local album tag. This search is less likely to be precise for a release.
          // Consider searching recordings, then finding releases. For now, this is a weaker search.
          searchTitleForReleaseContext = sanitizeName(llmMusicInfo.title);
          console.warn(`    WARN: LLM suggested title '${searchTitleForReleaseContext}' and artist '${searchArtist}' but no album. MusicBrainz release search may be imprecise.`);
          llmSearchQuery = `release:"${searchTitleForReleaseContext}" AND artist:"${searchArtist}"`; // This is a loose search
        } else {
            console.log("    LLM did not provide enough info (artist and album/title) for a targeted MusicBrainz search.");
            llmSearchQuery = ""; // Prevent search
        }

        if (llmYear && llmSearchQuery) { // Use the stringified llmYear
             llmSearchQuery += ` AND date:${llmYear}`;
        }

        if (llmSearchQuery) {
            console.log(`    Attempting MusicBrainz search with LLM-derived info (Query: ${llmSearchQuery})`);
            const llmSearchResults = await searchMusicBrainzReleases(llmSearchQuery);

            if (llmSearchResults && llmSearchResults.length > 0) {
              for (const potentialRelease of llmSearchResults) {
                if (potentialRelease.id && typeof potentialRelease.score === 'number' && potentialRelease.score >= MIN_MB_SCORE_AFTER_LLM_FALLBACK) {
                  const releaseArtistCredit = potentialRelease.artistCredit?.map(ac => ac.artist.name).join(', ') || 'Unknown Artist';
                  console.log(`    LLM Fallback: Found potential release (Score: ${potentialRelease.score}): '${potentialRelease.title}' by ${releaseArtistCredit} (ID: ${potentialRelease.id})`);
                  const releaseWithTracks = await lookupMusicBrainzReleaseTracks(potentialRelease.id);
                  if (releaseWithTracks && releaseWithTracks.media && releaseWithTracks.media.length > 0) {
                    const allTracksFromMedia: MusicBrainzTrack[] = releaseWithTracks.media.flatMap(m => m.tracks || []).filter(track => track != null);
                    if (allTracksFromMedia.length > 0) {
                      const titleToMatch = llmMusicInfo.title || localMetadata.title;
                      const trackNumToMatch = llmMusicInfo.trackNumber?.toString() || localMetadata.trackNumber?.toString();
                      let matchedTrackAttempt = findMatchingTrackInRelease(allTracksFromMedia, titleToMatch, trackNumToMatch);
                      
                      if (!matchedTrackAttempt && llmMusicInfo.title) {
                          console.log(`      INFO (LLM Fallback): Initial track match failed on media tracks (using title: '${titleToMatch}', trackNo: '${trackNumToMatch}'). Retrying with LLM title '${llmMusicInfo.title}' only on media tracks.`);
                          matchedTrackAttempt = findMatchingTrackInRelease(allTracksFromMedia, llmMusicInfo.title, undefined);
                      }

                      if (matchedTrackAttempt) {
                        console.log(`      SUCCESS (LLM Fallback): Matched track '${matchedTrackAttempt.title}' (TrackNo: ${matchedTrackAttempt.number}) in release '${releaseWithTracks.title}' (via media).`);
                        mbReleaseDetails = releaseWithTracks;
                        mbMatchedTrack = matchedTrackAttempt;
                        mbReleaseArtistFromSearch = releaseArtistCredit; 
                        attemptSource = "LLM Fallback";
                        break; // Exit loop over llmSearchResults
                      } else {
                        console.log(`      INFO (LLM Fallback): Release '${potentialRelease.title}' (ID: ${potentialRelease.id}) media tracks processed, but no specific match for title/track after retries.`);
                      }
                    } else {
                       console.log(`      INFO (LLM Fallback): Release '${potentialRelease.title}' (ID: ${potentialRelease.id}) has media, but no tracks found within it after processing.`);
                    }
                  } else {
                       console.log(`      INFO (LLM Fallback): Release '${potentialRelease.title}' (ID: ${potentialRelease.id}) lookup failed to return valid media/tracks information.`);
                  }
                }
                if (mbReleaseDetails) break; // Exit loop over llmSearchResults if already found a match in an earlier iteration
              } // End of for...of llmSearchResults
            }

            if (mbReleaseDetails) {
                console.log(`  MusicBrainz search WITH LLM context SUCCEEDED for '${fileBasenameForLoop}'.`);
            } else {
                console.log(`  MusicBrainz search with LLM context did not yield a high-confidence match for '${fileBasenameForLoop}'.`);
            }
        } else { // This 'else' corresponds to 'if (llmSearchQuery)'
            console.log("    LLM provided some info, but not enough to construct a valid MusicBrainz search query (e.g., missing album and title for release search, or other essential fields).");
        }
      } else { // This 'else' corresponds to 'if (llmMusicInfo && llmMusicInfo.artist && (llmMusicInfo.album || llmMusicInfo.title))'
        console.log(`    LLM did not provide sufficient info (artist and album/title) for a MusicBrainz search for ${fileBasenameForLoop}.`);
      }
    } // End of 'if (!mbReleaseDetails)' which is the main LLM fallback block

    if (!mbReleaseDetails) {
      console.warn(`  WARN: Could not find a satisfactory MusicBrainz match for ${fileBasenameForLoop} (Source: ${attemptSource}). Path will be based on local metadata only.`);
    } else {
      console.log(`  Proceeding with MusicBrainz details (Source: ${attemptSource}) for ${fileBasenameForLoop}.`);
    }

    pathComponents = determineMusicPathComponents(originalFilePath, localMetadata, sourceDirectory, mbReleaseDetails, mbMatchedTrack, mbReleaseArtistFromSearch);

    // At this point, pathComponents is set based on MB data (if found) or fallback to local metadata (if MB failed or was skipped).

    if (!pathComponents) {
      console.warn(`    WARN: Could not determine path components for ${fileBasenameForLoop}. Skipping.`);
      skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      continue;
    }

    const { targetArtistFolder, targetAlbumFolder, targetAlbumPath, targetFileName, targetFullPath, fileBasename, fileExt } = pathComponents;

    // --- File Operations Logic ---
    const currentFileDir = dirname(originalFilePath);
    const currentAlbumFolderBasename = basename(currentFileDir);
    const currentArtistFolderDir = dirname(currentFileDir);
    const currentArtistFolderBasename = basename(currentArtistFolderDir);

    if (
      dirname(currentArtistFolderDir) === sourceDirectory &&
      currentArtistFolderBasename === targetArtistFolder &&
      currentAlbumFolderBasename === targetAlbumFolder &&
      fileBasename === targetFileName
    ) {
      console.log(`    INFO: File '${fileBasename}' is already perfectly organized. Skipping.`);
      continue;
    }
    if (originalFilePath === targetFullPath) {
      console.log(`    INFO: File '${fileBasename}' is already in the target location and correctly named. Skipping.`);
      continue;
    }
    // Proposed target already logged by determineMusicPathComponents

    if (skipAllCurrentCategory) {
      console.log(`    SKIPPED (due to previous 'skip all' choice).`);
      continue;
    }

    let proceedWithOperations = true;
    if (isInteractive && !confirmAllCurrentCategory) {
      const answer = prompt(`  Organize '${fileBasename}' to '${targetFullPath}'? (y/n/a/s/q): `)?.toLowerCase();
      if (answer === 'a') confirmAllCurrentCategory = true;
      else if (answer === 's') { skipAllCurrentCategory = true; proceedWithOperations = false; console.log("    Skipping all remaining music files."); }
      else if (answer === 'q') { console.log("    Quitting music organization."); return; }
      else if (answer === 'n') { proceedWithOperations = false; console.log("    Skipping this file."); }
      else if (answer !== 'y') { console.log("    Invalid input. Skipping this file."); proceedWithOperations = false; }
    }

    if (isDryRun) {
      if (proceedWithOperations) {
        let initialTargetExistsForDryRun = false;
        try { await access(targetFullPath); initialTargetExistsForDryRun = true; } catch {}
        let loggedTargetPath = targetFullPath;
        if (initialTargetExistsForDryRun) {
          console.log(`    DRY RUN: Target '${targetFullPath}' would collide. Simulating duplicate naming...`);
          const base = basename(targetFileName, fileExt);
          loggedTargetPath = pathJoin(targetAlbumPath, `${base}_dup_1${fileExt}`);
        }
        console.log(`    DRY RUN: Would ensure directory exists: ${targetAlbumPath}`);
        console.log(`    DRY RUN: Would move ${originalFilePath} -> ${loggedTargetPath}`);
        movedFiles++;
      } else {
        console.log(`    DRY RUN: Skipped processing for ${fileBasename} (due to user choice or skipAll).`);
        skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
      }
      continue; 
    }

    // Actual Run
    if (proceedWithOperations) {
      let finalTargetFilePath = targetFullPath;
      try {
        console.log(`    Ensuring directory exists: ${targetAlbumPath}`);
        await mkdir(targetAlbumPath, { recursive: true });
        
        let targetFileExists = false;
        try { await access(finalTargetFilePath); targetFileExists = true; } 
        catch (e: any) { if (e.code !== 'ENOENT') console.warn(`    WARNING: Could not verify initial target path ${finalTargetFilePath}: ${e.message}.`); }

        if (targetFileExists) {
          console.warn(`    WARN: Target file '${finalTargetFilePath}' already exists. Attempting duplicate naming...`);
          let dupCount = 1;
          const base = basename(targetFileName, fileExt);
          while (true) {
            const newFileNameWithDup = `${base}_dup_${dupCount}${fileExt}`;
            const potentialDuplicatePath = pathJoin(targetAlbumPath, newFileNameWithDup);
            try {
              await access(potentialDuplicatePath);
              dupCount++;
              if (dupCount > 100) { 
                console.error(`    ERROR: Exceeded 100 attempts for unique duplicate name for '${targetFileName}'. Skipping.`);
                finalTargetFilePath = ''; break;
              }
            } catch (e_dup: any) {
              if (e_dup.code === 'ENOENT') { finalTargetFilePath = potentialDuplicatePath; console.log(`    INFO: Using unique name for duplicate: ${finalTargetFilePath}`); break; }
              else { console.error(`    ERROR: Could not verify duplicate path ${potentialDuplicatePath}: ${e_dup.message}. Skipping.`); finalTargetFilePath = ''; break; }
            }
          }
        }

        if (finalTargetFilePath) {
          await rename(originalFilePath, finalTargetFilePath);
          console.log(`    SUCCESS: Moved ${originalFilePath} -> ${finalTargetFilePath}`);
          movedFiles++;
        } else {
          console.warn(`    SKIPPED: Could not determine a unique target path for '${originalFilePath}'.`);
          skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
        }
      } catch (error: any) {
        console.error(`    ERROR processing file operations for '${originalFilePath}': ${error.message}`);
        problematicFiles.push({ filePath: originalFilePath, error: error.message });
      }
    } else {
      console.log(`    INFO: Skipped processing for '${fileBasename}' due to user choice.`);
      skippedFilePathsDueToMetadataUncertainty.push(originalFilePath);
    }
  } // End of for loop

  console.log('\n--- Music Organization Summary ---');
  console.log(`Successfully moved ${movedFiles} music files.`);
  if (skippedFilePathsDueToMetadataUncertainty.length > 0) {
    console.warn(`Skipped ${skippedFilePathsDueToMetadataUncertainty.length} files due to metadata uncertainty or user choice:`);
    skippedFilePathsDueToMetadataUncertainty.forEach(fp => console.warn(`  - ${fp}`));
  }
  if (problematicFiles.length > 0) {
    console.error(`Encountered errors with ${problematicFiles.length} files:`);
    problematicFiles.forEach(pf => console.error(`  - ${pf.filePath}: ${pf.error}`));
  }
  console.log("Music organization pass complete.");
}
