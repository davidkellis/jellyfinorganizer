// src/scanner.ts
import { Glob } from 'bun';

/**
 * Scans a directory recursively and returns a list of absolute file paths.
 * @param sourcePath The absolute path to the directory to scan.
 * @returns A promise that resolves to an array of absolute file paths.
 */
export async function scanDirectory(sourcePath: string): Promise<string[]> {
  const files: string[] = [];
  // Glob pattern to match all files and directories recursively.
  // '**/ *' means match any character in any subdirectory.
  const glob = new Glob('**/*');

  try {
    console.log(`Scanning directory: ${sourcePath}`);
    for await (const filePath of glob.scan({
      cwd: sourcePath,
      absolute: true, // Return absolute paths
      onlyFiles: true, // Only include files, not directories
      followSymlinks: false, // Do not follow symbolic links to avoid potential loops or unintended scanning
    })) {
      files.push(filePath);
    }
    console.log(`Found ${files.length} files in ${sourcePath}.`);
  } catch (error) {
    console.error(`Error scanning directory ${sourcePath}:`, error);
    // Depending on desired error handling, you might want to throw the error,
    // return an empty array, or handle it differently.
    // For now, returning an empty array on error.
    return [];
  }
  return files;
}
