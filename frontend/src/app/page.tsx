"use client";

import dynamic from "next/dynamic";
import { useBinanceData } from "@/hooks/useBinanceData";
import { useTradeJournal } from "@/hooks/useTradeJournal";
import { useBotLogs } from "@/hooks/useBotLogs";
import { usePosition } from "@/hooks/usePosition";
import { MIN_GAP, SMA_FAST, SMA_SLOW } from "@/lib/indicators";

const PriceChart = dynamic(() => import("@/components/PriceChart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">
      Loading chart…
    </div>
  ),
});

const TradeJournal = dynamic(() => import("@/components/TradeJournal"), {
  ssr: false,
});

const BotLogs = dynamic(() => import("@/components/BotLogs"), {
  ssr: false,
});

const LivePosition = dynamic(() => import("@/components/LivePosition"), {
  ssr: false,
});

function fmtPrice(v: number | null, decimals = 2) {
  if (v === null) return "—";
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function fmtTime(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function ConnDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-chart-green pulse-green"
      : status === "reconnecting"
      ? "bg-yellow-400"
      : status === "error"
      ? "bg-chart-red"
      : "bg-gray-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

export default function Dashboard() {
  const {
    livePrice,
    priceChange,
    sma25,
    sma99,
    gap,
    signal,
    chartData,
    connStatus,
    lastUpdate,
    candleCount,
  } = useBinanceData();

  const { position, loading: posLoading, error: posError, lastFetch: posLastFetch } = usePosition(2000);
  const { trades, stats } = useTradeJournal({ signal, livePrice, gap, sma25, sma99, realPosition: position });
  const { lines: botLogs, connected: botConnected, error: botError } = useBotLogs();

  const signalColor =
    signal === "LONG"
      ? "text-chart-green"
      : signal === "SHORT"
      ? "text-chart-red"
      : "text-gray-500";

  const signalBg =
    signal === "LONG"
      ? "bg-chart-green/10 border-chart-green/30"
      : signal === "SHORT"
      ? "bg-chart-red/10 border-chart-red/30"
      : "bg-gray-800/40 border-gray-700/30";

  const priceCls =
    priceChange === "up"
      ? "text-chart-green"
      : priceChange === "down"
      ? "text-chart-red"
      : "text-white";

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      {/* ── Header ── */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-btc-orange flex items-center justify-center text-black font-bold text-sm">
            ₿
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-widest uppercase">
              BTC/USDT Futures
            </h1>
            <p className="text-xs text-gray-500">
              SMA{SMA_FAST} / SMA{SMA_SLOW} Crossover · 1m
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <ConnDot status={connStatus} />
          <span className="capitalize">{connStatus}</span>
          <span className="text-gray-700">·</span>
          <span>{fmtTime(lastUpdate)}</span>
        </div>
      </header>

      {/* ── Live Price + Signal ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Big price */}
        <div className="card p-5 md:col-span-2 flex flex-col justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
              Live Price
            </p>
            <div
              className={`text-4xl md:text-5xl font-bold tabular-nums transition-colors duration-150 ${priceCls}`}
            >
              {livePrice ? fmtPrice(livePrice, 2) : "Loading…"}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-yellow-400/70 mb-0.5">SMA {SMA_FAST}</p>
              <p className="text-yellow-400 font-semibold tabular-nums">
                {fmtPrice(sma25, 2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-purple-400/70 mb-0.5">SMA {SMA_SLOW}</p>
              <p className="text-purple-400 font-semibold tabular-nums">
                {fmtPrice(sma99, 2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Gap</p>
              <p
                className={`font-semibold tabular-nums ${
                  gap >= MIN_GAP ? signalColor : "text-gray-500"
                }`}
              >
                {gap ? `$${gap.toFixed(2)}` : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Signal card */}
        <div
          className={`card p-5 border flex flex-col items-center justify-center gap-3 ${signalBg}`}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Bot Signal
          </p>
          <div className={`text-5xl font-bold ${signalColor}`}>
            {signal}
          </div>
          <div className="text-center space-y-1">
            <p className="text-xs text-gray-600">
              Min gap: ${MIN_GAP.toFixed(2)}
            </p>
            <p className="text-xs text-gray-600">
              {signal !== "FLAT"
                ? `Gap ${gap >= MIN_GAP ? "≥" : "<"} min → ${signal}`
                : gap > 0 && gap < MIN_GAP
                ? `Gap $${gap.toFixed(2)} < $${MIN_GAP} → waiting`
                : "No clear trend"}
            </p>
          </div>
          {signal !== "FLAT" && (
            <div
              className={`w-2 h-2 rounded-full ${
                signal === "LONG" ? "pulse-green bg-chart-green" : "pulse-red bg-chart-red"
              }`}
            />
          )}
        </div>
      </div>

      {/* ── Live Position ── */}
      <LivePosition
        position={position}
        loading={posLoading}
        error={posError}
        lastFetch={posLastFetch}
      />

      {/* ── Chart ── */}
      <div className="card p-4" style={{ height: 480 }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Price + SMA {SMA_FAST} / SMA {SMA_SLOW} · Last {Math.min(chartData.length, 150)} candles
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "8px solid #00C48C" }} />
              Long entry
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "8px solid #FF4D6A" }} />
              Short entry
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ display: "inline-block", width: 8, height: 8, transform: "rotate(45deg)", border: "1.5px solid #9ca3af" }} />
              Exit
            </span>
          </div>
        </div>
        <div style={{ height: 420 }}>
          <PriceChart data={chartData} trades={trades} livePrice={livePrice} />
        </div>
      </div>

      {/* ── Trade Journal ── */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 px-0.5">
          Trade Journal · Live session
        </p>
        <TradeJournal trades={trades} stats={stats} />
      </div>

      {/* ── Bot Logs ── */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 px-0.5">
          Bot Engine · Live Logs
        </p>
        <BotLogs lines={botLogs} connected={botConnected} error={botError} />
      </div>

      {/* ── Bot config row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {[
          { label: "Candles loaded",   value: candleCount || "—", sub: "historical + live" },
          { label: "SMA Fast period",  value: SMA_FAST,           sub: "candles" },
          { label: "SMA Slow period",  value: SMA_SLOW,           sub: "candles" },
          { label: "Take-profit move", value: "$1,000",           sub: "per trade" },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className="text-lg font-bold text-white">{s.value}</p>
            <p className="text-xs text-gray-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <footer className="text-center text-xs text-gray-700 pb-2">
        Live data via Binance Futures WebSocket · Simulated journal · No financial advice
      </footer>
    </div>
  );
}
