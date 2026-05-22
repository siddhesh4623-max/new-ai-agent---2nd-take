import fs from "fs";
import path from "path";

// Default path: relative to project root (one level up from frontend)
// Can be overridden with TRADES_CSV_PATH environment variable
const TRADES_FILE = process.env.TRADES_CSV_PATH 
  ?? path.join(process.cwd(), "..", "backend", "trades_journal.csv")
  ?? "trades_journal.csv";

// Parses the bot's trades_journal.csv format:
// trade_no,symbol,side,entry_time,exit_time,held_s,entry_price,exit_price,move_usd,pnl_usdt,exit_reason,entry_gap
function parseCSV(content) {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 10) continue;

    const [
      tradeNo,
      symbol,
      side,
      entryTime,
      exitTime,
      heldS,
      entryPrice,
      exitPrice,
      moveUsd,
      pnlUsdt,
      exitReason,
      ...entryGapParts
    ] = cols;

    const entryGap = entryGapParts.join(",").trim();

    rows.push({
      id: parseInt(tradeNo) || i,
      symbol: symbol?.trim() || "BTCUSDT",
      side: side?.trim().toUpperCase() || "LONG",
      status: "CLOSED",
      entryTime: entryTime?.trim() || "",
      entryPrice: parseFloat(entryPrice) || 0,
      exitTime: exitTime?.trim() || null,
      exitPrice: exitPrice?.trim() ? parseFloat(exitPrice) : null,
      moveUsd: moveUsd?.trim() ? parseFloat(moveUsd) : null,
      pnlUsdt: pnlUsdt?.trim() ? parseFloat(pnlUsdt) : null,
      qty: 0.007,
      entryGap: parseFloat(entryGap) || 0,
      exitReason: exitReason?.trim() || null,
      heldS: heldS?.trim() ? parseFloat(heldS) : null,
    });
  }

  // Re-index after reversing so IDs are globally unique across bot sessions
  return rows.reverse().map((row, i) => ({ ...row, id: i + 1 }));
}

export default function handler(req, res) {
  try {
    if (!fs.existsSync(TRADES_FILE)) {
      res.json({ trades: [] });
      return;
    }
    const content = fs.readFileSync(TRADES_FILE, "utf-8");
    const trades = parseCSV(content);
    res.json({ trades });
  } catch {
    res.json({ trades: [] });
  }
}
