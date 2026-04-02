import { buildGraphDataset } from "./data/graphBuilders";
import { rgbaToCssColor } from "./characterPalette";
import { LEGEND_VISIBLE_COUNT, buildNodeLegend, paginateLegendEntries } from "./nodePalette";
import { GraphDataset, GraphView, LoadResult, ParseWorkerMessage, RankingEntry, SummaryCard } from "./types";
import { WebGpuGraphRenderer } from "./rendering/WebGpuGraphRenderer";

const DEFAULT_TOP_N = 12;
const DEFAULT_MIN_SUPPORT = 5;

interface AppState {
  loadResult: LoadResult | null;
  selectedRunFiles: File[];
  selectedProgressFile: File | null;
  currentGraph: GraphDataset | null;
  legendOffset: number;
}

function createEmptyGraphDataset(): GraphDataset {
  return {
    view: "profileOverview",
    title: "",
    subtitle: "",
    nodes: [],
    edges: [],
    ranking: [],
    summaryCards: [],
    warnings: [],
  };
}

function createEmptyLoadResult(): LoadResult {
  return {
    runs: [],
    progress: null,
    parsedFiles: 0,
    skippedFiles: 0,
    warnings: [],
  };
}

function isRunFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".run");
}

function isProgressFile(file: File): boolean {
  return file.name.toLowerCase() === "progress.save";
}

function sortFilesByName(files: File[]): File[] {
  return [...files].sort((left, right) => left.name.localeCompare(right.name));
}

function clearSelectedFiles(state: AppState): void {
  state.selectedRunFiles = [];
  state.selectedProgressFile = null;
}

function setSelectedFilesFromList(state: AppState, files: File[]): void {
  state.selectedRunFiles = sortFilesByName(files.filter((file) => isRunFile(file)));
  state.selectedProgressFile = files.find((file) => isProgressFile(file)) ?? null;
}

function getSelectedFiles(state: AppState): File[] {
  return state.selectedProgressFile
    ? [...state.selectedRunFiles, state.selectedProgressFile]
    : [...state.selectedRunFiles];
}

async function listAnalyticsFiles(directory: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];

  for await (const handle of directory.values()) {
    if (handle.kind === "directory") {
      files.push(...(await listAnalyticsFiles(handle)));
      continue;
    }

    const lowerName = handle.name.toLowerCase();
    if (lowerName.endsWith(".run") || lowerName === "progress.save") {
      files.push(await handle.getFile());
    }
  }

  files.sort((left, right) => left.name.localeCompare(right.name));
  return files;
}

function setStatus(message: string): void {
  const status = document.getElementById("load-status");
  if (status) {
    status.textContent = message;
  }
}

function setError(message: string | null): void {
  const banner = document.getElementById("error-banner");
  if (!banner) {
    return;
  }

  banner.textContent = message ?? "";
  banner.style.display = message ? "block" : "none";
}

function renderSummaryCards(cards: SummaryCard[]): void {
  const summaryGrid = document.getElementById("summary-grid");
  if (!summaryGrid) {
    return;
  }

  summaryGrid.replaceChildren(
    ...cards.map((card) => {
      const wrapper = document.createElement("div");
      wrapper.className = "summary-card";

      const label = document.createElement("div");
      label.className = "summary-label";
      label.textContent = card.label;

      const value = document.createElement("div");
      value.className = "summary-value";
      value.textContent = card.value;

      wrapper.append(label, value);
      return wrapper;
    })
  );
}

function renderWarnings(
  warnings: string[],
  emptyMessage: string = "No parser or view warnings were produced for the current graph."
): void {
  const list = document.getElementById("warning-list");
  if (!list) {
    return;
  }

  if (warnings.length === 0) {
    const item = document.createElement("li");
    item.className = "warning-item";
    item.textContent = emptyMessage;
    list.replaceChildren(item);
    return;
  }

  list.replaceChildren(
    ...warnings.map((warning) => {
      const item = document.createElement("li");
      item.className = "warning-item";
      item.textContent = warning;
      return item;
    })
  );
}

