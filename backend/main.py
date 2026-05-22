from __future__ import annotations

import time
import signal
import logging
import sys
import os

from market_data_feed import MarketDataFeed
from binance_broker import BinanceFuturesBroker
from engine import TradingEngine

# ── Logging ──────────────────────────────────────────────────
# Determine log file path: use /tmp/bot.log on Unix, temp folder on Windows
if sys.platform == "win32":
    log_file = os.path.join(os.getenv("TEMP", "C:\\Temp"), "bot.log")
else:
    log_file = "/tmp/bot.log"

# Create formatters and handlers
formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")

# Stream handler (console output)
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(formatter)

# File handler (persistent logs)
file_handler = logging.FileHandler(log_file, mode="a", encoding="utf-8")
file_handler.setFormatter(formatter)

# Root logger configuration
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(stream_handler)
root_logger.addHandler(file_handler)

logger = logging.getLogger("Main")

# ── Shutdown ──────────────────────────────────────────────────
_shutdown = False

def _handle_shutdown(signum, frame):
    global _shutdown
    logger.warning("Shutdown signal received (%s)", signum)
    _shutdown = True

def _handle_sighup(signum, frame):
    """Ignore SIGHUP — allows bot to continue when terminal/session closes."""
    logger.info("SIGHUP received — bot continues running independently")

signal.signal(signal.SIGINT,  _handle_shutdown)
signal.signal(signal.SIGTERM, _handle_shutdown)

# On Unix systems, ignore SIGHUP so bot continues when frontend closes
if sys.platform != "win32":
    signal.signal(signal.SIGHUP, _handle_sighup)

# ── Main ──────────────────────────────────────────────────────
def main() -> None:
    logger.info(
        "Starting Pure SMA Trading System | SMA25/99 | 1s ticks | "
        "fixed_qty=0.007 | min_gap=$5.00"
    )

    feed   = MarketDataFeed(symbol="BTCUSDT", interval="1s")
    broker = BinanceFuturesBroker()
    engine = TradingEngine(symbol="BTCUSDT", feed=feed, broker=broker)

    try:
        engine.start()
        logger.info("Engine started | warm-up ~99 seconds")

        while not _shutdown:
            time.sleep(1.0)

    except Exception:
        logger.exception("Fatal error in main")

    finally:
        logger.info("Shutting down system")
        try:
            engine.stop()
        except Exception:
            pass
        logger.info("Shutdown complete")


if __name__ == "__main__":
    main()
