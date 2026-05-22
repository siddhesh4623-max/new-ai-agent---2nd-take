import { NextResponse } from "next/server";
import crypto from "crypto";

const BASE_URL = "https://testnet.binancefuture.com";

function sign(queryString: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

export async function GET() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET_KEY;

  if (!apiKey || !secret) {
    return NextResponse.json({ error: "Missing API credentials" }, { status: 500 });
  }

  const timestamp = Date.now();
  const query = `symbol=BTCUSDT&timestamp=${timestamp}`;
  const signature = sign(query, secret);
  const url = `${BASE_URL}/fapi/v2/positionRisk?${query}&signature=${signature}`;

  try {
    const res = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    const pos = Array.isArray(data)
      ? data.find((p: { symbol: string }) => p.symbol === "BTCUSDT")
      : null;

    if (!pos) {
      return NextResponse.json({ position: null });
    }

    return NextResponse.json({
      position: {
        symbol: pos.symbol,
        positionAmt: parseFloat(pos.positionAmt),
        entryPrice: parseFloat(pos.entryPrice),
        markPrice: parseFloat(pos.markPrice),
        unRealizedProfit: parseFloat(pos.unRealizedProfit),
        liquidationPrice: parseFloat(pos.liquidationPrice),
        leverage: parseInt(pos.leverage),
        marginType: pos.marginType,
        isolatedMargin: parseFloat(pos.isolatedMargin),
        positionSide: pos.positionSide,
        percentage: parseFloat(pos.unRealizedProfit) !== 0 && parseFloat(pos.isolatedMargin) !== 0
          ? (parseFloat(pos.unRealizedProfit) / parseFloat(pos.isolatedMargin)) * 100
          : 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