function renderRanking(
  entries: RankingEntry[],
  emptyMessage: string = "No ranked entities are available for this filter combination."
): void {
  const list = document.getElementById("ranking-list");
  if (!list) {
    return;
  }

  if (entries.length === 0) {
    const item = document.createElement("li");
    item.className = "ranking-item empty-state";
    item.textContent = emptyMessage;
    list.replaceChildren(item);
    return;
  }

  list.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li");
      item.className = "ranking-item";

      const line = document.createElement("div");
      line.className = "ranking-line";

      const label = document.createElement("div");
      label.className = "ranking-label";
      label.textContent = entry.label;

      const value = document.createElement("div");
      value.className = "ranking-value";
      value.textContent = entry.valueLabel;

      line.append(label, value);

      const detail = document.createElement("div");
      detail.className = "ranking-detail";
      detail.textContent = entry.detail;

      item.append(line, detail);
      return item;
    })
  );
}

function getLegendNote(graph: GraphDataset): string {
  if (graph.view === "profileOverview") {
    return "Profile Overview keeps the five main class colors fixed in the legend.";
  }

  return `Legend shows the current view's top ranked nodes, ${LEGEND_VISIBLE_COUNT} at a time.`;
}

function renderNodeLegend(state: AppState): void {
  const section = document.getElementById("node-legend-section");
  const note = document.getElementById("node-legend-note");
  const list = document.getElementById("node-legend");
  const status = document.getElementById("legend-page-status");
  const upButton = document.getElementById("legend-up-btn") as HTMLButtonElement | null;
  const downButton = document.getElementById("legend-down-btn") as HTMLButtonElement | null;
  if (!section || !note || !list || !status || !upButton || !downButton) {
    return;
  }

  const graph = state.currentGraph;
  const entries = graph ? buildNodeLegend(graph) : [];
  const page = paginateLegendEntries(entries, state.legendOffset);
  state.legendOffset = page.offset;

  section.hidden = !graph || entries.length === 0;
  if (!graph || entries.length === 0) {
    note.textContent = "";
    status.textContent = "0 of 0";
    upButton.disabled = true;
    downButton.disabled = true;
    list.replaceChildren();
    return;
  }

  note.textContent = getLegendNote(graph);
  status.textContent = page.total === 1 ? "1 of 1" : `${page.startIndex + 1}-${page.endIndex} of ${page.total}`;
  upButton.disabled = !page.canMoveUp;
  downButton.disabled = !page.canMoveDown;

  list.replaceChildren(
    ...page.entries.map((entry) => {
      const item = document.createElement("li");
      item.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = rgbaToCssColor(entry.color);

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = entry.label;

      item.append(swatch, label);
      return item;
    })
  );
}

function getNumericInputValue(id: string, fallback: number): number {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) {
    return fallback;
  }

  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value) || value <= 0) {
    input.value = String(fallback);
    return fallback;
  }

  return value;
}

function hasSelectedAnalyticsFiles(state: AppState): boolean {
  return state.selectedRunFiles.length > 0 || state.selectedProgressFile !== null;
}

function renderGraphHeader(eyebrow: string, title: string, subtitle: string): void {
  const graphTitle = document.getElementById("graph-title");
  const graphSubtitle = document.getElementById("graph-subtitle");
  const graphEyebrow = document.getElementById("graph-eyebrow");

  if (graphTitle) {
    graphTitle.textContent = title;
  }
  if (graphSubtitle) {
    graphSubtitle.textContent = subtitle;
  }
  if (graphEyebrow) {
    graphEyebrow.textContent = eyebrow;
  }
}

function buildPreparationSummaryCards(state: AppState): SummaryCard[] {
  if (!hasSelectedAnalyticsFiles(state)) {
    return [{ label: "Status", value: "No Data" }];
  }

  const loadResult = state.loadResult ?? createEmptyLoadResult();
  return [
    { label: "Parsed Runs", value: String(loadResult.parsedFiles) },
    { label: "progress.save", value: loadResult.progress ? "Loaded" : "Missing" },
    { label: "Skipped Files", value: String(loadResult.skippedFiles) },
    { label: "Status", value: "Ready" },
  ];
}

