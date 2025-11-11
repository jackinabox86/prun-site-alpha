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
  records180Days: number;
}

/**
 * Generate CSV summary of FIO data with record counts
 *
 * Returns a CSV with:
 * - Ticker
 * - Exchange
 * - Total Records
 * - Records Last 180 Days
 */
export async function GET(request: Request) {
  try {
    const generatedDate = new Date().toISOString().split('T')[0];

    // Calculate 180-day cutoff
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 180);
    const cutoffMs = cutoffDate.getTime();

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

          // Count records in last 180 days
          const recent180 = data.data.filter((d) => d.DateEpochMs >= cutoffMs);
          const records180Days = recent180.length;

          // Convert exchange code to readable name
          const exchangeName = EXCHANGE_CODE_TO_NAME[data.exchange] || data.exchange;

          return {
            ticker: data.ticker,
            exchange: exchangeName,
            totalRecords,
            records180Days,
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
      ['Ticker', 'Exchange', 'Total Records', 'Records Last 180 Days'].join(',')
    ];

    for (const row of summaryRows) {
      csvRows.push([
        row.ticker,
        row.exchange,
        row.totalRecords.toString(),
        row.records180Days.toString()
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
