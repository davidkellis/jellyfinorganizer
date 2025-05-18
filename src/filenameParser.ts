// src/filenameParser.ts
import { basename, extname } from "path"; // For parseMovieFilename & parseShowFilename
import { readFileSync } from "fs";
import { join as pathJoin } from "path"; // For wordlist path construction


// --- Wordlist Loading ---
let wordListSet: Set<string> | null = null;

export function getWordList(): Set<string> {
  if (wordListSet === null) {
    wordListSet = new Set<string>();
    try {
      const filePath = pathJoin(process.cwd(), "20k.txt");
      const fileContent = readFileSync(filePath, "utf-8");
      fileContent.split(/\r?\n/).forEach((word) => {
        const trimmedWord = word.trim();
        if (trimmedWord.length > 0) {
          wordListSet!.add(trimmedWord.toLowerCase());
        }
      });
      if (wordListSet.size > 0) {
        // console.log(`    Wordlist loaded: ${wordListSet.size} words from 20k.txt.`);
      } else {
        console.warn(`    Warning: Wordlist 20k.txt was empty or not found/readable. Word-based splitting will be skipped.`);
      }
    } catch (error) {
      let message = "Unknown error";
      if (error instanceof Error) message = error.message;
      console.warn(`    Warning: Could not load wordlist from 20k.txt. Word-based splitting will be skipped. Error: ${message}`);
      wordListSet = new Set<string>(); // Use empty set on error to prevent retry
    }
  }
  return wordListSet;
}

// Function to split a string based on a dictionary of words
function splitStringByWords(text: string, dictionary: Set<string>): string {
  if (!text || dictionary.size === 0) {
    return text;
  }

  const parts = text.split(/(\s+)/); // Split by existing spaces, keeping spaces
  const resultParts: string[] = [];

  for (const part of parts) {
    if (part.match(/^\s+$/) || part.length === 0) {
      // If it's whitespace or empty, keep it
      resultParts.push(part);
      continue;
    }

    let currentBlock = part;
    const blockResult: string[] = [];
    let i = 0;
    while (i < currentBlock.length) {
      let longestMatch = "";
      let matchEndPosition = i;

      for (let j = currentBlock.length; j >= i + 1; j--) {
        const segment = currentBlock.substring(i, j);
        if (dictionary.has(segment.toLowerCase())) {
          longestMatch = segment;
          matchEndPosition = j;
          break;
        }
      }

      if (longestMatch.length > 0) {
        blockResult.push(longestMatch);
        i = matchEndPosition;
      } else {
        let nonWordChunkEnd = i + 1;
        while (nonWordChunkEnd < currentBlock.length) {
          let canBreak = false;
          for (let k = currentBlock.length; k >= nonWordChunkEnd + 1; k--) {
            if (dictionary.has(currentBlock.substring(nonWordChunkEnd, k).toLowerCase())) {
              canBreak = true;
              break;
            }
          }
          if (canBreak) break;
          nonWordChunkEnd++;
        }
        blockResult.push(currentBlock.substring(i, nonWordChunkEnd));
        i = nonWordChunkEnd;
      }
    }
    resultParts.push(blockResult.join(" "));
  }
  return resultParts.join("").replace(/\s+/g, " ").trim();
}

// Local Parsed Info Interface
export interface ParsedMovieInfo {
  title: string;
  year: string | null;
  originalFilename: string;
}

export interface ParsedShowInfo {
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null; // Optional, might not always be in filename
  year: string | null; // Optional, year of the series or specific season/episode if parsable
  originalFilename: string;
}

/**
 * Parses a movie filename to extract title and year.
 * Attempts to handle "Title (Year)" and "Title.Year" patterns.
 * @param filename The movie filename (without path, but with extension).
 * @returns ParsedMovieInfo object.
 */
