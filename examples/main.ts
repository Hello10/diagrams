import { parse, render } from "../src/api.ts";
import classSource from "./diagrams/class.txt?raw";
import flowchartSource from "./diagrams/flowchart.txt?raw";
import sequenceSource from "./diagrams/sequence.txt?raw";
import stateSource from "./diagrams/state.txt?raw";
import uiSource from "./diagrams/ui.txt?raw";

const EXAMPLES: Record<string, string> = {
	ui: uiSource,
	flowchart: flowchartSource,
	sequence: sequenceSource,
	state: stateSource,
	class: classSource,
};

const SOURCE_WIDTH_KEY = "diagrams-examples:source-width";

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const preview = document.getElementById("preview") as HTMLDivElement;
const errorBox = document.getElementById("error") as HTMLDivElement;
const exampleSelector = document.getElementById(
	"example-selector",
) as HTMLSelectElement;
const columns = document.getElementById("columns") as HTMLDivElement;
const colSource = document.getElementById("col-source") as HTMLDivElement;
const resizer = document.getElementById("resizer") as HTMLDivElement;
const zoomOut = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomIn = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomReset = document.getElementById("zoom-reset") as HTMLButtonElement;
const zoomFit = document.getElementById("zoom-fit") as HTMLButtonElement;
const zoomLevel = document.getElementById("zoom-level") as HTMLOutputElement;

let currentExample = "ui";

// ─── Zoom ────────────────────────────────────────────────────────────────────

const ZOOM_KEY = "diagrams-examples:zoom";
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
let zoom = 1;

/** Scale every SVG in the preview by setting its width; the viewBox keeps
 * the drawing proportional and the pane scrolls as needed. */
function applyZoom(): void {
	for (const svg of preview.querySelectorAll("svg")) {
		const box = svg.viewBox.baseVal;
		if (!box || box.width === 0) continue;
		svg.setAttribute("width", `${Math.round(box.width * zoom)}`);
		svg.setAttribute("height", `${Math.round(box.height * zoom)}`);
	}
	zoomLevel.value = `${Math.round(zoom * 100)}%`;
	try {
		localStorage.setItem(ZOOM_KEY, String(zoom));
	} catch {}
}

function setZoom(next: number): void {
	zoom = Math.min(4, Math.max(0.1, next));
	applyZoom();
}

function stepZoom(direction: 1 | -1): void {
	const sorted = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
	const next = sorted.find((z) =>
		direction > 0 ? z > zoom + 0.001 : z < zoom - 0.001,
	);
	setZoom(next ?? zoom);
}

function fitZoom(): void {
	const widest = Math.max(
		0,
		...[...preview.querySelectorAll("svg")].map(
			(svg) => svg.viewBox.baseVal.width,
		),
	);
	if (widest === 0) return;
	const available = preview.clientWidth - 48;
	setZoom(available / widest);
}

function restoreZoom(): void {
	try {
		const raw = localStorage.getItem(ZOOM_KEY);
		const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
		if (Number.isFinite(parsed) && parsed > 0) zoom = parsed;
	} catch {}
}

zoomOut.addEventListener("click", () => stepZoom(-1));
zoomIn.addEventListener("click", () => stepZoom(1));
zoomReset.addEventListener("click", () => setZoom(1));
zoomFit.addEventListener("click", fitZoom);
preview.addEventListener(
	"wheel",
	(e) => {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
	},
	{ passive: false },
);
window.addEventListener("keydown", (e) => {
	if (!(e.ctrlKey || e.metaKey) || document.activeElement === editor) return;
	if (e.key === "=" || e.key === "+") {
		e.preventDefault();
		stepZoom(1);
	} else if (e.key === "-") {
		e.preventDefault();
		stepZoom(-1);
	} else if (e.key === "0") {
		e.preventDefault();
		setZoom(1);
	}
});

// ─── Active example persistence via URL hash ─────────────────────────────────

function readExampleFromUrl(): string | null {
	const hash = window.location.hash.replace(/^#/, "");
	if (hash && hash in EXAMPLES) return hash;
	return null;
}

function writeExampleToUrl(key: string): void {
	const target = `#${key}`;
	if (window.location.hash !== target) {
		history.replaceState(null, "", target);
	}
}

// ─── Source-panel width persistence ──────────────────────────────────────────

function applyStoredSourceWidth(): void {
	const raw = localStorage.getItem(SOURCE_WIDTH_KEY);
	if (!raw) return;
	const px = Number.parseInt(raw, 10);
	if (!Number.isFinite(px) || px < 200) return;
	colSource.style.width = `${px}px`;
}

function attachResizer(): void {
	let dragging = false;
	resizer.addEventListener("mousedown", (e) => {
		dragging = true;
		document.body.classList.add("resizing");
		resizer.classList.add("dragging");
		e.preventDefault();
	});
	window.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		const rect = columns.getBoundingClientRect();
		const next = Math.max(
			200,
			Math.min(rect.width - 240, e.clientX - rect.left),
		);
		colSource.style.width = `${next}px`;
	});
	window.addEventListener("mouseup", () => {
		if (!dragging) return;
		dragging = false;
		document.body.classList.remove("resizing");
		resizer.classList.remove("dragging");
		const px = colSource.getBoundingClientRect().width;
		localStorage.setItem(SOURCE_WIDTH_KEY, String(Math.round(px)));
	});
}

// ─── Loading examples ────────────────────────────────────────────────────────

function loadExample(key: string) {
	if (!(key in EXAMPLES)) return;
	currentExample = key;
	exampleSelector.value = key;
	editor.value = EXAMPLES[key] || "";
	writeExampleToUrl(key);
	updatePreview();
}

function showError(message: string) {
	errorBox.textContent = message;
	errorBox.style.display = "block";
}
function clearError() {
	errorBox.style.display = "none";
	errorBox.textContent = "";
}

function updatePreview() {
	const text = editor.value;
	if (!text.trim()) {
		preview.innerHTML = "";
		clearError();
		return;
	}

	try {
		const result = parse(text);
		if (result.ok) {
			preview.innerHTML = render(result.ast);
			preview.style.opacity = "1";
			applyZoom();
			clearError();
			return;
		}

		showError(
			result.errors.map((e) => `L${e.line}:${e.col} ${e.message}`).join("\n"),
		);
		preview.innerHTML = "";
		if (result.partialAst) {
			try {
				preview.innerHTML = render(result.partialAst);
				preview.style.opacity = "0.5";
				applyZoom();
			} catch {
				preview.innerHTML = "";
			}
		}
	} catch (error) {
		showError(String(error));
		preview.innerHTML = "";
	}
}

const DEBOUNCE_MS = 250;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

editor.addEventListener("input", () => {
	if (debounceTimer !== null) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		updatePreview();
	}, DEBOUNCE_MS);
});

exampleSelector.addEventListener("change", (event) => {
	loadExample((event.target as HTMLSelectElement).value);
});

window.addEventListener("hashchange", () => {
	const fromUrl = readExampleFromUrl();
	if (fromUrl && fromUrl !== currentExample) {
		loadExample(fromUrl);
	}
});

applyStoredSourceWidth();
attachResizer();
restoreZoom();
loadExample(readExampleFromUrl() ?? "ui");
