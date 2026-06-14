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

let appState = loadAppState();
let dragShotId = "";
let draggedNodeId = "";
let selectedNodeId = "";
let pendingConnectionNodeId = "";
let nodeDragOffset = { x: 0, y: 0 };

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
    projects: [project]
  };
}

function loadAppState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      parsed.projects = (parsed.projects || []).map(normalizeProject);
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
    timelineScale: project.timelineScale || "compact",
    activeShotId: project.activeShotId || project.shots?.[0]?.id || "",
    createdAt: project.createdAt || Date.now(),
    updatedAt: project.updatedAt || Date.now(),
    shots: (project.shots || []).map(normalizeShot),
    inspirations: (project.inspirations || []).map(normalizeInspiration),
    keywords: mergeKeywords(project.keywords),
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
  const merged = [...keywords];
  DEFAULT_KEYWORDS.forEach((keyword) => {
    const exists = merged.some((item) => item.text === keyword.text && item.type === keyword.type);
    if (!exists) merged.push(structuredClone(keyword));
  });
  return merged;
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
    locked: Boolean(node.locked) || (type === "small" && DEFAULT_SMALL_NODE_TITLES.includes(title))
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
  return {
    id: item.id || uid("insp"),
    title: item.title || "未命名灵感",
    url: item.url || "",
    type: item.type || "构图",
    tags: item.tags || [],
    difficulty: Number(item.difficulty || item.score || 3)
  };
}

function createProjectData(title = "新分镜项目") {
  const firstShot = createShot("S01");
  return {
    id: uid("project"),
    title,
    timelineScale: "compact",
    activeShotId: firstShot.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    shots: [firstShot],
    inspirations: [],
    keywords: structuredClone(DEFAULT_KEYWORDS),
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
  return shot;
}

function createDefaultNodes(shot = {}) {
  const mainId = uid("node-main");
  return [
    {
      id: mainId,
      type: "main",
      role: "storyboard",
      x: 44,
      y: 54,
      parentId: "",
      title: "分镜画面",
      content: "",
      asset: ""
    },
    createSmallNode("景别", shot.shotSize || "中景", 340, 44, mainId, true),
    createSmallNode("画面描述", shot.action || "", 340, 142, mainId, true),
    createSmallNode("镜头语言", shot.visualLanguage || "", 340, 250, mainId, true),
    createSmallNode("表达含义", shot.notes || "", 340, 358, mainId, true)
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
    x: 80 + Math.random() * 120,
    y: 70 + Math.random() * 120,
    parentId: "",
    title: labels[role],
    content: "",
    asset: ""
  };
}

function createSmallNode(title, content = "", x = 420, y = 120, parentId = "", locked = false) {
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
    renderShotList();
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
    const coverStyle = cover ? ` style="--cover-image: url('${escapeAttribute(cover)}')"` : "";
    card.innerHTML = `
      <div class="${recordClass}"${coverStyle} aria-hidden="true">
        <span class="record-label"></span>
      </div>
      <div class="tonearm" aria-hidden="true">
        <i></i>
      </div>
      <div class="album-sleeve">
        <header>
          <span>${project.shots.length} 镜头</span>
          <button type="button" data-delete-project>删除</button>
        </header>
        <div class="${coverClass}"${coverStyle}></div>
        <div class="album-meta">
          <h2>${escapeHtml(project.title)}</h2>
          <p>${formatSeconds(total)} · ${project.inspirations.length} 条灵感 · ${project.keywords.length} 个提示词</p>
          <button type="button" data-open-project>打开项目</button>
        </div>
      </div>
    `;
    $("[data-open-project]", card).addEventListener("click", () => openProject(project.id));
    $("[data-delete-project]", card).addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(project.id);
    });
    card.addEventListener("dblclick", () => openProject(project.id));
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

