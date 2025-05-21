// src/tmdb.ts
import type { ParsedShowInfo, ParsedMovieInfo } from "./filenameParser";

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

export interface TmdbShowResult {
  id: number;
  name: string;
  first_air_date: string; // "YYYY-MM-DD"
  original_name: string;
  overview: string;
}

export interface TmdbShowSearchResponse {
  page: number;
  results: TmdbShowResult[];
  total_pages: number;
  total_results: number;
}

// Helper function to fetch movie metadata from TMDB
export async function fetchTmdbMovieMetadata(filenameTitle: string, filenameYear: number | undefined, originalFilename: string, apiKey: string): Promise<ParsedMovieInfo | null> {
  let searchQuery = encodeURIComponent(filenameTitle.trim());
  const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${searchQuery}`;
  let finalSearchUrl = searchUrl;
  if (typeof filenameYear === 'number') {
    finalSearchUrl += `&year=${filenameYear.toString()}`;
  }

  try {
    // console.log(`    Querying TMDB: ${finalSearchUrl}`); // Uncomment for debugging TMDB URLs
    const response = await fetch(finalSearchUrl);
    if (!response.ok) {
      console.warn(`    TMDB API returned ${response.status} for ${originalFilename}. Query: ${finalSearchUrl}`);
      return null;
    }
    const data = await response.json() as TmdbSearchResponse;

    if (data.results && data.results.length > 0) {
      // Simple strategy: take the first result. Could be improved with more sophisticated matching.
      const movie = data.results[0];
      if (movie) {
        const releaseYearString = movie.release_date ? movie.release_date.substring(0, 4) : null;
        const year = releaseYearString ? parseInt(releaseYearString, 10) : undefined;
        const bestTitle = movie.title || movie.original_title;

        if (bestTitle) {
          console.log(`    TMDB Match for '${originalFilename}': '${bestTitle.trim()} (${year || "N/A"})'`);
          return { title: bestTitle.trim(), year: (year && !isNaN(year)) ? year : undefined, originalFilename };
        }
        // If bestTitle is not found, it implies an issue with the movie object.
        console.log(`    TMDB: Result for '${originalFilename}' (ID: ${movie.id}) lacked a usable title.`);
        return null;
      }
      // If movie (data.results[0]) was unexpectedly undefined
      console.log(`    TMDB: First result for '${originalFilename}' was unexpectedly undefined after checking results.length.`);
      return null;
    } else {
      console.log(`    TMDB: No results for '${filenameTitle}' (${typeof filenameYear === 'number' ? filenameYear : "any year"}) from file '${originalFilename}'.`);
      return null;
    }
  } catch (error) {
    console.error(`    Error fetching/parsing TMDB data for ${originalFilename}:`, error);
    return null;
  }
}

// Helper function to search for TV show metadata from TMDB
export async function searchTmdbShow(
  filenameTitle: string,
  filenameYear: number | undefined, // Optional: year from filename for more specific search
  originalFilename: string,
  apiKey: string
): Promise<{ id: number; name: string; year: number | undefined } | null> {
  let searchQuery = encodeURIComponent(filenameTitle.trim());
  const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${searchQuery}`;
  let finalSearchUrl = searchUrl;
  // TMDB doesn't directly support year for TV show search query like for movies (primary_release_year vs first_air_date_year in discover)
  // However, we can use filenameYear for post-search filtering if needed, or for more complex discovery later.
  // For now, we primarily rely on the title match.

  try {
    // console.log(`    Querying TMDB (TV): ${finalSearchUrl}`); // Uncomment for debugging
    const response = await fetch(finalSearchUrl);
    if (!response.ok) {
      console.warn(`    TMDB API (TV) returned ${response.status} for ${originalFilename}. Query: ${finalSearchUrl}`);
      return null;
    }
    const data = await response.json() as TmdbShowSearchResponse;

    if (data.results && data.results.length > 0) {
      // Simple strategy: take the first result. Could be improved.
      const show = data.results[0];
      if (show) {
        const firstAirDateYearString = show.first_air_date ? show.first_air_date.substring(0, 4) : null;
        const year = firstAirDateYearString ? parseInt(firstAirDateYearString, 10) : undefined;
        const bestTitle = show.name || show.original_name;

        if (bestTitle) {
          console.log(`    TMDB TV Match for '${originalFilename}': '${bestTitle.trim()} (${year || "N/A"})' [ID: ${show.id}]`);
          return { id: show.id, name: bestTitle.trim(), year: (year && !isNaN(year)) ? year : undefined };
        }
        // If bestTitle is not found, it implies an issue with the show object.
        console.log(`    TMDB TV: Result for '${originalFilename}' (ID: ${show.id}) lacked a usable title.`);
        return null;
      }
      // If show (data.results[0]) was unexpectedly undefined
      console.log(`    TMDB TV: First result for '${originalFilename}' was unexpectedly undefined after checking results.length.`);
      return null;
    } else {
      console.log(`    TMDB TV: No results for '${filenameTitle}' from file '${originalFilename}'.`);
      return null;
    }
  } catch (error) {
    console.error(`    Error fetching/parsing TMDB TV data for ${originalFilename}:`, error);
    return null;
  }
}

