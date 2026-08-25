# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A ComfyUI custom node that tracks model usage without requiring any workflow changes. It hooks the
prompt-submission pipeline, detects which on-disk model files a submitted workflow references, and
records usage counts/timestamps to disk. A sidebar tab in the ComfyUI UI shows all models found on
disk alongside their usage stats, sorted least-recently-used first, to help identify unused files for
cleanup.

There is no build system, package manager, or test suite here (no `package.json`, no `pyproject.toml`,
no `tests/`). This is a plain Python + vanilla-JS ComfyUI extension consumed directly by ComfyUI at
runtime.

## Running / verifying changes

This addon only takes effect when loaded by a real ComfyUI server — there is no standalone entry
point. To pick up changes, restart ComfyUI (it lives in `custom_nodes/`, so it is loaded by
`nodes.init_extra_nodes` on server startup).

For a quick syntax/logic check without a full ComfyUI boot (no GPU/model weights required), run from
the ComfyUI root with its bundled interpreter:

```
python_embeded/python.exe -m py_compile custom_nodes/ComfyUI-model-tracker/*.py
```

To exercise the actual hook end-to-end (this is how the initial implementation was validated), import
`server` from the ComfyUI root, construct a real `server.PromptServer(loop)` (this sets
`PromptServer.instance`), then call `hooks.install(store)` / `routes.install(store)` and feed
`PromptServer.instance.trigger_on_prompt({"prompt": {...}})` a synthetic API-format prompt dict. Delete
any `user/__model_tracker/usage_stats.json` produced by test runs afterward — it is real persisted
state, not a fixture.

## Architecture

Data flow: `hooks.py` (submission-time detection) → `usage_store.py` (persistence) → `routes.py`
(HTTP API) → `web/model_tracker.js` (sidebar UI). `model_index.py` is shared by both the detection
path and the stats API as the source of truth for "what models exist on disk."

- **`model_index.py`** — builds a `{filename: {category, ...}}` map by calling
  `folder_paths.get_filename_list()` for every key in `folder_paths.folder_names_and_paths` (except
  `custom_nodes`/`datasets`/`configs`). This is intentionally *not* a hardcoded list of loader node
  types — new categories ComfyUI adds later are picked up automatically, and it doubles as the "all
  models on disk" data source for the dashboard.

- **`hooks.py`** — registers with `PromptServer.instance.add_on_prompt_handler`, which ComfyUI calls
  synchronously inside the `POST /prompt` route (`server.py`) before the prompt is even validated. The
  handler receives the raw API-format prompt (`node_id -> {class_type, inputs}`), and detects usage by
  **value-matching**: any string in any node's `inputs` that exactly matches a filename in the
  `model_index` is counted as used, regardless of the node's `class_type` or input key name. This is
  what makes detection work for arbitrary/third-party loader nodes without maintaining an allowlist.

- **`usage_store.py`** — JSON persistence keyed by `"{category}|{filename}"`, storing `{total,
  last_used}`. Stored under `folder_paths.get_system_user_directory("model_tracker")` (i.e.
  `ComfyUI/user/__model_tracker/usage_stats.json`) rather than inside this addon's own directory, so
  data survives `git pull`/reinstall of the node and isn't exposed over HTTP (the `__` prefix marks it
  a system-internal user directory). Writes are atomic (`.tmp` + `os.replace`).

- **`routes.py`** — `GET /model_tracker/stats` merges the live on-disk file list (with size/mtime via
  `os.stat`) with the persisted usage counts, keyed the same way as the store.

