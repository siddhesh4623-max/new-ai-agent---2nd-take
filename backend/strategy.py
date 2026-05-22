from __future__ import annotations

import logging
import time
import requests
from collections import deque
from typing import Dict, Any, Optional

from config import BASE_URL as _CONFIG_BASE_URL

logger = logging.getLogger("Strategy")

MIN_GAP_ENTRY    = 5.0   # Minimum $ gap to enter a position
TIMEFRAME_SECONDS = 60   # 1m candles (change to 1 for 1s, 900 for 15m)
PRELOAD_CANDLES  = 200   # Historical candles to fetch on startup
BINANCE_BASE_URL = _CONFIG_BASE_URL  # uses testnet or mainnet from config.py

# Kline interval string for Binance API
_TF_MAP = {1: "1s", 60: "1m", 180: "3m", 300: "5m", 900: "15m", 3600: "1h"}
KLINE_INTERVAL = _TF_MAP.get(TIMEFRAME_SECONDS, "1m")


class RuleBasedStrategy:
    """
    SMA 25 / SMA 99 crossover with historical preload.

    On startup: fetches last 200 candles from Binance REST API,
    pre-fills the SMA window, and emits an immediate entry signal
    if the current state has gap >= MIN_GAP_ENTRY.

    No warm-up wait — bot enters a position within seconds of starting.

    When FLAT:        emits signal every candle when gap >= MIN_GAP_ENTRY
    When IN POSITION: only emits on a cross (direction change)
    """

    SMA_FAST = 25
    SMA_SLOW = 99

    def __init__(self, symbol: str = "BTCUSDT"):
        self._symbol = symbol
        self._prices: deque[float] = deque(maxlen=self.SMA_SLOW)

        self._current_candle: int  = 0
        self._current_price: float = 0.0

        self._sma_fast: Optional[float] = None
        self._sma_slow: Optional[float] = None
        self._prev_fast: Optional[float] = None
        self._prev_slow: Optional[float] = None

        self._preloaded = False

        tf_label = KLINE_INTERVAL
        logger.info(
            "Strategy ready | SMA%d / SMA%d | tf=%s | min_gap=$%.2f | "
            "preloading %d candles...",
            self.SMA_FAST, self.SMA_SLOW, tf_label,
            MIN_GAP_ENTRY, PRELOAD_CANDLES,
        )
        self._preload_candles()

    def _preload_candles(self) -> None:
        """Fetch historical closing prices from Binance and pre-fill SMA window."""
        try:
            url = f"{BINANCE_BASE_URL}/fapi/v1/klines"
            params = {
                "symbol": self._symbol,
                "interval": KLINE_INTERVAL,
                "limit": PRELOAD_CANDLES,
            }
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            candles = resp.json()

            # Each candle: [open_time, open, high, low, close, volume, ...]
            # Use close prices of all completed candles (exclude last — still open)
            closes = [float(c[4]) for c in candles[:-1]]

            # Only keep last SMA_SLOW candles (deque maxlen handles overflow)
            for close in closes:
                self._prices.append(close)

            logger.info(
                "PRELOAD COMPLETE | %d candles loaded | "
                "SMA%d ready | SMA%d ready",
                len(closes), self.SMA_FAST, self.SMA_SLOW,
            )
            self._preloaded = True

            # Calculate initial SMA values
            if len(self._prices) >= self.SMA_SLOW:
                prices = list(self._prices)
                self._sma_fast = sum(prices[-self.SMA_FAST:]) / self.SMA_FAST
                self._sma_slow = sum(prices) / self.SMA_SLOW
                gap = abs(self._sma_fast - self._sma_slow)
                direction = "LONG" if self._sma_fast > self._sma_slow else "SHORT"
                logger.info(
                    "INITIAL STATE | %s | SMA%d=%.2f | SMA%d=%.2f | gap=$%.2f",
                    direction,
                    self.SMA_FAST, self._sma_fast,
                    self.SMA_SLOW, self._sma_slow,
                    gap,
                )

        except Exception as e:
            logger.error("PRELOAD FAILED | %s | will warm up from live ticks", e)
            self._preloaded = False

    def evaluate(self, snapshot: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        price = snapshot.get("price")
        if not price or price <= 0:
            return None

        # Fire startup signal immediately on first live tick after preload
        # Don't wait for candle boundary — identify trend and enter now
        if self._preloaded:
            self._preloaded = False
            self._current_candle = int(time.time()) // TIMEFRAME_SECONDS
            self._current_price  = price
            signal = self._startup_signal(snapshot)
            if signal:
                return signal

        now_candle = int(time.time()) // TIMEFRAME_SECONDS

        # New candle — commit last candle's close to SMA window
        if now_candle != self._current_candle:
            if self._current_price > 0:
                self._prices.append(self._current_price)
                signal = self._check(snapshot)
                if signal:
                    return signal
            self._current_candle = now_candle

        self._current_price = price
        return None

    def _startup_signal(self, snapshot: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Emit entry signal immediately after preload if gap is wide enough."""
        if len(self._prices) < self.SMA_SLOW:
            return None

        prices = list(self._prices)
        sma_fast = sum(prices[-self.SMA_FAST:]) / self.SMA_FAST
        sma_slow = sum(prices) / self.SMA_SLOW
        gap      = abs(sma_fast - sma_slow)
        direction = "LONG" if sma_fast > sma_slow else "SHORT"

        in_position = snapshot.get("in_position", False)
        if in_position:
            return None  # already in position — engine handles alignment

        if gap >= MIN_GAP_ENTRY:
            reason = (
                f"startup_entry | SMA{self.SMA_FAST}={sma_fast:.2f} "
                f"{'>' if direction == 'LONG' else '<'} "
                f"SMA{self.SMA_SLOW}={sma_slow:.2f} | gap=${gap:.2f}"
            )
            logger.info("SIGNAL | %-5s | %s", direction, reason)
            return {"direction": direction, "reason": reason, "gap": gap}
        else:
            logger.info(
                "STARTUP | gap=$%.2f < min=$%.2f — waiting for clear signal",
                gap, MIN_GAP_ENTRY,
            )
        return None

    def _check(self, snapshot: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if len(self._prices) < self.SMA_SLOW:
            remaining = self.SMA_SLOW - len(self._prices)
            logger.debug("WARM-UP | %d / %d candles | %d remaining",
                         len(self._prices), self.SMA_SLOW, remaining)
            return None

        self._prev_fast = self._sma_fast
        self._prev_slow = self._sma_slow

        prices = list(self._prices)
        self._sma_fast = sum(prices[-self.SMA_FAST:]) / self.SMA_FAST
        self._sma_slow = sum(prices) / self.SMA_SLOW

        gap       = abs(self._sma_fast - self._sma_slow)
        direction = "LONG" if self._sma_fast > self._sma_slow else "SHORT"

        in_position   = snapshot.get("in_position", False)
        position_side = snapshot.get("position_side")

        # ── FLAT — enter whenever gap is wide enough ──────────
        if not in_position:
            if gap >= MIN_GAP_ENTRY:
                reason = (
                    f"state_entry | SMA{self.SMA_FAST}={self._sma_fast:.2f} "
                    f"{'>' if direction == 'LONG' else '<'} "
                    f"SMA{self.SMA_SLOW}={self._sma_slow:.2f} | gap=${gap:.2f}"
                )
                logger.info("SIGNAL | %-5s | %s", direction, reason)
                return {"direction": direction, "reason": reason, "gap": gap}
            return None

        # ── IN POSITION — only exit on a cross ───────────────
        if self._prev_fast is None or self._prev_slow is None:
            return None

        prev_above = self._prev_fast > self._prev_slow
        curr_above = self._sma_fast  > self._sma_slow

        if prev_above == curr_above:
            return None

        reason = (
            f"{'golden' if direction == 'LONG' else 'death'}_cross | "
            f"SMA{self.SMA_FAST}={self._sma_fast:.2f} "
            f"{'>' if direction == 'LONG' else '<'} "
            f"SMA{self.SMA_SLOW}={self._sma_slow:.2f} | gap=${gap:.2f}"
        )
        logger.info("SIGNAL | %-5s | %s", direction, reason)
        return {"direction": direction, "reason": reason, "gap": gap}
