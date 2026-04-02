import PMMGMMSClient from "./PMMGMMSClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PMMGMMSPage() {
  return <PMMGMMSClient />;
}
