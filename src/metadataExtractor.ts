import * as mm from "music-metadata";
import type { IAudioMetadata } from "music-metadata";

export interface MusicFileMetadata {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: number;
  trackNumber?: number;
  totalTracks?: number;
  genre?: string[];
  duration?: number; // in seconds
  path: string;
}

/**
 * Extracts metadata from a music file.
 * @param filePath Absolute path to the music file.
 * @returns A Promise resolving to MusicFileMetadata or null if metadata cannot be read.
 */
export async function extractMusicFileMetadata(filePath: string): Promise<MusicFileMetadata | null> {
  try {
    const metadata: IAudioMetadata = await mm.parseFile(filePath);
    const common = metadata.common;

    // Helper to get the first artist if multiple are listed (e.g., "Artist1; Artist2")
    const getPrimaryArtist = (artistsInput?: string[] | string): string | undefined => {
      if (!artistsInput) return undefined;
      let firstArtist: string | undefined;
      if (Array.isArray(artistsInput)) {
        firstArtist = artistsInput.length > 0 ? artistsInput[0] : undefined;
      } else {
        const firstArtist = artistsInput;
        if (firstArtist?.includes(";")) {
          return firstArtist?.split(";")[0]?.trim();
        }
        return firstArtist?.trim();
      }
    };

    // Track number and total tracks can be in format 'number/total' or just 'number'
    let trackNumber: number | undefined = undefined;
    let totalTracks: number | undefined = undefined;
    const trackInfo = common.track;
    if (trackInfo) {
      if (typeof trackInfo.no === "number") {
        trackNumber = trackInfo.no;
      }
      if (typeof trackInfo.of === "number") {
        totalTracks = trackInfo.of;
      }
    }
    // Fallback for total tracks if not in common.track.of
    if (totalTracks === undefined && common.totaltracks) {
      const val = Number(common.totaltracks); // Convert to number
      if (!isNaN(val) && val !== 0) { // Ensure it's a valid, non-zero number
        totalTracks = val;
      }
    }

    const extractedData: MusicFileMetadata = {
      title: common.title,
      artist: getPrimaryArtist(common.artist || common.artists),
      albumArtist: getPrimaryArtist(common.albumartist),
      album: common.album,
      year: typeof common.year === "number" && Number.isFinite(common.year) ? common.year : undefined,
      trackNumber: trackNumber,
      totalTracks: totalTracks,
      genre: common.genre,
      duration: metadata.format && typeof metadata.format.duration === "number" && Number.isFinite(metadata.format.duration) ? metadata.format.duration : undefined,
      path: filePath,
    };

    return extractedData;
  } catch (error) {
    console.error(`Error reading metadata for ${filePath}:`, error);
    return null;
  }
}

export interface VideoFileMetadata {
  title?: string; // For movies, this is the movie title. For shows, this might be episode title if a separate seriesTitle is not found.
  year?: number; // Movie release year, or Show's episode air year / series premiere year
  seriesTitle?: string; // Specifically for TV shows
  episodeTitle?: string; // Specifically for TV shows
  seasonNumber?: number;
  episodeNumber?: number;
  path: string;
}

/**
 * Extracts metadata from a video file using ffprobe.
 * @param filePath Absolute path to the video file.
 * @returns A Promise resolving to VideoFileMetadata or null if metadata cannot be read or ffprobe fails.
 */
