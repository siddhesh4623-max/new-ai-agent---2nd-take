from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from collections import deque

import websockets

# ============================================================
# CONFIG
# ============================================================

BINANCE_WS = "wss://fstream.binance.com/stream"
HEALTH_TIMEOUT = 5.0
RECONNECT_DELAY = 2.0

logger = logging.getLogger("MarketData")

# ============================================================
# MARKET DATA FEED
# ============================================================

class MarketDataFeed:
    """
    WebSocket-only Binance Futures Market Data Feed
    - Atomic snapshot (price + bid + ask from WS)
    - Heartbeat-safe
    - Production hardened

    The constructor intentionally mirrors older interfaces that allowed
    specifying a candle `interval` for kline data and a `preload` count of
    historical bars.  In this lightweight implementation those parameters
    are currently unused, but they are accepted for API compatibility and
    stored on the instance for future use or debugging.
    """

    def __init__(self, *, symbol: str, interval: Optional[str] = None, preload: int = 0):
        # users frequently pass `interval`/`preload` from configuration; accept
        # them even though the current feed only streams trades and book
        # tickers.  The values are stored for inspection or later extensions.
        self.symbol = symbol.upper()
        self.interval = interval
        self.preload = preload

        # Shared state
        self._latest: Dict[str, Any] = {}
        self._lock = threading.RLock()

        # Runtime
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._last_update: float = 0.0

        # Buffers
        self._trade_price: Optional[float] = None
        self._bid: Optional[float] = None
        self._ask: Optional[float] = None

    # ========================================================
    # LIFECYCLE
    # ========================================================

    def start(self) -> None:
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._run_thread,
            name=f"MarketDataFeed-{self.symbol}",
            daemon=True,
        )
        self._thread.start()

        logger.info("MarketDataFeed started | %s", self.symbol)

    def stop(self) -> None:
        self._running = False
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)

    def is_healthy(self) -> bool:
        return (time.time() - self._last_update) < HEALTH_TIMEOUT

    # ========================================================
    # THREAD / EVENT LOOP
    # ========================================================

    def _run_thread(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        try:
            self._loop.run_until_complete(self._ws_loop())
        except Exception as e:
            logger.exception("MarketData loop crashed | %s", e)
        finally:
            self._loop.close()

    # ========================================================
    # WEBSOCKET LOOP
    # ========================================================

    async def _ws_loop(self) -> None:
        streams = [
            f"{self.symbol.lower()}@trade",
            f"{self.symbol.lower()}@bookTicker",
        ]
        url = f"{BINANCE_WS}?streams={'/'.join(streams)}"

        while self._running:
            try:
                async with websockets.connect(
                    url,
                    ping_interval=20,
                    ping_timeout=10,
                    max_queue=1000,
                ) as ws:
                    logger.info("WS connected | %s", url)

                    async for raw in ws:
                        if not self._running:
                            return

                        msg = json.loads(raw)
                        payload = msg.get("data")
                        if payload:
                            self._handle_payload(payload)

            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning("WS error (%s) — reconnecting", e)
                await asyncio.sleep(RECONNECT_DELAY)

    # ========================================================
    # MESSAGE HANDLER (ATOMIC)
    # ========================================================

    def _handle_payload(self, payload: Dict[str, Any]) -> None:
        etype = payload.get("e")
        now = datetime.now(timezone.utc)

        with self._lock:
            if etype == "trade":
                self._trade_price = float(payload["p"])

            elif etype == "bookTicker":
                self._bid = float(payload["b"])
                self._ask = float(payload["a"])

            # Build snapshot ONLY when all components exist
            if (
                self._trade_price is not None
                and self._bid is not None
                and self._ask is not None
                and self._bid < self._ask
            ):
                self._latest = {
                    "symbol": self.symbol,
                    "price": self._trade_price,
                    "bid": self._bid,
                    "ask": self._ask,
                    "timestamp": now,
                }
                self._last_update = time.time()

    # ========================================================
    # PUBLIC API
    # ========================================================

    def get_latest(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            if not self._latest:
                return None
            return dict(self._latest)

# ============================================================
# MANUAL TEST
# ============================================================

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    )

    feed = MarketDataFeed(symbol="BTCUSDT")
    feed.start()

    try:
        while True:
            snap = feed.get_latest()
            print("SNAPSHOT:", snap, "| healthy =", feed.is_healthy())
            time.sleep(1)
    except KeyboardInterrupt:
        feed.stop()
        print("Stopped")
