import BasesRankingClient from "./BasesRankingClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function BasesRankingPage() {
  return <BasesRankingClient />;
}
