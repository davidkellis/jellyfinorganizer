// src/tmdb.ts
import { ParsedMovieInfo } from './filenameParser';

// TMDB API Interfaces
export interface TmdbMovieResult {
  id: number;
  title: string;
  release_date: string; // "YYYY-MM-DD"
  original_title: string;
  overview: string;
}

export interface TmdbSearchResponse {
  page: number;
  results: TmdbMovieResult[];
  total_pages: number;
  total_results: number;
}

// Helper function to fetch movie metadata from TMDB
export async function fetchTmdbMovieMetadata(
  filenameTitle: string,
  filenameYear: string | null,
  originalFilename: string,
  apiKey: string
): Promise<ParsedMovieInfo | null> {
  let searchQuery = encodeURIComponent(filenameTitle.trim());
  const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${searchQuery}`;
  let finalSearchUrl = searchUrl;
  if (filenameYear) {
    finalSearchUrl += `&year=${filenameYear}`;
  }

  try {
    // console.log(`    Querying TMDB: ${finalSearchUrl}`); // Uncomment for debugging TMDB URLs
    const response = await fetch(finalSearchUrl);
    if (!response.ok) {
      console.warn(`    TMDB API returned ${response.status} for ${originalFilename}. Query: ${finalSearchUrl}`);
      return null;
    }
    const data: TmdbSearchResponse = await response.json();

    if (data.results && data.results.length > 0) {
      // Simple strategy: take the first result. Could be improved with more sophisticated matching.
      const movie = data.results[0];
      const year = movie.release_date ? movie.release_date.substring(0, 4) : null;
      const bestTitle = movie.title || movie.original_title;

      if (bestTitle) {
        console.log(`    TMDB Match for '${originalFilename}': '${bestTitle.trim()} (${year || "N/A"})'`);
        return { title: bestTitle.trim(), year, originalFilename };
      }
      console.log(`    TMDB: Result for '${originalFilename}' lacked a usable title.`);
      return null;
    } else {
      console.log(`    TMDB: No results for '${filenameTitle}' (${filenameYear || "any year"}) from file '${originalFilename}'.`);
      return null;
    }
  } catch (error) {
    console.error(`    Error fetching/parsing TMDB data for ${originalFilename}:`, error);
    return null;
  }
}