function renderTimeline() {
  const project = getActiveProject();
  const timeline = $("#timeline");
  const ruler = $("#timelineRuler");
  timeline.innerHTML = "";
  ruler.innerHTML = "";
  const total = getTotalDuration(project);
  const visibleDuration = Math.max(30, Math.ceil(total / 5) * 5);
  const pixelsPerSecond = project.timelineScale === "wide" ? 34 : 22;
  const shotWidthTotal = project.shots.reduce((sum, shot) => {
    return sum + Math.max(76, Number(shot.duration || 0) * pixelsPerSecond);
  }, Math.max(0, project.shots.length - 1) * 8 + 130);
  const timelineWidth = Math.max(visibleDuration * pixelsPerSecond, shotWidthTotal);

  timeline.style.minWidth = `${timelineWidth}px`;
  ruler.style.minWidth = `${timelineWidth}px`;
  timeline.closest(".timeline-stage").style.setProperty("--timeline-second", `${pixelsPerSecond}px`);
  $("#timelineSummary").textContent = `${project.shots.length} 个镜头，预计 ${formatSeconds(total)}，拖动镜头可重排`;

  for (let second = 0; second <= visibleDuration; second += 5) {
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
    item.style.width = `${Math.max(76, Number(shot.duration || 0) * pixelsPerSecond)}px`;
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

function renderShotList() {
  const project = getActiveProject();
  const list = $("#shotList");
  list.innerHTML = "";
  project.shots.forEach((shot, index) => {
    const row = document.createElement("article");
    row.className = `shot-row${shot.id === project.activeShotId ? " is-active" : ""}`;
    row.innerHTML = `
      <header>
        <span>${escapeHtml(shot.code)}</span>
        <span>${Number(shot.duration || 0)}s</span>
      </header>
      <p>${escapeHtml(shot.scene)} · ${escapeHtml(shot.movement || "未填写运动")}</p>
      <div class="row-actions">
        <button type="button" data-move="up">上移</button>
        <button type="button" data-move="down">下移</button>
        <button type="button" data-delete>删除</button>
      </div>
    `;
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      project.activeShotId = shot.id;
      render();
    });
    $("[data-move='up']", row).addEventListener("click", () => moveShot(index, -1));
    $("[data-move='down']", row).addEventListener("click", () => moveShot(index, 1));
    $("[data-delete]", row).addEventListener("click", () => deleteShot(shot.id));
    list.appendChild(row);
  });
}

function renderEditor() {
  const shot = getActiveShot();
  $("#emptyState").hidden = Boolean(shot);
  $("#shotEditor").hidden = !shot;
  if (!shot) return;
  if (selectedNodeId && !shot.nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = "";
    pendingConnectionNodeId = "";
  }

  $$("[data-field]").forEach((input) => {
    input.value = shot[input.dataset.field] ?? "";
  });
  renderNodeCanvas();
}

function renderNodeCanvas() {
  const shot = getActiveShot();
  const canvas = $("#nodeCanvas");
  canvas.innerHTML = "";
  if (!shot) return;

  drawNodeConnections(canvas, shot);
  shot.nodes.forEach((node) => {
    const nodeEl = document.createElement("article");
    nodeEl.className = `canvas-node ${node.type === "main" ? "main-node" : "small-node"}${node.id === selectedNodeId ? " is-selected" : ""}${node.id === pendingConnectionNodeId ? " is-connecting" : ""}`;
    nodeEl.classList.add(node.type === "main" ? "main-node" : "small-node");
    nodeEl.dataset.nodeId = node.id;
    nodeEl.dataset.role = node.role;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.innerHTML = node.type === "main" ? renderMainNodeHtml(node) : renderSmallNodeHtml(node);

    nodeEl.addEventListener("pointerdown", (event) => startNodeDrag(event, node));
    nodeEl.addEventListener("click", (event) => {
      if (event.target.closest("button, input, textarea, label, img")) return;
      selectedNodeId = node.id;
      renderNodeCanvas();
    });
    nodeEl.addEventListener("dragover", (event) => event.preventDefault());
    nodeEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const text = event.dataTransfer.getData("text/plain");
      if (text) {
        node.content = appendToken(node.content, text);
        render();
      }
    });

    const titleInput = $("[data-node-title]", nodeEl);
    titleInput.addEventListener("input", (event) => {
      node.title = event.target.value;
      saveProjectTouch();
    });

    const contentInput = $("[data-node-content]", nodeEl);
    if (contentInput) {
      contentInput.addEventListener("input", (event) => {
        node.content = event.target.value;
        saveProjectTouch();
      });
    }

    $("[data-connection-port]", nodeEl).addEventListener("click", (event) => {
      event.stopPropagation();
      handleConnectionPort(node.id);
    });

    const img = $("[data-node-image]", nodeEl);
    if (img && node.asset) {
      img.addEventListener("click", () => openLightbox(node.asset, node.title));
    }

    const upload = $("[data-node-upload]", nodeEl);
    if (upload) {
      upload.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        node.asset = await fileToDataUrl(file);
        showToast("图片已加入节点", node.title);
        render();
      });
    }
    canvas.appendChild(nodeEl);
  });
}

