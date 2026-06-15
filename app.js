const OLD_STORAGE_KEY = "editable-storyboard-workbench-v1";
const STORAGE_KEY = "storyboard-project-library-v1";

const DEFAULT_KEYWORDS = [
  { id: "kw-subject-director", text: "孤独的年轻导演", type: "核心主体" },
  { id: "kw-subject-machine", text: "发光机械花", type: "核心主体" },
  { id: "kw-scene-rain", text: "霓虹雨夜街口", type: "特定场景" },
  { id: "kw-scene-theater", text: "废弃剧场后台", type: "特定场景" },
  { id: "kw-action-discover", text: "发现关键线索", type: "叙事动作" },
  { id: "kw-action-goodbye", text: "完成无声告别", type: "叙事动作" },
  { id: "kw-duration-6", text: "6秒", type: "时长" },
  { id: "kw-duration-12", text: "12秒", type: "时长" },
  { id: "kw-camera-push", text: "缓慢推进", type: "运镜类型" },
  { id: "kw-camera-orbit", text: "环绕运镜", type: "运镜类型" },
  { id: "kw-frame-close", text: "近景特写构图", type: "景别构图" },
  { id: "kw-frame-wide", text: "宽银幕对称构图", type: "景别构图" },
  { id: "kw-light-soft", text: "柔和侧逆光", type: "布光方案" },
  { id: "kw-light-neon", text: "霓虹反射光", type: "布光方案" },
  { id: "kw-color-cool", text: "冷蓝色调", type: "核心色调" },
  { id: "kw-color-warm", text: "暖金色调", type: "核心色调" }
];

const KEYWORD_CATEGORIES = ["核心主体", "特定场景", "叙事动作", "时长", "运镜类型", "景别构图", "布光方案", "核心色调"];
const DEFAULT_SMALL_NODE_TITLES = ["景别", "画面描述", "镜头语言", "表达含义"];
const DEFAULT_TIMELINE_SCALE = 22;
const MIN_TIMELINE_SCALE = 8;
const MAX_TIMELINE_SCALE = 80;
const MAIN_NODE_SIZE = { width: 480, height: 320 };
const STORYBOARD_NODE_SIZE = { width: 900, height: 600 };
const SMALL_NODE_SIZE = { width: 360, height: 92 };
const NODE_SNAP_GAP = 28;
const NODE_SNAP_THRESHOLD = 20;
const UNDO_LIMIT = 50;