function renderAwaitingGeneration(
  state: AppState,
  renderer: WebGpuGraphRenderer,
  subtitle?: string
): void {
  const hasData = hasSelectedAnalyticsFiles(state);
  const idleSubtitle = hasData
    ? "Choose a graph type, set the node limits, then click Generate Graph."
    : "Load a save-history folder, then choose a graph type and node limits before generating.";
  const warningMessage = hasData
    ? "Parser warnings for the current files will appear here."
    : "Malformed or missing files will appear here after a load.";
  const rankingMessage = hasData
    ? "Choose a graph type and node limits, then click Generate Graph."
    : "Load a folder to see the ranked labels and exact values behind the graph.";

  renderGraphHeader(
    hasData ? "Awaiting Graph" : "Impact Graph",
    hasData ? "Ready to generate" : "Load data to begin",
    subtitle ?? idleSubtitle
  );
  renderSummaryCards(buildPreparationSummaryCards(state));
  renderWarnings(state.loadResult?.warnings ?? [], warningMessage);
  renderRanking([], rankingMessage);
  state.currentGraph = null;
  state.legendOffset = 0;
  renderNodeLegend(state);
  renderer.setGraph(createEmptyGraphDataset());
}

function updateControlNote(view: GraphView): void {
  const note = document.getElementById("control-note");
  const topNInput = document.getElementById("top-n-input") as HTMLInputElement | null;
  const minSupportInput = document.getElementById("min-support-input") as HTMLInputElement | null;

  if (!note || !topNInput || !minSupportInput) {
    return;
  }

  if (view === "profileOverview") {
    topNInput.disabled = true;
    minSupportInput.disabled = true;
    note.textContent =
      "Profile Overview uses progress.save and ignores the Max Nodes and Minimum Node Support fields.";
  } else if (view === "bossDeaths") {
    topNInput.disabled = false;
    minSupportInput.disabled = true;
    note.textContent = "Boss Deaths uses Max Nodes to cap the encounter list and ignores Minimum Node Support.";
  } else if (view === "cardStats") {
    topNInput.disabled = false;
    minSupportInput.disabled = false;
    note.textContent =
      "Card Stats uses progress.save, ranks non-starter pickups by win rate, and filters by Minimum Node Support.";
  } else if (view === "encounterStats") {
    topNInput.disabled = false;
    minSupportInput.disabled = true;
    note.textContent =
      "Encounter Stats uses progress.save fight aggregates and applies Max Nodes to the most dangerous encounters.";
  } else {
    topNInput.disabled = false;
    minSupportInput.disabled = false;
    note.textContent =
      "Relic Win Rate excludes starter relics and only includes relics that meet the Minimum Node Support threshold.";
  }
}

function buildAndRenderCurrentView(state: AppState, renderer: WebGpuGraphRenderer): void {
  const loadResult = state.loadResult ?? createEmptyLoadResult();
  const viewSelect = document.getElementById("view-select") as HTMLSelectElement | null;
  const view = (viewSelect?.value ?? "profileOverview") as GraphView;
  updateControlNote(view);

  const graph = buildGraphDataset(view, loadResult, {
    topN: getNumericInputValue("top-n-input", DEFAULT_TOP_N),
    minSupport: getNumericInputValue("min-support-input", DEFAULT_MIN_SUPPORT),
  });
  console.info("[graph] build", {
    view,
    parsedRuns: loadResult.runs.length,
    hasProgress: loadResult.progress !== null,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    warnings: [...loadResult.warnings, ...graph.warnings],
  });

  const combinedWarnings = [...loadResult.warnings, ...graph.warnings];
  renderGraphHeader(`${graph.nodes.length} nodes · ${graph.edges.length} edges`, graph.title, graph.subtitle);

  renderSummaryCards(graph.summaryCards);
  renderWarnings(combinedWarnings);
  renderRanking(graph.ranking);
  state.currentGraph = graph;
  state.legendOffset = 0;
  renderNodeLegend(state);
  renderer.setGraph(graph);
}

function createParserWorker(): Worker {
  return new Worker(new URL("./workers/runParser.worker.ts", import.meta.url), { type: "module" });
}

