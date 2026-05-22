from __future__ import annotations

import json
import logging
import time
import threading
from collections import deque
from typing import Optional
import requests

logger = logging.getLogger("AIFilter")

OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "llama3.1:8b"
OLLAMA_TIMEOUT = 1.0   # 1 second — if Ollama doesn't respond instantly, skip it
                        # Previously 20s which caused 20s delay on EVERY trade entry

# ── CryptoPanic free public endpoint — no API key needed ──────
CRYPTOPANIC_URL = (
    "https://cryptopanic.com/api/free/v1/posts/"
    "?auth_token=free&currencies=BTC&filter=important&public=true"
)
NEWS_CACHE_SECONDS = 120   # re-fetch headlines every 2 minutes
NEWS_FETCH_TIMEOUT = 3.0   # also reduced from 5s

# ── Regime filter ─────────────────────────────────────────────
REGIME_WINDOW_SECONDS = 60


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _ask_ollama(prompt: str) -> Optional[str]:
    """
    Send a prompt to Ollama and return the raw text response.

    Timeout is 1 second. If Ollama is not running or too slow,
    this returns None immediately — no blocking, no trade delay.
    """
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model":  OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
            },
            timeout=OLLAMA_TIMEOUT,
        )
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except requests.exceptions.Timeout:
        logger.debug("Ollama timed out (>1s) — skipping filter")
        return None
    except Exception as e:
        logger.debug("Ollama unavailable: %s — skipping filter", e)
        return None


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Ollama response, stripping markdown fences if present."""
    try:
        clean = text.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────
# NEWS FILTER
# ─────────────────────────────────────────────────────────────

class NewsFilter:
    """
    Fetches recent BTC headlines from CryptoPanic every 2 minutes
    and asks Ollama whether the news environment is safe to trade.

    If Ollama doesn't respond within 1 second, allows the trade
    immediately with reason 'ollama_unavailable_allowing_trade'.

    Result is cached so it doesn't slow down every tick.
    """

    def __init__(self):
        self._cache_time: float = 0.0
        self._cache_result: tuple[bool, str] = (True, "no_news_checked_yet")
        self._lock = threading.Lock()
        logger.info("NewsFilter ready | cache=%ds | ollama_timeout=%.0fs",
                    NEWS_CACHE_SECONDS, OLLAMA_TIMEOUT)

    def _fetch_headlines(self) -> list[str]:
        try:
            r = requests.get(CRYPTOPANIC_URL, timeout=NEWS_FETCH_TIMEOUT)
            r.raise_for_status()
            posts = r.json().get("results", [])
            return [p["title"] for p in posts[:5] if "title" in p]
        except Exception as e:
            logger.warning("News fetch failed: %s", e)
            return []

    def _evaluate(self, headlines: list[str], direction: str) -> tuple[bool, str]:
        if not headlines:
            return True, "no_headlines_available"

        headline_text = "\n".join(f"- {h}" for h in headlines)

        prompt = f"""You are a crypto trading risk filter.

Recent BTC news headlines:
{headline_text}

A trading bot wants to open a {direction} position on BTCUSDT right now.

Assess whether the news environment makes this dangerous.
Look for: exchange hacks, regulatory bans, major liquidations,
Fed announcements, war/geopolitical shocks, stablecoin depegs.