let appState = loadAppState();
let dragShotId = "";
let draggedNodeId = "";
let selectedNodeId = "";
let selectedNodeIds = new Set();
let nodeDragOffset = { x: 0, y: 0 };
let nodeDragOffsets = new Map();
let isPanningCanvas = false;
let canvasPanStart = { x: 0, y: 0, panX: 0, panY: 0 };
let isSelectingNodes = false;
let selectionStart = { x: 0, y: 0 };
let selectionBoxEl = null;
let undoStack = [];
let pendingInspirationAssets = [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const toastStack = document.createElement("div");
toastStack.className = "toast-stack";
toastStack.setAttribute("aria-live", "polite");
document.body.appendChild(toastStack);

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultAppState() {
  const project = createProjectData("未命名短片");
  return {
    activeProjectId: project.id,
    currentView: "home",
    globalKeywords: structuredClone(DEFAULT_KEYWORDS),
    projects: [project]
  };
}

function loadAppState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      parsed.projects = (parsed.projects || []).map(normalizeProject);
      const projectKeywords = parsed.projects.flatMap((project) => project.keywords || []);
      parsed.globalKeywords = Array.isArray(parsed.globalKeywords)
        ? dedupeKeywords([...parsed.globalKeywords, ...projectKeywords])
        : mergeKeywords(projectKeywords);
      parsed.projects.forEach((project) => {
        project.keywords = [];
      });
      parsed.currentView ||= "home";
      return parsed.projects.length ? parsed : createDefaultAppState();
    } catch {
      return createDefaultAppState();
    }
  }

  const oldSaved = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldSaved) {
    try {
      const oldState = JSON.parse(oldSaved);
      const migrated = normalizeProject({
        ...oldState,
        id: uid("project"),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      return {
        activeProjectId: migrated.id,
        currentView: "home",
        globalKeywords: mergeKeywords(migrated.keywords || []),
        projects: [migrated]
      };
    } catch {
      return createDefaultAppState();
    }
  }

  return createDefaultAppState();
}

function saveAppState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function normalizeProject(project) {
  const normalized = {
    id: project.id || uid("project"),
    title: project.title || project.project?.title || "未命名短片",
    timelineScale: normalizeTimelineScale(project.timelineScale),
    activeShotId: project.activeShotId || project.shots?.[0]?.id || "",
    createdAt: project.createdAt || Date.now(),
    updatedAt: project.updatedAt || Date.now(),
    shots: (project.shots || []).map(normalizeShot),
    inspirations: (project.inspirations || []).map(normalizeInspiration),
    keywords: dedupeKeywords(project.keywords || []),
    promptSentence: project.promptSentence || { subject: "", scene: "", action: "" }
  };

  if (!normalized.shots.length) {
    normalized.shots.push(createShot());
  }
  normalized.activeShotId = normalized.shots.some((shot) => shot.id === normalized.activeShotId)
    ? normalized.activeShotId
    : normalized.shots[0].id;
  return normalized;
}

function mergeKeywords(keywords = []) {
  return dedupeKeywords([...keywords, ...structuredClone(DEFAULT_KEYWORDS)]);
}

function dedupeKeywords(keywords = []) {
  const seen = new Set();
  return keywords
    .filter((keyword) => keyword?.text && keyword?.type)
    .map((keyword) => ({
      id: keyword.id || uid("kw"),
      text: String(keyword.text).trim(),
      type: String(keyword.type).trim()
    }))
    .filter((keyword) => {
      const key = `${keyword.type}::${keyword.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeShot(shot) {
  const nodes = Array.isArray(shot.nodes) && shot.nodes.length ? shot.nodes : createDefaultNodes(shot);
  const normalized = {
    id: shot.id || uid("shot"),
    code: shot.code || "S01",
    scene: shot.scene || "新场景",
    duration: Number(shot.duration || 5),
    pace: shot.pace || "常规",
    angle: shot.angle || "",
    movement: shot.movement || "",
    audio: shot.audio || "",
    post: shot.post || "",
    viewport: normalizeViewport(shot.viewport),
    nodes: nodes.map(normalizeNode),
    connections: normalizeConnections(shot.connections, nodes)
  };
  return normalized;
}

function normalizeNode(node) {
  const title = node.title || "节点";
  const type = node.type || "small";
  return {
    id: node.id || uid("node"),
    type,
    role: node.role || "note",
    x: Number(node.x || 0),
    y: Number(node.y || 0),
    parentId: node.parentId || "",
    title,
    content: node.content || "",
    asset: node.asset || "",
    assetRatio: Number(node.assetRatio || 0),
    category: node.category || "",
    locked: Boolean(node.locked) || (type === "small" && DEFAULT_SMALL_NODE_TITLES.includes(title))
  };
}

function normalizeTimelineScale(scale) {
  if (scale === "wide") return 34;
  if (scale === "compact" || scale === undefined || scale === null) return DEFAULT_TIMELINE_SCALE;
  return Math.max(MIN_TIMELINE_SCALE, Math.min(MAX_TIMELINE_SCALE, Number(scale) || DEFAULT_TIMELINE_SCALE));
}

function normalizeViewport(viewport = {}) {
  return {
    scale: Math.max(0.45, Math.min(2.5, Number(viewport.scale || 0.72))),
    panX: Number(viewport.panX ?? 18),
    panY: Number(viewport.panY ?? 18)
  };
}

function normalizeConnections(connections, nodes) {
  const validIds = new Set(nodes.map((node) => node.id));
  const existing = Array.isArray(connections) ? connections : [];
  const normalized = existing
    .filter((connection) => validIds.has(connection.from) && validIds.has(connection.to))
    .map((connection) => ({
      id: connection.id || uid("conn"),
      from: connection.from,
      to: connection.to
    }));

  nodes.forEach((node) => {
    if (!node.parentId || !validIds.has(node.parentId)) return;
    const exists = normalized.some((connection) => {
      return [connection.from, connection.to].includes(node.id) && [connection.from, connection.to].includes(node.parentId);
    });
    if (!exists) {
      normalized.push({ id: uid("conn"), from: node.parentId, to: node.id });
    }
    node.parentId = "";
  });

  return normalized;
}

function normalizeInspiration(item) {
  const assets = Array.isArray(item.assets)
    ? item.assets.filter(Boolean)
    : (item.asset ? [item.asset] : []);
  return {
    id: item.id || uid("insp"),
    title: item.title || "未命名灵感",
    url: item.url || "",
    type: item.type || "构图",
    tags: item.tags || [],
    difficulty: Number(item.difficulty || item.score || 3),
    asset: assets[0] || "",
    assets
  };
}

function createProjectData(title = "新分镜项目") {
  const firstShot = createShot("S01");
  return {
    id: uid("project"),
    title,
    timelineScale: DEFAULT_TIMELINE_SCALE,
    activeShotId: firstShot.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    shots: [firstShot],
    inspirations: [],
    keywords: [],
    promptSentence: { subject: "", scene: "", action: "" }
  };
}

function createShot(code) {
  const shot = {
    id: uid("shot"),
    code: code || "S01",
    scene: "新场景",
    duration: 5,
    pace: "常规",
    angle: "",
    movement: "",
    audio: "",
    post: "",
    viewport: { scale: 0.72, panX: 18, panY: 18 },
    nodes: [],
    connections: []
  };
  shot.nodes = createDefaultNodes({
    shotSize: "中景",
    action: "",
    visualLanguage: "",
    notes: ""
  });
  shot.connections = normalizeConnections([], shot.nodes);
  layoutShotNodes(shot);
  return shot;
}

function createDefaultNodes(shot = {}) {
  const mainId = uid("node-main");
  return [
    {
      id: mainId,
      type: "main",
      role: "storyboard",
      x: 36,
      y: 36,
      parentId: "",
      title: "分镜画面",
      content: "",
      asset: ""
    },
    createSmallNode("景别", shot.shotSize || "中景", 556, 36, mainId, true),
    createSmallNode("画面描述", shot.action || "", 556, 152, mainId, true),
    createSmallNode("镜头语言", shot.visualLanguage || "", 556, 268, mainId, true),
    createSmallNode("表达含义", shot.notes || "", 556, 384, mainId, true)
  ];
}

function createMainNode(role) {
  const labels = {
    storyboard: "分镜画面",
    reference: "参考画面",
    effect: "参考效果"
  };
  return {
    id: uid("node-main"),
    type: "main",
    role,
    x: 36,
    y: 36 + Math.random() * 120,
    parentId: "",
    title: labels[role],
    content: "",
    asset: ""
  };
}

function createSmallNode(title, content = "", x = 420, y = 120, parentId = "", locked = false, category = "") {
  return {
    id: uid("node-small"),
    type: "small",
    role: "note",
    x,
    y,
    parentId,
    title,
    content,
    asset: "",
    category,
    locked
  };
}

function getActiveProject() {
  return appState.projects.find((project) => project.id === appState.activeProjectId) || appState.projects[0];
}

function getActiveShot() {
  const project = getActiveProject();
  return project?.shots.find((shot) => shot.id === project.activeShotId) || project?.shots[0];
}

function recordUndo() {
  if (appState.currentView !== "editor") return;
  const project = getActiveProject();
  if (!project) return;
  undoStack.push(JSON.stringify({
    project,
    globalKeywords: appState.globalKeywords || []
  }));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undoLastProjectChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) {
    showToast("没有可回撤的操作", "当前项目已经在最新的可回撤状态。");
    return;
  }
  try {
    const parsed = JSON.parse(snapshot);
    const index = appState.projects.findIndex((project) => project.id === parsed.project.id);
    if (index >= 0) {
      appState.projects[index] = normalizeProject(parsed.project);
      appState.activeProjectId = parsed.project.id;
    }
    appState.globalKeywords = dedupeKeywords(parsed.globalKeywords || []);
    saveAppState();
    render();
    showToast("已回撤一步", "当前项目已恢复到上一步。");
  } catch {
    showToast("回撤失败", "这个历史快照无法恢复。");
  }
}

function getTotalDuration(project = getActiveProject()) {
  return project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
}

function showToast(title, message = "") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function openLightbox(src, caption = "图片预览") {
  if (!src) return;
  const lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.innerHTML = `
    <figure class="lightbox-card">
      <img src="${src}" alt="${escapeHtml(caption)}">
      <figcaption class="lightbox-caption">
        <strong>${escapeHtml(caption || "图片预览")}</strong>
        <button type="button">关闭</button>
      </figcaption>
    </figure>
  `;
  const close = () => {
    lightbox.classList.add("is-leaving");
    window.setTimeout(() => lightbox.remove(), 160);
  };
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target.closest("button")) close();
  });
  document.body.appendChild(lightbox);
}

function render() {
  saveAppState();
  const isHome = appState.currentView !== "editor";
  $("#homeView").hidden = !isHome;
  $("#editorView").hidden = isHome;
  renderHome();
  if (!isHome) {
    renderProject();
    renderTimeline();
    renderEditor();
    renderInspirations();
    renderKeywords();
    renderPromptSentence();
  }
}

function renderHome() {
  const masonry = $("#projectMasonry");
  masonry.innerHTML = "";
  appState.projects.forEach((project) => {
    const card = document.createElement("article");
    card.className = "project-home-card";
    const total = getTotalDuration(project);
    const cover = getProjectCover(project);
    const coverClass = cover ? "album-art has-cover" : "album-art no-cover";
    const recordClass = cover ? "record-disc has-cover" : "record-disc no-cover";
    const coverImage = cover ? `<img src="${escapeAttribute(cover)}" alt="${escapeHtml(project.title)} 封面">` : "";
    card.innerHTML = `
      <div class="${recordClass}" aria-hidden="true">
        <span class="record-label">${coverImage}</span>
      </div>
      <div class="album-sleeve">
        <header>
          <span>${project.shots.length} 镜头</span>
        </header>
        <div class="${coverClass}">${coverImage}</div>
        <div class="album-meta">
          <h2>${escapeHtml(project.title)}</h2>
          <p>${formatSeconds(total)} · ${project.inspirations.length} 条灵感 · ${appState.globalKeywords.length} 个提示词</p>
          <button type="button" data-open-project>打开项目</button>
        </div>
      </div>
      <button type="button" class="project-delete-button" data-delete-project>删除</button>
    `;
    $("[data-open-project]", card).addEventListener("click", (event) => {
      event.stopPropagation();
      openProject(project.id);
    });
    $("[data-delete-project]", card).addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(project.id);
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openProject(project.id);
    });
    masonry.appendChild(card);
  });
}

function getProjectCover(project) {
  for (const shot of project.shots || []) {
    const coverNode = (shot.nodes || []).find((node) => {
      return node.type === "main" && node.role === "storyboard" && node.asset;
    });
    if (coverNode?.asset) return coverNode.asset;
  }
  return "";
}

function renderProject() {
  const project = getActiveProject();
  $("#projectTitle").value = project.title;
  $("#projectShotCount").textContent = project.shots.length;
  $("#projectDuration").textContent = formatSeconds(getTotalDuration(project));
}

function fitSceneInput() {
  const sceneInput = $('[data-field="scene"]');
  if (!sceneInput) return;
  const textLength = Math.max(4, String(sceneInput.value || sceneInput.placeholder || "").length + 2);
  sceneInput.style.width = `${Math.min(34, Math.max(8, textLength))}ch`;
}

function renderTimeline() {
  const project = getActiveProject();
  const timeline = $("#timeline");
  const ruler = $("#timelineRuler");
  timeline.innerHTML = "";
  ruler.innerHTML = "";
  const total = getTotalDuration(project);
  const visibleDuration = Math.max(30, Math.ceil(total / getTimelineTickStep(project.timelineScale)) * getTimelineTickStep(project.timelineScale));
  const pixelsPerSecond = normalizeTimelineScale(project.timelineScale);
  project.timelineScale = pixelsPerSecond;
  const shotWidthTotal = project.shots.reduce((sum, shot) => {
    return sum + getShotTimelineWidth(shot, pixelsPerSecond);
  }, Math.max(0, project.shots.length - 1) * 8 + 130);
  const timelineWidth = Math.max(visibleDuration * pixelsPerSecond, shotWidthTotal);

  timeline.style.minWidth = `${timelineWidth}px`;
  ruler.style.minWidth = `${timelineWidth}px`;
  timeline.closest(".timeline-stage").style.setProperty("--timeline-second", `${pixelsPerSecond}px`);
  $("#timelineSummary").textContent = `${project.shots.length} 个镜头，预计 ${formatSeconds(total)}，拖动镜头可重排`;

  const tickStep = getTimelineTickStep(pixelsPerSecond);
  for (let second = 0; second <= visibleDuration; second += tickStep) {
    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.style.left = `${second * pixelsPerSecond}px`;
    tick.innerHTML = `<i></i><b>${formatSeconds(second)}</b>`;
    ruler.appendChild(tick);
  }

  let cursor = 0;
  project.shots.forEach((shot) => {
    const item = document.createElement("button");
    item.type = "button";
    item.draggable = true;
    item.dataset.shotId = shot.id;
    item.className = `timeline-shot${shot.id === project.activeShotId ? " is-active" : ""}`;
    item.style.width = `${getShotTimelineWidth(shot, pixelsPerSecond)}px`;
    item.innerHTML = `
      <strong>${escapeHtml(shot.code)} · ${escapeHtml(shot.scene)}</strong>
      <small>${formatSeconds(cursor)} - ${formatSeconds(cursor + Number(shot.duration || 0))}</small>
      <small>${escapeHtml(shot.pace)}</small>
    `;
    item.addEventListener("click", () => {
      project.activeShotId = shot.id;
      render();
    });
    item.addEventListener("dragstart", (event) => {
      dragShotId = shot.id;
      event.dataTransfer.setData("text/plain", shot.id);
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => {
      dragShotId = "";
      item.classList.remove("is-dragging");
    });
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderShot(dragShotId, shot.id);
    });
    timeline.appendChild(item);
    cursor += Number(shot.duration || 0);
  });

  const addBlock = document.createElement("button");
  addBlock.type = "button";
  addBlock.className = "timeline-shot timeline-add-shot";
  addBlock.innerHTML = `<strong>+ 新建镜头</strong><small>点击加入时间线末尾</small>`;
  addBlock.addEventListener("click", addShotToTimeline);
  timeline.appendChild(addBlock);
}

function getShotTimelineWidth(shot, pixelsPerSecond) {
  return Math.max(28, Number(shot.duration || 0) * pixelsPerSecond);
}

function getTimelineTickStep(pixelsPerSecond) {
  if (pixelsPerSecond >= 46) return 1;
  if (pixelsPerSecond >= 26) return 2;
  if (pixelsPerSecond >= 14) return 5;
  return 10;
}

function adjustTimelineScale(delta) {
  const project = getActiveProject();
  const current = normalizeTimelineScale(project.timelineScale);
  project.timelineScale = Math.max(MIN_TIMELINE_SCALE, Math.min(MAX_TIMELINE_SCALE, current + delta));
  saveProjectTouch();
  renderTimeline();
}

function renderEditor() {
  const shot = getActiveShot();
  $("#emptyState").hidden = Boolean(shot);
  $("#shotEditor").hidden = !shot;
  if (!shot) return;
  if (selectedNodeId && !shot.nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = "";
  }

  $$("[data-field]").forEach((input) => {
    input.value = shot[input.dataset.field] ?? "";
  });
  fitSceneInput();
  renderNodeCanvas();
}

function renderNodeCanvas() {
  const shot = getActiveShot();
  const canvas = $("#nodeCanvas");
  canvas.innerHTML = "";
  if (!shot) return;

  shot.viewport = normalizeViewport(shot.viewport);
  const world = document.createElement("div");
  world.className = "node-world";
  world.style.transform = `translate(${shot.viewport.panX}px, ${shot.viewport.panY}px) scale(${shot.viewport.scale})`;
  shot.nodes.forEach((node) => {
    const nodeEl = document.createElement("article");
    const isSelected = node.id === selectedNodeId || selectedNodeIds.has(node.id);
    nodeEl.className = `canvas-node ${node.type === "main" ? "main-node" : "small-node"}${isSelected ? " is-selected" : ""}`;
    nodeEl.classList.add(node.type === "main" ? "main-node" : "small-node");
    nodeEl.dataset.nodeId = node.id;
    nodeEl.dataset.role = node.role;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.innerHTML = node.type === "main" ? renderMainNodeHtml(node) : renderSmallNodeHtml(node);

    nodeEl.addEventListener("pointerdown", (event) => startNodeDrag(event, node));
    nodeEl.addEventListener("click", (event) => {
      if (event.target.closest("button, input, textarea, label, img")) return;
      selectNode(node.id);
    });
    nodeEl.addEventListener("dragover", (event) => event.preventDefault());
    nodeEl.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = event.dataTransfer.getData("text/plain");
      if (text) {
        recordUndo();
        node.content = appendToken(node.content, text);
        render();
      }
    });

    const contentInput = $("[data-node-content]", nodeEl);
    if (contentInput) {
      autoResizeTextarea(contentInput);
      contentInput.addEventListener("input", (event) => {
        recordUndo();
        node.content = event.target.value;
        autoResizeTextarea(event.target);
        saveProjectTouch();
      });
    }

    const img = $("[data-node-image]", nodeEl);
    if (img && node.asset) {
      img.addEventListener("click", () => openLightbox(node.asset, node.title));
      if (!node.assetRatio) {
        img.addEventListener("load", () => {
          if (!img.naturalWidth || !img.naturalHeight) return;
          node.assetRatio = normalizeAssetRatio(img.naturalWidth / img.naturalHeight);
          const drop = img.closest(".main-image-drop");
          if (drop) drop.style.setProperty("--asset-ratio", node.assetRatio);
          saveProjectTouch();
        }, { once: true });
      }
    }

    const upload = $("[data-node-upload]", nodeEl);
    if (upload) {
      upload.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        recordUndo();
        node.asset = await fileToDataUrl(file);
        node.assetRatio = await getImageRatio(node.asset);
        showToast("图片/GIF 已加入节点", node.title);
        render();
      });
    }
    world.appendChild(nodeEl);
  });
  canvas.appendChild(world);
  autoResizeTextareas(canvas);
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  selectedNodeIds = new Set([nodeId]);
  $$(".canvas-node", $("#nodeCanvas")).forEach((nodeEl) => {
    nodeEl.classList.toggle("is-selected", selectedNodeIds.has(nodeEl.dataset.nodeId));
  });
}

function selectNodes(nodeIds = []) {
  selectedNodeIds = new Set(nodeIds);
  selectedNodeId = nodeIds[0] || "";
  $$(".canvas-node", $("#nodeCanvas")).forEach((nodeEl) => {
    nodeEl.classList.toggle("is-selected", selectedNodeIds.has(nodeEl.dataset.nodeId));
  });
}

function renderMainNodeHtml(node) {
  const ratio = normalizeAssetRatio(node.assetRatio);
  const imageHtml = node.asset
    ? `<img data-node-image src="${node.asset}" alt="${escapeHtml(node.title)}">`
    : `<div class="node-image-placeholder"><span>尚未添加图片</span></div>`;
  return `
    <header>
      <strong class="node-title">${escapeHtml(node.title)}</strong>
    </header>
    <div class="main-image-drop" style="--asset-ratio: ${ratio};">
      ${imageHtml}
      <label class="node-upload-button">
        添加图片
        <input type="file" accept="image/*" data-node-upload>
      </label>
    </div>
  `;
}

function renderSmallNodeHtml(node) {
  const category = node.category ? `<span class="node-category">${escapeHtml(node.category)}</span>` : "";
  return `
    <header>
      <strong class="node-title">${escapeHtml(node.title)}</strong>
      ${category}
    </header>
    <textarea data-node-content rows="1" aria-label="节点内容">${escapeHtml(node.content || "")}</textarea>
  `;
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function autoResizeTextareas(root = document) {
  $$("[data-node-content]", root).forEach(autoResizeTextarea);
}

function screenToCanvasPoint(event) {
  const shot = getActiveShot();
  const rect = $("#nodeCanvas").getBoundingClientRect();
  const viewport = normalizeViewport(shot?.viewport);
  return {
    x: (event.clientX - rect.left - viewport.panX) / viewport.scale,
    y: (event.clientY - rect.top - viewport.panY) / viewport.scale
  };
}

function updateCanvasViewport() {
  const shot = getActiveShot();
  const world = $(".node-world");
  if (!shot || !world) return;
  shot.viewport = normalizeViewport(shot.viewport);
  world.style.transform = `translate(${shot.viewport.panX}px, ${shot.viewport.panY}px) scale(${shot.viewport.scale})`;
}

function zoomNodeCanvas(event) {
  if (!event.target.closest("#nodeCanvas")) return;
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const shot = getActiveShot();
  if (!shot) return;
  const rect = $("#nodeCanvas").getBoundingClientRect();
  const viewport = normalizeViewport(shot.viewport);
  const oldScale = viewport.scale;
  const nextScale = Math.max(0.45, Math.min(2.5, oldScale + (event.deltaY > 0 ? -0.08 : 0.08)));
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const worldX = (mouseX - viewport.panX) / oldScale;
  const worldY = (mouseY - viewport.panY) / oldScale;
  shot.viewport = {
    scale: nextScale,
    panX: mouseX - worldX * nextScale,
    panY: mouseY - worldY * nextScale
  };
  updateCanvasViewport();
  saveProjectTouch();
}

function startCanvasPan(event) {
  if (event.button !== 1 || !event.target.closest("#nodeCanvas")) return;
  event.preventDefault();
  const shot = getActiveShot();
  if (!shot) return;
  shot.viewport = normalizeViewport(shot.viewport);
  isPanningCanvas = true;
  canvasPanStart = {
    x: event.clientX,
    y: event.clientY,
    panX: shot.viewport.panX,
    panY: shot.viewport.panY
  };
}

function panNodeCanvas(event) {
  if (!isPanningCanvas) return;
  const shot = getActiveShot();
  if (!shot) return;
  shot.viewport.panX = canvasPanStart.panX + event.clientX - canvasPanStart.x;
  shot.viewport.panY = canvasPanStart.panY + event.clientY - canvasPanStart.y;
  updateCanvasViewport();
}

function finishCanvasPan() {
  if (!isPanningCanvas) return;
  isPanningCanvas = false;
  saveProjectTouch();
}

function startNodeSelection(event) {
  if (event.button !== 0 || !event.target.closest("#nodeCanvas") || event.target.closest(".canvas-node, button, input, textarea, label, img")) return;
  event.preventDefault();
  const canvas = $("#nodeCanvas");
  const rect = canvas.getBoundingClientRect();
  isSelectingNodes = true;
  selectionStart = {
    x: event.clientX,
    y: event.clientY,
    left: event.clientX - rect.left,
    top: event.clientY - rect.top
  };
  selectNodes([]);
  selectionBoxEl = document.createElement("div");
  selectionBoxEl.className = "selection-box";
  canvas.appendChild(selectionBoxEl);
  updateSelectionBox(event);
}

function updateSelectionBox(event) {
  if (!isSelectingNodes || !selectionBoxEl) return;
  const canvasRect = $("#nodeCanvas").getBoundingClientRect();
  const currentLeft = event.clientX - canvasRect.left;
  const currentTop = event.clientY - canvasRect.top;
  const left = Math.min(selectionStart.left, currentLeft);
  const top = Math.min(selectionStart.top, currentTop);
  const width = Math.abs(currentLeft - selectionStart.left);
  const height = Math.abs(currentTop - selectionStart.top);
  Object.assign(selectionBoxEl.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`
  });
  const selectionRect = {
    left: Math.min(selectionStart.x, event.clientX),
    right: Math.max(selectionStart.x, event.clientX),
    top: Math.min(selectionStart.y, event.clientY),
    bottom: Math.max(selectionStart.y, event.clientY)
  };
  const ids = $$(".canvas-node", $("#nodeCanvas"))
    .filter((nodeEl) => rectsIntersect(selectionRect, nodeEl.getBoundingClientRect()))
    .map((nodeEl) => nodeEl.dataset.nodeId);
  selectNodes(ids);
}

function finishNodeSelection() {
  if (!isSelectingNodes) return;
  isSelectingNodes = false;
  selectionBoxEl?.remove();
  selectionBoxEl = null;
}

function renderInspirations() {
  const project = getActiveProject();
  const list = $("#inspirationList");
  list.innerHTML = "";
  [...project.inspirations].sort((a, b) => b.difficulty - a.difficulty).forEach((item) => {
    const card = document.createElement("article");
    card.className = "inspiration-card";
    const assets = Array.isArray(item.assets) ? item.assets : (item.asset ? [item.asset] : []);
    const assetHtml = assets.length
      ? `<div class="inspiration-assets">${assets.map((asset, index) => `<img class="inspiration-asset" src="${asset}" alt="${escapeHtml(item.title)} ${index + 1}" data-inspiration-asset-index="${index}">`).join("")}</div>`
      : "";
    card.innerHTML = `
      ${assetHtml}
      <div class="body">
        <header>
          <strong>${escapeHtml(item.title)}</strong>
          <button type="button" data-remove-inspiration>删</button>
        </header>
        <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url || "未填写链接")}</a>
        <p>${escapeHtml(item.type)} · ${escapeHtml(item.tags.join(" / "))}</p>
        <div class="difficulty-dots" aria-label="难度"></div>
      </div>
    `;
    const dots = $(".difficulty-dots", card);
    for (let index = 1; index <= 5; index += 1) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = index <= item.difficulty ? "is-active" : "";
      dot.title = `难度 ${index}`;
      dot.addEventListener("click", () => {
        recordUndo();
        item.difficulty = index;
        saveProjectTouch();
        renderInspirations();
      });
      dots.appendChild(dot);
    }
    $("[data-remove-inspiration]", card).addEventListener("click", () => {
      recordUndo();
      project.inspirations = project.inspirations.filter((inspiration) => inspiration.id !== item.id);
      render();
    });
    $$(".inspiration-asset", card).forEach((image) => {
      image.addEventListener("click", () => openLightbox(image.src, item.title));
    });
    list.appendChild(card);
  });
}

