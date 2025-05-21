# Jellyfin Media Organizer

## Goal and Vision

**Goal:** To create a command-line tool using Bun and TypeScript. The tool will accept a directory path and an expected media category (e.g., Movies, TV Shows, or Music) for that directory. It will then scan the specified directory and reorganize its contents to conform to the Jellyfin organizational structure for the given media category. This process will ensure seamless integration and metadata scraping with a Jellyfin server. The target structures are detailed in the 'Jellyfin Directory Structures Summary' section below, which is based on the official Jellyfin documentation.

**Vision:** To provide a simple, efficient, and configurable tool that takes the manual effort out of organizing large media libraries for Jellyfin users.

## Features

*   Organizes Movies and TV Shows.
*   Organizes Music files, leveraging embedded tags and MusicBrainz API for metadata.
*   Parses filenames to extract title, year, season, episode information for movies/shows.
*   Integrates with The Movie Database (TMDB) to fetch canonical metadata for movies/shows.
*   Integrates with MusicBrainz API to fetch canonical metadata for music (artist, album, tracks).
*   Utilizes Large Language Models (LLMs) via OpenRouter for:
    *   Correcting movie/show titles and years when TMDB lookups fail.
    *   Correcting music artist, album, and title from filenames when local tags and initial MusicBrainz lookups are insufficient.
*   Handles filename collisions by appending `_dup_N` suffixes.
*   Supports `--dry-run` mode to preview changes.
*   Supports `--interactive` mode for confirming operations.
*   Skips files if metadata is uncertain or if external API calls (TMDB, MusicBrainz, LLM) fail.
*   Conditional stack trace logging for LLM errors via `JELLYFIN_ORGANIZER_DEBUG` environment variable.

## Jellyfin Directory Structures Summary

Per https://jellyfin.org/docs/general/server/media/movies/, https://jellyfin.org/docs/general/server/media/shows/, and https://jellyfin.org/docs/general/server/media/music/, this tool will aim to organize files according to the following Jellyfin guidelines:

### Movies

- Each movie should be in the library root or its own subfolder.
- Naming convention: `Movie Name (Year).ext` or `Movie Name (Year) [providerid-id].ext`
- Example:
  ```
  Movies/
  ├── Avatar (2009).mkv
  └── The Dark Knight (2008)/
      └── The Dark Knight (2008).mp4
  ```

### TV Shows

- Shows are categorized by series name, then season.
- Naming convention for folders: `Series Name (Year)` or `Series Name (Year) [providerid-id]`
- Naming convention for files: `Series Name - SXXEXX - Episode Title.ext`
- Season folders should be named `Season XX` (e.g., `Season 01`, `Season 02`).
- Specials go into `Season 00`.
- Example:
  ```
  Shows/
  └── Breaking Bad (2008)/
      ├── Season 01/
      │   ├── Breaking Bad - S01E01 - Pilot.mkv
      │   └── Breaking Bad - S01E02 - Cat's in the Bag....mkv
      └── Season 00/
          └── Breaking Bad - S00E01 - Special.mkv
  ```

### Music

- Music will be organized by Artist, then Album (with year), then tracks.
- Jellyfin relies heavily on embedded metadata. This tool will prioritize reading embedded tags and use the MusicBrainz API for canonical information and enrichment.
- Target Naming Convention:
  - Standard Album: `Artist Name/Album Name (Year)/TrackNumber - Track Title.ext`
  - Compilation Album: `Various Artists/Album Name (Year)/TrackNumber - Track Artist - Track Title.ext`
- Example:
  ```
  Music/
  ├── Album Artist Name/
  │   └── Album Title (YYYY)/
  │       ├── 01 - Track Title.mp3
  │       └── 02 - Another Track Title.flac
  └── Various Artists/
      └── Compilation Album Title (YYYY)/
          ├── 01 - Track Artist A - Song Title X.ogg
          └── 02 - Track Artist B - Song Title Y.m4a
  ```

## Project Plan (High-Level Workflow)

