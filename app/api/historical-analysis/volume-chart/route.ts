import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { HistoricalPriceData, Exchange } from "../../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices";

const EXCHANGE_CODE_TO_NAME: Record<string, Exchange> = {
  ai1: "ANT",
  ci1: "CIS",
  ic1: "ICA",
  nc1: "NCC",
};

interface ManifestEntry {
  ticker: string;
  exchange: string;
  filename: string;
}

interface Manifest {
  generated: string;
  files: ManifestEntry[];
  tickerCount: number;
  fileCount: number;
}

interface VolumeDataPoint {
  date: string;
  timestamp: number;
  ANT: number;
  CIS: number;
  ICA: number;
  NCC: number;
  total: number;
}

interface VolumeChartResult {
  days: number;
  cutoffDate: string;
  dataPoints: VolumeDataPoint[];
  filesProcessed: number;
  lastUpdated: number;
  error?: string;
}

/**
 * Fetch all ticker files and aggregate daily volume per exchange over time.
 *
 * Query params:
 *   - days: number of days to look back (default: 90)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "90", 10);

    if (isNaN(days) || days <= 0) {
      return NextResponse.json(
        { error: "Invalid days parameter" },
        { status: 400 }
      );
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setUTCHours(0, 0, 0, 0);
    const cutoffMs = cutoffDate.getTime();

    // Load manifest from GCS, fall back to local file
    let manifest: Manifest | null = null;

    try {
      const manifestUrl = `${GCS_BUCKET}/manifest.json`;
      const manifestResponse = await fetch(manifestUrl, {
        cache: "no-store",
        next: { revalidate: 0 }
      });
      if (manifestResponse.ok) {
        manifest = await manifestResponse.json();
      }
    } catch {
      console.warn("Could not load manifest from GCS, trying local file");
    }

    if (!manifest) {
      try {
        const localManifestPath = join(process.cwd(), "public/data/historical-prices-manifest.json");
        manifest = JSON.parse(readFileSync(localManifestPath, "utf8"));
      } catch {
        console.error("Could not load local manifest");
      }
    }

    if (!manifest || !manifest.files) {
      return NextResponse.json(
        {
          error: "Manifest file not found",
          hint: "Run: npm run generate-manifest to create the manifest file"
        },
        { status: 503 }
      );
    }

    // dailyVolume[dateString][exchange] = total volume
    const dailyVolume: Record<string, Record<string, number>> = {};
    const exchanges: Exchange[] = ["ANT", "CIS", "ICA", "NCC"];

    let filesProcessed = 0;
    const BATCH_SIZE = 50;
    const files = manifest.files;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (entry) => {
        try {
          const fileUrl = `${GCS_BUCKET}/${entry.filename}`;
          const response = await fetch(fileUrl, {
            cache: "no-store",
            next: { revalidate: 0 }
          });

          if (!response.ok) return null;

          const data: HistoricalPriceData = await response.json();
          const exchangeName = EXCHANGE_CODE_TO_NAME[data.exchange] || data.exchange;

          // Filter to the requested date range
          const points = data.data.filter((d) => d.DateEpochMs >= cutoffMs);

          if (points.length === 0) return null;

          return points.map((d) => {
            const date = new Date(d.DateEpochMs).toISOString().split("T")[0];
            return { date, timestamp: d.DateEpochMs, exchange: exchangeName, volume: d.Volume };
          });
        } catch {
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        if (!result) continue;
        filesProcessed++;

        for (const point of result) {
          if (!dailyVolume[point.date]) {
            dailyVolume[point.date] = { ANT: 0, CIS: 0, ICA: 0, NCC: 0 };
          }
          if (point.exchange in dailyVolume[point.date]) {
            dailyVolume[point.date][point.exchange] += point.volume;
          }
        }
      }

      console.log(`Volume chart: processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}`);
    }

    // Build sorted daily points, then bucket into 7-day periods
    const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

    type WeekBucket = { date: string; timestamp: number; ANT: number; CIS: number; ICA: number; NCC: number };
    const weekBuckets: Record<number, WeekBucket> = {};

    for (const date of Object.keys(dailyVolume).sort()) {
      const ts = new Date(date + "T00:00:00Z").getTime();
      const weekIndex = Math.floor((ts - cutoffMs) / MS_PER_WEEK);
      if (!weekBuckets[weekIndex]) {
        // Label each bucket by the Monday-aligned week start date
        const weekStartTs = cutoffMs + weekIndex * MS_PER_WEEK;
        weekBuckets[weekIndex] = {
          date: new Date(weekStartTs).toISOString().split("T")[0],
          timestamp: weekStartTs,
          ANT: 0, CIS: 0, ICA: 0, NCC: 0,
        };
      }
      const ex = dailyVolume[date];
      weekBuckets[weekIndex].ANT += ex.ANT ?? 0;
      weekBuckets[weekIndex].CIS += ex.CIS ?? 0;
      weekBuckets[weekIndex].ICA += ex.ICA ?? 0;
      weekBuckets[weekIndex].NCC += ex.NCC ?? 0;
    }

    const dataPoints: VolumeDataPoint[] = Object.keys(weekBuckets)
      .map(Number)
      .sort((a, b) => a - b)
      .map((idx) => {
        const b = weekBuckets[idx];
        return { ...b, total: b.ANT + b.CIS + b.ICA + b.NCC };
      });

    const result: VolumeChartResult = {
      days,
      cutoffDate: cutoffDate.toISOString().split("T")[0],
      dataPoints,
      filesProcessed,
      lastUpdated: Date.now(),
    };

    console.log(`Volume chart complete: ${filesProcessed} files, ${dataPoints.length} date points`);

    return NextResponse.json(result);

  } catch (error) {
    console.error("Error in volume chart API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
