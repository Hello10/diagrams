import { parse, render } from "../src/api.ts";
import classSource from "./diagrams/class.txt?raw";
import flowchartSource from "./diagrams/flowchart.txt?raw";
import sequenceSource from "./diagrams/sequence.txt?raw";
import stateSource from "./diagrams/state.txt?raw";
import wireflowSource from "./diagrams/wireflow.txt?raw";
import wireframeSource from "./diagrams/wireframe.txt?raw";

const EXAMPLES: Record<string, string> = {
	wireframe: wireframeSource,
	wireflow: wireflowSource,
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

let currentExample = "wireframe";

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
loadExample(readExampleFromUrl() ?? "wireframe");
