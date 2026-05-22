"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface LogLine {
  id: number;
  raw: string;
  time: string;
  level: "INFO" | "WARNING" | "ERROR" | "DEBUG" | "UNKNOWN";
  logger: string;
  message: string;
}

function parseLine(raw: string, id: number): LogLine {
  // Format: "2026-05-21 06:21:01,926 | INFO | Engine | message..."
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+)\s*\|\s*(INFO|WARNING|ERROR|DEBUG)\s*\|\s*(\w+)\s*\|\s*(.+)$/
  );
  if (match) {
    return {
      id,
      raw,
      time: match[1].split(" ")[1].split(",")[0], // HH:MM:SS
      level: match[2] as LogLine["level"],
      logger: match[3],
      message: match[4],
    };
  }
  return { id, raw, time: "", level: "UNKNOWN", logger: "", message: raw };
}

export function useBotLogs(pollMs = 2000) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);
  const sinceRef = useRef(0);
  const counterRef = useRef(0);
  const mountedRef = useRef(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/logs?since=${sinceRef.current}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();

      if (data.logs?.length > 0) {
        const parsed: LogLine[] = data.logs.map((raw: string) => {
          counterRef.current += 1;
          return parseLine(raw, counterRef.current);
        });

        setLines((prev) => {
          const combined = [...prev, ...parsed];
          // Keep last 300 lines in state
          return combined.slice(-300);
        });

        sinceRef.current = data.total;
      }

      setConnected(true);
      setError(false);
    } catch {
      setError(true);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchLogs();
    const interval = setInterval(() => {
      if (mountedRef.current) fetchLogs();
    }, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchLogs, pollMs]);

  return { lines, connected, error };
}
