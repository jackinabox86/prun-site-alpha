// app/page.tsx — Server Component that renders the client UI
import ReportClient from "./components/ReportClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <ReportClient />;
}
