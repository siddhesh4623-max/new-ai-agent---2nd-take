from __future__ import annotations

import math
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Dict, Any

logger = logging.getLogger("RiskManager")


@dataclass(frozen=True)
class RiskProfile:
    timeframe: str
    risk_per_trade: float
    max_exposure_pct: float
    stop_model: str                 # "FIXED" | "ATR"
    stop_loss_pct: Optional[float] = None
    atr_multiplier: Optional[float] = None
    reward_risk: float = 2.0


@dataclass(frozen=True)
class OrderIntent:
    symbol: str
    side: str
    qty: float
    entry_price: float
    stop_price: float
    take_profit: float
    created_at: datetime


class RiskManager:
    def __init__(
        self,
        *,
        profile: RiskProfile,
        min_qty: float = 0.001,
        max_leverage: float = 1.0,
        daily_kill_pct: float = 0.05,
    ):
        self.profile = profile
        self.min_qty = min_qty
        self.max_leverage = max_leverage
        self.daily_kill_pct = daily_kill_pct

        self._day_start_balance: Optional[float] = None

    # ====================================================
    # ENTRY
    # ====================================================

    def build_order(
        self,
        *,
        entry_signal: Dict[str, Any],
        ctx: Dict[str, Any],
    ) -> Optional[OrderIntent]:

        side = entry_signal["direction"]
        price = ctx["price"]
        balance = ctx["balance"]
        symbol = ctx["symbol"]

        if self._kill_switch_triggered(balance):
            return None

        stop = self._compute_stop(side, price, ctx)
        if stop is None:
            return None

        qty = self._position_size(balance, price, stop)
        if qty < self.min_qty:
            return None

        tp = self._take_profit(side, price, stop)

        return OrderIntent(
            symbol=symbol,
            side=side,
            qty=qty,
            entry_price=price,
            stop_price=stop,
            take_profit=tp,
            created_at=datetime.now(timezone.utc),
        )

    # ====================================================
    # INTERNAL
    # ====================================================

    def _kill_switch_triggered(self, balance: float) -> bool:
        if self._day_start_balance is None:
            self._day_start_balance = balance
            return False

        drawdown = (self._day_start_balance - balance) / self._day_start_balance
        return drawdown >= self.daily_kill_pct

    def _compute_stop(self, side: str, entry: float, ctx: Dict[str, Any]) -> Optional[float]:
        p = self.profile

        if p.stop_model == "FIXED":
            return entry * (1 - p.stop_loss_pct) if side == "LONG" else entry * (1 + p.stop_loss_pct)

        if p.stop_model == "ATR":
            atr = ctx.get("atr")
            if atr is None:
                return None
            dist = atr * p.atr_multiplier
            return entry - dist if side == "LONG" else entry + dist

        return None

    def _position_size(self, balance: float, entry: float, stop: float) -> float:
        risk_capital = balance * self.profile.risk_per_trade * self.max_leverage
        risk_per_unit = abs(entry - stop)
        if risk_per_unit <= 0:
            return 0.0

        raw_qty = risk_capital / risk_per_unit
        max_qty = (balance * self.profile.max_exposure_pct) / entry
        return self._round_down(min(raw_qty, max_qty), 6)

    @staticmethod
    def _take_profit(side: str, entry: float, stop: float) -> float:
        risk = abs(entry - stop)
        return entry + risk * 2 if side == "LONG" else entry - risk * 2

    @staticmethod
    def _round_down(v: float, p: int) -> float:
        f = 10 ** p
        return math.floor(v * f) / f
