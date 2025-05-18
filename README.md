# Jellyfin Media Organizer

## Goal and Vision

**Goal:** To create a command-line tool using Bun and TypeScript. The tool will accept a directory path and an expected media category (e.g., Movies, TV Shows, or Music) for that directory. It will then scan the specified directory and reorganize its contents to conform to the Jellyfin organizational structure for the given media category. This process will ensure seamless integration and metadata scraping with a Jellyfin server. The target structures are detailed in the 'Jellyfin Directory Structures Summary' section below, which is based on the official Jellyfin documentation.

**Vision:** To provide a simple, efficient, and configurable tool that takes the manual effort out of organizing large media libraries for Jellyfin users.

## Features

*   Organizes Movies and TV Shows.
*   Parses filenames to extract title, year, season, episode information.
*   Integrates with The Movie Database (TMDB) to fetch canonical metadata.
*   Utilizes Large Language Models (LLMs) via OpenRouter for correcting titles and years when TMDB lookups fail.
*   Handles filename collisions by appending `_dup_N` suffixes.
*   Supports `--dry-run` mode to preview changes.
*   Supports `--interactive` mode for confirming operations.
*   Skips files if metadata (either from TMDB or LLM) is uncertain or if LLM API calls fail (e.g., rate limits).
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

- Albums are organized in folders; one folder per album.
- Jellyfin primarily uses embedded metadata, but a clean folder structure is good practice.
- Example:
  ```
  Music/
  ├── Artist Name/
  │   ├── Album Name A/
  │   │   ├── 01 - Track Title.mp3
  │   │   └── 02 - Another Track.mp3
  │   └── Album Name B/
  │       ├── 01 - Song.flac
  └── Various Artists/
      └── Best Of 90s/
          ├── Artist X - Song Y.ogg
  ```

## Project Plan (High-Level Workflow)

The general workflow of the application is:

1.  **CLI Input Parsing (`index.ts`):**
    *   Accepts source directory, media category, TMDB API key, and flags (`--dry-run`, `--interactive`, `--llm`).
    *   Validates inputs.
2.  **Main Controller Logic (`index.ts`):**
    *   Dispatches to category-specific organization functions (`movieOrganizer.ts`, `showOrganizer.ts`).
3.  **File Scanning (`src/scanner.ts`):**
    *   Scans the source directory for relevant media files based on extensions.
4.  **Category-Specific Organizers (e.g., `src/movieOrganizer.ts`, `src/showOrganizer.ts`):
    *   For each file:
        *   **Parse Filename (`src/filenameParser.ts`):** Extract initial title, year, series, season, episode.
        *   **TMDB Lookup (`src/tmdb.ts`):** Attempt to find a match on TMDB using parsed info.
        *   **LLM Correction (Optional, `src/llmUtils.ts`):** If TMDB fails and `--llm` is active:
            *   Query LLM for corrected title/year.
            *   Attempt TMDB lookup again with LLM's suggestion.
            *   If TMDB still fails, use LLM's suggestion as a fallback title (if LLM call was successful).
            *   Skip file if LLM call itself fails (e.g., rate limit, API error).
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

-   [ ] Implement filename/metadata parsing for Music.
-   [ ] Implement directory creation and file moving/renaming for Music.
-   [ ] Investigate music metadata libraries (e.g., `music-metadata-browser` for Bun).

### General & Ongoing TODOs

-   [ ] Refine episode title fetching for shows, ensuring TMDB-fetched episode titles are consistently used when available, and filename-parsed titles are used as a fallback (especially if TMDB series ID is missing post-LLM).
-   [ ] Consider global rate-limiting awareness/handling for external APIs (TMDB, OpenRouter) if frequent use is anticipated (e.g., local request cache, smarter retry delays).
-   [ ] Enhance Music organization using embedded metadata.
-   [ ] Configuration file support (e.g., `config.json`) for API keys, preferred LLM models, etc.
-   [ ] More robust error handling and recovery across all modules.
-   [ ] Parallel processing for faster organization of large libraries (careful with API rate limits).
-   [ ] Support for subtitles and other associated media files (posters, nfo, etc.).
-   [ ] Watch mode to automatically organize new files added to a directory.
-   [ ] Thoroughly test LLM title correction with a diverse range of problematic filenames.
-   [ ] Experiment with different LLM models via `OPENROUTER_MODEL_NAME` for improved JSON structure adherence and accuracy.
-   [ ] Continuously refine LLM prompts in `src/llmUtils.ts` based on observed failure modes.

## Design Decisions and Findings Log

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
