import { argv } from "bun";
import { scanDirectory } from './src/scanner'; // Import scanDirectory
import { extname } from 'path'; // For filtering by extension
// Import organizer functions and constants
import { organizeMovies, MOVIE_EXTENSIONS, organizeShows, SHOW_EXTENSIONS, organizeMusic, MUSIC_EXTENSIONS } from './src/organizers';

function printUsage() {
  console.log(`
Usage: bun run index.ts <sourceDirectory> <mediaCategory> [--dry-run | --interactive]

Arguments:
  sourceDirectory:               Path to the directory to organize.
  mediaCategory:                 Type of media in the directory. Must be one of: 'movies', 'shows', 'music'.
  --dry-run:                     Optional. If present, only log planned changes without modifying files.
  --interactive:                 Optional. If present, prompt for confirmation before each file operation.

Example:
  bun run index.ts /path/to/my/videos movies
  bun run index.ts /data/tv_series shows --dry-run
  bun run index.ts /media/new_music music --interactive
`);
}

async function main() {
  const validCategories = ["movies", "shows", "music"];
  const cliArgs = argv.slice(2);

  // 1. Preliminary argument check (minimum 2 arguments: source, category)
  if (cliArgs.length < 2) {
    console.error("Error: Insufficient arguments. Source directory and media category are required.");
    printUsage();
    process.exit(1);
  }

  // 2. Assign and validate source and category (guaranteed to exist by Bun.argv contract if cliArgs.length >= 2)
  const sourceDirectory: string = cliArgs[0]!;
  const mediaCategoryRaw: string = cliArgs[1]!;
  const mediaCategory: string = mediaCategoryRaw.toLowerCase();

  if (!validCategories.includes(mediaCategory)) {
    console.error(`Error: Invalid media category '${mediaCategory}'. Must be one of: ${validCategories.join(", ")}.`);
    printUsage();
    process.exit(1);
  }

  let dryRun = false;
  let isInteractive = false;
  let argsToParseForFlags: string[];

  // For all categories, optional flags start after source and category.
  argsToParseForFlags = cliArgs.slice(2);

  // Max 4 args total for any category: source, category, flag1, flag2
  if (cliArgs.length > 4) { 
    console.error(`Error: Too many arguments for '${mediaCategory}' category. Expected source, category, and optionally --dry-run or --interactive.`);
    printUsage();
    process.exit(1);
  }

  // Process optional arguments (flags)
  for (const arg of argsToParseForFlags) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--interactive") {
      isInteractive = true;
    } else {
      // Any argument here that is not a recognized flag is an error.
      console.error(`Error: Invalid optional argument: '${arg}'. Optional arguments must be --dry-run or --interactive.`);
      printUsage();
      process.exit(1);
    }
  }

  // 4a. Check for mutual exclusivity of --dry-run and --interactive
  if (dryRun && isInteractive) {
    console.error("Error: --dry-run and --interactive flags cannot be used simultaneously.");
    printUsage();
    process.exit(1);
  }

console.log('\nJellyfin Organizer Initializing...');
console.log('---------------------------------');
console.log(`Source Directory: ${sourceDirectory}`);
console.log(`Media Category:   ${mediaCategory}`);
console.log(`Dry Run:          ${dryRun}`);
console.log(`Interactive Mode: ${isInteractive}`);
console.log('---------------------------------');

// 5. Call the appropriate organizer function
const apiKey = process.env.TMDB_API_KEY || null;

switch (mediaCategory) {
  case 'movies':
    console.log(`\nScanning ${sourceDirectory} for movie files...`);
    const allFiles = await scanDirectory(sourceDirectory);
    const movieFiles = allFiles.filter((file) => MOVIE_EXTENSIONS.includes(extname(file).toLowerCase()));
    console.log(`Found ${movieFiles.length} potential movie files to process.`);
    await organizeMovies(sourceDirectory, movieFiles, dryRun, isInteractive, apiKey);
    break;
  case 'shows':
    console.log(`\nScanning ${sourceDirectory} for TV show files...`);
    const allShowFiles = await scanDirectory(sourceDirectory); // Use a different variable name to avoid conflict if 'allFiles' is used elsewhere
    const showFiles = allShowFiles.filter((file) => SHOW_EXTENSIONS.includes(extname(file).toLowerCase()));
    console.log(`Found ${showFiles.length} potential TV show files to process.`);
    await organizeShows(sourceDirectory, showFiles, dryRun, isInteractive, apiKey);
    break;
  case 'music':
    console.log(`\nScanning ${sourceDirectory} for music files...`);
    const allMusicFiles = await scanDirectory(sourceDirectory);
    const musicFiles = allMusicFiles.filter((file) => MUSIC_EXTENSIONS.includes(extname(file).toLowerCase()));
    console.log(`Found ${musicFiles.length} potential music files to process.`);
    // Music will be organized within subdirectories of the sourceDirectory.
    await organizeMusic(sourceDirectory, musicFiles, dryRun, isInteractive);
    break;
  default:
    // This case should not be reached due to earlier validation
    console.error("Critical Error: Unrecognized media category after validation.");
    process.exit(1);
}

console.log('\nJellyfin Organizer finished.');
}

// Run the main function
main().catch(error => {
  console.error("An unexpected error occurred:", error);
  process.exit(1);
});