async function parseCurrentSelection(
  state: AppState,
  renderer: WebGpuGraphRenderer
): Promise<void> {
  const files = getSelectedFiles(state);

  if (files.length === 0) {
    state.loadResult = createEmptyLoadResult();
    setStatus("No .run files or progress.save file have been selected yet.");
    renderAwaitingGeneration(state, renderer);
    return;
  }

  setStatus(`Parsing ${files.length} analytics files in the worker...`);
  state.loadResult = await parseFilesInWorker(files);
  const progressState = state.selectedProgressFile ? "progress loaded" : "no progress.save";
  setStatus(
    `Parsed ${state.loadResult.parsedFiles} run files, skipped ${state.loadResult.skippedFiles}, ${progressState}.`
  );
  renderAwaitingGeneration(state, renderer);
}

function parseFilesInWorker(files: File[]): Promise<LoadResult> {
  return new Promise((resolve, reject) => {
    const worker = createParserWorker();

    worker.addEventListener("message", (event: MessageEvent<ParseWorkerMessage>) => {
      worker.terminate();

      if (event.data.type === "parse-complete") {
        resolve(event.data.result);
        return;
      }

      reject(new Error(event.data.message));
    });

    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message));
    });

    worker.postMessage({
      type: "parse-files",
      files,
    });
  });
}

