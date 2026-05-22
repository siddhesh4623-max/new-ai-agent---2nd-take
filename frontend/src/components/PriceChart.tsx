"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceDot,
  ReferenceLine,
  CartesianGrid,
  Brush,
} from "recharts";
import { IndicatorPoint } from "@/lib/indicators";
import { TradeEntry } from "@/hooks/useTradeJournal";

interface Props {
  data: IndicatorPoint[];
  trades?: TradeEntry[];
  livePrice?: number | null;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function fmtPrice(v: number) {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function snapTime(data: IndicatorPoint[], ms: number): number {
  let best = data[0].time;
  let bestDiff = Math.abs(data[0].time - ms);
  for (const d of data) {
    const diff = Math.abs(d.time - ms);
    if (diff < bestDiff) { bestDiff = diff; best = d.time; }
  }
  return best;
}

/* ── SVG shapes ─────────────────────────────────────────── */
function LongEntryArrow({ cx = 0, cy = 0, label = "" }) {
  return (
    <g>
      <polygon
        points={`${cx},${cy - 2} ${cx - 7},${cy + 12} ${cx + 7},${cy + 12}`}
        fill="#00C48C" opacity={0.95}
      />
      <text x={cx} y={cy + 23} textAnchor="middle" fill="#00C48C"
        fontSize={9} fontFamily="JetBrains Mono" fontWeight="600">
        {label}
      </text>
    </g>
  );
}

function ShortEntryArrow({ cx = 0, cy = 0, label = "" }) {
  return (
    <g>
      <polygon
        points={`${cx},${cy + 2} ${cx - 7},${cy - 12} ${cx + 7},${cy - 12}`}
        fill="#FF4D6A" opacity={0.95}
      />
      <text x={cx} y={cy - 16} textAnchor="middle" fill="#FF4D6A"
        fontSize={9} fontFamily="JetBrains Mono" fontWeight="600">
        {label}
      </text>
    </g>
  );
}

function ExitMarker({ cx = 0, cy = 0, pnl = 0 }) {
  const color = pnl >= 0 ? "#00C48C" : "#FF4D6A";
  return (
    <g>
      <polygon
        points={`${cx},${cy - 7} ${cx + 7},${cy} ${cx},${cy + 7} ${cx - 7},${cy}`}
        fill="none" stroke={color} strokeWidth={1.5} opacity={0.85}
      />
    </g>
  );
}

function OpenPositionLabel({ viewBox, side }: any) {
  if (!viewBox) return null;
  const { x, y, width } = viewBox;
  const color = side === "LONG" ? "#00C48C" : "#FF4D6A";
  return (
    <g>
      <rect x={x + width - 80} y={y - 10} width={80} height={18}
        fill={color} rx={3} opacity={0.9} />
      <text x={x + width - 40} y={y + 4} textAnchor="middle"
        fill="#000" fontSize={10} fontFamily="JetBrains Mono" fontWeight="700">
        {side} ENTRY
      </text>
    </g>
  );
}

/* ── tooltip ─────────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as IndicatorPoint;
  return (
    <div style={{
      background: "#111318", border: "1px solid #1e2330",
      borderRadius: 8, padding: "8px 12px", fontSize: 11,
      fontFamily: "JetBrains Mono", minWidth: 170,
    }}>
      <div style={{ color: "#6b7280", marginBottom: 4 }}>{fmtTime(label)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: "#9ca3af" }}>Price</span>
        <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{fmtPrice(d.price)}</span>
      </div>
      {d.sma25 != null && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "#FBBF24" }}>SMA 25</span>
          <span style={{ color: "#FBBF24" }}>{fmtPrice(d.sma25)}</span>
        </div>
      )}
      {d.sma99 != null && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "#A78BFA" }}>SMA 99</span>
          <span style={{ color: "#A78BFA" }}>{fmtPrice(d.sma99)}</span>
        </div>
      )}
      {d.sma25 != null && d.sma99 != null && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "#6b7280" }}>Gap</span>
          <span style={{ color: d.signal === "LONG" ? "#00C48C" : d.signal === "SHORT" ? "#FF4D6A" : "#6b7280" }}>
            ${d.gap.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
};

/* ── zoom level configs (Y-axis padding multiplier) ─────── */
const Y_ZOOM_LEVELS = [
  { label: "Tight", pad: 0.03 },
  { label: "Normal", pad: 0.08 },
  { label: "Wide", pad: 0.18 },
  { label: "Full", pad: 0.35 },
];

/* ── main chart ──────────────────────────────────────────── */
export default function PriceChart({ data, trades = [], livePrice }: Props) {
  const [yZoomIdx, setYZoomIdx] = useState(1);
  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null);

  // When data grows, keep end pegged to the latest candle unless user has zoomed
  useEffect(() => {
    if (!data.length) return;
    setBrushIdx((prev) => {
      if (prev === null) return { start: 0, end: data.length - 1 };
      // If end was at the previous last candle, advance it
      return prev;
    });
  }, [data.length]);

  const handleBrushChange = useCallback((e: any) => {
    if (e?.startIndex != null && e?.endIndex != null) {
      setBrushIdx({ start: e.startIndex, end: e.endIndex });
    }
  }, []);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Loading chart data…
      </div>
    );
  }

  // Visible window based on brush
  const brushStart = brushIdx?.start ?? 0;
  const brushEnd = brushIdx?.end ?? data.length - 1;
  const visibleData = data.slice(brushStart, brushEnd + 1);
  const prices = visibleData.map((d) => d.price);
  const minP = Math.min(...prices, ...(livePrice ? [livePrice] : []));
  const maxP = Math.max(...prices, ...(livePrice ? [livePrice] : []));
  const range = Math.max(maxP - minP, 30);
  const padFactor = Y_ZOOM_LEVELS[yZoomIdx].pad;
  const pad = range * padFactor + 10;

  const tickEvery = Math.max(1, Math.floor(visibleData.length / 8));
  const xTicks = visibleData.filter((_, i) => i % tickEvery === 0).map((d) => d.time);

  const yBottom = Math.floor((minP - pad) / 25) * 25;
  const yTop = Math.ceil((maxP + pad) / 25) * 25;
  const step = range < 100 ? 10 : range < 300 ? 25 : 50;
  const yTicks: number[] = [];
  for (let v = yBottom; v <= yTop; v += step) yTicks.push(v);

  const openTrade = trades.find((t) => t.status === "OPEN") ?? null;

  const chartStart = data[0].time;
  const chartEnd = data[data.length - 1].time;

  const markers = trades.flatMap((t) => {
    const items: {
      key: string; x: number; y: number;
      type: "long_entry" | "short_entry" | "exit"; pnl?: number; label?: string;
    }[] = [];

    const entryMs = t.entryTime.getTime();
    if (entryMs >= chartStart - 120_000 && entryMs <= chartEnd + 120_000) {
      items.push({
        key: `entry-${t.id}`, x: snapTime(data, entryMs), y: t.entryPrice,
        type: t.side === "LONG" ? "long_entry" : "short_entry",
        label: `${t.side} #${t.id}`,
      });
    }
    if (t.exitTime && t.exitPrice != null) {
      const exitMs = t.exitTime.getTime();
      if (exitMs >= chartStart - 120_000 && exitMs <= chartEnd + 120_000) {
        items.push({
          key: `exit-${t.id}`, x: snapTime(data, exitMs), y: t.exitPrice,
          type: "exit", pnl: t.pnlUsdt ?? 0,
        });
      }
    }
    return items;
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      {/* ── Y-zoom buttons ─────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
        <span style={{ fontSize: 10, color: "#4b5563", fontFamily: "JetBrains Mono", marginRight: 4 }}>
          Scale:
        </span>
        {Y_ZOOM_LEVELS.map((z, i) => (
          <button
            key={z.label}
            onClick={() => setYZoomIdx(i)}
            style={{
              fontSize: 10,
              fontFamily: "JetBrains Mono",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid",
              borderColor: i === yZoomIdx ? "#6b7280" : "#1e2330",
              background: i === yZoomIdx ? "#1e2330" : "transparent",
              color: i === yZoomIdx ? "#e5e7eb" : "#4b5563",
              cursor: "pointer",
            }}
          >
            {z.label}
          </button>
        ))}
      </div>

      {/* ── chart ──────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 72, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" horizontal vertical={false} />

            <XAxis
              dataKey="time" type="number" scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={xTicks} tickFormatter={fmtTime}
              tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "#1e2330" }} tickLine={{ stroke: "#1e2330" }} height={28}
            />
            <YAxis
              orientation="right" domain={[yBottom, yTop]}
              ticks={yTicks}
              tickFormatter={(v) =>
                `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              }
              tick={{ fill: "#4b5563", fontSize: 10, fontFamily: "JetBrains Mono" }}
              axisLine={false} tickLine={{ stroke: "#1e2330" }} width={72}
            />

            <Tooltip content={<CustomTooltip />} />

            {/* X-axis brush for zoom/pan */}
            {data.length > 1 && (
              <Brush
                dataKey="time"
                startIndex={brushStart}
                endIndex={Math.min(brushEnd, data.length - 1)}
                onChange={handleBrushChange}
                height={20}
                travellerWidth={8}
                stroke="#2d3348"
                fill="#0d0f14"
                tickFormatter={fmtTime}
                style={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
              />
            )}

            <Line
              type="monotone" dataKey="price" stroke="#d1d5db" strokeWidth={1.5}
              dot={false} activeDot={{ r: 3, fill: "#e5e7eb" }}
              connectNulls isAnimationActive={false}
            />
            <Line
              type="monotone" dataKey="sma25" stroke="#FBBF24" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls isAnimationActive={false}
            />
            <Line
              type="monotone" dataKey="sma99" stroke="#A78BFA" strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls isAnimationActive={false}
            />

            {livePrice != null && (
              <ReferenceLine
                y={livePrice} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1}
                label={{
                  value: fmtPrice(livePrice), position: "right",
                  fill: "#9ca3af", fontSize: 10, fontFamily: "JetBrains Mono", dx: 4,
                }}
              />
            )}

            {openTrade && (
              <ReferenceLine
                y={openTrade.entryPrice}
                stroke={openTrade.side === "LONG" ? "#00C48C" : "#FF4D6A"}
                strokeDasharray="6 3" strokeWidth={1.5}
                label={<OpenPositionLabel side={openTrade.side} entryPrice={openTrade.entryPrice} />}
              />
            )}

            {markers.map((m) => (
              <ReferenceDot
                key={m.key} x={m.x} y={m.y} r={0}
                shape={(props: any) => {
                  const { cx, cy } = props;
                  if (m.type === "long_entry") return <LongEntryArrow cx={cx} cy={cy} label={m.label ?? ""} />;
                  if (m.type === "short_entry") return <ShortEntryArrow cx={cx} cy={cy} label={m.label ?? ""} />;
                  return <ExitMarker cx={cx} cy={cy} pnl={m.pnl ?? 0} />;
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
