"use client";

import { TradeEntry } from "@/hooks/useTradeJournal";

interface Props {
  trades: TradeEntry[];
  stats: {
    totalTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    totalPnl: number;
    winRate: number;
  };
}

function fmt(d: Date) {
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function duration(entry: Date, exit: Date | null) {
  const end = exit ?? new Date();
  const secs = Math.floor((end.getTime() - entry.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function PnlCell({ value, open }: { value: number | null; open?: boolean }) {
  if (value === null) return <span className="text-gray-600">—</span>;
  const pos = value > 0;
  const color = pos ? "text-chart-green" : value < 0 ? "text-chart-red" : "text-gray-400";
  return (
    <span className={`${color} tabular-nums font-semibold`}>
      {open && <span className="text-xs mr-0.5 opacity-60">~</span>}
      {pos ? "+" : ""}
      {value.toFixed(4)} USDT
    </span>
  );
}

export default function TradeJournal({ trades, stats }: Props) {
  return (
    <div className="space-y-4">
      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
        {[
          { label: "Total trades", value: stats.totalTrades, color: "text-white" },
          {
            label: "Open",
            value: stats.openTrades,
            color: stats.openTrades > 0 ? "text-yellow-400" : "text-gray-500",
          },
          { label: "Wins", value: stats.wins, color: "text-chart-green" },
          { label: "Losses", value: stats.losses, color: "text-chart-red" },
          {
            label: "Win rate",
            value: stats.totalTrades > 0 ? `${stats.winRate}%` : "—",
            color: stats.winRate >= 50 ? "text-chart-green" : "text-chart-red",
          },
          {
            label: "Total PnL",
            value:
              stats.totalTrades > 0
                ? `${stats.totalPnl > 0 ? "+" : ""}${stats.totalPnl.toFixed(4)}`
                : "—",
            color:
              stats.totalPnl > 0
                ? "text-chart-green"
                : stats.totalPnl < 0
                ? "text-chart-red"
                : "text-gray-500",
            suffix: stats.totalTrades > 0 ? " USDT" : "",
          },
        ].map((s) => (
          <div key={s.label} className="card p-3">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={`text-lg font-bold tabular-nums ${s.color}`}>
              {s.value}
              {"suffix" in s && (
                <span className="text-xs font-normal text-gray-500">{s.suffix}</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Live Trade Journal
          </p>
          <p className="text-xs text-gray-600">qty = actual BTC per trade</p>
        </div>

        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <p className="text-gray-600 text-sm">No trades recorded yet</p>
            <p className="text-gray-700 text-xs">
              Waiting for SMA 25/99 crossover with gap ≥ $5…
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  {[
                    "#",
                    "Side",
                    "Status",
                    "Entry time",
                    "Entry $",
                    "Exit time",
                    "Exit $",
                    "Move",
                    "PnL",
                    "Held",
                    "Exit reason",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-normal whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors ${
                      t.status === "OPEN" ? "bg-yellow-500/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-gray-500">{t.id}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`font-bold ${
                          t.side === "LONG" ? "text-chart-green" : "text-chart-red"
                        }`}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {t.status === "OPEN" ? (
                        <span className="text-yellow-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 blink inline-block" />
                          OPEN
                        </span>
                      ) : (
                        <span className="text-gray-500">CLOSED</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-300 tabular-nums">
                      {fmt(t.entryTime)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-white">
                      ${t.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-gray-300 tabular-nums">
                      {t.exitTime ? fmt(t.exitTime) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-white">
                      {t.exitPrice
                        ? `$${t.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {t.moveUsd !== null ? (
                        <span className={t.moveUsd >= 0 ? "text-chart-green" : "text-chart-red"}>
                          {t.moveUsd >= 0 ? "+" : ""}${t.moveUsd.toFixed(2)}
                        </span>
                      ) : t.status === "OPEN" && t.unrealisedPnl !== null ? (
                        <span className="text-gray-500 text-xs">live</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <PnlCell
                        value={t.status === "OPEN" ? t.unrealisedPnl : t.pnlUsdt}
                        open={t.status === "OPEN"}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-400">
                      {duration(t.entryTime, t.exitTime)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate">
                      {t.exitReason ?? (
                        <span className="text-yellow-600 text-xs">in progress…</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
