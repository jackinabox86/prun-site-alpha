"use client";
import { useEffect, useState } from "react";

export default function Home() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/report?ticker=PCB&priceMode=bid")
      .then(r => r.json())
      .then(setData);
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Report (mock)</h1>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
