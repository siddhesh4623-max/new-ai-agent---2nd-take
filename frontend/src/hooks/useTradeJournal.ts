"use client";

import { useEffect, useRef, useState } from "react";
import type { PositionData } from "@/hooks/usePosition";

export interface TradeEntry {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  entryTime: Date;
  entryPrice: number;
  exitTime: Date | null;
  exitPrice: number | null;
  moveUsd: number | null;
  pnlUsdt: number | null;
  exitReason: string | null;
  entryGap: number;
  qty: number;
  status: "OPEN" | "CLOSED";
  unrealisedPnl: number | null;
}

const MIN_GAP = 5.0;
const TAKE_PROFIT_MOVE = 1000.0;

interface Input {
  signal: "LONG" | "SHORT" | "FLAT";
  livePrice: number | null;
  gap: number;
  sma25: number | null;
  sma99: number | null;
  realPosition?: PositionData | null;
}

export function useTradeJournal({
  signal,
  livePrice,
  gap,
  sma25,
  sma99,
  realPosition,
}: Input) {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [stats, setStats] = useState({
    totalTrades: 0,
    openTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    winRate: 0,
  });

  const prevSignalRef = useRef<"LONG" | "SHORT" | "FLAT">("FLAT");
  const tradeCounterRef = useRef<number>(0);
  const openTradeIdRef = useRef<number | null>(null);
  const seededRef = useRef<boolean>(false);
  const historicalLoadedRef = useRef<boolean>(false);

  // ─────────────────────────────────────────────────────────────
  // Load historical trades from CSV
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (historicalLoadedRef.current) return;

    historicalLoadedRef.current = true;

    const loadHistoricalTrades = async () => {
      try {
        const res = await fetch("/api/trades");

        if (!res.ok) {
          throw new Error("Failed to fetch trades");
        }

        const data = await res.json();

        const historicalTrades: any[] = data.trades || [];

        if (historicalTrades.length > 0) {
          const parsed: TradeEntry[] = historicalTrades.map((t: any) => ({
            ...t,

            entryTime:
              typeof t.entryTime === "string"
                ? new Date(t.entryTime)
                : t.entryTime,

            exitTime: t.exitTime
              ? typeof t.exitTime === "string"
                ? new Date(t.exitTime)
                : t.exitTime
              : null,
          }));

          setTrades(parsed);

          // Fix TypeScript error
          const maxId = Math.max(
            ...parsed.map((t: TradeEntry) => t.id),
            0
          );

          tradeCounterRef.current = maxId;
        }
      } catch (err) {
        console.warn("Could not load historical trades:", err);
      }
    };

    loadHistoricalTrades();
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Seed open trade from Binance position
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (seededRef.current) return;
    if (!realPosition) return;

    const amt = realPosition.positionAmt;

    if (Math.abs(amt) < 0.0001) return;

    seededRef.current = true;

    const side: "LONG" | "SHORT" = amt > 0 ? "LONG" : "SHORT";

    tradeCounterRef.current = 1;
    openTradeIdRef.current = 1;
    prevSignalRef.current = side;

    const seedTrade: TradeEntry = {
      id: 1,
      symbol: "BTCUSDT",
      side,
      entryTime: new Date(Date.now() - 60_000),
      entryPrice: realPosition.entryPrice,
      exitTime: null,
      exitPrice: null,
      moveUsd: null,
      pnlUsdt: null,
      exitReason: null,
      entryGap: 0,
      qty: Math.abs(amt),
      status: "OPEN",
      unrealisedPnl: realPosition.unRealizedProfit,
    };

    setTrades([seedTrade]);
  }, [realPosition]);

  // ─────────────────────────────────────────────────────────────
  // Sync live Binance PnL
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!realPosition) return;

    const amt = realPosition.positionAmt;

    setTrades((prev) => {
      const openIdx = prev.findIndex((t) => t.status === "OPEN");

      if (openIdx === -1) return prev;

      const currentTrade = prev[openIdx];

      // Position closed externally
      if (Math.abs(amt) < 0.0001) {
        const pnl = parseFloat(
          realPosition.unRealizedProfit.toFixed(4)
        );

        const updated = [...prev];

        updated[openIdx] = {
          ...currentTrade,
          status: "CLOSED",
          exitTime: new Date(),
          exitPrice: realPosition.markPrice,
          moveUsd:
            currentTrade.side === "LONG"
              ? parseFloat(
                  (
                    realPosition.markPrice -
                    currentTrade.entryPrice
                  ).toFixed(2)
                )
              : parseFloat(
                  (
                    currentTrade.entryPrice -
                    realPosition.markPrice
                  ).toFixed(2)
                ),

          pnlUsdt: pnl,
          exitReason: "closed_externally",
          unrealisedPnl: null,
        };

        openTradeIdRef.current = null;

        return updated;
      }

      // Update live PnL
      const updated = [...prev];

      updated[openIdx] = {
        ...currentTrade,
        qty: Math.abs(amt),
        unrealisedPnl: parseFloat(
          realPosition.unRealizedProfit.toFixed(4)
        ),
      };

      return updated;
    });
  }, [realPosition]);

  // ─────────────────────────────────────────────────────────────
  // Signal-driven trade logic
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (livePrice === null || livePrice <= 0) return;

    const prevSignal = prevSignalRef.current;
    const currSignal = signal;

    setTrades((prev) => {
      let updated = [...prev];

      const openIdx = updated.findIndex(
        (t) => t.status === "OPEN"
      );

      // Take profit fallback
      if (openIdx !== -1 && !realPosition) {
        const trade = updated[openIdx];

        const move =
          trade.side === "LONG"
            ? livePrice - trade.entryPrice
            : trade.entryPrice - livePrice;

        updated[openIdx] = {
          ...trade,
          unrealisedPnl: parseFloat(
            (move * trade.qty).toFixed(4)
          ),
        };

        if (move >= TAKE_PROFIT_MOVE) {
          const pnl = parseFloat(
            (move * trade.qty).toFixed(4)
          );

          updated[openIdx] = {
            ...trade,
            status: "CLOSED",
            exitTime: new Date(),
            exitPrice: livePrice,
            moveUsd: parseFloat(move.toFixed(2)),
            pnlUsdt: pnl,
            exitReason: `take_profit | move=$${move.toFixed(0)}`,
            unrealisedPnl: null,
          };

          openTradeIdRef.current = null;
          prevSignalRef.current = currSignal;

          return updated;
        }
      }

      // No signal change
      if (currSignal === prevSignal) {
        return updated;
      }

      prevSignalRef.current = currSignal;

      const wasInTrade = openIdx !== -1;

      // Close existing trade
      if (wasInTrade) {
        const trade = updated[openIdx];

        const move =
          trade.side === "LONG"
            ? livePrice - trade.entryPrice
            : trade.entryPrice - livePrice;

        const pnl =
          realPosition &&
          Math.abs(realPosition.positionAmt) > 0
            ? parseFloat(
                realPosition.unRealizedProfit.toFixed(4)
              )
            : parseFloat((move * trade.qty).toFixed(4));

        const crossType =
          currSignal === "LONG"
            ? "golden_cross"
            : currSignal === "SHORT"
            ? "death_cross"
            : "signal_flat";

        const reason = `${crossType} | SMA25=${
          sma25?.toFixed(2) ?? "?"
        } SMA99=${sma99?.toFixed(2) ?? "?"}`;

        updated[openIdx] = {
          ...trade,
          status: "CLOSED",
          exitTime: new Date(),
          exitPrice: livePrice,
          moveUsd: parseFloat(move.toFixed(2)),
          pnlUsdt: pnl,
          exitReason: reason,
          unrealisedPnl: null,
        };

        openTradeIdRef.current = null;
      }

      // Open new trade
      if (currSignal !== "FLAT" && gap >= MIN_GAP) {
        tradeCounterRef.current += 1;

        const newId = tradeCounterRef.current;

        const realAmt = realPosition
          ? Math.abs(realPosition.positionAmt)
          : 0;

        const qty =
          realAmt > 0.0001 ? realAmt : 0.007;

        const newTrade: TradeEntry = {
          id: newId,
          symbol: "BTCUSDT",
          side: currSignal,
          entryTime: new Date(),
          entryPrice: livePrice,
          exitTime: null,
          exitPrice: null,
          moveUsd: null,
          pnlUsdt: null,
          exitReason: null,
          entryGap: parseFloat(gap.toFixed(2)),
          qty,
          status: "OPEN",
          unrealisedPnl: 0,
        };

        openTradeIdRef.current = newId;

        updated = [newTrade, ...updated];
      }

      return updated;
    });
  }, [signal, livePrice, gap, sma25, sma99, realPosition]);

  // ─────────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const closed = trades.filter(
      (t) => t.status === "CLOSED"
    );

    const open = trades.filter(
      (t) => t.status === "OPEN"
    );

    const wins = closed.filter(
      (t) => (t.pnlUsdt ?? 0) > 0
    ).length;

    const losses = closed.filter(
      (t) => (t.pnlUsdt ?? 0) <= 0
    ).length;

    const totalPnl = closed.reduce(
      (sum, t) => sum + (t.pnlUsdt ?? 0),
      0
    );

    setStats({
      totalTrades: trades.length,
      openTrades: open.length,
      wins,
      losses,
      totalPnl: parseFloat(totalPnl.toFixed(4)),
      winRate:
        closed.length > 0
          ? Math.round((wins / closed.length) * 100)
          : 0,
    });
  }, [trades]);

  return {
    trades,
    stats,
  };
}
