import PlanetRepairsClient from "./PlanetRepairsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PlanetRepairsPage() {
  return <PlanetRepairsClient />;
}
