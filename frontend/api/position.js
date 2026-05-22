import crypto from "crypto";

const BASE_URL = "https://testnet.binancefuture.com";

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

export default async function handler(req, res) {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET_KEY;

  if (!apiKey || !secret) {
    res.status(500).json({ error: "Missing API credentials" });
    return;
  }

  const timestamp = Date.now();
  const query = `symbol=BTCUSDT&timestamp=${timestamp}`;
  const signature = sign(query, secret);
  const url = `${BASE_URL}/fapi/v2/positionRisk?${query}&signature=${signature}`;

  try {
    const fetchRes = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      res.status(fetchRes.status).json({ error: text });
      return;
    }

    const data = await fetchRes.json();
    const pos = Array.isArray(data)
      ? data.find((p) => p.symbol === "BTCUSDT")
      : null;

    if (!pos) {
      res.json({ position: null });
      return;
    }

    res.json({
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
        percentage:
          parseFloat(pos.unRealizedProfit) !== 0 &&
          parseFloat(pos.isolatedMargin) !== 0
            ? (parseFloat(pos.unRealizedProfit) /
                parseFloat(pos.isolatedMargin)) *
              100
            : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
