"use client";

import { useEffect, useRef, useState } from "react";

export interface PositionData {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unRealizedProfit: number;
  liquidationPrice: number;
  leverage: number;
  marginType: string;
  isolatedMargin: number;
  positionSide: string;
  percentage: number;
}

export interface PositionState {
  position: PositionData | null;
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

export function usePosition(intervalMs = 2000): PositionState {
  const [state, setState] = useState<PositionState>({
    position: null,
    loading: true,
    error: null,
    lastFetch: null,
  });

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPosition = async () => {
    try {
      const res = await fetch("/api/position", { cache: "no-store" });
      const json = await res.json();
      if (!mountedRef.current) return;

      if (json.error) {
        setState((s) => ({ ...s, error: json.error, loading: false, lastFetch: new Date() }));
      } else {
        setState({
          position: json.position,
          loading: false,
          error: null,
          lastFetch: new Date(),
        });
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, error: String(e), loading: false, lastFetch: new Date() }));
    } finally {
      if (mountedRef.current) {
        timerRef.current = setTimeout(fetchPosition, intervalMs);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchPosition();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return state;
}
