import logging

from server import PromptServer

from .model_index import build_model_index

logger = logging.getLogger(__name__)


def _extract_used_models(prompt, index):
    used = []
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for value in inputs.values():
            if not isinstance(value, str):
                continue
            categories = index.get(value)
            if categories:
                for category in categories:
                    used.append((category, value))
    return used


def install(store):
    def _on_prompt(json_data):
        try:
            prompt = json_data.get("prompt") if isinstance(json_data, dict) else None
            if isinstance(prompt, dict):
                index = build_model_index()
                used = _extract_used_models(prompt, index)
                if used:
                    store.record_usage(used)
        except Exception:
            logger.exception("model-tracker: failed to process submitted prompt for usage tracking")
        return json_data

    PromptServer.instance.add_on_prompt_handler(_on_prompt)
