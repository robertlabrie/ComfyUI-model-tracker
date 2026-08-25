import logging
from collections import defaultdict

import folder_paths

logger = logging.getLogger(__name__)

EXCLUDED_CATEGORIES = {"custom_nodes", "datasets", "configs"}


def get_trackable_categories():
    return [name for name in folder_paths.folder_names_and_paths if name not in EXCLUDED_CATEGORIES]


def build_model_index():
    """Map every on-disk model filename to the folder_paths categories it appears in."""
    index = defaultdict(set)
    for category in get_trackable_categories():
        try:
            filenames = folder_paths.get_filename_list(category)
        except Exception:
            logger.exception("model-tracker: failed to list files for category '%s'", category)
            continue
        for filename in filenames:
            index[filename].add(category)
    return index