function renderInspirationPreview() {
  const preview = $("#inspirationPreview");
  if (!preview) return;
  preview.hidden = !pendingInspirationAssets.length;
  preview.innerHTML = pendingInspirationAssets.length
    ? pendingInspirationAssets.map((asset, index) => `
      <figure>
        <img src="${asset}" alt="灵感图片预览 ${index + 1}">
        <button type="button" data-remove-pending-inspiration="${index}">移除</button>
      </figure>
    `).join("")
    : "";
  $$("[data-remove-pending-inspiration]", preview).forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removePendingInspiration);
      pendingInspirationAssets.splice(index, 1);
      if (!pendingInspirationAssets.length) {
      $("#inspirationAssetInput").value = "";
      }
      renderInspirationPreview();
    });
  });
  $$("img", preview).forEach((image) => {
    image.addEventListener("click", () => openLightbox(image.src, "灵感图片预览"));
  });
}

function renderKeywords() {
  const list = $("#keywordCategoryList");
  list.innerHTML = "";
  appState.globalKeywords = dedupeKeywords(appState.globalKeywords);
  KEYWORD_CATEGORIES.forEach((category) => {
    const group = document.createElement("section");
    group.className = "keyword-category";
    group.innerHTML = `<h3>${escapeHtml(category)}</h3><div class="keyword-bank"></div>`;
    const bank = $(".keyword-bank", group);
    appState.globalKeywords.filter((keyword) => keyword.type === category).forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "keyword-chip";
      chip.draggable = true;
      chip.dataset.type = keyword.type;
      chip.innerHTML = `<span>${escapeHtml(keyword.text)}</span><button type="button" data-delete-keyword title="删除提示词">×</button>`;
      chip.title = "拖到节点画布或输入框";
      chip.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", keyword.text);
        event.dataTransfer.setData("application/x-keyword-type", keyword.type);
      });
      $("[data-delete-keyword]", chip).addEventListener("click", (event) => {
        event.stopPropagation();
        recordUndo();
        appState.globalKeywords = appState.globalKeywords.filter((item) => item.id !== keyword.id);
        render();
      });
      bank.appendChild(chip);
    });
    list.appendChild(group);
  });
}

