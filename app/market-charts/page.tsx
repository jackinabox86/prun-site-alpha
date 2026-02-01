// app/market-charts/page.tsx
import MarketChartsClient from "./MarketChartsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MarketChartsPage() {
  return <MarketChartsClient />;
}
