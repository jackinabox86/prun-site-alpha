// app/api/market-charts/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GCS_BUCKET = "https://storage.googleapis.com/prun-site-alpha-bucket";
const GCS_VWAP_PATH = "historical-prices-vwap";

// Exchange code mapping
const EXCHANGE_MAP: Record<string, string> = {
  ANT: "ai1",
  CIS: "ci1",
  ICA: "ic1",
  NCC: "nc1",
};

// Full exchange names for display
const EXCHANGE_NAMES: Record<string, string> = {
  ANT: "Antares (AI1)",
  CIS: "Benten (CI1)",
  ICA: "Moria (IC1)",
  NCC: "Hortus (NC1)",
};

interface VWAPDataPoint {
  DateEpochMs: number;
  rawVolume: number;
  rawTraded: number;
  rawOpen: number;
  rawClose: number;
  rawHigh: number;
  rawLow: number;
  dailyVWAP: number | null;
  vwap7d: number | null;
  tradingDaysInWindow: number;
  wasForwardFilled: boolean;
}

interface VWAPHistoricalData {
  ticker: string;
  exchange: string;
  calculationVersion: string;
  lastCalculated: number;
  data: VWAPDataPoint[];
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number;
  traded: number;
  vwap7d: number | null;
}

interface ExchangeChartData {
  exchange: string;
  exchangeName: string;
  ticker: string;
  found: boolean;
  dataPoints: number;
  data: ChartDataPoint[];
}

/**
 * Fetch VWAP data from GCS for a specific ticker and exchange
 */
async function fetchVWAPData(ticker: string, exchange: string): Promise<VWAPHistoricalData | null> {
  try {
    const shortExchange = EXCHANGE_MAP[exchange] || exchange.toLowerCase();
    const filename = `${ticker}-${shortExchange}-vwap.json`;
    const url = `${GCS_BUCKET}/${GCS_VWAP_PATH}/${filename}`;

    console.log(`Fetching VWAP data: ${url}`);
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      console.warn(`Failed to fetch VWAP data for ${ticker}.${exchange}: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching VWAP data for ${ticker}.${exchange}:`, error);
    return null;
  }
}

/**
 * Transform VWAP data to chart format
 */
function transformToChartData(vwapData: VWAPHistoricalData): ChartDataPoint[] {
  return vwapData.data.map((point) => ({
    date: new Date(point.DateEpochMs).toISOString().split("T")[0],
    timestamp: point.DateEpochMs,
    open: point.rawOpen > 0 ? point.rawOpen : null,
    close: point.rawClose > 0 ? point.rawClose : null,
    high: point.rawHigh > 0 ? point.rawHigh : null,
    low: point.rawLow > 0 ? point.rawLow : null,
    volume: point.rawVolume || 0,
    traded: point.rawTraded || 0,
    vwap7d: point.vwap7d,
  }));
}

/**
 * GET /api/market-charts
 * Query params:
 *   - ticker: ticker symbol (e.g., "RAT")
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker")?.toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        { error: "Missing required parameter: ticker" },
        { status: 400 }
      );
    }

    // Fetch data for all exchanges in parallel
    const exchanges = Object.keys(EXCHANGE_MAP);
    const fetchPromises = exchanges.map((exchange) => fetchVWAPData(ticker, exchange));
    const results = await Promise.all(fetchPromises);

    // Build response for each exchange
    const exchangeData: ExchangeChartData[] = exchanges.map((exchange, index) => {
      const vwapData = results[index];

      if (vwapData && vwapData.data.length > 0) {
        const chartData = transformToChartData(vwapData);
        return {
          exchange,
          exchangeName: EXCHANGE_NAMES[exchange],
          ticker,
          found: true,
          dataPoints: chartData.length,
          data: chartData,
        };
      }

      return {
        exchange,
        exchangeName: EXCHANGE_NAMES[exchange],
        ticker,
        found: false,
        dataPoints: 0,
        data: [],
      };
    });

    // Check if any exchange has data
    const hasAnyData = exchangeData.some((ex) => ex.found);

    if (!hasAnyData) {
      return NextResponse.json(
        {
          success: false,
          error: `No market data found for ticker: ${ticker}`,
          ticker,
          exchanges: exchangeData,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ticker,
      exchanges: exchangeData,
    });
  } catch (error: any) {
    console.error("Error fetching market chart data:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
