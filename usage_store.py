import json
import logging
import os
import threading
import time

import folder_paths

logger = logging.getLogger(__name__)

STATS_FILENAME = "usage_stats.json"


class UsageStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._path = os.path.join(folder_paths.get_system_user_directory("model_tracker"), STATS_FILENAME)
        self._data = {"entries": {}}
        self._load()

    @staticmethod
    def _key(category, filename):
        return f"{category}|{filename}"

    def _load(self):
        try:
            if os.path.exists(self._path):
                with open(self._path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
                    self._data = loaded
        except Exception:
            logger.exception("model-tracker: failed to load usage stats from %s", self._path)

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            tmp_path = f"{self._path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
            os.replace(tmp_path, self._path)
        except Exception:
            logger.exception("model-tracker: failed to save usage stats to %s", self._path)

    def record_usage(self, used_models):
        """used_models: iterable of (category, filename) tuples referenced by one submitted prompt."""
        if not used_models:
            return
        now_ms = int(time.time() * 1000)
        with self._lock:
            entries = self._data["entries"]
            seen = set()
            for category, filename in used_models:
                key = self._key(category, filename)
                if key in seen:
                    continue
                seen.add(key)
                entry = entries.setdefault(key, {"total": 0, "last_used": None})
                entry["total"] += 1
                entry["last_used"] = now_ms
            self._save()

    def get_all(self):
        with self._lock:
            return dict(self._data["entries"])