The general workflow of the application is:

1.  **CLI Input Parsing (`index.ts`):**
    *   Accepts source directory, media category, API keys, and flags (`--dry-run`, `--interactive`, `--llm`).
    *   Validates inputs.
2.  **Main Controller Logic (`index.ts`):**
    *   Dispatches to category-specific organization functions (`movieOrganizer.ts`, `showOrganizer.ts`, `musicOrganizer.ts`).
3.  **File Scanning (`src/scanner.ts`):**
    *   Scans the source directory for relevant media files based on extensions.
4.  **Category-Specific Organizers (e.g., `src/movieOrganizer.ts`, `src/showOrganizer.ts`, `src/musicOrganizer.ts`):
    *   For each file:
        *   **Parse Filename/Metadata:** 
            *   Movies/Shows: Extract initial title, year, series, season, episode from filename (`src/filenameParser.ts`).
            *   Music: Extract embedded tags (`src/metadataExtractor.ts`).
        *   **External API Lookup (TMDB/MusicBrainz):** Attempt to find a match using parsed info/tags.
        *   **LLM Correction (Optional, `src/llmUtils.ts`):** If initial lookup fails and `--llm` is active:
            *   Query LLM for corrected metadata (title/year for movies/shows; artist/album/title for music based on filename and local tags).
            *   Attempt API lookup again with LLM's suggestion.
            *   If API lookup still fails, use LLM's suggestion as a fallback (if LLM call was successful).
            *   Skip file if LLM call itself fails.
        *   **Path Construction:** Determine the target Jellyfin-compliant path.
        *   **File Operations:** Create directories, move/rename files, handle duplicates.
        *   Log actions and errors.

## TODO List

### Phase 1 & 2: Core Functionality & Movie/Show Organizers

-   [x] Initialize Bun + TypeScript project.
-   [x] Implement basic CLI argument parsing in `index.ts`.
-   [x] Implement generic file system scanning (`scanDirectory`).
-   [x] Implement filename parsing logic for Movies and TV Shows (`src/filenameParser.ts`).
-   [x] Implement TMDB integration for movie and show metadata (`src/tmdb.ts`), including fetching season and episode details for shows.
-   [x] Implement LLM-based title/year correction for movies and shows (`src/llmUtils.ts`).
-   [x] Implement interactive mode (`--interactive`).
-   [x] Implement directory creation and file moving/renaming for Movies and TV Shows (with `dryRun` support and `_dup_N` duplicate handling).
-   [x] Implement logic to skip files on LLM API failures or if LLM-corrected titles still don't yield TMDB results (with option to use LLM title as fallback).
-   [x] Implement conditional stack trace logging for LLM errors (`JELLYFIN_ORGANIZER_DEBUG`).

### Phase 3: Music Organization

-   [x] **Implement Metadata Extraction:**
    -   [x] Utilized `music-metadata` library to read embedded tags (ID3, Vorbis, etc.) for Artist, Album, Title, Track Number, Year, Album Artist.
-   [x] **Implement MusicBrainz API Integration:**
    -   [x] Query [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) using extracted metadata (and LLM-corrected info as fallback) to fetch canonical data.
    -   [ ] Store MusicBrainz IDs (Release, Recording, Artist) where feasible (Future enhancement).
    -   [~] Implement respectful API usage (user-agent set, basic error handling; advanced rate limiting TBD).
-   [ ] **Implement Filename Parsing (Fallback for Music):**
    -   [ ] If embedded metadata is sparse and MusicBrainz yields no confident match, attempt basic filename parsing (e.g., `Artist - Album - Track - Title`). (Currently LLM fallback serves a similar role if tags are bad but filename is good).
-   [x] **LLM for Music Correction:**
    -   [x] LLM is used for correcting artist/album/title from filenames when initial tag-based MusicBrainz lookups are insufficient, providing context from local tags to the LLM.
