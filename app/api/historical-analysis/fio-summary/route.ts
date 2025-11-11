import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { HistoricalPriceData } from "../../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket/historical-prices";

// Mapping from FNAR exchange codes to human-readable names
const EXCHANGE_CODE_TO_NAME: Record<string, string> = {
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

interface SummaryRow {
  ticker: string;
  exchange: string;
  totalRecords: number;
  records0to180: number;
  records180to360: number;
  records360to540: number;
}

/**
 * Generate CSV summary of FIO data with record counts
 *
 * Returns a CSV with:
 * - Ticker
 * - Exchange
 * - Total Records
 * - Records Days 0-180 (most recent)
 * - Records Days 180-360
 * - Records Days 360-540
 */
export async function GET(request: Request) {
  try {
    const generatedDate = new Date().toISOString().split('T')[0];
    const now = Date.now();

    // Calculate cutoff dates for three 180-day periods
    const cutoff180 = new Date();
    cutoff180.setDate(cutoff180.getDate() - 180);
    const cutoff180Ms = cutoff180.getTime();

    const cutoff360 = new Date();
    cutoff360.setDate(cutoff360.getDate() - 360);
    const cutoff360Ms = cutoff360.getTime();

    const cutoff540 = new Date();
    cutoff540.setDate(cutoff540.getDate() - 540);
    const cutoff540Ms = cutoff540.getTime();

    // Load manifest
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
    } catch (error) {
      console.warn("Could not load manifest from GCS, trying local file");
    }

    if (!manifest) {
      try {
        const localManifestPath = join(process.cwd(), "public/data/historical-prices-manifest.json");
        const localManifest = readFileSync(localManifestPath, "utf8");
        manifest = JSON.parse(localManifest);
      } catch (error) {
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

    console.log(`Generating FIO summary for ${manifest.files.length} files...`);

    const summaryRows: SummaryRow[] = [];

    // Process files in batches
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

          if (!response.ok) {
            return null;
          }

          const data: HistoricalPriceData = await response.json();

          // Count total records
          const totalRecords = data.data.length;

          // Count records in three 180-day periods
          // Period 1: 0-180 days ago (most recent)
          const records0to180 = data.data.filter((d) => d.DateEpochMs >= cutoff180Ms).length;

          // Period 2: 180-360 days ago
          const records180to360 = data.data.filter((d) =>
            d.DateEpochMs >= cutoff360Ms && d.DateEpochMs < cutoff180Ms
          ).length;

          // Period 3: 360-540 days ago
          const records360to540 = data.data.filter((d) =>
            d.DateEpochMs >= cutoff540Ms && d.DateEpochMs < cutoff360Ms
          ).length;

          // Convert exchange code to readable name
          const exchangeName = EXCHANGE_CODE_TO_NAME[data.exchange] || data.exchange;

          return {
            ticker: data.ticker,
            exchange: exchangeName,
            totalRecords,
            records0to180,
            records180to360,
            records360to540,
          };
        } catch (error) {
          console.error(`Error processing ${entry.filename}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        if (result) {
          summaryRows.push(result);
        }
      }

      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}`);
    }

    // Sort by ticker, then exchange
    summaryRows.sort((a, b) => {
      if (a.ticker !== b.ticker) {
        return a.ticker.localeCompare(b.ticker);
      }
      return a.exchange.localeCompare(b.exchange);
    });

    // Generate CSV
    const csvRows = [
      ['Ticker', 'Exchange', 'Total Records', 'Records Days 0-180', 'Records Days 180-360', 'Records Days 360-540'].join(',')
    ];

    for (const row of summaryRows) {
      csvRows.push([
        row.ticker,
        row.exchange,
        row.totalRecords.toString(),
        row.records0to180.toString(),
        row.records180to360.toString(),
        row.records360to540.toString()
      ].join(','));
    }

    const csv = csvRows.join('\n');

    console.log(`FIO summary generated: ${summaryRows.length} rows`);

    // Return CSV with proper headers for download
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="fio-data-summary-${generatedDate}.csv"`,
      },
    });

  } catch (error) {
    console.error("Error in FIO summary API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
