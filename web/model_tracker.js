import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatLastUsed(lastUsedMs) {
    if (!lastUsedMs) return "Never";
    const diffMs = Date.now() - lastUsedMs;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 30) return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
}

const SORTERS = {
    last_used_asc: (a, b) => (a.last_used || 0) - (b.last_used || 0),
    last_used_desc: (a, b) => (b.last_used || 0) - (a.last_used || 0),
    size_desc: (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0),
    name_asc: (a, b) => a.filename.localeCompare(b.filename),
    uses_asc: (a, b) => (a.total_uses || 0) - (b.total_uses || 0),
    uses_desc: (a, b) => (b.total_uses || 0) - (a.total_uses || 0),
};

function modelKey(model) {
    return `${model.category}|${model.filename}`;
}

class ModelTrackerPanel {
    constructor(container) {
        this.container = container;
        this.models = [];
        this.sortKey = "last_used_asc";
        this.filterText = "";
        this.selected = new Set();
        this.render();
        this.refresh();
    }

    render() {
        this.container.innerHTML = `
            <div class="model-tracker-panel" style="display:flex;flex-direction:column;height:100%;color:var(--fg-color,#ddd);font-size:12px;">
                <div style="display:flex;gap:6px;padding:8px;flex-wrap:wrap;border-bottom:1px solid var(--border-color,#333);">
                    <input type="text" placeholder="Filter models..." class="mt-filter" style="flex:1;min-width:100px;background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:4px;padding:4px 6px;">
                    <select class="mt-sort" style="background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:4px;">
                        <option value="last_used_asc">Least recently used</option>
                        <option value="last_used_desc">Most recently used</option>
                        <option value="uses_asc">Fewest uses</option>
                        <option value="uses_desc">Most uses</option>
                        <option value="size_desc">Largest first</option>
                        <option value="name_asc">Name (A-Z)</option>
                    </select>
                    <button class="mt-refresh" style="background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:4px;padding:4px 8px;cursor:pointer;">Refresh</button>
                    <button class="mt-delete" disabled style="color:#fff;background:#7a2020;border:1px solid #a33;border-radius:4px;padding:4px 10px;cursor:pointer;opacity:0.5;">Delete Selected</button>
                </div>
                <div class="mt-status" style="padding:4px 8px;opacity:0.7;"></div>
                <div class="mt-table-wrap" style="flex:1;overflow:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="position:sticky;top:0;background:var(--comfy-menu-bg,#1a1a1a);text-align:left;">
                                <th style="padding:6px 8px;width:24px;"><input type="checkbox" class="mt-select-all"></th>
                                <th style="padding:6px 8px;">Category</th>
                                <th style="padding:6px 8px;">Filename</th>
                                <th style="padding:6px 8px;">Size</th>
                                <th style="padding:6px 8px;">Last Used</th>
                                <th style="padding:6px 8px;">Uses</th>
                            </tr>
                        </thead>
                        <tbody class="mt-tbody"></tbody>
                    </table>
                </div>
            </div>
        `;

        this.filterInput = this.container.querySelector(".mt-filter");
        this.sortSelect = this.container.querySelector(".mt-sort");
        this.refreshButton = this.container.querySelector(".mt-refresh");
        this.deleteButton = this.container.querySelector(".mt-delete");
        this.selectAllCheckbox = this.container.querySelector(".mt-select-all");
        this.statusEl = this.container.querySelector(".mt-status");
        this.tbody = this.container.querySelector(".mt-tbody");

        this.sortSelect.value = this.sortKey;

        this.filterInput.addEventListener("input", () => {
            this.filterText = this.filterInput.value.toLowerCase();
            this.renderRows();
        });
        this.sortSelect.addEventListener("change", () => {
            this.sortKey = this.sortSelect.value;
            this.renderRows();
        });
        this.refreshButton.addEventListener("click", () => this.refresh());
        this.deleteButton.addEventListener("click", () => this.deleteSelected());
        this.selectAllCheckbox.addEventListener("change", () => {
            for (const cb of this.tbody.querySelectorAll(".mt-row-select")) {
                cb.checked = this.selectAllCheckbox.checked;
                this.toggleSelection(cb.dataset.key, this.selectAllCheckbox.checked);
            }
        });
    }

    async refresh() {
        this.selected.clear();
        this.statusEl.textContent = "Loading...";
        try {
            const response = await api.fetchApi("/model_tracker/stats");
            const data = await response.json();
            this.models = data.models || [];
            this.statusEl.textContent = `${this.models.length} models on disk`;
            this.renderRows();
        } catch (err) {
            console.error("model-tracker: failed to load stats", err);
            this.statusEl.textContent = "Failed to load model usage stats.";
        }
    }

    toggleSelection(key, isSelected) {
        if (isSelected) {
            this.selected.add(key);
        } else {
            this.selected.delete(key);
        }
        this.updateDeleteButton();
    }

