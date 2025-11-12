// app/best-recipes-history/page.tsx
import BestRecipesHistoryClient from "./BestRecipesHistoryClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function BestRecipesHistoryPage() {
  return <BestRecipesHistoryClient />;
}
