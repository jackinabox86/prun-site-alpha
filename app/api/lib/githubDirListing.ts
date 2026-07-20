import { getOrCompute } from "../best-recipes/lib/cache";

export interface GitHubDirEntry {
  name: string;
}

const LISTING_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch a GitHub contents listing with a 10-minute in-memory cache, in-flight
 * deduplication, and optional GITHUB_TOKEN auth. Unauthenticated GitHub API
 * quota is 60 requests/hour per IP (often shared on serverless egress), so
 * per-page-view fetches exhaust it quickly. Failures are not cached.
 * Returns null when the listing can't be retrieved.
 */
export async function fetchGitHubDirListing(url: string): Promise<GitHubDirEntry[] | null> {
  try {
    return await getOrCompute(`github-dir:${url}`, LISTING_TTL_MS, async () => {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      const token = process.env.GITHUB_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        throw new Error(`GitHub listing failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as GitHubDirEntry[];
    });
  } catch (error) {
    console.error(`Could not fetch GitHub listing ${url}:`, error);
    return null;
  }
}
