// src/filenameParser.ts
import { readFileSync } from "fs";
import { join as pathJoin } from "path"; // For wordlist path construction
import { basename, extname } from "path"; // For parseMovieFilename

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
