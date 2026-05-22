from __future__ import annotations

import json
import logging
import threading
import time
import requests
from enum import Enum
from typing import Dict, Any, Optional

logger = logging.getLogger("AIAgent")


class DecisionMode(str, Enum):
    REGIME   = "regime"
    ENTRY    = "entry"
    POSITION = "position"


class AIAgent:

    def __init__(
        self,
        *,
        model: str = "llama3.1",
        ollama_url: str = "http://localhost:11434",
        timeout: float = 30.0,
        refresh_seconds: float = 5.0,
    ):
        self.model           = model
        self.ollama_url      = ollama_url.rstrip("/")
        self.timeout         = timeout
        self.refresh_seconds = refresh_seconds

        self._lock       = threading.RLock()
        self._latest_ctx = None
        self._cache      = {}
        self._last_run   = {}

        # Direction stability — only flip when confidence >= threshold
        self._last_direction      = None
        self._last_direction_conf = 0.0
        self.MIN_FLIP_CONFIDENCE  = 0.75

        self._ollama_ready       = False
        self._logged_unavailable = False
        self._ollama_ready       = self._check_ollama()

        self._worker = threading.Thread(target=self._run_loop, name="AIWorker", daemon=True)
        self._worker.start()

        logger.info("AI Agent started | async | ollama_ready=%s | model=%s", self._ollama_ready, self.model)

    def decide(self, mode: DecisionMode, ctx: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._latest_ctx = ctx
            cached = self._cache.get(mode)
        if cached:
            return cached
        return self._safe_fallback(mode, "ai_not_ready")

    def _run_loop(self):
        while True:
            try:
                time.sleep(0.5)
                if not self._ollama_ready:
                    self._ollama_ready = self._check_ollama()
                    continue
                with self._lock:
                    ctx = self._latest_ctx
                if not ctx:
                    continue
                for mode in DecisionMode:
                    now = time.monotonic()
                    if now - self._last_run.get(mode, 0) < self.refresh_seconds:
                        continue
                    result = self._call_ai(mode, ctx)
                    with self._lock:
                        self._cache[mode] = result
                        self._last_run[mode] = now
            except Exception:
                logger.exception("AI background loop error")

    def _check_ollama(self) -> bool:
        try:
            resp = requests.get(f"{self.ollama_url}/api/tags", timeout=3)
            resp.raise_for_status()
            models  = [m["name"] for m in resp.json().get("models", [])]
            matches = [m for m in models if m.startswith(self.model)]
            if not matches:
                logger.error("No model matching '%s'. Installed: %s", self.model, models)
                return False
            self.model = matches[0]
            return True
        except Exception:
            if not self._logged_unavailable:
                logger.warning("Ollama not running. AI disabled. Start it with: ollama serve")
                self._logged_unavailable = True
            return False

    def _call_ai(self, mode: DecisionMode, ctx: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = requests.post(
                f"{self.ollama_url}/api/generate",
                json={"model": self.model, "prompt": self._build_prompt(mode, ctx), "stream": False},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            return self._parse_response(mode, raw)
        except Exception as e:
            self._ollama_ready = False
            logger.warning("AI call failed — disabling AI (%s)", e)
            return self._safe_fallback(mode, "ai_offline")

    def _build_prompt(self, mode: DecisionMode, ctx: Dict[str, Any]) -> str:
        price = ctx.get("price")
        bid   = ctx.get("bid")
        ask   = ctx.get("ask")
        mid   = round((bid + ask) / 2, 2) if bid and ask else None
        above = price and mid and price >= mid

        return f"""You are a crypto scalping AI. Assess the SUSTAINED TREND — not micro tick noise.

Market snapshot:
- Price: {price}
- Bid: {bid}  Ask: {ask}  Mid: {mid}
- Price vs mid: {"ABOVE mid (bullish)" if above else "BELOW mid (bearish)"}

Rules:
- LONG only if price has been trending UP for the past minute
- SHORT only if price has been trending DOWN for the past minute
- Choppy or unclear market = confidence below 0.65 and entry_allowed false
- HIGH confidence (0.8+) = clear sustained trend, not a single tick
- Do NOT flip direction unless trend has clearly reversed for several seconds
- Stable consistent signals are better than frequent direction changes

Respond ONLY with raw JSON, no markdown:
{{"entry_allowed": true, "direction": "SHORT", "confidence": 0.82, "reason": "sustained downtrend"}}""".strip()

    def _parse_response(self, mode: DecisionMode, raw: str) -> Dict[str, Any]:
        try:
            cleaned = raw.strip()
            if "```" in cleaned:
                for part in cleaned.split("```"):
                    part = part.strip().lstrip("json").strip()
                    if part.startswith("{"):
                        cleaned = part
                        break
            start = cleaned.find("{")
            end   = cleaned.rfind("}") + 1
            if start != -1 and end > start:
                cleaned = cleaned[start:end]

            data          = json.loads(cleaned)
            confidence    = float(data.get("confidence", 0.0))
            direction     = str(data.get("direction", "NONE")).upper()
            entry_allowed = bool(data.get("entry_allowed", False))
            reason        = str(data.get("reason", ""))

            if direction not in ("LONG", "SHORT", "NONE"):
                direction     = "NONE"
                entry_allowed = False

            # Suppress direction flip if new confidence is too low
            if (self._last_direction is not None
                    and direction not in (self._last_direction, "NONE")
                    and confidence < self.MIN_FLIP_CONFIDENCE):
                logger.debug(
                    "AI flip suppressed | %s->%s conf=%.2f < %.2f — keeping %s",
                    self._last_direction, direction,
                    confidence, self.MIN_FLIP_CONFIDENCE, self._last_direction,
                )
                direction     = self._last_direction
                entry_allowed = self._last_direction_conf >= 0.6

            if direction != "NONE":
                self._last_direction      = direction
                self._last_direction_conf = confidence

            result = {
                "entry_allowed": entry_allowed,
                "direction":     direction,
                "confidence":    confidence,
                "reason":        reason,
            }
            logger.info("AI parsed | mode=%s | dir=%s | conf=%.2f | reason=%s", mode.value, direction, confidence, reason)
            return result

        except Exception as e:
            logger.warning("AI parse failed: %s | raw: %.200s", e, raw)
            return self._safe_fallback(mode, "invalid_json")

    @staticmethod
    def _safe_fallback(mode: DecisionMode, reason: str) -> Dict[str, Any]:
        return {"entry_allowed": False, "direction": "NONE", "confidence": 0.0, "reason": reason}