-   [x] **Implement Directory/File Organization for Music:**
    -   [x] Create directory structure: `Artist Name/Album Name (Year)/` or `Various Artists/Album Name (Year)/`.
    -   [x] Rename files to: `TrackNumber - Track Title.ext` or `TrackNumber - Track Artist - Track Title.ext` for compilations.
    -   [x] Implement `--dry-run`, `--interactive`, and `_dup_N` collision handling.

### General & Ongoing TODOs

-   [ ] **Resolve Lint Errors:** Address outstanding type-related lint errors in `src/movieOrganizer.ts` to ensure consistency across the codebase.
-   [ ] **Test TV Show Organization:** Thoroughly test the updated TV show organization logic (`src/showOrganizer.ts`) with a variety of files, including the "Veep" example and other edge cases, to confirm improved accuracy.

-   [ ] Refine episode title fetching for shows, ensuring TMDB-fetched episode titles are consistently used when available, and filename-parsed titles are used as a fallback (especially if TMDB series ID is missing post-LLM).
-   [ ] Consider global rate-limiting awareness/handling for external APIs (TMDB, OpenRouter, MusicBrainz) if frequent use is anticipated (e.g., local request cache, smarter retry delays).
-   [ ] Configuration file support (e.g., `config.json`) for API keys, preferred LLM models, etc.
-   [ ] More robust error handling and recovery across all modules.
-   [ ] Parallel processing for faster organization of large libraries (careful with API rate limits).
-   [ ] Support for subtitles and other associated media files (posters, nfo, etc.).
-   [ ] Watch mode to automatically organize new files added to a directory.
-   [ ] Thoroughly test LLM title correction with a diverse range of problematic filenames for all media types.
-   [ ] Experiment with different LLM models via `OPENROUTER_MODEL_NAME` for improved JSON structure adherence and accuracy.
-   [ ] Continuously refine LLM prompts in `src/llmUtils.ts` based on observed failure modes.

## Design Decisions and Findings Log

*   **2025-05-20 (TV Show Metadata Enhancement):**
    *   **Objective:** Improve the accuracy of TV show identification, particularly for files with non-descriptive filenames but rich embedded metadata (e.g., "Veep" example).
    *   **Key Changes:**
        *   Enhanced `src/metadataExtractor.ts`:
            *   `VideoFileMetadata` interface now includes `seriesTitle`, `episodeTitle`, `seasonNumber`, and `episodeNumber`.
            *   `extractVideoFileMetadata` function was significantly updated to parse a wider range of embedded tags (e.g., `artist`, `album_artist` for series title; `season_number`, `episode_sort` for season/episode details) from `ffprobe` output.
        *   Refactored `src/showOrganizer.ts`:
            *   Now calls `extractVideoFileMetadata` at the start of processing each file.
            *   Prioritizes using the extracted embedded metadata.
            *   Falls back to filename parsing (`parseShowFilename`) only to supplement missing information if embedded metadata is incomplete.
            *   Consolidated variables (`finalSeriesTitle`, `finalSeriesYear`, `finalSeasonNumber`, `finalEpisodeNumber`, `finalEpisodeTitle`) are used for TMDB and LLM lookups, ensuring more accurate data input.
            *   `finalSeriesYear` is consistently handled as `number | undefined`.
    *   **Design Decision:** Adopted a hybrid approach for show metadata: prioritize comprehensive embedded tag extraction first, then use filename parsing as a fallback. This leverages the potentially richer information in tags while still having a fallback for poorly tagged files.
    *   **Outcome:** This change is expected to significantly improve the classification and organization of TV show episodes by relying on more definitive metadata sources when available.


*   **2025-05-17:** Decided to use `Bun.Glob` for file system scanning due to its efficiency and built-in capabilities.
*   **2025-05-17:** The primary operational mode is to organize files *within* a given source directory based on a user-specified media category.
*   **2025-05-18 (Movie Organizer & Initial LLM Integration):**
    *   Implemented the movie organizer with TMDB and LLM (OpenRouter + Vercel AI SDK) integration for title/year correction.
    *   API keys (`OPENROUTER_API_KEY`, `TMDB_API_KEY`) and LLM model managed via `.env` file and CLI arguments.
    *   LLM Output Validation: Utilized Zod schema (`movieInfoSchema`, `showInfoSchema` in `src/llmUtils.ts`) with `z.preprocess` for robust JSON output validation.
