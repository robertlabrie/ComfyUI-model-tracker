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
  a system-internal user directory). Writes are atomic (`.tmp` + `os.replace`). `remove(category,
  filename)` drops an entry (called after a successful delete so a re-added file starts at zero
  instead of resurrecting a stale count).

- **`routes.py`** — two endpoints:
  - `GET /model_tracker/stats` merges the live on-disk file list (with size/mtime via `os.stat`) with
    the persisted usage counts, keyed the same way as the store.
  - `POST /model_tracker/delete` takes `{"models": [{"category", "filename"}, ...]}` and permanently
    deletes each file from disk (`os.remove`) plus its usage-store entry, returning a per-item
    `{category, filename, success, error?}` so partial failures are visible. Path safety relies
    entirely on `folder_paths.get_full_path(category, filename)` — it rebases the filename under the
    category's real root and collapses `..` traversal by construction (verified: a `../../../etc/hosts`
    style filename resolves to `None`, not an escape), so there's no separate path-traversal check to
    maintain here. Only deletes a path that both resolves via that function *and* passes
    `os.path.isfile` — an unresolvable request is reported as `"file not found"`, not silently skipped.

- **`web/model_tracker.js`** — two classes:
  - `ModelTrackerPanel` — the actual report: filter box, sort dropdown, refresh, the table, row
    checkboxes + a "Delete Selected" button. `deleteSelected()` confirms via `window.confirm()` (this
    is a permanent disk delete — don't remove that confirmation), POSTs to `/model_tracker/delete`,
    surfaces any per-item failures via `window.alert()`, then always calls `refresh()` afterward so
    the table reflects what's actually left on disk rather than trusting the client-side state.
  - `ModelTrackerModal` — a plain `position:fixed` overlay + centered card, built with vanilla
    `document.createElement` (deliberately **not** a `ComfyDialog` subclass — see the note below on
    why that was tried and reverted). Lazily constructs one `ModelTrackerPanel` into its body on first
    `show()`, and calls `panel.refresh()` on every subsequent `show()` so data is never stale.
    Closes on the ✕ button, clicking the backdrop, or Escape.

  The single entry point is `app.extensionManager.registerSidebarTab(...)`, whose `render()` callback
  just calls `modal.show()` — it does not put the report content into the sidebar panel itself. This
  is deliberate: the sidebar icon is the only reliably-working attach point in this frontend's default
  left-dock layout (see below), but a docked sliding panel was explicitly rejected in favor of a big
  centered dialog, so the icon is used purely as a button that happens to live in that dock.

  Loaded because `__init__.py` sets `WEB_DIRECTORY = "web"`; ComfyUI serves that directory's contents
  directly at `/extensions/ComfyUI-model-tracker/...`, so `scripts/app.js`/`scripts/api.js` imports
  need `../../`.

  **Tried and reverted:** a `ComfyButton` inserted into the top menu via
  `app.menu.settingsGroup.element.before(...)` (mirroring `comfyui-manager.js`'s own toolbar button)
  was added as a second entry point for users on the classic "Legacy" topbar layout. It was removed
  again — this frontend's default layout is the left-dock icon rail (Assets/Nodes/Models/Workflows/
  Apps/Templates), where `app.menu.settingsGroup` doesn't exist, so the button silently never
  attached. Don't re-add it without a real need; the sidebar tab alone covers the layout this addon is
  actually used in.

- **`__init__.py`** — the ComfyUI entry point. `NODE_CLASS_MAPPINGS = {}` — this addon registers no
  actual nodes; it only installs the background hook and HTTP route on import.

## A frontend bug worth remembering

An earlier iteration made the popup a `ComfyDialog` subclass (`scripts/ui.js`) and assumed `super()`
hands you a usable `this.element` for free. It doesn't — every real example in `comfyui-manager`'s
source explicitly builds and assigns `this.element = $el("div.comfy-modal", {...}, [content])` itself
in the constructor. That version called `.classList.add(...)` on `this.element` before ever assigning
it, which threw synchronously inside the constructor — and because dialog construction happened
*before* `registerSidebarTab` in the same `async setup()`, the exception silently aborted the whole
extension and the sidebar icon itself vanished with no error visible anywhere in the server log (this
is a client-side JS exception; check the browser console, not `user/comfyui.log`, for frontend bugs
here). The fix that stuck was to stop using `ComfyDialog` entirely — `ModelTrackerModal` is now plain
`document.createElement`, nothing inherited to get wrong. If a future change reintroduces
`ComfyDialog`, build content first and assign `this.element` explicitly.

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
  file is referenced by two nodes in one submitted graph, it's deduped to a single count via the
  `seen` set in `usage_store.record_usage` — the counter answers "how many workflow runs used this
  model," not "how many node calls."

- **Delete is a real, permanent `os.remove` — the browser `confirm()` in `deleteSelected()` is the
  only guard rail.** There's no trash/undo. This is intentional (the whole point of the tool is
  disk cleanup), but it means: never remove that confirmation dialog, and always re-`refresh()`
  after a delete rather than optimistically updating client-side state, so the table can't drift from
  what's actually on disk.