export async function extractVideoFileMetadata(filePath: string): Promise<VideoFileMetadata | null> {
  try {
    const proc = Bun.spawnSync([
      "ffprobe",
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr);
      if (stderr.includes("No such file or directory") || stderr.includes("ENOENT")) {
        console.warn(
          `ffprobe command not found. Please ensure FFmpeg (which includes ffprobe) is installed and in your system's PATH. Skipping metadata extraction for ${filePath}.`
        );
      } else {
        console.error(`Error running ffprobe for ${filePath}: ${stderr}`);
      }
      return null;
    }

    const stdout = new TextDecoder().decode(proc.stdout);
    const ffprobeOutput = JSON.parse(stdout);

    let title: string | undefined = undefined;
    let year: number | undefined = undefined;
    let seriesTitle: string | undefined = undefined;
    let episodeTitle: string | undefined = undefined;
    let seasonNumber: number | undefined = undefined;
    let episodeNumber: number | undefined = undefined;

    const parseNum = (val: any): number | undefined => {
      if (val === null || val === undefined) return undefined;
      const num = parseInt(String(val), 10);
      return isNaN(num) ? undefined : num;
    };

    const tags = ffprobeOutput?.format?.tags;
    if (tags) {
      // Attempt to get general title first
      let generalTitle = tags.title || tags.TITLE || tags.Title;

      // Series-specific tags
      seriesTitle = tags.artist || tags.ARTIST || 
                    tags.album_artist || tags.ALBUM_ARTIST || 
                    tags.album || tags.ALBUM || // Sometimes series title is in album for shows
                    tags.show || tags.SHOW || 
                    tags.tv_show_name || tags.TVSHOWNAME || 
                    tags.series_title || tags.SERIES_TITLE;

      if (seriesTitle && generalTitle && seriesTitle.toLowerCase() !== generalTitle.toLowerCase()) {
        episodeTitle = generalTitle; // If we have a series title, the general 'title' tag is likely the episode title
      } else if (generalTitle) {
        title = generalTitle; // Otherwise, the general title is the main title (movie, or potentially episode/series if not well-tagged)
      }
      if (!episodeTitle && seriesTitle && generalTitle && seriesTitle.toLowerCase() === generalTitle.toLowerCase()){
        // If tags.title was the same as a found seriesTitle, episodeTitle might be empty. Clear general title.
        title = undefined;
      }

      // Season and Episode Numbers
      seasonNumber = parseNum(tags.season_number || tags.SEASONNUMBER || tags.tv_season || tags.TVSEASON || tags.season);
      episodeNumber = parseNum(tags.episode_sort || tags.EPISODESORT || tags.track || tags.TRACKNUMBER || tags.tv_episode || tags.TVEPISODE || tags.episode_id || tags.EPISODEID || tags.tv_episode_num);
      
      // Try to extract year from various date-related tags
      const dateString = tags.date || tags.DATE || tags.Date || tags.year || tags.YEAR || tags.creation_time || tags.encoding_time;
      if (dateString && typeof dateString === 'string') {
        const yearMatch = dateString.match(/^(\d{4})/); // Matches YYYY at the start of the string
        if (yearMatch && yearMatch[1]) {
          const parsedYearNum = parseInt(yearMatch[1], 10);
          if (!isNaN(parsedYearNum) && parsedYearNum > 1800 && parsedYearNum < 2100) {
            year = parsedYearNum;
          }
        }
      }
    }

    // Fallback for streams if format tags didn't yield much
    if (ffprobeOutput.streams) {
      const videoStream = ffprobeOutput.streams.find((s: any) => s.codec_type === 'video');
      if (videoStream?.tags) {
        const streamTags = videoStream.tags;
        if (!seriesTitle) {
          seriesTitle = streamTags.artist || streamTags.ARTIST || 
                        streamTags.album_artist || streamTags.ALBUM_ARTIST || 
                        streamTags.album || streamTags.ALBUM ||
                        streamTags.show || streamTags.SHOW || 
                        streamTags.tv_show_name || streamTags.TVSHOWNAME || 
                        streamTags.series_title || streamTags.SERIES_TITLE;
        }
        
        let generalStreamTitle = streamTags.title || streamTags.TITLE || streamTags.Title;
        if (seriesTitle && generalStreamTitle && !episodeTitle && seriesTitle.toLowerCase() !== generalStreamTitle.toLowerCase()) {
          episodeTitle = generalStreamTitle;
        } else if (generalStreamTitle && !title && !episodeTitle) {
          title = generalStreamTitle;
        }
        if (!episodeTitle && seriesTitle && generalStreamTitle && seriesTitle.toLowerCase() === generalStreamTitle.toLowerCase()){
             title = undefined; // clear general title if it was just the series title again
        }

        if (!seasonNumber) {
          seasonNumber = parseNum(streamTags.season_number || streamTags.SEASONNUMBER || streamTags.tv_season || streamTags.TVSEASON || streamTags.season);
        }
        if (!episodeNumber) {
          episodeNumber = parseNum(streamTags.episode_sort || streamTags.EPISODESORT || streamTags.track || streamTags.TRACKNUMBER || streamTags.tv_episode || streamTags.TVEPISODE || streamTags.episode_id || streamTags.EPISODEID || streamTags.tv_episode_num);
        }

        if (!year) {
            const dateString = streamTags.date || streamTags.DATE || streamTags.Date || streamTags.year || streamTags.YEAR || streamTags.creation_time || streamTags.encoding_time;
            if (dateString && typeof dateString === 'string') {
                const yearMatch = dateString.match(/^(\d{4})/);
                if (yearMatch && yearMatch[1]) {
                    const parsedYearNum = parseInt(yearMatch[1], 10);
                    if (!isNaN(parsedYearNum) && parsedYearNum > 1800 && parsedYearNum < 2100) {
                        year = parsedYearNum;
                    }
                }
            }
        }
      }
    }

    // If we have seriesTitle but no episodeTitle, and there's a remaining 'title', use it as episodeTitle.
    if (seriesTitle && !episodeTitle && title) {
        episodeTitle = title;
        title = undefined; // Title is now episodeTitle, clear the general title field for movies
    }

    // If only one of title or seriesTitle is populated, and episodeTitle is not, ensure the main 'title' field is clear if seriesTitle is the one that's set.
    // This is to prefer seriesTitle in the VideoFileMetadata if it's the only one of the two found.
    if (seriesTitle && !title && !episodeTitle) {
        // This case is fine, seriesTitle is set, title is empty.
    } else if (!seriesTitle && title && !episodeTitle) {
        // This is also fine, means it's likely a movie, or a show where only title was found (could be episode or series name)
    }

    if (!title && !year && !seriesTitle && !episodeTitle && !seasonNumber && !episodeNumber) { // Adjusted condition
      const videoStream = ffprobeOutput.streams.find((s: any) => s.codec_type === 'video');
      if (videoStream?.tags) {
        title = videoStream.tags.title || videoStream.tags.TITLE || videoStream.tags.Title;
        if (!year) {
            const dateString = videoStream.tags.date || videoStream.tags.DATE || videoStream.tags.Date || videoStream.tags.creation_time || videoStream.tags.encoding_time;
            if (dateString && typeof dateString === 'string') {
                const yearMatch = dateString.match(/^(\d{4})/);
                if (yearMatch && yearMatch[1]) {
                    const parsedYear = parseInt(yearMatch[1], 10);
                    if (!isNaN(parsedYear) && parsedYear > 1800 && parsedYear < 2100) {
                        year = parsedYear;
                    }
                }
            }
        }
      }
    }

    if (!title && !year) {
      // console.log(`No relevant metadata (title, year) found by ffprobe for ${filePath}`);
      return null; // Return null if no useful metadata found
    }

    return {
      title, // Primarily for movies, or if it's the only title-like field found for a show
      year,
      seriesTitle,
      episodeTitle,
      seasonNumber,
      episodeNumber,
      path: filePath,
    };

  } catch (error: any) {
    if (error.message?.includes("ENOENT")) {
        console.warn(
            `ffprobe command not found. Please ensure FFmpeg (which includes ffprobe) is installed and in your system's PATH. Skipping metadata extraction for ${filePath}.`
          );
    } else {
        console.error(`Error processing ffprobe output for ${filePath}:`, error);
    }
    return null;
  }
}
