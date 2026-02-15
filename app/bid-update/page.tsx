import BidUpdateClient from "./BidUpdateClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function BidUpdatePage() {
  return <BidUpdateClient />;
}