export function parseMovieFilename(filename: string, enableWordlistSplitting: boolean = true): ParsedMovieInfo {
  const originalFilename = filename;
  let nameWithoutExt = basename(filename, extname(filename));

  // 1. Replace periods and underscores with spaces.
  nameWithoutExt = nameWithoutExt.replace(/[\._]/g, " ");

  // 2. Split camelCase/PascalCase (lowerUPPER -> lower UPPER)
  nameWithoutExt = nameWithoutExt.replace(/([a-z])([A-Z])/g, "$1 $2");

  // 3. Split ALLCAPSWord (ACRONYMWord -> ACRONYM Word)
  nameWithoutExt = nameWithoutExt.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  // 4. Wordlist-based splitting (conditional)
  if (enableWordlistSplitting) {
    const loadedWordList = getWordList(); // Ensure wordlist is loaded
    if (loadedWordList.size > 0) {
      nameWithoutExt = splitStringByWords(nameWithoutExt, loadedWordList);
    }
  }

  // Trim any leading/trailing spaces that might have been introduced or consolidated
  nameWithoutExt = nameWithoutExt.trim();

  let parsedTitle: string | null = null;
  let parsedYear: string | null = null;

  // Pattern 1: "Title (Year)" e.g., "My Movie (2023)"
  let match = nameWithoutExt.match(/(.+?)\s*\((\d{4})\)/);
  if (match && match[1] && match[2]) {
    parsedTitle = match[1].trim();
    parsedYear = match[2];
    return { title: parsedTitle, year: parsedYear, originalFilename };
  }

  // Pattern 2: Attempt to find a year (e.g., "My Movie 2023")
  const yearCandidates: { year: string; index: number }[] = [];
  const yearRegex = /(?:\.| |^)(\d{4})(?:\.| |$|[^px\d])/g;
  let yearMatch;
  while ((yearMatch = yearRegex.exec(nameWithoutExt)) !== null) {
    if (
      yearMatch[1] === "1080" &&
      nameWithoutExt
        .substring(yearMatch.index + yearMatch[0].length)
        .toLowerCase()
        .startsWith("p")
    )
      continue;
    yearCandidates.push({ year: yearMatch[1], index: yearMatch.index });
  }

  if (yearCandidates.length > 0) {
    const chosenYear = yearCandidates[yearCandidates.length - 1];
    let titlePart = nameWithoutExt.substring(0, chosenYear.index);
    titlePart = titlePart.replace(/[\.\s]+$/, "").trim();

    if (titlePart) {
      // Corrected bug: was `if (title)` which was not in scope
      parsedTitle = titlePart;
      parsedYear = chosenYear.year;
      return { title: parsedTitle, year: parsedYear, originalFilename };
    }
  }

  // Fallback: If no year found or title extraction failed, use the whole (cleaned) name as title
  parsedTitle = nameWithoutExt.trim();
  return { title: parsedTitle, year: parsedYear, originalFilename }; // parsedYear will be null if not found
}

/**
 * Parses a TV show filename to extract series title, season, episode, and optionally year or episode title.
 * Attempts to handle common patterns like S01E01, 1x01, Season 1 Episode 1, etc.
 * @param filename The TV show filename (without path, but with extension).
 * @param enableWordlistSplitting Flag to enable/disable advanced word-based splitting for title refinement.
 * @returns ParsedShowInfo object.
 */
