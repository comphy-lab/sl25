const form = document.getElementById("impact-form");
const processButton = document.getElementById("process-button");
const resultGrid = document.getElementById("result");
const resultStatus = document.getElementById("result-status");
const resultNote = document.getElementById("result-note");
const resultRe = document.getElementById("result-re");
const resultRegime = document.getElementById("result-regime");
const resultBeta = document.getElementById("result-beta");
const themeToggle = document.getElementById("theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const phaseDiagram = document.getElementById("phase-diagram");
const bibtexCopyButton = document.getElementById("bibtex-copy");
const bibtexEntry = document.getElementById("bibtex-entry");
const footerYear = document.getElementById("footer-year");

let activeRequestId = 0;
// Shared with the other CoMPhy Lab sites; the old "sl-theme" key is read once
// in the head boot script for visitors who chose a theme before this key.
const THEME_STORAGE_KEY = "comphy-theme";
const EMPTY_VALUE = "–";
const MIN_WEBER_NUMBER = 1;
const MAX_WEBER_NUMBER = 1e3;
const MIN_OHNESORGE_NUMBER = 1e-3;
const MAX_OHNESORGE_NUMBER = 1e2;
const THEORY_RANGE_ERROR = "Theory is valid only for 1 <= We <= 10^3 and 10^-3 <= Oh <= 10^2.";

function isWithinTheoryRange(weberNumber, ohnesorgeNumber) {
    return (
        Number.isFinite(weberNumber) &&
        Number.isFinite(ohnesorgeNumber) &&
        weberNumber >= MIN_WEBER_NUMBER &&
        weberNumber <= MAX_WEBER_NUMBER &&
        ohnesorgeNumber >= MIN_OHNESORGE_NUMBER &&
        ohnesorgeNumber <= MAX_OHNESORGE_NUMBER
    );
}

function updatePhaseDiagram() {
    if (!phaseDiagram) {
        return;
    }

    const params = new URLSearchParams({
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light"
    });
    const weberValue = Number(form?.elements?.weberNumber?.value);
    const ohnesorgeValue = Number(form?.elements?.ohnesorgeNumber?.value);

    if (isWithinTheoryRange(weberValue, ohnesorgeValue)) {
        params.set("weberNumber", String(weberValue));
        params.set("ohnesorgeNumber", String(ohnesorgeValue));
    }

    phaseDiagram.src = `/regime-diagram.svg?${params.toString()}`;
}

function syncThemeColor() {
    if (!themeColorMeta) {
        return;
    }

    const paper = getComputedStyle(document.documentElement).getPropertyValue("--c-paper").trim();
    if (paper) {
        themeColorMeta.setAttribute("content", paper);
    }
}

function applyTheme(theme) {
    const normalizedTheme = theme === "dark" ? "dark" : "light";
    const isDarkTheme = normalizedTheme === "dark";

    document.documentElement.dataset.theme = normalizedTheme;

    if (themeToggle) {
        themeToggle.setAttribute("aria-pressed", String(isDarkTheme));
        themeToggle.setAttribute(
            "aria-label",
            isDarkTheme ? "Switch to light theme" : "Switch to dark theme"
        );
    }

    syncThemeColor();
    updatePhaseDiagram();
}

function saveTheme(theme) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
        // Ignore storage failures and keep the theme for the current session.
    }
}

function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveTheme(nextTheme);
}

function formatNumber(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return EMPTY_VALUE;
    }

    return numericValue.toFixed(2);
}

function setResultState(state, note) {
    resultGrid.dataset.state = state;
    resultNote.textContent = note;
    resultNote.dataset.tone = state === "error" ? "error" : state;
}

function resetResultValues() {
    resultRe.textContent = EMPTY_VALUE;
    resultRegime.textContent = EMPTY_VALUE;
    resultBeta.textContent = EMPTY_VALUE;
}

async function copyText(text) {
    if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
    }
    await navigator.clipboard.writeText(text);
}

