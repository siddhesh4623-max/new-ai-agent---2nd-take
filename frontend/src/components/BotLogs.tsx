"use client";

import { useEffect, useRef, useState } from "react";
import { LogLine } from "@/hooks/useBotLogs";

interface Props {
  lines: LogLine[];
  connected: boolean;
  error: boolean;
}

function levelColor(level: LogLine["level"], message: string) {
  if (level === "ERROR") return "#FF4D6A";
  if (level === "WARNING") return "#FBBF24";
  if (message.includes("POSITION OPEN")) return "#00C48C";
  if (message.includes("POSITION CLOSED") || message.includes("EXIT")) return "#F97316";
  if (message.includes("SIGNAL")) return "#A78BFA";
  if (message.includes("HEARTBEAT")) return "#374151";
  if (level === "INFO") return "#9ca3af";
  return "#4b5563";
}

function levelBg(level: LogLine["level"], message: string) {
  if (message.includes("POSITION OPEN")) return "rgba(0,196,140,0.07)";
  if (message.includes("POSITION CLOSED") || message.includes("EXIT")) return "rgba(249,115,22,0.07)";
  if (message.includes("SIGNAL")) return "rgba(167,139,250,0.07)";
  if (level === "ERROR") return "rgba(255,77,106,0.08)";
  if (level === "WARNING") return "rgba(251,191,36,0.06)";
  return "transparent";
}

function loggerBadge(logger: string) {
  const colors: Record<string, string> = {
    Engine: "#3b82f6",
    Strategy: "#8b5cf6",
    Main: "#6b7280",
    BinanceBroker: "#f59e0b",
    MarketData: "#10b981",
    ExecAdapter: "#ec4899",
  };
  return colors[logger] ?? "#4b5563";
}

export default function BotLogs({ lines, connected, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "SIGNAL" | "POSITION" | "ERROR">("ALL");

  // Auto-scroll to bottom when new lines come in
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const filtered = lines.filter((l) => {
    if (filter === "ALL") return true;
    if (filter === "SIGNAL") return l.message.includes("SIGNAL");
    if (filter === "POSITION")
      return l.message.includes("POSITION") || l.message.includes("EXIT") || l.message.includes("ENTERING");
    if (filter === "ERROR") return l.level === "ERROR" || l.level === "WARNING";
    return true;
  });

  return (
    <div className="card overflow-hidden flex flex-col" style={{ height: 400 }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              error ? "bg-chart-red" : connected ? "bg-chart-green pulse-green" : "bg-yellow-400"
            }`}
          />
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Live Bot Logs
          </p>
          <span className="text-xs text-gray-700">
            {connected ? "· live" : error ? "· disconnected" : "· connecting"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          {(["ALL", "SIGNAL", "POSITION", "ERROR"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                filter === f
                  ? "bg-gray-700 text-white"
                  : "text-gray-600 hover:text-gray-400"
              }`}
            >
              {f}
            </button>
          ))}
          {/* Auto-scroll indicator */}
          <button
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              autoScroll ? "text-chart-green" : "text-gray-600 hover:text-gray-400"
            }`}
          >
            ↓ live
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto flex-1 font-mono text-xs"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1e2330 transparent" }}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <p>
              {connected
                ? "Bot is starting up — logs will appear here…"
                : error
                ? "Cannot reach bot log API. Is the bot running?"
                : "Connecting to bot logs…"}
            </p>
          </div>
        ) : (
          filtered.map((l) => (
            <div
              key={l.id}
              style={{ background: levelBg(l.level, l.message) }}
              className="flex gap-2 px-3 py-0.5 border-b border-gray-900/50 hover:bg-gray-800/20 items-baseline"
            >
              {/* Time */}
              <span className="text-gray-700 shrink-0 w-16">{l.time}</span>

              {/* Logger badge */}
              {l.logger && (
                <span
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{
                    background: loggerBadge(l.logger) + "22",
                    color: loggerBadge(l.logger),
                  }}
                >
                  {l.logger}
                </span>
              )}

              {/* Message */}
              <span
                style={{ color: levelColor(l.level, l.message) }}
                className="break-all leading-5"
              >
                {l.message || l.raw}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer: line count */}
      <div className="px-4 py-1.5 border-t border-gray-800 shrink-0 flex justify-between">
        <span className="text-xs text-gray-700">{lines.length} lines total</span>
        <span className="text-xs text-gray-700">{filtered.length} shown</span>
      </div>
    </div>
  );
}
