from __future__ import annotations

import time
import uuid
import logging
from decimal import Decimal, ROUND_DOWN, getcontext
from dataclasses import dataclass
from typing import Optional

from risk_manager import OrderIntent

logger = logging.getLogger("ExecutionAdapter")
 
# High precision; we explicitly quantize
getcontext().prec = 28


# ============================================================
# EXECUTION RESULT
# ============================================================

@dataclass(frozen=True)
class ExecutionResult:
    status: str                     # FILLED | PARTIAL | REJECTED
    filled_qty: Decimal
    avg_price: Decimal
    slippage_pct: Decimal
    latency_ms: int
    retries: int
    exchange_order_id: Optional[str]


# ============================================================
# EXECUTION ADAPTER
# ============================================================

class ExecutionAdapter:
    """
    Institutional-grade execution adapter.

    - Decimal boundary enforcement
    - Exchange precision compliance
    - Retry-safe & idempotent
    - Partial-fill aware
    """

    def __init__(
        self,
        *,
        broker,
        step_size: str,
        tick_size: str,
        min_qty: str,
        max_retries: int = 3,
        retry_backoff: float = 0.5,
    ):
        self.broker = broker

        self.step_size = Decimal(step_size)
        self.tick_size = Decimal(tick_size)
        self.min_qty = Decimal(min_qty)

        self.max_retries = max_retries
        self.retry_backoff = retry_backoff

    # ========================================================
    # ENTRY
    # ========================================================

    def execute_entry(self, intent: OrderIntent) -> ExecutionResult:
        start = time.monotonic()

        qty = self._quantize_qty(intent.qty)
        expected_price = self._quantize_price(intent.entry_price)

        if qty < self.min_qty:
            return self._reject("qty_below_min", start)

        client_order_id = self._client_order_id(intent)
        retries = 0
        last_error = None

        while retries <= self.max_retries:
            try:
                raw = self.broker.place_order(
                    symbol=intent.symbol,
                    side="BUY" if intent.side == "LONG" else "SELL",
                    order_type="MARKET",
                    qty=qty,
                    client_order_id=client_order_id,
                )

                return self._build_result(
                    raw=raw,
                    expected_price=expected_price,
                    qty=qty,
                    start=start,
                    retries=retries,
                )

            except Exception as e:
                last_error = e
                retries += 1
                time.sleep(self.retry_backoff * (2 ** retries))

        logger.error("ENTRY FAILED | %s", last_error)
        return self._reject("execution_failed", start, retries)

    # ========================================================
    # EXIT
    # ========================================================

    def exit_market(self, position) -> ExecutionResult:
        start = time.monotonic()

        qty = self._quantize_qty(position.qty)
        client_order_id = f"exit-{uuid.uuid4().hex[:12]}"

        try:
            raw = self.broker.place_order(
                symbol=position.symbol,
                side="SELL" if position.side == "LONG" else "BUY",
                order_type="MARKET",
                qty=qty,
                client_order_id=client_order_id,
            )

            return self._build_result(
                raw=raw,
                expected_price=Decimal(str(position.entry_price)),
                qty=qty,
                start=start,
                retries=0,
            )

        except Exception:
            logger.exception("EXIT FAILED")
            return self._reject("exit_failed", start)

    # ========================================================
    # RECONCILIATION
    # ========================================================

    def cancel_all(self, symbol: str) -> None:
        self.broker.cancel_all(symbol)

    def reconcile(self, symbol: str) -> None:
        self.broker.reconcile(symbol)

    # ========================================================
    # DECIMAL HELPERS
    # ========================================================

    def _quantize_qty(self, qty: float) -> Decimal:
        return Decimal(str(qty)).quantize(self.step_size, rounding=ROUND_DOWN)

    def _quantize_price(self, price: float) -> Decimal:
        return Decimal(str(price)).quantize(self.tick_size, rounding=ROUND_DOWN)

    @staticmethod
    def _client_order_id(intent: OrderIntent) -> str:
        base = f"{intent.symbol}-{intent.side}-{intent.created_at.isoformat()}"
        return f"cli-{uuid.uuid5(uuid.NAMESPACE_OID, base)}"

    # ========================================================
    # RESULT BUILDING
    # ========================================================

    def _build_result(
        self,
        *,
        raw: dict,
        expected_price: Decimal,
        qty: Decimal,
        start: float,
        retries: int,
    ) -> ExecutionResult:

        filled_qty = Decimal(str(raw.get("executedQty", "0")))
        avg_price = Decimal(str(raw.get("avgPrice", expected_price)))

        slippage = (
            (avg_price - expected_price) / expected_price
            if expected_price > 0
            else Decimal("0")
        )

        latency_ms = int((time.monotonic() - start) * 1000)

        return ExecutionResult(
            status=raw.get("status", "REJECTED"),
            filled_qty=filled_qty,
            avg_price=avg_price,
            slippage_pct=slippage.copy_abs(),
            latency_ms=latency_ms,
            retries=retries,
            exchange_order_id=str(raw.get("orderId")) if raw.get("orderId") else None,
        )

    def _reject(
        self,
        reason: str,
        start: float,
        retries: int = 0,
    ) -> ExecutionResult:

        latency_ms = int((time.monotonic() - start) * 1000)
        logger.warning("ORDER REJECTED | reason=%s", reason)

        return ExecutionResult(
            status="REJECTED",
            filled_qty=Decimal("0"),
            avg_price=Decimal("0"),
            slippage_pct=Decimal("0"),
            latency_ms=latency_ms,
            retries=retries,
            exchange_order_id=None,
        )