Respond ONLY with raw JSON, no markdown:
{{"safe": true, "reason": "no major risk events detected"}}
or
{{"safe": false, "reason": "Fed rate decision imminent — high volatility risk"}}"""

        response = _ask_ollama(prompt)
        if not response:
            return True, "ollama_unavailable_allowing_trade"

        parsed = _parse_json_response(response)
        safe   = bool(parsed.get("safe", True))
        reason = str(parsed.get("reason", response[:80]))
        return safe, reason

    def is_safe_to_trade(self, direction: str) -> tuple[bool, str]:
        with self._lock:
            now = time.time()
            if now - self._cache_time < NEWS_CACHE_SECONDS:
                safe, reason = self._cache_result
                logger.debug("NEWS CACHE | safe=%s | %s", safe, reason)
                return safe, reason

            headlines = self._fetch_headlines()
            safe, reason = self._evaluate(headlines, direction)

            self._cache_time   = now
            self._cache_result = (safe, reason)

            logger.info(
                "NEWS FILTER | safe=%s | headlines=%d | reason=%s",
                safe, len(headlines), reason,
            )
            return safe, reason


# ─────────────────────────────────────────────────────────────
# REGIME FILTER
# ─────────────────────────────────────────────────────────────

class RegimeFilter:
    """
    Tracks the last 60 seconds of prices and asks Ollama to classify
    the market regime as 'trending' or 'choppy'.

    If Ollama doesn't respond within 1 second, allows the trade
    immediately — zero delay on every entry.

    Cache TTL is 15s so Ollama is called at most once per 15 seconds
    even when it is running.
    """

    def __init__(self):
        self._prices: deque[tuple[float, float]] = deque()
        self._lock = threading.Lock()
        self._cache_time: float = 0.0
        self._cache_result: tuple[bool, str] = (True, "warming_up")
        self._cache_ttl = 15.0
        logger.info(
            "RegimeFilter ready | window=%ds | cache=%.0fs | ollama_timeout=%.0fs",
            REGIME_WINDOW_SECONDS, self._cache_ttl, OLLAMA_TIMEOUT,
        )

    def update(self, price: float) -> None:
        now = time.time()
        with self._lock:
            self._prices.append((now, price))
            cutoff = now - REGIME_WINDOW_SECONDS
            while self._prices and self._prices[0][0] < cutoff:
                self._prices.popleft()

    def _evaluate(self, prices: list[float], direction: str) -> tuple[bool, str]:
        if len(prices) < 20:
            return True, "insufficient_data_allowing_trade"

        p_open   = prices[0]
        p_close  = prices[-1]
        p_high   = max(prices)
        p_low    = min(prices)
        move_pct  = (p_close - p_open) / p_open * 100
        range_pct = (p_high - p_low) / p_open * 100

        sampled      = prices[::5]
        price_series = ", ".join(f"{p:.2f}" for p in sampled)

        prompt = f"""You are a market regime classifier for a crypto trading bot.

Last 60 seconds of BTCUSDT prices (sampled every 5s):
{price_series}

Summary:
- Open: {p_open:.2f}
- Close: {p_close:.2f}
- High: {p_high:.2f}
- Low: {p_low:.2f}
- Net move: {move_pct:.3f}%
- Range: {range_pct:.3f}%

The bot wants to open a {direction} position based on an EMA crossover.
EMA crossovers work well in trending markets and poorly in choppy/ranging markets.

Classify the current regime:
- "trending": clear directional move, price progressing consistently one way
- "choppy": price oscillating back and forth without clear direction

Respond ONLY with raw JSON, no markdown:
{{"trending": true, "reason": "clear upward progression over 60s"}}
or
{{"trending": false, "reason": "price oscillating in tight $20 range, no clear direction"}}"""

        response = _ask_ollama(prompt)
        if not response:
            return True, "ollama_unavailable_allowing_trade"

        parsed   = _parse_json_response(response)
        trending = bool(parsed.get("trending", True))
        reason   = str(parsed.get("reason", response[:80]))
        return trending, reason

    def is_trending(self, direction: str) -> tuple[bool, str]:
        with self._lock:
            prices = [p for _, p in self._prices]

        now = time.time()
        if now - self._cache_time < self._cache_ttl:
            trending, reason = self._cache_result
            logger.debug("REGIME CACHE | trending=%s | %s", trending, reason)
            return trending, reason

        trending, reason = self._evaluate(prices, direction)

        self._cache_time   = now
        self._cache_result = (trending, reason)

        logger.info(
            "REGIME FILTER | trending=%s | prices=%d | reason=%s",
            trending, len(prices), reason,
        )
        return trending, reason
