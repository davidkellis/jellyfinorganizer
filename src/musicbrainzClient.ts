import { MusicBrainzApi } from 'musicbrainz-api';

// TODO: User should update contactInformation, e.g., to their email or project repository URL.
const APP_NAME = 'JellyfinOrganizer';
const APP_VERSION = '0.1.0'; // Or dynamically get from package.json if desired
const CONTACT_INFORMATION = 'user@example.com-or-project-url';

const mbApi = new MusicBrainzApi({
  appName: APP_NAME,
  appVersion: APP_VERSION,
  appContactInfo: CONTACT_INFORMATION,
  // The library defaults to https://musicbrainz.org/ws/2
});

export interface MusicBrainzRelease {
  id: string; // MBID
  title: string;
  artistCredit?: { artist: { id: string; name: string; } }[];
  date?: string; // YYYY-MM-DD or YYYY-MM or YYYY
  trackCount?: number;
  media?: { format?: string; trackCount?: number; tracks?: MusicBrainzTrack[] }[];
  releaseGroup?: { id: string; primaryType?: string; };
  score?: number; // Search result score
}

export interface MusicBrainzTrack {
  id: string; // MBID for the recording
  title: string;
  number?: string; // Track number as string
  length?: number; // Duration in ms
  artistCredit?: { artist: { id: string; name: string; } }[];
}

export interface MusicBrainzArtist {
  id: string;
  name: string;
  type?: string;
  country?: string;
  score?: number;
}

// Raw types for MusicBrainz API responses before mapping
interface RawArtistCreditItem {
  artist: {
    id: string;
    name: string;
  };
  name?: string;
  joinphrase?: string;
}

interface RawTrack {
  recording: {
    id: string;
  };
  title: string;
  number?: string;
  length?: number;
  ['artist-credit']?: RawArtistCreditItem[];
}

interface RawMedium {
  format?: string;
  ['track-count']?: number;
  tracks?: RawTrack[];
  title?: string;
}

/**
 * Searches for releases (albums) on MusicBrainz.
 * @param query - The search query, typically album title.
 * @param artistName - Optional artist name to refine the search.
 * @param limit - Max number of results (default 25, max 100).
 * @returns A promise resolving to an array of MusicBrainzRelease objects.
 */
export async function searchMusicBrainzReleases(
  query: string,
  artistName?: string,
  limit: number = 2
): Promise<MusicBrainzRelease[]> {
  try {
    let searchQuery = `release:"${query}"`;
    if (artistName) {
      searchQuery += ` AND artist:"${artistName}"`;
    }

    // Type casting SearchResult to any to bypass strict type checks if library types are slightly off
    // This is a common workaround when library typings are not perfectly aligned or too complex.
    const results = await mbApi.search('release', { query: searchQuery, limit: limit }) as any;

    if (results && results.releases) {
        return results.releases.map((release: any) => ({
            id: release.id,
            title: release.title,
            artistCredit: release['artist-credit'],
            date: release.date,
            trackCount: release['track-count'],
            media: release.media?.map((m: any) => ({
                format: m.format,
                trackCount: m['track-count'],
                // Tracks are usually fetched via a lookup on release ID, not directly in search.
            })),
            releaseGroup: release['release-group'] ? {
                id: release['release-group'].id,
                primaryType: release['release-group']['primary-type'],
            } : undefined,
            score: release.score,
        }));
    }
    return [];
  } catch (error) {
    console.error('Error searching MusicBrainz releases:', error);
    return [];
  }
}

/**
 * Fetches detailed information for a specific release, including its tracks.
 * @param releaseMbid The MusicBrainz ID of the release.
 * @returns A promise resolving to a MusicBrainzRelease object with track details, or null.
 */
export async function lookupMusicBrainzReleaseTracks(releaseMbid: string): Promise<MusicBrainzRelease | undefined> {
  try {
    // The 'recordings' inc parameter includes track information.
    // 'artist-credits' includes artist details for tracks and release.
    const releaseDetails = await mbApi.lookup('release', releaseMbid, ['recordings', 'artist-credits', 'release-groups']) as any;

    if (!releaseDetails) return undefined;

    const tracks: MusicBrainzTrack[] = [];
    releaseDetails.media?.forEach((medium: RawMedium) => {
      medium.tracks?.forEach((track: RawTrack) => {
        tracks.push({
          id: track.recording.id,
          title: track.title,
          number: track.number,
          length: track.length,
          artistCredit: track['artist-credit']?.map((ac: RawArtistCreditItem) => ({ artist: { id: ac.artist.id, name: ac.artist.name }}))
        });
      });
    });

    return {
      id: releaseDetails.id,
      title: releaseDetails.title,
      artistCredit: releaseDetails['artist-credit']?.map((ac: RawArtistCreditItem) => ({ artist: { id: ac.artist.id, name: ac.artist.name }})),
      date: releaseDetails.date,
      trackCount: releaseDetails.media?.reduce((sum: number, med: RawMedium) => sum + (med['track-count'] || 0), 0),
      media: releaseDetails.media?.map((m: RawMedium) => ({
        format: m.format,
        trackCount: m['track-count'],
        tracks: m.tracks?.map((t: RawTrack) => ({
            id: t.recording.id,
            title: t.title,
            number: t.number,
            length: t.length,
            artistCredit: t['artist-credit']?.map((ac: RawArtistCreditItem) => ({ artist: {id: ac.artist.id, name: ac.artist.name }}))
        }))
      })),
      releaseGroup: releaseDetails['release-group'] ? {
        id: releaseDetails['release-group'].id,
        primaryType: releaseDetails['release-group']['primary-type'],
      } : undefined,
    };

  } catch (error) {
    console.error(`Error looking up MusicBrainz release ${releaseMbid}:`, error);
    return undefined;
  }
}

// TODO: Implement searchMusicBrainzArtists and searchMusicBrainzRecordings if needed directly.
// Often, recordings are found via release lookups.