async function copyBibtexEntry() {
    if (!bibtexCopyButton || !bibtexEntry) {
        return;
    }

    const originalLabel = bibtexCopyButton.textContent;

    try {
        await copyText(bibtexEntry.textContent);
        bibtexCopyButton.textContent = "Copied";
    } catch (error) {
        bibtexCopyButton.textContent = "Copy failed";
    }

    window.setTimeout(() => {
        bibtexCopyButton.textContent = originalLabel;
    }, 1600);
}

function bindCopyable(element) {
    async function copyValue() {
        try {
            await copyText(element.textContent.trim());
            element.dataset.copied = "true";
            window.setTimeout(() => {
                delete element.dataset.copied;
            }, 600);
        } catch (error) {
            // Leave the value in place; the user can still select it manually.
        }
    }

    element.addEventListener("click", copyValue);
    element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            copyValue();
        }
    });
}

async function processImpactData(event) {
    event.preventDefault();

    const formData = new FormData(form);
    const weberNumber = Number(formData.get("weberNumber"));
    const ohnesorgeNumber = Number(formData.get("ohnesorgeNumber"));

    if (!Number.isFinite(weberNumber) || !Number.isFinite(ohnesorgeNumber) || weberNumber <= 0 || ohnesorgeNumber <= 0) {
        resultStatus.textContent = "Check the inputs.";
        setResultState("error", "Enter positive numeric values for both Weber and Ohnesorge numbers.");
        resetResultValues();
        return;
    }

    if (!isWithinTheoryRange(weberNumber, ohnesorgeNumber)) {
        resultStatus.textContent = "Outside theory range.";
        setResultState("error", THEORY_RANGE_ERROR);
        resetResultValues();
        updatePhaseDiagram();
        return;
    }

    const requestId = ++activeRequestId;
    const payload = JSON.stringify({ weberNumber, ohnesorgeNumber });

    processButton.disabled = true;
    resultStatus.textContent = "Calculating…";
    setResultState("loading", "Fetching the Reynolds number, regime, and predicted spreading.");

    try {
        const [reynoldsResponse, regimeResponse] = await Promise.all([
            fetch("/add", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: payload
            }),
            fetch("/regime", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: payload
            })
        ]);

        const [reynoldsResult, regimeResult] = await Promise.all([
            reynoldsResponse.json(),
            regimeResponse.json()
        ]);

        if (requestId !== activeRequestId) {
            return;
        }

        if (!reynoldsResponse.ok) {
            throw new Error(reynoldsResult.error || "Unable to calculate Reynolds number.");
        }

        if (!regimeResponse.ok) {
            throw new Error(regimeResult.error || "Unable to determine the impact regime.");
        }

        resultRe.textContent = formatNumber(reynoldsResult.result);
        resultRegime.textContent = regimeResult.regime;
        resultBeta.textContent = formatNumber(regimeResult.predBeta);
        resultStatus.textContent = "Computation complete.";
        setResultState("success", "Rounded to two decimals using the current SL theory model and regime classification.");
        updatePhaseDiagram();
    } catch (error) {
        if (requestId !== activeRequestId) {
            return;
        }

        resultStatus.textContent = "Calculation failed.";
        resetResultValues();
        setResultState("error", error.message);
        updatePhaseDiagram();
    } finally {
        if (requestId === activeRequestId) {
            processButton.disabled = false;
        }
    }
}

applyTheme(document.documentElement.dataset.theme);
themeToggle?.addEventListener("click", toggleTheme);
form?.elements?.weberNumber?.addEventListener("input", updatePhaseDiagram);
form?.elements?.ohnesorgeNumber?.addEventListener("input", updatePhaseDiagram);
form?.addEventListener("submit", processImpactData);
bibtexCopyButton?.addEventListener("click", copyBibtexEntry);
document.querySelectorAll(".copyable").forEach(bindCopyable);

if (footerYear) {
    footerYear.textContent = String(new Date().getFullYear());
}

// ── Batch CSV upload ────────────────────────────────────────────────

