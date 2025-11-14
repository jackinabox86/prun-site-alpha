// app/inflation/page.tsx
import InflationClient from "./InflationClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InflationPage() {
  return <InflationClient />;
}
