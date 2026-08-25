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
};

class ModelTrackerPanel {
    constructor(container) {
        this.container = container;
        this.models = [];
        this.sortKey = "last_used_asc";
        this.filterText = "";
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
                        <option value="size_desc">Largest first</option>
                        <option value="name_asc">Name (A-Z)</option>
                    </select>
                    <button class="mt-refresh" style="background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:4px;padding:4px 8px;cursor:pointer;">Refresh</button>
                </div>
                <div class="mt-status" style="padding:4px 8px;opacity:0.7;"></div>
                <div class="mt-table-wrap" style="flex:1;overflow:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="position:sticky;top:0;background:var(--comfy-menu-bg,#1a1a1a);text-align:left;">
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
    }

    async refresh() {
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

        this.tbody.innerHTML = "";
        for (const model of rows) {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid var(--border-color,#2a2a2a)";
            tr.innerHTML = `
                <td style="padding:4px 8px;opacity:0.8;">${model.category}</td>
                <td style="padding:4px 8px;word-break:break-all;">${model.filename}</td>
                <td style="padding:4px 8px;white-space:nowrap;">${formatBytes(model.size_bytes)}</td>
                <td style="padding:4px 8px;white-space:nowrap;">${formatLastUsed(model.last_used)}</td>
                <td style="padding:4px 8px;text-align:right;">${model.total_uses}</td>
            `;
            this.tbody.appendChild(tr);
        }
    }
}

app.registerExtension({
    name: "Comfy.ModelTracker",
    setup() {
        app.extensionManager.registerSidebarTab({
            id: "modelTracker",
            title: "Model Usage",
            icon: "pi pi-chart-bar",
            tooltip: "Track which models on disk are actually being used",
            type: "custom",
            render: (el) => {
                new ModelTrackerPanel(el);
            },
        });
    },
});
