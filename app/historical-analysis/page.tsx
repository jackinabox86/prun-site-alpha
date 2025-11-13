import HistoricalAnalysisClient from "./HistoricalAnalysisClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HistoricalAnalysisPage() {
  return <HistoricalAnalysisClient />;
}
