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

### Phase 1: Core Functionality

-   [x] Initialize Bun + TypeScript project.
-   [x] Create `src` directory for source code.
-   [x] Implement basic CLI argument parsing in `index.ts` (for `sourceDirectory`, `mediaCategory`, and `dryRun` flag).
-   [x] Implement the generic file system scanning function (`scanDirectory`) in `src/scanner.ts` using `Bun.Glob`.
-   [x] Create placeholder functions for category-specific organizers (e.g., `organizeMovies`, `organizeShows`, `organizeMusic`) in `src/organizers.ts` or similar.
-   [x] Integrate `scanDirectory` into placeholder organizers and log found files for basic testing.
-   [x] Implement filename parsing logic for Movies.
-   [ ] Implement directory creation and file moving/renaming for Movies (with `dryRun` support).
-   [ ] Implement filename parsing logic for TV Shows.
-   [ ] Implement directory creation and file moving/renaming for TV Shows (with `dryRun` support).

## Design Decisions and Findings Log

*   **2025-05-17:** Decided to use `Bun.Glob` for file system scanning due to its efficiency and built-in capabilities for recursive scanning and filtering.
*   **2025-05-17:** The primary operational mode will be to organize files *within* a given source directory based on a user-specified media category (movies, shows, music).
*   **2025-05-17:** Initial file scanning will be generic, returning all files. Category-specific filtering (e.g., by extension) will occur within the respective organizer functions.

### Future Enhancements

-   [ ] Music organization based on embedded metadata (e.g., using `music-metadata`).
-   [ ] Integration with online databases (TMDb, TVDB) to fetch/verify metadata and naming (requires API keys and careful implementation).
-   [ ] Interactive mode for ambiguous files or conflicts.
-   [ ] Configuration file support (e.g., `config.json`).
-   [ ] More robust error handling and recovery.
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
    bun run src/index.ts --source /path/to/your/media --destination /path/to/jellyfin/library --dry-run
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