async function main(): Promise<void> {
  const canvas = document.getElementById("webgpu-canvas") as HTMLCanvasElement | null;
  const nodeLabelLayer = document.getElementById("node-label-layer") as HTMLDivElement | null;
  const loadButton = document.getElementById("load-folder-btn") as HTMLButtonElement | null;
  const loadHistoryFilesButton = document.getElementById(
    "load-history-files-btn"
  ) as HTMLButtonElement | null;
  const loadProgressFileButton = document.getElementById(
    "load-progress-file-btn"
  ) as HTMLButtonElement | null;
  const resetCameraButton = document.getElementById("reset-camera-btn") as HTMLButtonElement | null;
  const generateGraphButton = document.getElementById("generate-graph-btn") as HTMLButtonElement | null;
  const viewSelect = document.getElementById("view-select") as HTMLSelectElement | null;
  const topNInput = document.getElementById("top-n-input") as HTMLInputElement | null;
  const minSupportInput = document.getElementById("min-support-input") as HTMLInputElement | null;
  const legendUpButton = document.getElementById("legend-up-btn") as HTMLButtonElement | null;
  const legendDownButton = document.getElementById("legend-down-btn") as HTMLButtonElement | null;
  const historyFilesInput = document.getElementById("history-files-input") as HTMLInputElement | null;
  const progressFileInput = document.getElementById("progress-file-input") as HTMLInputElement | null;

  if (
    !canvas ||
    !nodeLabelLayer ||
    !loadButton ||
    !loadHistoryFilesButton ||
    !loadProgressFileButton ||
    !resetCameraButton ||
    !generateGraphButton ||
    !viewSelect ||
    !topNInput ||
    !minSupportInput ||
    !legendUpButton ||
    !legendDownButton ||
    !historyFilesInput ||
    !progressFileInput
  ) {
    throw new Error("App shell is missing required DOM nodes.");
  }

  const state: AppState = {
    loadResult: null,
    selectedRunFiles: [],
    selectedProgressFile: null,
    currentGraph: null,
    legendOffset: 0,
  };

  const renderer = new WebGpuGraphRenderer(canvas, nodeLabelLayer, (message) => setError(message));
  await renderer.initialize();
  updateControlNote((viewSelect.value ?? "profileOverview") as GraphView);
  renderAwaitingGeneration(state, renderer);

  const setLoadingControlsDisabled = (disabled: boolean): void => {
    loadButton.disabled = disabled;
    loadHistoryFilesButton.disabled = disabled;
    loadProgressFileButton.disabled = disabled;
    generateGraphButton.disabled = disabled;
    viewSelect.disabled = disabled;
    if (disabled) {
      topNInput.disabled = true;
      minSupportInput.disabled = true;
      return;
    }

    updateControlNote(viewSelect.value as GraphView);
  };

  loadButton.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      setError("showDirectoryPicker is unavailable in this browser. Use Chromium or Edge on localhost.");
      return;
    }

    setLoadingControlsDisabled(true);
    setError(null);
    setStatus("Choosing a folder...");

    try {
      const directory = await window.showDirectoryPicker();
      setStatus("Scanning .run files and progress.save...");
      const files = await listAnalyticsFiles(directory);

      if (files.length === 0) {
        clearSelectedFiles(state);
        state.loadResult = createEmptyLoadResult();
        setStatus("No .run files or progress.save file were found in the selected folder.");
        renderAwaitingGeneration(state, renderer);
        return;
      }

      setSelectedFilesFromList(state, files);
      await parseCurrentSelection(state, renderer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown folder-loading error";
      const normalizedMessage = message.toLowerCase();

      if (normalizedMessage.includes("abort")) {
        setStatus("Folder selection cancelled.");
      } else if (
        normalizedMessage.includes("system files") ||
        normalizedMessage.includes("sensitive")
      ) {
        setError(
          "Chromium blocked that AppData folder because it is treated as sensitive. Use Load History Files for the .run files in the history folder, then Add progress.save for the profile stats."
        );
        setStatus("Folder load was blocked by the browser.");
      } else {
        setError(message);
        setStatus("Folder load failed.");
      }
    } finally {
      setLoadingControlsDisabled(false);
    }
  });

  loadHistoryFilesButton.addEventListener("click", () => {
    historyFilesInput.click();
  });

  loadProgressFileButton.addEventListener("click", () => {
    progressFileInput.click();
  });

  historyFilesInput.addEventListener("change", async () => {
    const selectedFiles = sortFilesByName(
      Array.from(historyFilesInput.files ?? []).filter((file) => isRunFile(file))
    );
    historyFilesInput.value = "";

    if (selectedFiles.length === 0) {
      setError("No .run files were selected. Open the history folder and choose the run files there.");
      setStatus("History file selection did not include any .run files.");
      return;
    }

    state.selectedRunFiles = selectedFiles;
    setError(null);
    setLoadingControlsDisabled(true);

    try {
      await parseCurrentSelection(state, renderer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file-loading error";
      setError(message);
      setStatus("History file load failed.");
    } finally {
      setLoadingControlsDisabled(false);
    }
  });

  progressFileInput.addEventListener("change", async () => {
    const selectedProgressFile =
      Array.from(progressFileInput.files ?? []).find((file) => isProgressFile(file)) ?? null;
    progressFileInput.value = "";

    if (!selectedProgressFile) {
      setError("Choose the actual progress.save file from the saves folder.");
      setStatus("progress.save was not selected.");
      return;
    }

    state.selectedProgressFile = selectedProgressFile;
    setError(null);
    setLoadingControlsDisabled(true);

    try {
      await parseCurrentSelection(state, renderer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file-loading error";
      setError(message);
      setStatus("progress.save load failed.");
    } finally {
      setLoadingControlsDisabled(false);
    }
  });

  resetCameraButton.addEventListener("click", () => {
    renderer.resetCamera();
  });

  legendUpButton.addEventListener("click", () => {
    state.legendOffset -= 1;
    renderNodeLegend(state);
  });
  legendDownButton.addEventListener("click", () => {
    state.legendOffset += 1;
    renderNodeLegend(state);
  });

  generateGraphButton.addEventListener("click", () => {
    buildAndRenderCurrentView(state, renderer);
  });

  viewSelect.addEventListener("change", () => {
    updateControlNote(viewSelect.value as GraphView);
    renderAwaitingGeneration(state, renderer, "Graph settings changed. Click Generate Graph to refresh the canvas.");
  });
  topNInput.addEventListener("change", () => {
    renderAwaitingGeneration(state, renderer, "Graph settings changed. Click Generate Graph to refresh the canvas.");
  });
  minSupportInput.addEventListener("change", () => {
    renderAwaitingGeneration(state, renderer, "Graph settings changed. Click Generate Graph to refresh the canvas.");
  });
}

void main();