function renderMainNodeHtml(node) {
  const imageHtml = node.asset
    ? `<img data-node-image src="${node.asset}" alt="${escapeHtml(node.title)}">`
    : `<div class="node-image-placeholder"><span>添加图片</span></div>`;
  return `
    <button type="button" class="connection-port" data-connection-port title="连接节点"></button>
    <header>
      <input data-node-title type="text" value="${escapeAttribute(node.title)}" aria-label="节点标题">
    </header>
    <label class="main-image-drop">
      ${imageHtml}
      <input type="file" accept="image/*" data-node-upload>
    </label>
  `;
}

function renderSmallNodeHtml(node) {
  return `
    <button type="button" class="connection-port" data-connection-port title="连接节点"></button>
    <header>
      <input data-node-title type="text" value="${escapeAttribute(node.title)}" aria-label="节点标题">
    </header>
    <textarea data-node-content rows="2" aria-label="节点内容">${escapeHtml(node.content || "")}</textarea>
  `;
}

function drawNodeConnections(canvas, shot) {
  $$(".node-lines", canvas).forEach((lineLayer) => lineLayer.remove());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("node-lines");
  (shot.connections || []).forEach((connection) => {
    const from = shot.nodes.find((node) => node.id === connection.from);
    const to = shot.nodes.find((node) => node.id === connection.to);
    if (!from || !to) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const fromPoint = getNodeCenter(from);
    const toPoint = getNodeCenter(to);
    line.setAttribute("x1", fromPoint.x);
    line.setAttribute("y1", fromPoint.y);
    line.setAttribute("x2", toPoint.x);
    line.setAttribute("y2", toPoint.y);
    line.dataset.connectionId = connection.id;
    line.addEventListener("click", () => removeConnection(connection.id));
    svg.appendChild(line);
  });
  canvas.appendChild(svg);
}

function getNodeCenter(node) {
  const width = node.type === "main" ? 240 : 168;
  const height = node.type === "main" ? 172 : 86;
  return {
    x: node.x + width / 2,
    y: node.y + height / 2
  };
}

