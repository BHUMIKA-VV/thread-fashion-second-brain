"""In-process sliding-window rate limits for sign-up, sign-in and account emails.

Kept in memory: the API runs as one process, and a restart forgetting the counters only
gives an attacker a fresh window, not a bypass. Several API processes would need a shared
store (e.g. Redis) instead.
"""

import math
import threading
import time
from collections import deque


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Too many attempts. Try again later.")
        self.retry_after = retry_after


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> None:
        """Count one attempt for `key`; raise RateLimited if it is over the limit."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                raise RateLimited(max(1, math.ceil(hits[0] + window_seconds - now)))
            hits.append(now)
            if len(self._hits) > 50_000:  # forget idle keys so memory stays bounded
                self._hits = {k: v for k, v in self._hits.items() if v}

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
