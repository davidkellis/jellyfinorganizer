import { argv } from "bun";
import { scanDirectory } from './src/scanner'; // Import scanDirectory
import { MOVIE_EXTENSIONS, SHOW_EXTENSIONS } from './src/organizers'; // Import MOVIE_EXTENSIONS and SHOW_EXTENSIONS
import { extname } from 'path'; // For filtering by extension
// Import organizer functions
import { organizeMovies, organizeShows, organizeMusic } from './src/organizers';

function printUsage() {
  console.log(`
Usage: bun run index.ts <sourceDirectory> <mediaCategory> [--dry-run | --interactive]

Arguments:
  sourceDirectory: Path to the directory to organize.
  mediaCategory:   Type of media in the directory. Must be one of: 'movies', 'shows', 'music'.
  --dry-run:       Optional. If present, only log planned changes without modifying files.
  --interactive:   Optional. If present, prompt for confirmation before each file operation.
Example:
  bun run index.ts /path/to/my/videos movies
  bun run index.ts /data/tv_series shows --dry-run
  bun run index.ts /media/new_music music --interactive
`);
}

async function main() { // Added async main function
  const validCategories = ["movies", "shows", "music"];
  const cliArgs = argv.slice(2);

// 1. Validate argument count (source, category, and up to two optional flags)
if (cliArgs.length < 2 || cliArgs.length > 4) {
  console.error("Error: Incorrect number of arguments.");
  printUsage();
  process.exit(1);
}

// 2. Assign required arguments (guaranteed to exist and be strings by Bun.argv contract and length check)
const sourceArg = cliArgs[0];
if (typeof sourceArg !== 'string') {
  console.error("Error: Source directory argument is missing or invalid.");
  printUsage();
  process.exit(1);
}
const sourceDirectory: string = sourceArg;

const categoryArg = cliArgs[1];
if (typeof categoryArg !== 'string') {
  console.error("Error: Media category argument is missing or invalid.");
  printUsage();
  process.exit(1);
}
const mediaCategoryRaw: string = categoryArg;
const mediaCategory: string = mediaCategoryRaw.toLowerCase();
let dryRun = false;
let isInteractive = false;

// 3. Validate mediaCategory value
if (!validCategories.includes(mediaCategory)) {
  console.error(`Error: Invalid media category '${mediaCategory}'. Must be one of: ${validCategories.join(", ")}.`);
  printUsage();
  process.exit(1);
}

// 4. Process optional arguments (flags)
  const optionalArgs = cliArgs.slice(2);
  for (const arg of optionalArgs) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--interactive") {
      isInteractive = true;
    } else {
      console.error(`Error: Invalid optional argument '${arg}'. Expected '--dry-run' or '--interactive'.`);
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
    await organizeMusic(sourceDirectory, dryRun, isInteractive);
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
