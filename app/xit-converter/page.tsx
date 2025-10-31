// app/xit-converter/page.tsx
import XitConverterClient from "./XitConverterClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function XitConverterPage() {
  return <XitConverterClient />;
}