(function () {
    const batchForm    = document.getElementById("batch-form");
    const batchBtn     = document.getElementById("batch-button");
    const statusEl     = document.getElementById("batch-status");
    const previewWrap  = document.getElementById("batch-preview-wrap");
    const previewTable = document.getElementById("batch-preview-table");
    const dlBtn        = document.getElementById("batch-download-btn");

    if (!batchForm) return;

    let lastBlobUrl = null;

    function setStatus(msg, state) {
        statusEl.textContent = msg;
        statusEl.dataset.state = state || "";
    }

    batchForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const fileInput = batchForm.elements["file"];
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            setStatus("Select a CSV file first.", "err");
            return;
        }

        const file = fileInput.files[0];
        if (!file.name.toLowerCase().endsWith(".csv")) {
            setStatus("File must be a .csv", "err");
            return;
        }

        batchBtn.disabled = true;
        previewWrap.hidden = true;
        setStatus("Uploading…", "");

        const formData = new FormData();
        formData.append("file", file);

        try {
            const resp = await fetch("/batch", { method: "POST", body: formData });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({ error: resp.statusText }));
                throw new Error(body.error || resp.statusText);
            }

            const csvText = await resp.text();
            const rowErrors = resp.headers.get("X-Row-Errors");

            // Build blob for download
            if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
            const blob = new Blob([csvText], { type: "text/csv" });
            lastBlobUrl = URL.createObjectURL(blob);

            dlBtn.onclick = function () {
                const a = document.createElement("a");
                a.href = lastBlobUrl;
                a.download = "SLtheory_results.csv";
                a.click();
            };

            renderBatchPreview(csvText, previewTable);
            previewWrap.hidden = false;

            const msg = rowErrors
                ? "Done. Some rows were outside the theory range or could not be parsed; see the CSV."
                : "Done. β filled in for all rows.";
            setStatus(msg, rowErrors ? "err" : "ok");
        } catch (err) {
            setStatus("Error: " + err.message, "err");
        } finally {
            batchBtn.disabled = false;
        }
    });

    function renderBatchPreview(csvText, table) {
        table.innerHTML = "";
        const parsedRows = parseCSV(csvText);

        if (parsedRows.length === 0) {
            return;
        }

        const header = parsedRows[0];
        const rows = parsedRows.slice(1, 11);

        const thead = table.createTHead();
        const hrow  = thead.insertRow();
        header.forEach(function (h) {
            const th = document.createElement("th");
            th.scope = "col";
            th.textContent = h;
            hrow.appendChild(th);
        });

        const betaIdx = header.indexOf("beta");
        const tbody   = table.createTBody();
        rows.forEach(function (cols) {
            const tr = tbody.insertRow();
            cols.forEach(function (val, i) {
                const td = tr.insertCell();
                td.textContent = val;
                if (i === betaIdx) {
                    td.className = val === "error" ? "error-val" : "beta-col";
                }
            });
        });

        if (parsedRows.length - 1 > 10) {
            const tr = tbody.insertRow();
            const td = tr.insertCell();
            td.colSpan  = header.length;
            td.className = "more-rows";
            td.textContent = "… " + (parsedRows.length - 11) + " more rows (download to see all)";
        }
    }

    function parseCSV(csvText) {
        const rows = [];
        let row = [];
        let cell = "";
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (ch === '"') {
                if (inQuotes && csvText[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === "," && !inQuotes) {
                row.push(cell);
                cell = "";
            } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
                if (ch === "\r" && csvText[i + 1] === "\n") {
                    i++;
                }
                row.push(cell);
                rows.push(row);
                row = [];
                cell = "";
            } else {
                cell += ch;
            }
        }

        if (inQuotes) {
            throw new Error("Preview could not be rendered because the CSV output is malformed.");
        }

        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }

        const lastRow = rows[rows.length - 1];
        if (lastRow && lastRow.length === 1 && lastRow[0] === "") {
            rows.pop();
        }

        return rows;
    }
}());
