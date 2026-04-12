import { NextResponse } from "next/server";

const FIO_BASE = "https://rest.fnar.net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const username = request.headers.get("x-fio-username");
  const apiKey = request.headers.get("x-fio-api-key");

  if (!username || !apiKey) {
    return NextResponse.json(
      { error: "FIO username and API key are required. Enter them in the credentials section above." },
      { status: 400 }
    );
  }

  try {
    const [warehousesRes, storageRes, exchangeRes, ordersRes] = await Promise.all([
      fetch(`${FIO_BASE}/sites/warehouses/${encodeURIComponent(username)}`, {
        headers: { accept: "application/json", Authorization: apiKey },
      }),
      fetch(`${FIO_BASE}/storage/${encodeURIComponent(username)}`, {
        headers: { accept: "application/json", Authorization: apiKey },
      }),
      fetch(`${FIO_BASE}/exchange/all`, {
        headers: { accept: "application/json" },
      }),
      fetch(`${FIO_BASE}/cxos/${encodeURIComponent(username)}`, {
        headers: { accept: "application/json", Authorization: apiKey },
      }),
    ]);

    if (!warehousesRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch warehouses: ${warehousesRes.status} ${warehousesRes.statusText}` },
        { status: 502 }
      );
    }
    if (!storageRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch storage: ${storageRes.status} ${storageRes.statusText}` },
        { status: 502 }
      );
    }
    if (!exchangeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch exchange data: ${exchangeRes.status} ${exchangeRes.statusText}` },
        { status: 502 }
      );
    }
    if (!ordersRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch orders: ${ordersRes.status} ${ordersRes.statusText}` },
        { status: 502 }
      );
    }

    const warehouses = await warehousesRes.json();
    const storage = await storageRes.json();
    const exchangeData = await exchangeRes.json();
    const orders = await ordersRes.json();

    return NextResponse.json({
      warehouses,
      storage,
      exchangeData,
      orders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
