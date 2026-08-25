import logging
import os
import time

from aiohttp import web
from server import PromptServer

import folder_paths

from .model_index import get_trackable_categories

logger = logging.getLogger(__name__)


def install(store):
    routes = PromptServer.instance.routes

    @routes.get("/model_tracker/stats")
    async def get_stats(request):
        usage = store.get_all()
        models = []
        for category in get_trackable_categories():
            try:
                filenames = folder_paths.get_filename_list(category)
            except Exception:
                logger.exception("model-tracker: failed to list files for category '%s'", category)
                continue

            for filename in filenames:
                size_bytes = None
                disk_modified_time = None
                full_path = folder_paths.get_full_path(category, filename)
                if full_path and os.path.isfile(full_path):
                    try:
                        stat = os.stat(full_path)
                        size_bytes = stat.st_size
                        disk_modified_time = stat.st_mtime
                    except OSError:
                        pass

                entry = usage.get(f"{category}|{filename}", {})
                models.append({
                    "category": category,
                    "filename": filename,
                    "size_bytes": size_bytes,
                    "disk_modified_time": disk_modified_time,
                    "total_uses": entry.get("total", 0),
                    "last_used": entry.get("last_used"),
                })

        return web.json_response({
            "models": models,
            "generated_at": int(time.time() * 1000),
        })
