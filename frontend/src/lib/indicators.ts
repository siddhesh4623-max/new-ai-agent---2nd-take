export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: number;
  price: number;
  sma25: number | null;
  sma99: number | null;
  signal: "LONG" | "SHORT" | "FLAT";
  gap: number;
}

export const SMA_FAST = 25;
export const SMA_SLOW = 99;
export const MIN_GAP = 5.0;

export function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function getSignal(
  smaFast: number | null,
  smaSlow: number | null
): { signal: "LONG" | "SHORT" | "FLAT"; gap: number } {
  if (smaFast === null || smaSlow === null) return { signal: "FLAT", gap: 0 };
  const gap = Math.abs(smaFast - smaSlow);
  if (gap < MIN_GAP) return { signal: "FLAT", gap };
  return { signal: smaFast > smaSlow ? "LONG" : "SHORT", gap };
}

export function buildChartData(candles: Candle[]): IndicatorPoint[] {
  const closes = candles.map((c) => c.close);
  return candles.map((c, i) => {
    const slice = closes.slice(0, i + 1);
    const sma25 = calcSMA(slice, SMA_FAST);
    const sma99 = calcSMA(slice, SMA_SLOW);
    const { signal, gap } = getSignal(sma25, sma99);
    return { time: c.time, price: c.close, sma25, sma99, signal, gap };
  });
}
