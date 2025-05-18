# Jellyfin Media Organizer

## Goal and Vision

**Goal:** To create a command-line tool using Bun and TypeScript. The tool will accept a directory path and an expected media category (e.g., Movies, TV Shows, or Music) for that directory. It will then scan the specified directory and reorganize its contents to conform to the Jellyfin organizational structure for the given media category. This process will ensure seamless integration and metadata scraping with a Jellyfin server. The target structures are detailed in the 'Jellyfin Directory Structures Summary' section below, which is based on the official Jellyfin documentation.

**Vision:** To provide a simple, efficient, and configurable tool that takes the manual effort out of organizing large media libraries for Jellyfin users.

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
- Naming convention for files: `Series Name SXXEXX.ext` or `Series Name SXXEXX-EXX.ext` (for multi-episode files).
- Season folders should be named `Season XX` (e.g., `Season 01`, `Season 02`).
- Specials go into `Season 00`.
- Example:
  ```
  Shows/
  └── Breaking Bad (2008)/
      ├── Season 01/
      │   ├── Breaking Bad S01E01.mkv
      │   └── Breaking Bad S01E02.mkv
      └── Season 00/
          └── Breaking Bad S00E01 Special.mkv
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

## Project Plan

The general workflow of the application will be:

1.  **CLI Input Parsing (`index.ts` / `src/main.ts`):**
    *   Accept a source directory path and an expected media category (movies, shows, music) as command-line arguments.
    *   Include an optional `dry-run` flag.
    *   Validate inputs.
2.  **Main Controller Logic (`index.ts` / `src/main.ts`):**
    *   Based on the provided `mediaCategory`, dispatch to a category-specific organization function.
3.  **File Scanning (`src/scanner.ts`):**
    *   A generic function to recursively scan the `sourceDirectory` and return a list of all file paths.
4.  **Category-Specific Organizers (e.g., `src/movieOrganizer.ts`, `src/showOrganizer.ts`, `src/musicOrganizer.ts`):**
    *   Each organizer will:
        *   Call the file scanner to get all files in the `sourceDirectory`.
        *   Filter files based on common extensions for its media category.
        *   For each relevant file:
            *   Parse filename/metadata to extract key information (e.g., title, year, series, season, episode).
            *   Determine the target Jellyfin-compliant path (subdirectories and filename) within the `sourceDirectory`.
            *   If not a `dry-run`, create necessary subdirectories and move/rename the file.
            *   Log actions and handle conflicts.
5.  **Logging & Error Handling:**
    *   Implement robust logging for actions, errors, and dry-run output.

## TODO List

### Phase 1: Core Functionality & Initial Movie Organizer

-   [x] Initialize Bun + TypeScript project.
-   [x] Create `src` directory for source code.
-   [x] Implement basic CLI argument parsing in `index.ts` (for `sourceDirectory`, `mediaCategory`, and `dryRun` flag).
-   [x] Implement the generic file system scanning function (`scanDirectory`) in `src/scanner.ts` using `Bun.Glob`.
-   [x] Create placeholder functions for category-specific organizers (e.g., `organizeMovies`, `organizeShows`, `organizeMusic`) in `src/organizers.ts` or similar.
-   [x] Integrate `scanDirectory` into placeholder organizers and log found files for basic testing.
-   [x] Implement filename parsing logic for Movies (`src/filenameParser.ts`).
-   [x] Implement initial TMDB integration for movie metadata verification (`src/tmdb.ts`, `src/organizers.ts`).
-   [x] Implement LLM-based title/year correction as a fallback for movies (`src/llmUtils.ts`, `src/organizers.ts`).
-   [x] Implement interactive mode for confirming directory creation and file moves (`src/organizers.ts`).
-   [ ] Implement directory creation and file moving/renaming for Movies (with `dryRun` support) - *Testing and refinement ongoing*.

### Phase 2: TV Show Organization

-   [ ] Implement filename parsing logic for TV Shows.
-   [ ] Implement directory creation and file moving/renaming for TV Shows (with `dryRun` support).
-   [ ] Integrate TMDB/TVDB for TV Show metadata.

### General & Ongoing TODOs

-   [ ] Investigate and resolve persistent lint errors (e.g., `dryRun`/`isDryRun` in `organizers.ts`).
-   [ ] Thoroughly test LLM title correction with a diverse range of problematic filenames.
-   [ ] Experiment with different LLM models via `OPENROUTER_MODEL_NAME` for improved JSON structure adherence and accuracy if current model remains problematic.
-   [ ] Continuously refine LLM prompt in `src/llmUtils.ts` based on observed failure modes.

## Design Decisions and Findings Log

*   **2025-05-17:** Decided to use `Bun.Glob` for file system scanning due to its efficiency and built-in capabilities for recursive scanning and filtering.
*   **2025-05-17:** The primary operational mode will be to organize files *within* a given source directory based on a user-specified media category (movies, shows, music).
*   **2025-05-17:** Initial file scanning will be generic, returning all files. Category-specific filtering (e.g., by extension) will occur within the respective organizer functions.
*   **2025-05-18 (LLM Integration for Movie Title Correction):**
    *   Integrated LLM-based title/year correction using OpenRouter (`@openrouter/ai-sdk-provider`) and Vercel AI SDK (`generateObject`) as a fallback when TMDB lookups fail for movies. See `src/llmUtils.ts` and `src/organizers.ts`.
    *   **Fallback Strategy:** The system now employs a multi-step process for determining movie title and year:
        1.  Initial TMDB lookup using a 'gently' parsed filename (minimal transformations).
        2.  If TMDB fails, attempt LLM-based correction of the original filename.
        3.  Attempt TMDB lookup again using the LLM's suggested title and year.
        4.  If TMDB *still* fails but the LLM provided a usable title/year, use the LLM's output directly for renaming.
        5.  As a final resort, use an 'aggressive' filename parse (more transformations, potential for less accurate titles).
    *   **LLM Output Validation:** Utilized Zod schema (`movieInfoSchema` in `src/llmUtils.ts`) with `z.preprocess` to robustly validate and sanitize JSON output from the LLM. This specifically handles cases where the LLM might return an empty string for the `year` (which is converted to `undefined` to satisfy the optional 4-digit year regex) instead of omitting the field.
    *   **Challenges & Mitigations:**
        *   Encountered LLMs returning empty strings (`""`) for optional fields instead of omitting them, or producing malformed JSON.
        *   Addressed through: Detailed prompt engineering in `llmUtils.ts` (including schema definition, positive/negative examples, and explicit instructions on JSON formatting) and making the LLM model configurable via the `OPENROUTER_MODEL_NAME` environment variable (defaulting to `meta-llama/llama-4-maverick:free`). The `generateObject` tool also has built-in retries.
    *   API keys (`OPENROUTER_API_KEY`, `TMDB_API_KEY`) and the LLM model name are managed via a `.env` file.

### Future Enhancements

-   [ ] Music organization based on embedded metadata (e.g., using `music-metadata`).
-   [ ] Configuration file support (e.g., `config.json`) for more advanced settings (API keys, preferred models, etc.).
-   [ ] More robust error handling and recovery across all modules.
-   [ ] Parallel processing for faster organization of large libraries.
-   [ ] Support for subtitles and other associated media files (posters, nfo, etc.).
-   [ ] Watch mode to automatically organize new files added to a directory.

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

3.  **Running the tool (once implemented):**
    The main entry point will likely be `src/index.ts` or `src/main.ts`.
    ```bash
    ❯ bun index.ts ~/mnt/synology_multimedia/Movies movies --interactive
    ```

4.  **Development Scripts:**
    (These will be added to `package.json` as the project develops)
    *   `bun dev`: Run the application in development mode (e.g., with `nodemon` or Bun's watch mode).
    *   `bun build`: Compile TypeScript to JavaScript (if needed for distribution, though Bun can run TS directly).
    *   `bun test`: Run tests.

### Contribution Guidelines

*   Follow a consistent coding style.
*   Write tests for new features and bug fixes.
*   Keep an eye on the TODO list for tasks to pick up.
*   Discuss any major changes or new features in an issue before starting implementation.