- **`web/model_tracker.js`** — a `ModelTrackerDialog extends ComfyDialog` (from `scripts/ui.js`) shown
  as a big centered `.comfy-modal` popup, not a docked panel — the first iteration used
  `registerSidebarTab` alone (a panel sliding out from the side), which is what the report itself now
  deliberately avoids. Fetches `/model_tracker/stats` via `api.fetchApi` on each `show()` and renders a
  filterable/sortable table inside the dialog, default sorted least-recently-used first.

  There are **two** entry points registered, because this frontend's default layout is the left-dock
  ("Assets / Nodes / Models / Workflows / Apps / Templates" icon rail), not the classic top menu bar:
  - `registerSidebarTab` — the primary, confirmed-reliable one. It shows up as an icon in that left
    dock; its `render(el)` callback calls `dialog.show()` immediately (plus leaves a manual "Open
    Model Usage" button in the thin sidebar panel as a fallback) so the report itself is always the
    big dialog, never the docked panel content.
  - A `ComfyButton` inserted into the top menu via `app.menu.settingsGroup.element.before(...)`
    (mirroring how `comfyui-manager.js` attaches its own toolbar button) — this is a bonus for anyone
    on the "Legacy" topbar layout, where `app.menu.settingsGroup` actually exists. It's wrapped in a
    guarded `if`, not relied upon, because it silently does nothing in the default left-dock layout
    (confirmed: the button never appeared there). The newer `actionBarButtons` extension field was
    considered instead but also only renders under that same Legacy layout.

  Loaded because `__init__.py` sets `WEB_DIRECTORY = "web"`; ComfyUI serves that directory's contents
  directly at `/extensions/ComfyUI-model-tracker/...`, so `scripts/app.js`/`scripts/api.js`/
  `scripts/ui.js` imports need `../../`.

- **`__init__.py`** — the ComfyUI entry point. `NODE_CLASS_MAPPINGS = {}` — this addon registers no
  actual nodes; it only installs the background hook and HTTP route on import.

## A frontend bug worth remembering

`ComfyDialog` subclasses (`scripts/ui.js`) do **not** get a usable `this.element` for free from
`super()`. Every real example in `comfyui-manager`'s source explicitly builds and assigns
`this.element = $el("div.comfy-modal", {parent: document.body}, [content])` itself in the
constructor. An earlier version of `ModelTrackerDialog` assumed the base class already created
`this.element` and called `.classList.add(...)` on it before ever assigning it — that threw
synchronously inside the dialog's constructor, which ran *before* `registerSidebarTab` in the same
`async setup()`, so the exception silently aborted the whole extension and **both** entry points
(sidebar icon and top-menu button) vanished with no error visible anywhere in the server log (this is
a client-side JS exception; check the browser console, not `user/comfyui.log`, for frontend bugs
here). Fixed by building `content` first and assigning `this.element` explicitly, matching the
pattern every other `ComfyDialog` subclass in this codebase's ecosystem actually uses.

`setup()` now also wraps dialog construction in its own try/catch and keeps registering the sidebar
tab even if it fails (rendering an error message instead) — don't let a bug in the dialog take down
the entry point again.

## Key design decisions (don't relitigate without reason)

- **Hook point is `add_on_prompt_handler`, not `PromptQueue.put` or internal execution functions.**
  `add_on_prompt_handler` is a public, stable extension point. Patching private internals (e.g.
  `execution._map_node_over_list`, as a neighboring installed addon does) is what "actually
  executed" tracking would require, but it's version-fragile — that neighboring addon has to
  branch on ComfyUI's sync/async execution model because the internal function's shape changed
  between versions. This tradeoff means usage here is tracked at **prompt submission**, not
  confirmed execution — a queued-then-interrupted/failed prompt still counts. Acceptable for a
  disk-cleanup/inactivity signal; would need reconsidering for anything requiring execution-accurate
  counts.

- **Detection is value-matching against the on-disk index, not a `class_type` allowlist.** Keeps
  coverage of third-party/community loader nodes automatic, at the cost of missing model filenames
  that reach a loader through a link (e.g. a `PrimitiveNode` feeding the widget) rather than as a
  literal string in `inputs`, and missing `embedding:name` references embedded inside prompt text
  (both are known, currently-unhandled gaps, not oversights).

- **One usage increment per prompt submission per model, not per node instance.** If the same model
  file is referenced by two nodes in one submitted graph, it's deduped to a single count
  (`hooks.py`'s per-submission `seen` set in `usage_store.record_usage`) — the counter answers "how
  many workflow runs used this model," not "how many node calls" — see the `seen` set in
  `usage_store.record_usage`.
