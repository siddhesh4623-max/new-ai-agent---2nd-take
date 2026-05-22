from __future__ import annotations

import hmac
import hashlib
import logging
import math
import threading
import time
import requests
from decimal import Decimal
from typing import Dict, Any, List, Optional
from urllib.parse import urlencode

from config import API_KEY, SECRET_KEY, BASE_URL

logger = logging.getLogger("BinanceBroker")


class BinanceFuturesBroker:
    REQUEST_TIMEOUT    = 10
    MAX_RETRIES        = 3
    BACKOFF_BASE       = 0.5
    RECV_WINDOW        = 5000
    TIME_SYNC_INTERVAL = 60.0

    def __init__(self):
        self._local = threading.local()
        self._lock  = threading.RLock()
        self._time_offset_ms: int   = 0
        self._last_time_sync: float = 0.0
        self._symbol_filters: Dict[str, Dict[str, Any]] = {}
        self._sync_time()
        self._load_exchange_info()

    def _session(self) -> requests.Session:
        if not hasattr(self._local, "session"):
            s = requests.Session()
            s.headers.update({"X-MBX-APIKEY": API_KEY})
            self._local.session = s
        return self._local.session

    def _sync_time(self) -> None:
        try:
            r = requests.get(f"{BASE_URL}/fapi/v1/time", timeout=self.REQUEST_TIMEOUT)
            server_ms = r.json()["serverTime"]
            self._time_offset_ms = server_ms - int(time.time() * 1000)
            self._last_time_sync = time.time()
            logger.debug("Time synced | offset=%dms", self._time_offset_ms)
        except Exception as e:
            logger.warning("Time sync failed (using local clock): %s", e)

    def _timestamp(self) -> int:
        if time.time() - self._last_time_sync > self.TIME_SYNC_INTERVAL:
            self._sync_time()
        return int(time.time() * 1000) + self._time_offset_ms

    def _load_exchange_info(self) -> None:
        try:
            data = requests.get(
                f"{BASE_URL}/fapi/v1/exchangeInfo",
                timeout=self.REQUEST_TIMEOUT,
            ).json()
            for s in data.get("symbols", []):
                sym = s.get("symbol")
                if sym:
                    self._symbol_filters[sym] = {
                        f["filterType"]: f for f in s.get("filters", [])
                    }
            logger.info("Exchange info loaded | %d symbols", len(self._symbol_filters))
        except Exception as e:
            logger.warning("Could not load exchange info (will use fallback precision): %s", e)

    def _normalize_qty(self, symbol: str, qty: float) -> float:
        filters = self._symbol_filters.get(symbol, {})
        lot = filters.get("LOT_SIZE")
        if not lot:
            logger.debug("LOT_SIZE filter not found for %s — using fallback 3dp", symbol)
            return round(math.floor(qty * 1000) / 1000, 3)
        step  = float(lot["stepSize"])
        min_q = float(lot["minQty"])
        max_q = float(lot["maxQty"])
        if qty < min_q:
            raise ValueError(f"qty {qty} is below minQty {min_q} for {symbol}")
        if qty > max_q:
            raise ValueError(f"qty {qty} is above maxQty {max_q} for {symbol}")
        precision  = max(0, int(round(-math.log10(step))))
        normalized = math.floor(qty / step) * step
        return round(normalized, precision)

    def _normalize_price(self, symbol: str, price: float) -> float:
        filters = self._symbol_filters.get(symbol, {})
        pf = filters.get("PRICE_FILTER")
        if not pf:
            return round(price, 2)
        tick      = float(pf["tickSize"])
        precision = max(0, int(round(-math.log10(tick))))
        normalized = math.floor(price / tick) * tick
        return round(normalized, precision)

    def _signed(self, method: str, path: str, params: Dict[str, Any]) -> Any:
        params = dict(params)
        params["timestamp"]  = self._timestamp()
        params["recvWindow"] = self.RECV_WINDOW

        query     = urlencode(params)
        signature = hmac.new(
            SECRET_KEY.encode(), query.encode(), hashlib.sha256,
        ).hexdigest()
        url = f"{BASE_URL}{path}?{query}&signature={signature}"

        last_error = None
        for attempt in range(self.MAX_RETRIES):
            try:
                r = self._session().request(method, url, timeout=self.REQUEST_TIMEOUT)

                # Timestamp drift — re-sync and rebuild URL
                if r.status_code == 400:
                    body = r.json() if r.content else {}
                    if body.get("code") == -1021:
                        logger.warning("Timestamp drift — re-syncing clock")
                        self._sync_time()
                        params["timestamp"] = self._timestamp()
                        query     = urlencode(params)
                        signature = hmac.new(
                            SECRET_KEY.encode(), query.encode(), hashlib.sha256
                        ).hexdigest()
                        url = f"{BASE_URL}{path}?{query}&signature={signature}"
                        continue

                # Rate limit
                if r.status_code == 429:
                    retry_after = float(r.headers.get("Retry-After", self.BACKOFF_BASE))
                    logger.warning("Rate limited — sleeping %.1fs", retry_after)
                    time.sleep(retry_after)
                    continue

                r.raise_for_status()
                return r.json()

            except requests.RequestException as e:
                last_error = e
                backoff = self.BACKOFF_BASE * (2 ** attempt)
                logger.warning(
                    "Request failed (attempt %d/%d): %s — retrying in %.1fs",
                    attempt + 1, self.MAX_RETRIES, e, backoff,
                )
                time.sleep(backoff)

        raise RuntimeError(
            f"Binance API error after {self.MAX_RETRIES} retries: {last_error}"
        )

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        qty: float,
        client_order_id: str,
        stop_price: Optional[float] = None,
    ) -> Dict[str, Any]:
        clean_qty = self._normalize_qty(symbol, qty)

        params: Dict[str, Any] = {
            "symbol":           symbol,
            "side":             side,
            "type":             order_type,
            "quantity":         format(Decimal(str(clean_qty)), "f"),
            "newClientOrderId": client_order_id,
        }

        if stop_price is not None:
            clean_stop = self._normalize_price(symbol, stop_price)
            params["stopPrice"]   = format(Decimal(str(clean_stop)), "f")
            # CONTRACT_PRICE works on both testnet and live.
            # MARK_PRICE is NOT supported on testnet — causes 400 errors.
            params["workingType"] = "CONTRACT_PRICE"

        logger.info(
            "BINANCE ORDER | %s %s %s qty=%s stop=%s",
            symbol, side, order_type,
            params["quantity"],
            params.get("stopPrice"),
        )

        return self._signed("POST", "/fapi/v1/order", params)

    def get_balance(self) -> Decimal:
        data = self._signed("GET", "/fapi/v2/account", {})
        for a in data.get("assets", []):
            if a["asset"] == "USDT":
                return Decimal(a["availableBalance"])
        return Decimal("0")

    def get_positions(self, symbol: str) -> List[Dict[str, Any]]:
        data = self._signed("GET", "/fapi/v2/positionRisk", {"symbol": symbol})
        return data if isinstance(data, list) else []
