from __future__ import annotations

import csv
import os
import threading
import time
import logging
from datetime import datetime, timezone
from typing import Optional

from market_data_feed import MarketDataFeed
from binance_broker import BinanceFuturesBroker
from strategy import RuleBasedStrategy

logger = logging.getLogger("Engine")

FIXED_QTY        = 0.007
MIN_GAP          = 5.0     # Required gap for entries
TAKE_PROFIT_MOVE = 1000.0  # Close when BTC price moves $1000 in our favor

# Trade journal file path: relative to backend directory or environment override
JOURNAL_FILE = os.getenv("TRADES_CSV_PATH", "trades_journal.csv")
_JOURNAL_HEADERS = [
    "trade_no", "symbol", "side",
    "entry_time", "exit_time", "held_s",
    "entry_price", "exit_price", "move_usd",
    "pnl_usdt", "exit_reason", "entry_gap",
]

def _journal_write(row: dict) -> None:
    """Append one trade row to the CSV journal."""
    file_exists = os.path.isfile(JOURNAL_FILE)
    try:
        with open(JOURNAL_FILE, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=_JOURNAL_HEADERS)
            if not file_exists:
                w.writeheader()
            w.writerow(row)
    except Exception as e:
        logger.warning("JOURNAL WRITE FAILED | %s", e)