*   **2025-05-18 (TV Show Organizer & LLM/Error Handling Refinements):**
    *   Successfully implemented the `organizeShows` function, mirroring movie organizer logic but tailored for series, seasons, and episodes (including TMDB calls for season/episode details).
    *   Implemented logic to handle filename collisions by appending `_dup_N` suffixes (for both movies and shows).
    *   **LLM Fallback Strategy & Error Handling (Movies & Shows):**
        1.  Initial TMDB lookup using parsed filename.
        2.  If TMDB fails & LLM enabled: Query LLM.
        3.  If LLM call itself fails (e.g. API error, rate limit, malformed response): Skip the file. Log concise error; log full stack trace if `JELLYFIN_ORGANIZER_DEBUG=true`.
        4.  If LLM succeeds: Attempt TMDB lookup with LLM's suggestion.
        5.  If TMDB lookup with LLM's suggestion also fails: Use LLM's suggested title/year directly as a fallback (instead of skipping).
    *   **Challenges & Mitigations (LLM):** Encountered LLMs returning empty strings or malformed JSON. Addressed through detailed prompt engineering, model configurability (`OPENROUTER_MODEL_NAME`), Zod validation, and `generateObject` retries.
*   **2025-05-19 (Music LLM - Schema & Prompt Refinement for `meta-llama/llama-4-maverick:free`):**
    *   **Initial Problem:** The `meta-llama/llama-4-maverick:free` model (via OpenRouter) was consistently failing `generateObject` calls for music metadata, initially with "Parameter type is required for `artist`", then for `year`, and finally with truncated JSON responses.
    *   **Iterative Schema Adjustments (`musicInfoSchema` in `src/llmUtils.ts`):
        *   **String Fields (`artist`, `album`, `title`):** Discovered that this model prefers simple `z.string()` definitions in the Zod schema for required string fields, rather than `z.string().optional().nullable()`. The prompt was updated to instruct the LLM to return an empty string `""` if these fields are not found.
        *   **Numeric Fields (`year`, `trackNumber`):** Similarly, these were simplified to `z.number().int().optional()` (with appropriate `min`/`max` for `year`). Preprocessing steps and `.nullable()` were removed from the Zod definitions to align with what the LLM provider expects.
        *   Initially, `year` was attempted as `z.string().regex().optional()`, but this also seemed to cause issues; changing `year` to `z.number().int().min(1000).max(9999).optional()` was part of the final successful configuration for schema validation.
    *   **Prompt Engineering (`getCorrectedMusicInfoFromLLM`):
        *   **Explicit Instructions:** The prompt was made very explicit about returning empty strings for missing required string fields (`artist`, `album`, `title`) and `null` for missing optional numeric fields (`year`, `trackNumber`).
        *   **JSON Structure Enforcement:** Added text to emphasize that the output JSON *must* include all five keys (`artist`, `album`, `title`, `year`, `trackNumber`).
        *   **Examples:** Provided clear examples in the prompt, including one with `null` values for `year` and `trackNumber`.
    *   **Parameter Tuning (`generateObject` call):
        *   `maxTokens`: Gradually increased from 250 up to 800. While the final truncation error seemed model-specific and not purely a token count issue, a higher value ensures sufficient space.
        *   `temperature`: Slightly increased from 0.1 to 0.2 to allow minor flexibility if the model was stuck.
    *   **Data Handling:** Ensured that numeric `year` values returned by the LLM are converted to strings in `src/musicOrganizer.ts` before being used in MusicBrainz API queries.
    *   **Key Takeaway:** Interacting with specific LLMs for structured JSON output (`generateObject`) can require significant iterative refinement of both the Zod schema (to match the provider's underlying expectations for type definitions) and the prompt (to guide the LLM's generation process accurately). Error messages from the Vercel AI SDK, while sometimes indirect, were crucial in pinpointing problematic fields.