export function parseShowFilename(filename: string, enableWordlistSplitting: boolean = true): ParsedShowInfo {
  const originalFilename = filename;
  let nameWithoutExt = basename(filename, extname(filename));

  // Basic normalization: replace dots and underscores with spaces
  let cleanedName = nameWithoutExt.replace(/[._]/g, " ").trim();

  let seriesTitle: string | null = null;
  let seasonNumber: number | null = null;
  let episodeNumber: number | null = null;
  let episodeTitle: string | null = null;
  let year: string | null = null;

  // Regex patterns for Season/Episode. Order matters: more specific first.
  // Supports S01E01, S01E01-E02 (multi-episode), 1x01, Season 01 Episode 01, etc.
  const sePatterns = [
    // S01E01, s01e01, Season 01 Episode 01, Season 1 Ep 1, etc.
    {
      regex: /(.*?)[^\w]*(?:S(?:eason)?[^\w]*(\d{1,3}))[^\w]*(?:E(?:p(?:isode)?)?[^\w]*(\d{1,3}))(?:[^\w]*(?:E(?:p(?:isode)?)?[^\w]*(\d{1,3})))?/i,
      sIdx: 2, eIdx: 3, tIdx: 1, multiEIdx: 4
    },
    // 1x01, 1x01-02 (multi-episode)
    {
      regex: /(.*?)[^\w]*(\d{1,3})x(\d{1,3})(?:[\s-]*-?[\sDd]*(\d{1,3}))?/i,
      sIdx: 2, eIdx: 3, tIdx: 1, multiEIdx: 4
    },
     // Part 1, Pt. 1, Episode 1 (often for specials or single-season shows without explicit S prefix)
    {
       regex: /(.*?)[^\w]*(?:(?:Episode|Part|Ep|Pt)[^\w\d]*(\d{1,3}))/i,
       sIdx: null, eIdx: 2, tIdx: 1 // Season might be assumed 1 or needs context
    },
  ];

  for (const p of sePatterns) {
    const match = cleanedName.match(p.regex);
    if (match) {
      if (p.sIdx !== null && match[p.sIdx]) seasonNumber = parseInt(match[p.sIdx], 10);
      if (match[p.eIdx]) episodeNumber = parseInt(match[p.eIdx], 10);
      
      let titleCandidate = match[p.tIdx] ? match[p.tIdx].trim() : "";
      
      // Remove trailing hyphens, spaces, or common separators from the title part
      titleCandidate = titleCandidate.replace(/[\s-]+$/, "").trim();
      
      // Attempt to extract year from the title part before assigning seriesTitle
      const yearMatch = titleCandidate.match(/(.*?)\s*\(?(\d{4})\)?$/);
      if (yearMatch && yearMatch[1] && yearMatch[2]) {
        seriesTitle = yearMatch[1].trim();
        year = yearMatch[2];
      } else {
        seriesTitle = titleCandidate;
      }

      // Remainder of the string after SxE might be episode title or quality info
      let remainder = cleanedName.substring(match[0].length).trim();
      // Attempt to clean up and isolate episode title from quality/source tags
      const qualityTags = ["1080p", "720p", "480p", "HDTV", "WEB-DL", "WEBRip", "BluRay", "x264", "x265", "AAC", "DTS"];
      let cutOffIndex = remainder.length;
      for (const tag of qualityTags) {
        const tagIndex = remainder.toLowerCase().indexOf(tag.toLowerCase());
        if (tagIndex !== -1) {
          cutOffIndex = Math.min(cutOffIndex, tagIndex);
        }
      }
      episodeTitle = remainder.substring(0, cutOffIndex).replace(/^[- ]+/, "").replace(/[- ]+$/, "").trim() || null;
      if (episodeTitle === "") episodeTitle = null;
      
      break; // Found a match, stop processing patterns
    }
  }

  // If seriesTitle is still null after SE patterns, assume the whole cleaned name is the title (e.g. for movies miscategorized or specials)
  if (seriesTitle === null && episodeNumber === null) { // only if no episode info was found
    seriesTitle = cleanedName;
  }
  
  // Final title cleaning and word splitting if enabled
  if (seriesTitle && enableWordlistSplitting) {
    const loadedWordList = getWordList();
    if (loadedWordList.size > 0) {
      seriesTitle = splitStringByWords(seriesTitle.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"), loadedWordList);
    }
  }
  seriesTitle = seriesTitle?.replace(/\s+/g, " ").trim() || null;
  if (seriesTitle === "") seriesTitle = null;

  // Fallback: if no season but episode, assume season 1
  if (seasonNumber === null && episodeNumber !== null && seriesTitle !== null) {
    seasonNumber = 1;
  }

  return {
    seriesTitle,
    seasonNumber,
    episodeNumber,
    episodeTitle,
    year,
    originalFilename,
  };
}
