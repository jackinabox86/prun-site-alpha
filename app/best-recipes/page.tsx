// app/best-recipes/page.tsx
import BestRecipesClient from "./BestRecipesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function BestRecipesPage() {
  return <BestRecipesClient />;
}