*   **2025-05-19 (Music Organizer Refinements & Robustness):**
    *   **Challenge - Matching Well-Known Songs:** Addressed issues where songs like "Eleanor Rigby" were correctly identified by the LLM (e.g., album "Revolver") but failed to match in MusicBrainz if the filename-derived track number (e.g., "32") was incorrect.
    *   **Solution - Enhanced Track Matching:** Modified `findMatchingTrackInRelease` to perform a two-step match: first using title & track number, then, if that fails, retrying with title only. This allows correct identification if the LLM provides the right title/album but an erroneous track number (from filename).
    *   **Solution - Contextual LLM Prompts:** Updated `getCorrectedMusicInfoFromLLM` to accept local file tags as context. The LLM prompt now instructs the model to prioritize these tags and, if the local album tag appears generic (e.g., "Greatest Hits"), to identify a more common studio album.
    *   **Bugfix - MusicBrainz Track Extraction:** Corrected the usage of `release.media.flatMap()` in `musicOrganizer.ts` to properly iterate through media and extract all tracks from a MusicBrainz release.
    *   **Bugfix - LLM Fallback Logic:** Resolved an "Unexpected else" structural error in `musicOrganizer.ts` within the LLM fallback block by correctly nesting conditional logic.
    *   **Bugfix - Type Consistency (`null` vs. `undefined`):** Standardized the use of `undefined` for optional MusicBrainz data. Modified `lookupMusicBrainzReleaseTracks` in `src/musicbrainzClient.ts` to return `Promise<MusicBrainzRelease | undefined>` (from `| null`). Adjusted `mbReleaseDetails` declaration in `musicOrganizer.ts` accordingly. This resolved TypeScript errors related to type mismatches when calling `determineMusicPathComponents`.
    *   **Outcome:** Significantly improved the reliability of music organization, especially for well-known tracks where filename information might be misleading but local tags or LLM corrections can guide to the correct MusicBrainz entry.

## Environment Variables

Create a `.env` file in the project root to store your API keys and other configurations:

```
TMDB_API_KEY=your_tmdb_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
# Optional: Specify a different OpenRouter compatible model
# OPENROUTER_MODEL_NAME="mistralai/mistral-7b-instruct-v0.2"

# Optional: Set to true for verbose LLM error logging
# JELLYFIN_ORGANIZER_DEBUG=true
```

## Onboarding Information for New Developers

This project uses [Bun](https://bun.sh/) as the JavaScript runtime and toolkit, and [TypeScript](https://www.typescriptlang.org/) for static typing.

### Prerequisites

*   Install [Bun](https://bun.sh/docs/installation).

### Getting Started

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd jellyfinorganizer
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

3.  **Set up environment variables:**
    Copy `.env.example` to `.env` (if `.env.example` is created) or create `.env` manually as shown in the "Environment Variables" section above.

4.  **Running the tool:**
    The main entry point is `src/index.ts`.
    Example for movies:
    ```bash
    bun --bun run src/index.ts -s /path/to/your/movies -d /path/to/your/jellyfin/movies -m movies --api-key YOUR_TMDB_API_KEY --llm
    ```
    Example for TV shows:
    ```bash
    bun --bun run src/index.ts -s /path/to/your/shows -d /path/to/your/jellyfin/shows -t shows --api-key YOUR_TMDB_API_KEY --llm --interactive
    ```
    To enable debug logging for LLM errors:
    ```bash
    JELLYFIN_ORGANIZER_DEBUG=true bun --bun run src/index.ts -s /path/to/source -d /path/to/dest -m movies --api-key YOUR_KEY --llm
    ```


### Contribution Guidelines

*   Follow a consistent coding style (ESLint and Prettier are set up).
*   Write tests for new features and bug fixes.
*   Keep an eye on the TODO list for tasks to pick up.
*   Discuss any major changes or new features in an issue before starting implementation.
