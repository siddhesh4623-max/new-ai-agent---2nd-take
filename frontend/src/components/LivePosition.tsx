"use client";

import { PositionData } from "@/hooks/usePosition";

function fmt(v: number, decimals = 2) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPrice(v: number, decimals = 2) {
  return `$${fmt(v, decimals)}`;
}

interface Props {
  position: PositionData | null;
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

export default function LivePosition({ position, loading, error, lastFetch }: Props) {
  const hasPos = position && Math.abs(position.positionAmt) > 0;
  const side = hasPos
    ? position!.positionAmt > 0
      ? "LONG"
      : "SHORT"
    : null;

  const pnl = position?.unRealizedProfit ?? 0;
  const pnlPct = position?.percentage ?? 0;
  const pnlColor = pnl > 0 ? "text-chart-green" : pnl < 0 ? "text-chart-red" : "text-gray-400";
  const sideColor =
    side === "LONG" ? "text-chart-green" : side === "SHORT" ? "text-chart-red" : "text-gray-500";
  const sideBg =
    side === "LONG"
      ? "bg-chart-green/10 border-chart-green/30"
      : side === "SHORT"
      ? "bg-chart-red/10 border-chart-red/30"
      : "bg-gray-800/40 border-gray-700/20";

  const time = lastFetch
    ? lastFetch.toLocaleTimeString("en-US", { hour12: false })
    : null;

  return (
    <div className={`card border ${sideBg} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Live Position · BTCUSDT
          </p>
          {loading && (
            <span className="text-xs text-gray-600 animate-pulse">fetching…</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          {time && <span>Updated {time}</span>}
          {error && <span className="text-chart-red">Error</span>}
        </div>
      </div>

      {!hasPos ? (
        <div className="text-center py-4 text-gray-600 text-sm">
          {loading ? "Loading position…" : error ? `Failed: ${error}` : "No open position"}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {/* Side */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Side</p>
            <p className={`text-sm font-bold ${sideColor}`}>{side}</p>
          </div>

          {/* Size */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Size</p>
            <p className="text-sm font-semibold text-white tabular-nums">
              {fmt(Math.abs(position!.positionAmt), 4)} BTC
            </p>
          </div>

          {/* Entry Price */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Entry Price</p>
            <p className="text-sm font-semibold text-white tabular-nums">
              {fmtPrice(position!.entryPrice, 2)}
            </p>
          </div>

          {/* Mark Price */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Mark Price</p>
            <p className="text-sm font-semibold text-yellow-400 tabular-nums">
              {fmtPrice(position!.markPrice, 2)}
            </p>
          </div>

          {/* Liq. Price */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Liq. Price</p>
            <p className="text-sm font-semibold text-orange-400 tabular-nums">
              {position!.liquidationPrice > 0
                ? fmtPrice(position!.liquidationPrice, 2)
                : "—"}
            </p>
          </div>

          {/* Unrealized PnL */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Unreal. PnL</p>
            <p className={`text-sm font-bold tabular-nums ${pnlColor}`}>
              {pnl >= 0 ? "+" : ""}
              {fmt(pnl, 4)} USDT
            </p>
            <p className={`text-xs tabular-nums ${pnlColor}`}>
              ({pnlPct >= 0 ? "+" : ""}
              {fmt(pnlPct, 2)}%)
            </p>
          </div>

          {/* Margin */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Margin</p>
            <p className="text-sm font-semibold text-white tabular-nums">
              {fmt(position!.isolatedMargin, 2)} USDT
            </p>
          </div>

          {/* Leverage */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Leverage</p>
            <p className="text-sm font-semibold text-purple-400">
              {position!.leverage}x{" "}
              <span className="text-xs text-gray-600 capitalize">
                {position!.marginType}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