class TradingEngine:
    """
    SMA 25/99 crossover engine.

    EXIT conditions (whichever comes first):
      1. TP hit — price moved $1000 in our favor
      2. SMA cross opposite direction (any gap)

    ENTRY conditions:
      - Flat + gap >= $5 → enter in current SMA direction
      - Opposite cross + gap >= $5 → reverse
      - Opposite cross + gap < $5  → close only, stay flat
    """

    def __init__(self, *, symbol, feed, risk_manager=None, broker, ai_agent=None):
        self.symbol = symbol
        self.feed   = feed
        self.broker = broker

        self.strategy = RuleBasedStrategy(symbol=symbol)

        self._running        = False
        self._thread         = threading.Thread(
            target=self._run, name=f"Engine-{symbol}", daemon=True
        )
        self._last_heartbeat = 0.0

        self._in_position          = False
        self._position_side: Optional[str] = None
        self._position_qty         = 0.0
        self._position_entry_price = 0.0
        self._position_entry_time  = 0.0
        self._tp_price             = 0.0
        self._closing              = False  # prevents TP spam on close failure
        self._entry_gap            = 0.0   # gap at entry, for journal
        self._trade_no             = 0     # increments each closed trade

    def start(self):
        if self._running:
            return

        try:
            positions = self.broker.get_positions(self.symbol)
            for p in positions:
                amt = float(p.get("positionAmt", 0))
                if abs(amt) > 0:
                    self._in_position          = True
                    self._position_side        = "LONG" if amt > 0 else "SHORT"
                    self._position_qty         = abs(amt)
                    self._position_entry_price = float(p.get("entryPrice", 0))
                    self._position_entry_time  = time.time()
                    self._tp_price             = self._calc_tp(
                        self._position_side, self._position_entry_price
                    )
                    logger.warning(
                        "STARTUP | Recovered open %s | qty=%.3f | entry=%.2f | TP=%.2f",
                        self._position_side, self._position_qty,
                        self._position_entry_price, self._tp_price,
                    )
        except Exception:
            logger.exception("STARTUP | Position check failed — starting flat")

        try:
            self.feed.start()
        except Exception:
            logger.exception("Failed to start market data feed")

        self._running = True
        self._thread.start()
        logger.info(
            "ENGINE STARTED | %s | fixed_qty=%.3f | min_gap=$%.2f | TP=$%.0f move",
            self.symbol, FIXED_QTY, MIN_GAP, TAKE_PROFIT_MOVE,
        )

    def stop(self):
        self._running = False
        logger.info("ENGINE STOPPED")
        try:
            self.feed.stop()
        except Exception:
            pass

    def _calc_tp(self, side: str, entry: float) -> float:
        return entry + TAKE_PROFIT_MOVE if side == "LONG" else entry - TAKE_PROFIT_MOVE

    def _close_position(self, reason: str, exit_price: float = 0.0) -> bool:
        if not self._in_position:
            return True
        close_side = "SELL" if self._position_side == "LONG" else "BUY"
        held = time.time() - self._position_entry_time
        logger.info(
            "CLOSING | %s | side=%s | qty=%.3f | held=%.1fs",
            reason, close_side, self._position_qty, held,
        )
        try:
            self.broker.place_order(
                symbol=self.symbol,
                side=close_side,
                order_type="MARKET",
                qty=self._position_qty,
                client_order_id=f"CLOSE-{int(time.time())}",
            )
            logger.info("CLOSED | held=%.1fs", held)

            # ── Journal ──────────────────────────────────────
            self._trade_no += 1
            move = (exit_price - self._position_entry_price) if self._position_side == "LONG" \
                   else (self._position_entry_price - exit_price)
            pnl  = round(move * self._position_qty, 4)
            _journal_write({
                "trade_no":    self._trade_no,
                "symbol":      self.symbol,
                "side":        self._position_side,
                "entry_time":  datetime.fromtimestamp(self._position_entry_time, tz=timezone.utc)
                                       .strftime("%Y-%m-%d %H:%M:%S"),
                "exit_time":   datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                "held_s":      round(held, 1),
                "entry_price": self._position_entry_price,
                "exit_price":  exit_price,
                "move_usd":    round(move, 2),
                "pnl_usdt":    pnl,
                "exit_reason": reason,
                "entry_gap":   self._entry_gap,
            })
            logger.info(
                "JOURNAL | trade #%d | %s | move=$%.2f | pnl=$%.4f USDT | reason=%s",
                self._trade_no, self._position_side, move, pnl, reason,
            )
            # ─────────────────────────────────────────────────

            self._in_position          = False
            self._position_side        = None
            self._position_qty         = 0.0
            self._position_entry_price = 0.0
            self._tp_price             = 0.0
            self._entry_gap            = 0.0
            self._closing              = False
            return True
        except Exception as e:
            logger.critical("CLOSE FAILED — position preserved | %s", e)
            self._closing = False
            return False

    def _open_position(self, direction: str, price: float, gap: float) -> None:
        entry_side = "BUY" if direction == "LONG" else "SELL"
        logger.info(
            "ENTERING | %s | qty=%.3f | price=%.2f | gap=$%.2f",
            direction, FIXED_QTY, price, gap,
        )
        order = self.broker.place_order(
            symbol=self.symbol,
            side=entry_side,
            order_type="MARKET",
            qty=FIXED_QTY,
            client_order_id=f"ENG-{int(time.time())}-ENTRY",
        )

        # Use actual fill price from Binance; fall back to feed price
        fill_price = price
        try:
            avg = float((order or {}).get("avgPrice", 0) or 0)
            if avg > 0:
                fill_price = avg
                logger.info(
                    "FILL PRICE | %.2f (feed was %.2f, diff=$%.2f)",
                    fill_price, price, abs(fill_price - price),
                )
            else:
                logger.warning(
                    "avgPrice missing in order response — using feed price %.2f", price
                )
        except Exception:
            logger.warning("Could not parse fill price — using feed price %.2f", price)

        tp = self._calc_tp(direction, fill_price)
        self._in_position          = True
        self._position_side        = direction
        self._position_qty         = FIXED_QTY
        self._position_entry_price = fill_price
        self._position_entry_time  = time.time()
        self._tp_price             = tp
        self._entry_gap            = gap
        logger.info(
            "POSITION OPEN | %s | qty=%.3f | entry=%.2f | TP=%.2f (+$%.0f move)",
            direction, FIXED_QTY, fill_price, tp, TAKE_PROFIT_MOVE,
        )

    def _run(self):
        logger.info("ENGINE LOOP RUNNING")

        while self._running:
            try:
                snapshot = self.feed.get_latest()

                now   = time.time()
                price = snapshot.get("price", 0) if snapshot else 0

                # ── Heartbeat ────────────────────────────────
                if now - self._last_heartbeat >= 5:
                    self._last_heartbeat = now
                    held = now - self._position_entry_time if self._in_position else 0
                    if self._in_position and price > 0:
                        move = (price - self._position_entry_price) if self._position_side == "LONG" \
                               else (self._position_entry_price - price)
                        logger.info(
                            "HEARTBEAT | in_position=%s | side=%s | held=%.0fs | "
                            "move=$%.2f | TP=%.2f",
                            self._in_position, self._position_side, held,
                            move, self._tp_price,
                        )
                    else:
                        logger.info(
                            "HEARTBEAT | in_position=%s | side=%s | held=%.0fs",
                            self._in_position, self._position_side, held,
                        )

                if not snapshot:
                    time.sleep(0.1)
                    continue

                # ── Take Profit check (every tick) ────────────
                if self._in_position and price > 0 and not self._closing:
                    tp_hit = (
                        self._position_side == "LONG"  and price >= self._tp_price or
                        self._position_side == "SHORT" and price <= self._tp_price
                    )
                    if tp_hit:
                        move   = abs(price - self._position_entry_price)
                        profit = round(move * self._position_qty, 4)
                        logger.info(
                            "TAKE PROFIT HIT | %s | entry=%.2f | current=%.2f | "
                            "move=$%.2f | profit=$%.4f USDT",
                            self._position_side, self._position_entry_price,
                            price, move, profit,
                        )
                        self._closing = True
                        self._close_position("take_profit", exit_price=price)
                        time.sleep(0.1)
                        continue

                # ── Strategy signal ───────────────────────────
                snapshot["symbol"]        = self.symbol
                snapshot["in_position"]   = self._in_position
                snapshot["position_side"] = self._position_side

                setup = self.strategy.evaluate(snapshot)
                if setup is None:
                    time.sleep(0.1)
                    continue

                direction = setup["direction"]
                gap       = setup.get("gap", 999)

                logger.info("SIGNAL | %s | %s", direction, setup.get("reason"))

                # Same direction — hold
                if self._in_position and direction == self._position_side:
                    time.sleep(0.1)
                    continue

                # Opposite direction — always close, no gap check
                if self._in_position and direction != self._position_side:
                    closed = self._close_position(f"opposite_cross_{direction}", exit_price=price)
                    if not closed:
                        time.sleep(0.1)
                        continue
                    if gap < MIN_GAP:
                        logger.info(
                            "REVERSAL SKIPPED | gap=$%.2f < min=$%.2f — staying flat",
                            gap, MIN_GAP,
                        )
                        time.sleep(0.1)
                        continue
                    self._open_position(direction, price, gap)
                    time.sleep(0.1)
                    continue

                # Flat — enter if gap wide enough
                if gap < MIN_GAP:
                    logger.info(
                        "ENTRY SKIPPED | %s | gap=$%.2f < min=$%.2f",
                        direction, gap, MIN_GAP,
                    )
                    time.sleep(0.1)
                    continue

                self._open_position(direction, price, gap)
                time.sleep(0.1)

            except Exception:
                logger.exception("ENGINE LOOP ERROR")
                time.sleep(1.0)
