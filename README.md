# ComfyUI-model-tracker

Yet another model usage addon. This one works by hooking the pipeline event so you don't have to add custom nodes to every workflow. Vibe coded with claude.

## Features

- **Zero workflow changes.** No tracker node to drop into every graph — it hooks prompt submission at the server level, so it works retroactively on every workflow you already have.
- **Sees every model type**, not just checkpoints/LoRAs: anything ComfyUI resolves through `folder_paths` (VAEs, ControlNets, upscale models, CLIP/text encoders, embeddings, and whatever category gets added next) is tracked automatically, including third-party loader nodes from other custom node packs.
- **Usage counts + last-used timestamps** for every model file actually found on disk, not just the ones you remember installing.
- **One-click cleanup.** Select stale models by checkbox and delete them straight from the UI — no need to go hunting through `models/` in a file explorer.
- **No database, no server process.** Just a JSON file next to your other ComfyUI user data.

## How it works

1. A hook installs on `PromptServer`'s prompt-submission handler. Every time you hit Queue Prompt, it looks at the submitted graph and checks every node input against the list of model files ComfyUI knows about.
2. Anything that matches gets a usage counter incremented and its last-used timestamp updated in a small JSON file.
3. A sidebar button opens a report: every model file on disk, cross-referenced with how often (and how recently) it's actually been used.

No model files are read, hashed, or modified to do this — it only looks at filenames already present in the submitted workflow JSON.

## Installation

Drop this folder into `ComfyUI/custom_nodes/` and restart ComfyUI. That's it — no `pip install`, no extra config.

## Usage

Click the chart icon in the ComfyUI sidebar to open the Model Usage dialog.

- **Filter** by filename or category.
- **Sort** by least/most recently used, fewest/most uses, size, or name — least-recently-used first is the default, since that's the list you actually came here for.
- **Select and delete** models you don't need anymore. Deletion is permanent (there's a confirmation prompt, but no undo, no recycle bin) — it removes the file from disk and clears its usage record.

Usage data lives at `ComfyUI/user/__model_tracker/usage_stats.json`. Delete that file if you ever want to reset all counters back to zero; it'll be recreated automatically.

## Limitations

- Counts are based on **prompt submission**, not confirmed execution — a queued workflow that errors out before actually loading a model still counts as a "use." Good enough for a cleanup tool; not a precise execution audit.
- A model fed into a loader node through a reroute/primitive node (instead of typed directly into the widget) won't be detected.
- Textual-inversion embeddings referenced inline in a prompt (`embedding:name`) aren't parsed out of text fields yet.

## Why does this exist

Model folders grow forever and nobody remembers which of the forty checkpoints from last year are actually load-bearing. This answers that question without requiring you to rebuild every workflow with a tracking node bolted on.