function renderPromptSentence() {
  const project = getActiveProject();
  $$("[data-prompt-slot]").forEach((input) => {
    input.value = project.promptSentence[input.dataset.promptSlot] || "";
  });
}

function openProject(projectId) {
  appState.activeProjectId = projectId;
  appState.currentView = "editor";
  render();
}

function createProject() {
  const project = createProjectData(`新分镜项目 ${appState.projects.length + 1}`);
  appState.projects.unshift(project);
  appState.activeProjectId = project.id;
  appState.currentView = "editor";
  showToast("项目已创建", "已进入新的分镜工作台。");
  render();
}

function deleteProject(projectId) {
  if (appState.projects.length === 1) {
    showToast("至少保留一个项目", "最后一个项目不能删除。");
    return;
  }
  appState.projects = appState.projects.filter((project) => project.id !== projectId);
  if (appState.activeProjectId === projectId) {
    appState.activeProjectId = appState.projects[0].id;
  }
  showToast("项目已删除", "项目库已更新。");
  render();
}

function saveProjectTouch() {
  const project = getActiveProject();
  project.updatedAt = Date.now();
  saveAppState();
}

function addShotToTimeline() {
  recordUndo();
  const project = getActiveProject();
  const shot = createShot(`S${String(project.shots.length + 1).padStart(2, "0")}`);
  project.shots.push(shot);
  project.activeShotId = shot.id;
  showToast("新镜头已创建", `${shot.code} 已加入时间线。`);
  render();
}

