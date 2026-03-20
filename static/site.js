const form = document.getElementById("impact-form");
const processButton = document.getElementById("process-button");
const resultGrid = document.getElementById("result");
const resultStatus = document.getElementById("result-status");
const resultNote = document.getElementById("result-note");
const resultRe = document.getElementById("result-re");
const resultRegime = document.getElementById("result-regime");
const resultBeta = document.getElementById("result-beta");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleValue = document.getElementById("theme-toggle-value");
const phaseDiagram = document.getElementById("phase-diagram");
const bibtexCopyButton = document.getElementById("bibtex-copy");
const bibtexEntry = document.getElementById("bibtex-entry");

let activeRequestId = 0;
const THEME_STORAGE_KEY = "sl-theme";
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

    if (themeToggleValue) {
        themeToggleValue.textContent = isDarkTheme ? "Dark" : "Light";
    }

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
        return "--";
    }

    return numericValue.toFixed(2);
}

function setResultState(state, note) {
    resultGrid.dataset.state = state;
    resultNote.textContent = note;
}

function resetResultValues() {
    resultRe.textContent = "--";
    resultRegime.textContent = "--";
    resultBeta.textContent = "--";
}

async function copyBibtexEntry() {
    if (!bibtexCopyButton || !bibtexEntry) {
        return;
    }

    const originalLabel = bibtexCopyButton.textContent;

    try {
        await navigator.clipboard.writeText(bibtexEntry.textContent);
        bibtexCopyButton.textContent = "Copied";
    } catch (error) {
        bibtexCopyButton.textContent = "Copy failed";
    }

    window.setTimeout(() => {
        bibtexCopyButton.textContent = originalLabel;
    }, 1600);
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
    resultStatus.textContent = "Calculating...";
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
form.addEventListener("submit", processImpactData);
bibtexCopyButton?.addEventListener("click", copyBibtexEntry);
