import PMMGGDPClient from "./PMMGGDPClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PMMGGDPPage() {
  return <PMMGGDPClient />;
}