function reorderShot(sourceId, targetId) {
  const project = getActiveProject();
  if (!sourceId || !targetId || sourceId === targetId) return;
  const fromIndex = project.shots.findIndex((shot) => shot.id === sourceId);
  const toIndex = project.shots.findIndex((shot) => shot.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return;
  recordUndo();
  const [shot] = project.shots.splice(fromIndex, 1);
  project.shots.splice(toIndex, 0, shot);
  project.activeShotId = shot.id;
  render();
}

function moveShot(index, direction) {
  const project = getActiveProject();
  const target = index + direction;
  if (target < 0 || target >= project.shots.length) return;
  recordUndo();
  const [shot] = project.shots.splice(index, 1);
  project.shots.splice(target, 0, shot);
  render();
}

function deleteShot(id) {
  const project = getActiveProject();
  if (project.shots.length === 1) {
    showToast("至少保留一个镜头", "最后一个镜头不能删除。");
    return;
  }
  recordUndo();
  project.shots = project.shots.filter((shot) => shot.id !== id);
  project.activeShotId = project.shots[0]?.id || "";
  showToast("已删除镜头", "时间线已重新排列。");
  render();
}

function startNodeDrag(event, node) {
  if (event.target.matches("input, textarea, button, label, img")) return;
  event.preventDefault();
  if (!selectedNodeIds.has(node.id)) {
    selectNode(node.id);
  }
  draggedNodeId = node.id;
  selectedNodeId = node.id;
  const point = screenToCanvasPoint(event);
  const shot = getActiveShot();
  nodeDragOffsets = new Map();
  (shot?.nodes || []).filter((item) => selectedNodeIds.has(item.id)).forEach((item) => {
    nodeDragOffsets.set(item.id, {
      x: point.x - item.x,
      y: point.y - item.y
    });
  });
  nodeDragOffset = {
    x: point.x - node.x,
    y: point.y - node.y
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function dragNode(event) {
  if (!draggedNodeId) return;
  const shot = getActiveShot();
  const point = screenToCanvasPoint(event);
  (shot?.nodes || []).forEach((node) => {
    const offset = nodeDragOffsets.get(node.id);
    if (!offset) return;
    node.x = point.x - offset.x;
    node.y = point.y - offset.y;
    const nodeEl = $(`[data-node-id="${node.id}"]`, $("#nodeCanvas"));
    if (nodeEl) {
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
    }
  });
  updateSnapGuides(shot, getMovingNodeIds());
}

function finishNodeDrag() {
  if (!draggedNodeId) return;
  const shot = getActiveShot();
  const movingIds = getMovingNodeIds();
  snapDraggedNodesToGuides(shot, movingIds);
  movingIds.forEach((id) => {
    const node = shot?.nodes.find((item) => item.id === id);
    const nodeEl = node ? $(`[data-node-id="${node.id}"]`, $("#nodeCanvas")) : null;
    if (nodeEl) {
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
    }
  });
  clearSnapGuides();
  draggedNodeId = "";
  nodeDragOffsets = new Map();
  saveProjectTouch();
}

function getMovingNodeIds() {
  if (nodeDragOffsets.size) return [...nodeDragOffsets.keys()];
  if (selectedNodeIds.size) return [...selectedNodeIds];
  return draggedNodeId ? [draggedNodeId] : [];
}

function getNodeRect(node) {
  const size = getNodeLayoutSize(node);
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    left: node.x,
    top: node.y,
    right: node.x + size.width,
    bottom: node.y + size.height,
    width: size.width,
    height: size.height
  };
}

function getSelectedBounds(nodes) {
  const rects = nodes.map(getNodeRect);
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function getSnapCandidates(shot, movedIds = []) {
  const movedIdSet = new Set(movedIds);
  const movedNodes = (shot?.nodes || []).filter((node) => movedIdSet.has(node.id));
  const stationaryNodes = (shot?.nodes || []).filter((node) => !movedIdSet.has(node.id));
  if (!movedNodes.length || !stationaryNodes.length) return { x: [], y: [], movedNodes, stationaryNodes };
  const bounds = getSelectedBounds(movedNodes);
  const x = [];
  const y = [];
  stationaryNodes.forEach((node) => {
    const rect = getNodeRect(node);
    [
      { delta: rect.right + NODE_SNAP_GAP - bounds.left, guideX: rect.right + NODE_SNAP_GAP },
      { delta: rect.left - NODE_SNAP_GAP - bounds.right, guideX: rect.left - NODE_SNAP_GAP }
    ].forEach((candidate) => {
      if (Math.abs(candidate.delta) <= NODE_SNAP_THRESHOLD) {
        x.push({ ...candidate, distance: Math.abs(candidate.delta), rect });
      }
    });
    [
      { delta: rect.top - bounds.top, guideY: rect.top },
      { delta: rect.bottom + NODE_SNAP_GAP - bounds.top, guideY: rect.bottom + NODE_SNAP_GAP },
      { delta: rect.top - NODE_SNAP_GAP - bounds.bottom, guideY: rect.top - NODE_SNAP_GAP }
    ].forEach((candidate) => {
      if (Math.abs(candidate.delta) <= NODE_SNAP_THRESHOLD) {
        y.push({ ...candidate, distance: Math.abs(candidate.delta), rect });
      }
    });
  });
  x.sort((a, b) => a.distance - b.distance);
  y.sort((a, b) => a.distance - b.distance);
  return { x, y, movedNodes, stationaryNodes };
}

function nodesWouldOverlap(movedNodes, stationaryNodes, deltaX = 0, deltaY = 0) {
  return movedNodes.some((node) => {
    const rect = getNodeRect(node);
    const next = {
      left: rect.left + deltaX,
      right: rect.right + deltaX,
      top: rect.top + deltaY,
      bottom: rect.bottom + deltaY
    };
    return stationaryNodes.some((stationary) => {
      const other = getNodeRect(stationary);
      return next.left < other.right
        && next.right > other.left
        && next.top < other.bottom
        && next.bottom > other.top;
    });
  });
}

function chooseSafeSnapDelta(axisCandidates, movedNodes, stationaryNodes, baseDeltaX = 0, baseDeltaY = 0, axis = "x") {
  return axisCandidates.find((candidate) => {
    const deltaX = axis === "x" ? candidate.delta : baseDeltaX;
    const deltaY = axis === "y" ? candidate.delta : baseDeltaY;
    return !nodesWouldOverlap(movedNodes, stationaryNodes, deltaX, deltaY);
  }) || null;
}

function snapDraggedNodesToGuides(shot, movedIds = []) {
  const { x, y, movedNodes, stationaryNodes } = getSnapCandidates(shot, movedIds);
  if (!movedNodes.length) return;
  let deltaX = 0;
  let deltaY = 0;
  const xSnap = chooseSafeSnapDelta(x, movedNodes, stationaryNodes, 0, 0, "x");
  if (xSnap) deltaX = xSnap.delta;
  const ySnap = chooseSafeSnapDelta(y, movedNodes, stationaryNodes, deltaX, 0, "y");
  if (ySnap) deltaY = ySnap.delta;
  if (deltaX && deltaY && nodesWouldOverlap(movedNodes, stationaryNodes, deltaX, deltaY)) {
    deltaY = 0;
  }
  if (!deltaX && !deltaY) return;
  movedNodes.forEach((node) => {
    node.x += deltaX;
    node.y += deltaY;
  });
}

function updateSnapGuides(shot, movedIds = []) {
  clearSnapGuides();
  const world = $(".node-world", $("#nodeCanvas"));
  const { x, y, movedNodes, stationaryNodes } = getSnapCandidates(shot, movedIds);
  if (!world || !movedNodes.length) return;
  const bounds = getSelectedBounds(movedNodes);
  const xSnap = chooseSafeSnapDelta(x, movedNodes, stationaryNodes, 0, 0, "x");
  const ySnap = chooseSafeSnapDelta(y, movedNodes, stationaryNodes, xSnap?.delta || 0, 0, "y");
  if (ySnap) {
    const guide = document.createElement("div");
    guide.className = "snap-guide snap-guide-horizontal";
    guide.style.left = `${Math.min(bounds.left, ySnap.rect.left) - 24}px`;
    guide.style.top = `${ySnap.guideY}px`;
    guide.style.width = `${Math.max(bounds.right, ySnap.rect.right) - Math.min(bounds.left, ySnap.rect.left) + 48}px`;
    world.appendChild(guide);
  }
  if (xSnap) {
    const guide = document.createElement("div");
    guide.className = "snap-guide snap-guide-vertical";
    guide.style.left = `${xSnap.guideX}px`;
    guide.style.top = `${Math.min(bounds.top, xSnap.rect.top) - 24}px`;
    guide.style.height = `${Math.max(bounds.bottom, xSnap.rect.bottom) - Math.min(bounds.top, xSnap.rect.top) + 48}px`;
    world.appendChild(guide);
  }
}

function clearSnapGuides() {
  $$(".snap-guide", $("#nodeCanvas")).forEach((guide) => guide.remove());
}

function findNearestMainNode(node, nodes) {
  return nodes
    .filter((item) => item.type === "main")
    .map((main) => ({
      node: main,
      distance: Math.hypot(node.x - main.x, node.y - main.y)
    }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function addMainNode(role) {
  const shot = getActiveShot();
  recordUndo();
  shot.nodes.push(createMainNode(role));
  showToast("大节点已创建", roleName(role));
  render();
}

function addSmallNode(title = "新小节点", content = "", category = "") {
  const shot = getActiveShot();
  const main = shot.nodes.find((node) => node.type === "main");
  recordUndo();
  const slot = main ? getNextSmallNodeSlot(shot, main) : { x: 420, y: 120 };
  const node = createSmallNode(title, content, slot.x, slot.y, "", false);
  node.category = category;
  shot.nodes.push(node);
  render();
}

function removeNode(nodeId) {
  const shot = getActiveShot();
  const node = shot?.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  recordUndo();
  shot.nodes = shot.nodes.filter((item) => item.id !== nodeId);
  shot.connections = (shot.connections || []).filter((connection) => connection.from !== nodeId && connection.to !== nodeId);
  selectedNodeId = selectedNodeId === nodeId ? "" : selectedNodeId;
  selectedNodeIds.delete(nodeId);
  renderNodeCanvas();
  saveProjectTouch();
}

function removeNodes(nodeIds = []) {
  const shot = getActiveShot();
  const ids = new Set(nodeIds);
  if (!shot || !ids.size) return;
  recordUndo();
  shot.nodes = shot.nodes.filter((item) => !ids.has(item.id));
  shot.connections = (shot.connections || []).filter((connection) => !ids.has(connection.from) && !ids.has(connection.to));
  selectedNodeId = "";
  selectedNodeIds = new Set();
  renderNodeCanvas();
  saveProjectTouch();
}

function snapNodeToMain(node, shot) {
  const nearest = findNearestMainNode(node, shot.nodes);
  if (!nearest || nearest.distance >= 180) return;
  const slot = getNextSmallNodeSlot(shot, nearest.node, node.id);
  node.x = slot.x;
  node.y = slot.y;
}

function autoLayoutNodes() {
  const shot = getActiveShot();
  if (!shot) return;
  recordUndo();
  layoutShotNodes(shot);
  render();
}

function layoutShotNodes(shot) {
  if (!shot) return;
  const storyboard = shot.nodes.find((node) => node.type === "main" && node.role === "storyboard");
  const sideNodes = shot.nodes.filter((node) => node.id !== storyboard?.id);
  const storyboardSize = getMainNodeSize(storyboard);
  const layoutGap = 28;
  const top = 36;
  if (storyboard) {
    storyboard.x = 36;
    storyboard.y = top;
  }
  const layoutLimit = storyboard
    ? top + estimateMainNodeHeight(storyboard)
    : getLayoutColumnLimit();
  const baseX = 36 + storyboardSize.width + layoutGap;
  const columns = [{ width: 0, placements: [], y: top }];
  sideNodes.forEach((node) => {
    const nodeSize = getNodeLayoutSize(node);
    let column = columns[columns.length - 1];
    if (column.y > top && column.y + nodeSize.height > layoutLimit) {
      column = { width: 0, placements: [], y: top };
      columns.push(column);
    }
    column.placements.push({ node, y: column.y });
    column.width = Math.max(column.width, nodeSize.width);
    column.y += nodeSize.height + layoutGap;
  });
  let columnX = baseX;
  columns.forEach((column) => {
    column.placements.forEach(({ node, y }) => {
      node.x = columnX;
      node.y = y;
    });
    columnX += column.width + layoutGap;
  });
}

function getNextSmallNodeSlot(shot, mainNode, excludeId = "") {
  const mainSize = getMainNodeSize(mainNode);
  const layoutGap = 28;
  const baseX = mainNode.x + mainSize.width + layoutGap;
  const baseY = mainNode.y;
  const occupied = shot.nodes.filter((item) => item.type === "small" && item.id !== excludeId);
  for (let slot = 0; slot < 80; slot += 1) {
    const x = baseX + Math.floor(slot / 4) * (SMALL_NODE_SIZE.width + layoutGap);
    const y = baseY + (slot % 4) * (SMALL_NODE_SIZE.height + layoutGap);
    const blocked = occupied.some((item) => rectsOverlap(
      { x, y, width: SMALL_NODE_SIZE.width, height: SMALL_NODE_SIZE.height },
      { x: item.x, y: item.y, width: SMALL_NODE_SIZE.width, height: estimateSmallNodeHeight(item) }
    ));
    if (!blocked) return { x, y };
  }
  return { x: baseX, y: baseY };
}

function estimateSmallNodeHeight(node) {
  const textLength = String(node.content || "").length;
  const lineCount = Math.max(1, Math.ceil(textLength / 30));
  return Math.max(SMALL_NODE_SIZE.height, 96 + lineCount * 24);
}

function getMainNodeSize(node) {
  return node?.role === "storyboard" ? STORYBOARD_NODE_SIZE : MAIN_NODE_SIZE;
}

function getNodeLayoutSize(node) {
  if (node.type === "main") {
    const size = getMainNodeSize(node);
    return {
      width: size.width,
      height: estimateMainNodeHeight(node)
    };
  }
  return {
    width: SMALL_NODE_SIZE.width,
    height: estimateSmallNodeHeight(node)
  };
}

function estimateMainNodeHeight(node) {
  const size = getMainNodeSize(node);
  if (!node?.asset) return size.height;
  const ratio = normalizeAssetRatio(node.assetRatio);
  return Math.max(size.height, 88 + size.width / ratio);
}

function getLayoutColumnLimit() {
  const canvas = $("#nodeCanvas");
  const shot = getActiveShot();
  const scale = normalizeViewport(shot?.viewport).scale || 1;
  return Math.max(720, (canvas?.clientHeight || 800) / scale - 72);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width + 16
    && a.x + a.width + 16 > b.x
    && a.y < b.y + b.height + 16
    && a.y + a.height + 16 > b.y;
}

function rectsIntersect(a, b) {
  return a.left < b.right
    && a.right > b.left
    && a.top < b.bottom
    && a.bottom > b.top;
}

async function addInspiration() {
  const project = getActiveProject();
  const title = $("#inspirationTitle").value.trim();
  const url = $("#inspirationUrl").value.trim();
  if (!title && !url && !pendingInspirationAssets.length) {
    showToast("请填写标题、链接或图片", "灵感卡片至少需要一个可记录的内容。");
    return;
  }
  recordUndo();
  project.inspirations.push({
    id: uid("insp"),
    title: title || "未命名灵感",
    url,
    type: $("#inspirationType").value,
    tags: $("#inspirationTags").value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
    difficulty: 3,
    asset: pendingInspirationAssets[0] || "",
    assets: [...pendingInspirationAssets]
  });
  $("#inspirationTitle").value = "";
  $("#inspirationUrl").value = "";
  $("#inspirationTags").value = "";
  pendingInspirationAssets = [];
  renderInspirationPreview();
  showToast("灵感已收集", "可以用圆点调整难度。");
  render();
}

function addKeyword() {
  const text = $("#keywordInput").value.trim();
  if (!text) return;
  recordUndo();
  let added = 0;
  const type = $("#keywordType").value;
  appState.globalKeywords = dedupeKeywords(appState.globalKeywords);
  text.split(/[，,]/).map((word) => word.trim()).filter(Boolean).forEach((word) => {
    const exists = appState.globalKeywords.some((keyword) => keyword.type === type && keyword.text === word);
    if (exists) return;
    appState.globalKeywords.push({
      id: uid("kw"),
      text: word,
      type
    });
    added += 1;
  });
  appState.globalKeywords = dedupeKeywords(appState.globalKeywords);
  $("#keywordInput").value = "";
  showToast(added ? "关键词已加入" : "关键词已存在", added ? "可以拖到节点画布或输入框。" : "同类型同文本不会重复添加。");
  render();
}

function exportJson() {
  downloadFile("storyboard-project-library.json", JSON.stringify(appState, null, 2), "application/json");
  showToast("工程已导出", "JSON 文件包含完整项目库。");
}

function exportScript() {
  const project = getActiveProject();
  let cursor = 0;
  const lines = [`项目：${project.title}`, `总时长：${formatSeconds(getTotalDuration(project))}`, ""];
  project.shots.forEach((shot) => {
    const start = formatSeconds(cursor);
    cursor += Number(shot.duration || 0);
    lines.push(`${shot.code}｜${shot.scene}｜${start}-${formatSeconds(cursor)}｜${shot.duration}s`);
    lines.push(`节奏：${shot.pace}`);
    lines.push("节点：");
    shot.nodes.forEach((node) => lines.push(`- ${node.title}：${node.content || ""}`));
    lines.push("");
  });
  downloadFile(`${project.title || "storyboard"}-脚本.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  showToast("脚本已导出", "文本版适合发给团队查看。");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.className = "download-link";
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getImageRatio(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(normalizeAssetRatio(img.naturalWidth / img.naturalHeight));
    img.onerror = () => resolve(16 / 9);
    img.src = src;
  });
}

function normalizeAssetRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return 16 / 9;
  return Math.max(0.35, Math.min(3.2, ratio));
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value || 0));
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function roleName(role) {
  return {
    storyboard: "分镜画面",
    reference: "参考画面",
    effect: "参考效果"
  }[role] || "节点";
}

function appendToken(value, token) {
  const clean = String(value || "").trim();
  return clean ? `${clean}${clean.endsWith("；") ? "" : "；"}${token}；` : `${token}；`;
}

function isTypingTarget(target) {
  return target.matches("input, textarea, select") || target.isContentEditable;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

$("#createProjectBtn").addEventListener("click", createProject);
$("#backHomeBtn").addEventListener("click", () => {
  appState.currentView = "home";
  render();
});
$("#exportJsonBtn").addEventListener("click", exportJson);
$("#exportScriptBtn").addEventListener("click", exportScript);
$("#compactTimelineBtn").addEventListener("click", () => {
  adjustTimelineScale(-4);
});
$("#wideTimelineBtn").addEventListener("click", () => {
  adjustTimelineScale(4);
});
$("#projectTitle").addEventListener("input", (event) => {
  recordUndo();
  getActiveProject().title = event.target.value;
  saveProjectTouch();
});
$("#shotEditor").addEventListener("input", (event) => {
  const shot = getActiveShot();
  if (!shot || !event.target.dataset.field) return;
  recordUndo();
  const field = event.target.dataset.field;
  shot[field] = field === "duration" ? Number(event.target.value) : event.target.value;
  if (field === "scene") fitSceneInput();
  renderProject();
  renderTimeline();
  saveProjectTouch();
});
$$("[data-add-main-node]").forEach((button) => {
  button.addEventListener("click", () => addMainNode(button.dataset.addMainNode));
});
$("#autoLayoutNodesBtn").addEventListener("click", autoLayoutNodes);
$("#addInspirationBtn").addEventListener("click", addInspiration);
$("#inspirationAssetInput").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  const assets = await Promise.all(files.map(fileToDataUrl));
  pendingInspirationAssets.push(...assets);
  renderInspirationPreview();
});
$("#addKeywordBtn").addEventListener("click", addKeyword);
$("#keywordInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addKeyword();
  }
});
$("#timelineRuler").addEventListener("wheel", (event) => {
  event.preventDefault();
  adjustTimelineScale(event.deltaY > 0 ? -2 : 2);
}, { passive: false });
$$("[data-prompt-slot]").forEach((input) => {
  input.addEventListener("input", (event) => {
    recordUndo();
    getActiveProject().promptSentence[event.target.dataset.promptSlot] = event.target.value;
    saveProjectTouch();
  });
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest("#nodeCanvas")) event.preventDefault();
});
$("#nodeCanvas").addEventListener("drop", (event) => {
  if (event.target.matches("input, textarea")) return;
  event.preventDefault();
  const text = event.dataTransfer.getData("text/plain");
  if (!text) return;
  const category = event.dataTransfer.getData("application/x-keyword-type");
  const point = screenToCanvasPoint(event);
  const shot = getActiveShot();
  recordUndo();
  shot.nodes.push(createSmallNode("AI提示词", text, point.x, point.y, "", false, category));
  showToast("提示词已变成节点", text);
  render();
});
$("#nodeCanvas").addEventListener("wheel", zoomNodeCanvas, { passive: false });
$("#nodeCanvas").addEventListener("pointerdown", startCanvasPan);
$("#nodeCanvas").addEventListener("pointerdown", startNodeSelection);
document.addEventListener("dragover", (event) => {
  if (event.target.matches("input, textarea")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (!event.target.matches("input, textarea")) return;
  const text = event.dataTransfer.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  recordUndo();
  event.target.value = appendToken(event.target.value, text);
  event.target.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("pointermove", dragNode);
document.addEventListener("pointermove", panNodeCanvas);
document.addEventListener("pointermove", updateSelectionBox);
document.addEventListener("pointerup", finishNodeDrag);
document.addEventListener("pointerup", finishCanvasPan);
document.addEventListener("pointerup", finishNodeSelection);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && appState.currentView === "editor" && !isTypingTarget(event.target)) {
    event.preventDefault();
    undoLastProjectChange();
    return;
  }
  if (event.key !== "Delete" || appState.currentView !== "editor" || isTypingTarget(event.target)) return;
  if (selectedNodeIds.size > 1) {
    removeNodes([...selectedNodeIds]);
    return;
  }
  if (selectedNodeId) {
    const shot = getActiveShot();
    const node = shot?.nodes.find((item) => item.id === selectedNodeId);
    if (node) {
      removeNode(node.id);
      return;
    }
  }
  const shot = getActiveShot();
  if (shot) deleteShot(shot.id);
});
$("#importJsonInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (Array.isArray(imported.projects)) {
      const projects = imported.projects.map(normalizeProject);
      appState = {
        activeProjectId: imported.activeProjectId || projects[0]?.id,
        currentView: "home",
        globalKeywords: Array.isArray(imported.globalKeywords)
          ? dedupeKeywords([...imported.globalKeywords, ...projects.flatMap((project) => project.keywords || [])])
          : mergeKeywords(projects.flatMap((project) => project.keywords || [])),
        projects
      };
      appState.projects.forEach((project) => {
        project.keywords = [];
      });
    } else {
      const project = normalizeProject(imported);
      appState.projects.unshift(project);
      appState.globalKeywords = dedupeKeywords([
        ...(appState.globalKeywords || []),
        ...(project.keywords || [])
      ]);
      project.keywords = [];
      appState.activeProjectId = project.id;
      appState.currentView = "editor";
    }
    showToast("工程已导入", "项目库已经更新。");
    render();
  } catch {
    alert("导入失败：请选择本工具导出的 JSON 工程文件。");
  } finally {
    event.target.value = "";
  }
});

appState.currentView = "home";
render();
