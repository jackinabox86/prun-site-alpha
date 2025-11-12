// app/api/best-recipes/lib/timestamp.ts

/**
 * Parse timestamps that may be in either format:
 * - Old format (malformed): "2025-11-07T20-01-54Z" (hyphens in time)
 * - New format (correct): "2025-11-07T20:01:54Z" (colons in time)
 *
 * Converts malformed timestamps to proper ISO 8601 format before parsing.
 */
export function parseTimestamp(timestamp: string): Date {
  // Check if the timestamp has hyphens in the time portion (old malformed format)
  // Pattern: YYYY-MM-DDTHH-MM-SSZ
  const malformedPattern = /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})(Z)$/;
  const match = timestamp.match(malformedPattern);

  if (match) {
    // Convert to proper ISO 8601 format with colons
    const properTimestamp = `${match[1]}${match[2]}:${match[3]}:${match[4]}${match[5]}`;
    return new Date(properTimestamp);
  }

  // Already in correct format, parse normally
  return new Date(timestamp);
}

/**
 * Get the timestamp as a number for sorting/comparison
 */
export function getTimestampMillis(timestamp: string): number {
  return parseTimestamp(timestamp).getTime();
}