// --- TV Show Specific Interfaces for Season/Episode Details ---
export interface TmdbEpisode {
  air_date: string | null; // "YYYY-MM-DD"
  episode_number: number;
  id: number;
  name: string;
  overview: string;
  production_code: string | null;
  season_number: number;
  still_path: string | null;
  vote_average: number;
  vote_count: number;
}

export interface TmdbSeasonDetailsResponse {
  _id: string; // internal TMDB id for the season (seems to be a string)
  air_date: string | null; // "YYYY-MM-DD"
  episodes: TmdbEpisode[];
  name: string;
  overview: string;
  id: number; // TMDB's season ID (numeric)
  poster_path: string | null;
  season_number: number;
}

// TmdbEpisodeDetailsResponse can often be the same as TmdbEpisode if the direct fetch doesn't add more fields.
// For simplicity, we can reuse TmdbEpisode or define TmdbEpisodeDetailsResponse if specific extra fields are expected.
export interface TmdbEpisodeDetailsResponse extends TmdbEpisode {}

// Helper function to fetch TV season details from TMDB
export async function fetchTmdbSeasonDetails(
  seriesId: number,
  seasonNumber: number,
  apiKey: string,
  originalFilename?: string // For logging context
): Promise<TmdbSeasonDetailsResponse | null> {
  const apiUrl = `https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}?api_key=${apiKey}`;
  try {
    // console.log(`    Querying TMDB (Season Details): ${apiUrl}`); // Uncomment for debugging
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.warn(
        `    TMDB API (Season Details) returned ${response.status} for series ${seriesId}, S${String(seasonNumber).padStart(2, "0")}${
          originalFilename ? ` (file: ${originalFilename})` : ""
        }. Query: ${apiUrl}`
      );
      return null;
    }
    const data = await response.json() as TmdbSeasonDetailsResponse;
    if (data && data.episodes) {
      // console.log(`    TMDB Season Details for S${String(seasonNumber).padStart(2, '0')} of series ${seriesId} found ${data.episodes.length} episodes.`);
      return data;
    }
    console.log(
      `    TMDB Season Details: No episode data for S${String(seasonNumber).padStart(2, "0")} of series ${seriesId}${originalFilename ? ` (file: ${originalFilename})` : ""}.`
    );
    return null;
  } catch (error) {
    console.error(
      `    Error fetching/parsing TMDB Season Details for S${String(seasonNumber).padStart(2, "0")} of series ${seriesId}${
        originalFilename ? ` (file: ${originalFilename})` : ""
      }:`,
      error
    );
    return null;
  }
}

// Helper function to fetch TV episode details from TMDB
export async function fetchTmdbEpisodeDetails(
  seriesId: number,
  seasonNumber: number,
  episodeNumber: number,
  apiKey: string,
  originalFilename?: string // For logging context
): Promise<TmdbEpisodeDetailsResponse | null> {
  const apiUrl = `https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${apiKey}`;
  try {
    // console.log(`    Querying TMDB (Episode Details): ${apiUrl}`); // Uncomment for debugging
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.warn(
        `    TMDB API (Episode Details) returned ${response.status} for S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")} of series ${seriesId}${
          originalFilename ? ` (file: ${originalFilename})` : ""
        }. Query: ${apiUrl}`
      );
      return null;
    }
    const data = await response.json() as TmdbEpisodeDetailsResponse;
    if (data && data.name) {
      // console.log(`    TMDB Episode Details found: S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')} - ${data.name}`);
      return data;
    }
    console.log(
      `    TMDB Episode Details: No name for S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")} of series ${seriesId}${
        originalFilename ? ` (file: ${originalFilename})` : ""
      }.`
    );
    return null;
  } catch (error) {
    console.error(
      `    Error fetching/parsing TMDB Episode Details for S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")} of series ${seriesId}${
        originalFilename ? ` (file: ${originalFilename})` : ""
      }:`,
      error
    );
    return null;
  }
}