    updateDeleteButton() {
        const count = this.selected.size;
        this.deleteButton.disabled = count === 0;
        this.deleteButton.style.opacity = count === 0 ? "0.5" : "1";
        this.deleteButton.textContent = count === 0 ? "Delete Selected" : `Delete Selected (${count})`;
    }

    async deleteSelected() {
        const targets = this.models.filter((model) => this.selected.has(modelKey(model)));
        if (targets.length === 0) return;

        const names = targets.map((m) => m.filename).join("\n");
        const confirmed = window.confirm(
            `Permanently delete ${targets.length} model file(s) from disk?\n\n${names}`
        );
        if (!confirmed) return;

        this.deleteButton.disabled = true;
        this.statusEl.textContent = "Deleting...";
        try {
            const response = await api.fetchApi("/model_tracker/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    models: targets.map((m) => ({ category: m.category, filename: m.filename })),
                }),
            });
            const data = await response.json();
            const results = data.results || [];
            const failed = results.filter((r) => !r.success);
            if (failed.length > 0) {
                console.error("model-tracker: some deletions failed", failed);
                window.alert(
                    `${results.length - failed.length} of ${results.length} deleted. Failures:\n` +
                    failed.map((f) => `${f.filename}: ${f.error}`).join("\n")
                );
            }
        } catch (err) {
            console.error("model-tracker: delete request failed", err);
            window.alert("Delete request failed. See console for details.");
        }

        await this.refresh();
    }

    renderRows() {
        const filterText = this.filterText;
        let rows = this.models.filter((model) => {
            if (!filterText) return true;
            return (
                model.filename.toLowerCase().includes(filterText) ||
                model.category.toLowerCase().includes(filterText)
            );
        });

        const sorter = SORTERS[this.sortKey] || SORTERS.last_used_asc;
        rows = rows.slice().sort(sorter);

        this.selectAllCheckbox.checked = false;
        this.tbody.innerHTML = "";
        for (const model of rows) {
            const key = modelKey(model);
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid var(--border-color,#2a2a2a)";
            tr.innerHTML = `
                <td style="padding:4px 8px;"><input type="checkbox" class="mt-row-select" data-key="${key}" ${this.selected.has(key) ? "checked" : ""}></td>
                <td style="padding:4px 8px;opacity:0.8;">${model.category}</td>
                <td style="padding:4px 8px;word-break:break-all;">${model.filename}</td>
                <td style="padding:4px 8px;white-space:nowrap;">${formatBytes(model.size_bytes)}</td>
                <td style="padding:4px 8px;white-space:nowrap;">${formatLastUsed(model.last_used)}</td>
                <td style="padding:4px 8px;text-align:right;">${model.total_uses}</td>
            `;
            const checkbox = tr.querySelector(".mt-row-select");
            checkbox.addEventListener("change", () => this.toggleSelection(key, checkbox.checked));
            this.tbody.appendChild(tr);
        }
        this.updateDeleteButton();
    }
}

class ModelTrackerModal {
    constructor() {
        this.panel = null;

        this.overlay = document.createElement("div");
        this.overlay.className = "model-tracker-modal-overlay";
        this.overlay.style.cssText =
            "display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;";
        this.overlay.addEventListener("mousedown", (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.card = document.createElement("div");
        this.card.style.cssText =
            "display:flex;flex-direction:column;width:min(1100px,90vw);height:min(750px,85vh);background:var(--comfy-menu-bg,#202020);color:var(--fg-color,#ddd);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.6);overflow:hidden;";

        const header = document.createElement("div");
        header.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border-color,#333);flex:none;";
        header.innerHTML = `<div style="font-size:16px;font-weight:600;">Model Usage</div>`;

        const closeButton = document.createElement("button");
        closeButton.textContent = "✕";
        closeButton.style.cssText =
            "background:transparent;color:var(--fg-color,#ddd);border:none;font-size:16px;cursor:pointer;padding:4px 8px;";
        closeButton.addEventListener("click", () => this.close());
        header.appendChild(closeButton);

        this.body = document.createElement("div");
        this.body.style.cssText = "flex:1;min-height:0;";

        this.card.appendChild(header);
        this.card.appendChild(this.body);
        this.overlay.appendChild(this.card);
        document.body.appendChild(this.overlay);

        this.onKeyDown = (e) => {
            if (e.key === "Escape" && this.overlay.style.display !== "none") this.close();
        };
    }

    show() {
        this.overlay.style.display = "flex";
        document.addEventListener("keydown", this.onKeyDown);
        if (!this.panel) {
            this.panel = new ModelTrackerPanel(this.body);
        } else {
            this.panel.refresh();
        }
    }

    close() {
        this.overlay.style.display = "none";
        document.removeEventListener("keydown", this.onKeyDown);
    }
}

app.registerExtension({
    name: "Comfy.ModelTracker",
    setup() {
        const modal = new ModelTrackerModal();

        app.extensionManager.registerSidebarTab({
            id: "modelTracker",
            title: "Model Usage",
            icon: "pi pi-chart-bar",
            tooltip: "Track which models on disk are actually being used",
            type: "custom",
            render: () => {
                modal.show();
            },
        });
    },
});
