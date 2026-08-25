import logging

from . import hooks
from . import routes as tracker_routes
from .usage_store import UsageStore

logger = logging.getLogger(__name__)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "web"

_store = UsageStore()
hooks.install(_store)
tracker_routes.install(_store)

logger.info("ComfyUI-model-tracker: usage tracking installed")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