function renderInspirations() {
  const project = getActiveProject();
  const list = $("#inspirationList");
  list.innerHTML = "";
  [...project.inspirations].sort((a, b) => b.difficulty - a.difficulty).forEach((item) => {
    const card = document.createElement("article");
    card.className = "inspiration-card";
    card.innerHTML = `
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
        item.difficulty = index;
        saveProjectTouch();
        renderInspirations();
      });
      dots.appendChild(dot);
    }
    $("[data-remove-inspiration]", card).addEventListener("click", () => {
      project.inspirations = project.inspirations.filter((inspiration) => inspiration.id !== item.id);
      render();
    });
    list.appendChild(card);
  });
}

function renderKeywords() {
  const project = getActiveProject();
  const list = $("#keywordCategoryList");
  list.innerHTML = "";
  KEYWORD_CATEGORIES.forEach((category) => {
    const group = document.createElement("section");
    group.className = "keyword-category";
    group.innerHTML = `<h3>${escapeHtml(category)}</h3><div class="keyword-bank"></div>`;
    const bank = $(".keyword-bank", group);
    project.keywords.filter((keyword) => keyword.type === category).forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "keyword-chip";
      chip.draggable = true;
      chip.dataset.type = keyword.type;
      chip.textContent = keyword.text;
      chip.title = "拖到节点画布或输入框";
      chip.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", keyword.text);
      });
      chip.addEventListener("dblclick", () => {
        project.keywords = project.keywords.filter((item) => item.id !== keyword.id);
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
  const [shot] = project.shots.splice(fromIndex, 1);
  project.shots.splice(toIndex, 0, shot);
  project.activeShotId = shot.id;
  render();
}

function moveShot(index, direction) {
  const project = getActiveProject();
  const target = index + direction;
  if (target < 0 || target >= project.shots.length) return;
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
  project.shots = project.shots.filter((shot) => shot.id !== id);
  project.activeShotId = project.shots[0]?.id || "";
  showToast("已删除镜头", "时间线已重新排列。");
  render();
}

function startNodeDrag(event, node) {
  if (event.target.matches("input, textarea, button, label, img")) return;
  event.preventDefault();
  draggedNodeId = node.id;
  selectedNodeId = node.id;
  const rect = event.currentTarget.getBoundingClientRect();
  nodeDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function dragNode(event) {
  if (!draggedNodeId) return;
  const shot = getActiveShot();
  const canvas = $("#nodeCanvas");
  const node = shot.nodes.find((item) => item.id === draggedNodeId);
  if (!node) return;
  const rect = canvas.getBoundingClientRect();
  node.x = Math.max(0, Math.min(rect.width - 180, event.clientX - rect.left - nodeDragOffset.x));
  node.y = Math.max(0, Math.min(rect.height - 120, event.clientY - rect.top - nodeDragOffset.y));
  const nodeEl = $(`[data-node-id="${node.id}"]`, canvas);
  if (nodeEl) {
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
  }
  drawNodeConnections(canvas, shot);
}

function finishNodeDrag() {
  if (!draggedNodeId) return;
  const shot = getActiveShot();
  const node = shot.nodes.find((item) => item.id === draggedNodeId);
  if (node?.type === "small") snapNodeToMain(node, shot);
  draggedNodeId = "";
  render();
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
  shot.nodes.push(createMainNode(role));
  showToast("大节点已创建", roleName(role));
  render();
}

function addSmallNode(title = "新小节点", content = "") {
  const shot = getActiveShot();
  const main = shot.nodes.find((node) => node.type === "main");
  const node = createSmallNode(title, content, 360 + Math.random() * 80, 120 + Math.random() * 160, "", false);
  shot.nodes.push(node);
  if (main) toggleConnection(main.id, node.id, false);
  render();
}

function removeNode(nodeId) {
  const shot = getActiveShot();
  const node = shot.nodes.find((item) => item.id === nodeId);
  if (node?.locked) {
    showToast("默认节点已保留", "核心小节点不能删除。");
    return;
  }
  if (node?.type === "main" && shot.nodes.filter((item) => item.type === "main").length === 1) {
    showToast("至少保留一个大节点", "默认分镜画面节点不能全部删除。");
    return;
  }
  shot.nodes = shot.nodes.filter((item) => item.id !== nodeId);
  shot.connections = (shot.connections || []).filter((connection) => connection.from !== nodeId && connection.to !== nodeId);
  selectedNodeId = selectedNodeId === nodeId ? "" : selectedNodeId;
  render();
}

function handleConnectionPort(nodeId) {
  selectedNodeId = nodeId;
  if (!pendingConnectionNodeId) {
    pendingConnectionNodeId = nodeId;
    renderNodeCanvas();
    return;
  }
  if (pendingConnectionNodeId !== nodeId) {
    toggleConnection(pendingConnectionNodeId, nodeId);
  }
  pendingConnectionNodeId = "";
  render();
}

function toggleConnection(from, to, shouldRender = true) {
  const shot = getActiveShot();
  if (!shot || from === to) return;
  shot.connections ||= [];
  const existing = shot.connections.find((connection) => {
    return [connection.from, connection.to].includes(from) && [connection.from, connection.to].includes(to);
  });
  if (existing) {
    shot.connections = shot.connections.filter((connection) => connection.id !== existing.id);
  } else {
    shot.connections.push({ id: uid("conn"), from, to });
  }
  if (shouldRender) render();
}

function removeConnection(connectionId) {
  const shot = getActiveShot();
  shot.connections = (shot.connections || []).filter((connection) => connection.id !== connectionId);
  render();
}

function snapNodeToMain(node, shot) {
  const nearest = findNearestMainNode(node, shot.nodes);
  if (!nearest || nearest.distance >= 180) return;
  const siblings = shot.nodes.filter((item) => item.type === "small" && item.id !== node.id);
  const slot = siblings.filter((item) => Math.abs(item.x - (nearest.node.x + 290)) < 80).length;
  node.x = nearest.node.x + 300;
  node.y = nearest.node.y + 8 + slot * 78;
  const exists = (shot.connections || []).some((connection) => {
    return [connection.from, connection.to].includes(node.id) && [connection.from, connection.to].includes(nearest.node.id);
  });
  if (!exists) {
    shot.connections ||= [];
    shot.connections.push({ id: uid("conn"), from: nearest.node.id, to: node.id });
  }
}

function autoLayoutNodes() {
  const shot = getActiveShot();
  if (!shot) return;
  const mains = shot.nodes.filter((node) => node.type === "main");
  const smalls = shot.nodes.filter((node) => node.type === "small");
  mains.forEach((node, index) => {
    node.x = 42;
    node.y = 42 + index * 220;
  });
  smalls.forEach((node, index) => {
    node.x = 360 + Math.floor(index / 4) * 220;
    node.y = 42 + (index % 4) * 94;
  });
  render();
}

async function addInspiration() {
  const project = getActiveProject();
  const title = $("#inspirationTitle").value.trim();
  const url = $("#inspirationUrl").value.trim();
  if (!title || !url) {
    showToast("请填写标题和链接", "灵感卡片需要一个可打开的网页地址。");
    return;
  }
  project.inspirations.push({
    id: uid("insp"),
    title,
    url,
    type: $("#inspirationType").value,
    tags: $("#inspirationTags").value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
    difficulty: 3
  });
  $("#inspirationTitle").value = "";
  $("#inspirationUrl").value = "";
  $("#inspirationTags").value = "";
  showToast("灵感链接已收集", "可以用圆点调整难度。");
  render();
}

function addKeyword() {
  const project = getActiveProject();
  const text = $("#keywordInput").value.trim();
  if (!text) return;
  text.split(/[，,]/).map((word) => word.trim()).filter(Boolean).forEach((word) => {
    project.keywords.push({
      id: uid("kw"),
      text: word,
      type: $("#keywordType").value
    });
  });
  $("#keywordInput").value = "";
  showToast("关键词已加入", "可以拖到节点画布或输入框。");
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
  getActiveProject().timelineScale = "compact";
  render();
});
$("#wideTimelineBtn").addEventListener("click", () => {
  getActiveProject().timelineScale = "wide";
  render();
});
$("#projectTitle").addEventListener("input", (event) => {
  getActiveProject().title = event.target.value;
  saveProjectTouch();
});
$("#shotEditor").addEventListener("input", (event) => {
  const shot = getActiveShot();
  if (!shot || !event.target.dataset.field) return;
  const field = event.target.dataset.field;
  shot[field] = field === "duration" ? Number(event.target.value) : event.target.value;
  renderProject();
  renderTimeline();
  renderShotList();
  saveProjectTouch();
});
$$("[data-add-main-node]").forEach((button) => {
  button.addEventListener("click", () => addMainNode(button.dataset.addMainNode));
});
$("#autoLayoutNodesBtn").addEventListener("click", autoLayoutNodes);
$("#addInspirationBtn").addEventListener("click", addInspiration);
$("#addKeywordBtn").addEventListener("click", addKeyword);
$("#keywordInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addKeyword();
  }
});
$$("[data-prompt-slot]").forEach((input) => {
  input.addEventListener("input", (event) => {
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
  const rect = event.currentTarget.getBoundingClientRect();
  const shot = getActiveShot();
  shot.nodes.push(createSmallNode("AI提示词", text, event.clientX - rect.left, event.clientY - rect.top));
  showToast("提示词已变成节点", text);
  render();
});
document.addEventListener("dragover", (event) => {
  if (event.target.matches("input, textarea")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (!event.target.matches("input, textarea")) return;
  const text = event.dataTransfer.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  event.target.value = appendToken(event.target.value, text);
  event.target.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("pointermove", dragNode);
document.addEventListener("pointerup", finishNodeDrag);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" || appState.currentView !== "editor" || isTypingTarget(event.target)) return;
  if (selectedNodeId) {
    const shot = getActiveShot();
    const node = shot?.nodes.find((item) => item.id === selectedNodeId);
    if (node && !node.locked) {
      if (node.type === "small") {
        removeNode(node.id);
      } else {
        showToast("大节点已保留", "大节点可通过画布整理，不会用 Delete 删除。");
      }
      return;
    }
    if (node?.locked) {
      showToast("默认节点已保留", "核心小节点不能删除。");
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
      appState = {
        activeProjectId: imported.activeProjectId || imported.projects[0]?.id,
        currentView: "home",
        projects: imported.projects.map(normalizeProject)
      };
    } else {
      const project = normalizeProject(imported);
      appState.projects.unshift(project);
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

render();
