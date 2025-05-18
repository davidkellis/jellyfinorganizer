// src/organizers.ts
// This file will re-export from category-specific organizer files.

import { scanDirectory } from "./scanner"; // Import for organizeShows/Music placeholders for now

// Re-export from movieOrganizer.ts
export { organizeMovies, MOVIE_EXTENSIONS } from "./movieOrganizer";

// Re-export from showOrganizer.ts (placeholder for now)
export { organizeShows, SHOW_EXTENSIONS } from "./showOrganizer";

// Re-export from musicOrganizer.ts (placeholder for now)
export { organizeMusic, MUSIC_EXTENSIONS } from "./musicOrganizer";
