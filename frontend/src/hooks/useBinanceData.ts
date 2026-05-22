"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Candle, buildChartData, IndicatorPoint, calcSMA, getSignal, SMA_FAST, SMA_SLOW } from "@/lib/indicators";

const REST_URL =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=200";
const WS_KLINE_URL =
  "wss://stream.binance.com:9443/ws/btcusdt@kline_1m";
const WS_PRICE_URL =
  "wss://stream.binance.com:9443/ws/btcusdt@aggTrade";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "error";

export interface BinanceState {
  livePrice: number | null;
  priceChange: "up" | "down" | "none";
  sma25: number | null;
  sma99: number | null;
  gap: number;
  signal: "LONG" | "SHORT" | "FLAT";
  chartData: IndicatorPoint[];
  connStatus: ConnStatus;
  lastUpdate: Date | null;
  candleCount: number;
}

export function useBinanceData(): BinanceState {
  const [state, setState] = useState<BinanceState>({
    livePrice: null,
    priceChange: "none",
    sma25: null,
    sma99: null,
    gap: 0,
    signal: "FLAT",
    chartData: [],
    connStatus: "connecting",
    lastUpdate: null,
    candleCount: 0,
  });

  const candlesRef = useRef<Candle[]>([]);
  const prevPriceRef = useRef<number | null>(null);
  const wsKlineRef = useRef<WebSocket | null>(null);
  const wsPriceRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const computeIndicators = useCallback((candles: Candle[]) => {
    const closes = candles.map((c) => c.close);
    const sma25 = calcSMA(closes, SMA_FAST);
    const sma99 = calcSMA(closes, SMA_SLOW);
    const { signal, gap } = getSignal(sma25, sma99);
    return { sma25, sma99, signal, gap };
  }, []);

  const connectWebSockets = useCallback(() => {
    if (!mountedRef.current) return;

    // Kline WebSocket
    const wsK = new WebSocket(WS_KLINE_URL);
    wsKlineRef.current = wsK;

    wsK.onopen = () => {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, connStatus: "connected" }));
    };

    wsK.onmessage = (ev) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(ev.data);
        const k = msg.k;
        if (!k) return;

        const candle: Candle = {
          time: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };

        const candles = candlesRef.current;

        if (k.x) {
          // Candle closed — append
          if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
            candles[candles.length - 1] = candle;
          } else {
            candles.push(candle);
            if (candles.length > 300) candles.shift();
          }
        } else {
          // Update last (open) candle
          if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
            candles[candles.length - 1] = candle;
          }
        }

        const chartData = buildChartData(candles.slice(-150));
        const { sma25, sma99, signal, gap } = computeIndicators(candles);

        setState((s) => ({
          ...s,
          sma25,
          sma99,
          signal,
          gap,
          chartData,
          lastUpdate: new Date(),
          candleCount: candles.length,
        }));
      } catch {}
    };

    wsK.onerror = () => {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, connStatus: "error" }));
    };

    wsK.onclose = () => {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, connStatus: "reconnecting" }));
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connectWebSockets();
      }, 3000);
    };

    // Aggregate trade WebSocket for real-time price
    const wsP = new WebSocket(WS_PRICE_URL);
    wsPriceRef.current = wsP;

    wsP.onmessage = (ev) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(ev.data);
        const price = parseFloat(msg.p);
        if (isNaN(price)) return;

        const prev = prevPriceRef.current;
        const change = prev === null ? "none" : price > prev ? "up" : price < prev ? "down" : "none";
        prevPriceRef.current = price;

        setState((s) => ({ ...s, livePrice: price, priceChange: change }));
      } catch {}
    };
  }, [computeIndicators]);

  useEffect(() => {
    mountedRef.current = true;

    // Preload historical candles
    fetch(REST_URL)
      .then((r) => r.json())
      .then((data: number[][]) => {
        if (!mountedRef.current) return;
        const candles: Candle[] = data.slice(0, -1).map((c) => ({
          time: c[0],
          open: parseFloat(String(c[1])),
          high: parseFloat(String(c[2])),
          low: parseFloat(String(c[3])),
          close: parseFloat(String(c[4])),
          volume: parseFloat(String(c[5])),
        }));
        candlesRef.current = candles;

        const chartData = buildChartData(candles.slice(-150));
        const { sma25, sma99, signal, gap } = computeIndicators(candles);

        setState((s) => ({
          ...s,
          sma25,
          sma99,
          signal,
          gap,
          chartData,
          candleCount: candles.length,
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) connectWebSockets();
      });

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsKlineRef.current?.close();
      wsPriceRef.current?.close();
    };
  }, [connectWebSockets, computeIndicators]);

  return state;
}
