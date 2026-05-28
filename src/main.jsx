import React from "react";
import { createRoot } from "react-dom/client";
import { EMOJI_CATEGORIES, getEmojiCategory } from "./emojiLibrary";
import { createEmojiPatternStickers, createEmojiRainDrops, EMOJI_PATTERNS, EMOJI_RAIN_THEMES, getEmojiPattern, getEmojiRainLifetime } from "./emojiPlay";
import {
  addBranch,
  addBranchMilestoneAfter,
  addMilestoneAfter,
  addPlanMilestoneAfter,
  addCrossTaskLink,
  buildTask,
  chooseStoredBoard,
  connectBranchToNode,
  completeTask,
  createConfettiBurst,
  createEmojiSticker,
  deleteBranch,
  deleteBranchNode,
  deleteCrossTaskLink,
  deleteNode,
  deleteTask,
  formatCompactDate,
  getAchievementCollection,
  getCompletedTaskSummary,
  getBranchSegments,
  getTaskBranchEntries,
  getCrossTaskLinkSegments,
  getNewlyUnlockedAchievements,
  getNextViewportScale,
  getTaskProcessEntries,
  moveCanvasItem,
  normalizeBoard,
  restoreTask,
  toggleKeyNode,
  togglePlanMilestoneComplete,
  unlockBoardAchievements,
} from "./progressCore";
import "./styles.css";

const STORAGE_KEY = "stepview-board-v1";
const emoji = (codePoint) => String.fromCodePoint(codePoint);
const INITIAL_BOARD = { tasks: [], stickers: [], links: [], achievements: [] };
const desktopApi = window.stepview;

function loadBrowserBoard() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeBoard(JSON.parse(saved)) : INITIAL_BOARD;
  } catch {
    return INITIAL_BOARD;
  }
}

function screenToWorld(event, viewport, canvasElement) {
  const rect = canvasElement?.getBoundingClientRect() || { left: 0, top: 0 };
  return {
    x: (event.clientX - rect.left - viewport.x) / viewport.scale,
    y: (event.clientY - rect.top - viewport.y) / viewport.scale,
  };
}

function isCanvasPanTarget(target) {
  return target instanceof Element && !target.closest(".node, .sticker, .contextMenu, .modalBackdrop, .galleryBackdrop, .linkHandle, .crossTaskEdgeHit");
}

function App() {
  const [board, setBoard] = React.useState(INITIAL_BOARD);
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, scale: 1 });
  const [menu, setMenu] = React.useState(null);
  const [selectedLinkId, setSelectedLinkId] = React.useState(null);
  const [selectedBranchId, setSelectedBranchId] = React.useState(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState(null);
  const [dragState, setDragState] = React.useState(null);
  const [noteDraft, setNoteDraft] = React.useState(null);
  const [branchDraft, setBranchDraft] = React.useState(null);
  const [linkDrag, setLinkDrag] = React.useState(null);
  const [branchLinkDrag, setBranchLinkDrag] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [achievementPopup, setAchievementPopup] = React.useState(null);
  const [tutorialOpen, setTutorialOpen] = React.useState(false);
  const [completedGalleryOpen, setCompletedGalleryOpen] = React.useState(false);
  const [achievementGalleryOpen, setAchievementGalleryOpen] = React.useState(false);
  const [selectedCompletedTaskId, setSelectedCompletedTaskId] = React.useState(null);
  const [confetti, setConfetti] = React.useState([]);
  const [loveRain, setLoveRain] = React.useState([]);
  const [emojiRain, setEmojiRain] = React.useState([]);
  const [quickGoal, setQuickGoal] = React.useState("Ship StepView v1");
  const [emojiCategoryId, setEmojiCategoryId] = React.useState(EMOJI_CATEGORIES[0].id);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const canvasRef = React.useRef(null);

  const persistBoard = React.useCallback((nextBoard) => {
    const snapshot = { ...normalizeBoard(nextBoard), updatedAt: new Date().toISOString() };
    if (desktopApi) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (backupError) {
        console.error("Failed to save browser backup", backupError);
      }
      desktopApi.saveBoard(snapshot).catch((error) => {
        console.error("Failed to save board", error);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
          setToast("Local file save failed; browser backup saved.");
        } catch (backupError) {
          console.error("Failed to save browser backup", backupError);
          setToast("Save failed. Please avoid closing StepView.");
        }
      });
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error("Failed to save board", error);
      setToast("Save failed. Please avoid closing StepView.");
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (desktopApi) {
          const saved = chooseStoredBoard(await desktopApi.loadBoard(), loadBrowserBoard());
          if (!cancelled) {
            setBoard(saved);
            persistBoard(saved);
          }
          return;
        }
        if (!cancelled) setBoard(loadBrowserBoard());
      } catch (error) {
        console.error("Failed to load board", error);
        if (!cancelled) {
          setBoard(loadBrowserBoard());
          setToast("Load failed, using browser backup.");
        }
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [persistBoard]);

  const updateBoard = React.useCallback((updater) => {
    setBoard((current) => {
      const rawNextBoard = typeof updater === "function" ? updater(current) : updater;
      const nextBoard = unlockBoardAchievements(rawNextBoard);
      const [achievement] = getNewlyUnlockedAchievements(current, nextBoard);
      if (achievement) {
        setAchievementPopup(achievement);
        window.setTimeout(() => setAchievementPopup(null), 3600);
      }
      if (isLoaded) persistBoard(nextBoard);
      return nextBoard;
    });
  }, [isLoaded, persistBoard]);

  const activeTasks = board.tasks.filter((task) => task.status === "active");
  const completedTasks = board.tasks.filter((task) => task.status === "completed");
  const activeEmojiCategory = getEmojiCategory(emojiCategoryId);
  const achievementCollection = getAchievementCollection(board);
  const unlockedAchievements = achievementCollection.filter((achievement) => achievement.unlocked);
  const selectedCompletedTask = completedTasks.find((task) => task.id === selectedCompletedTaskId);
  const latestCompletedAt = completedTasks
    .map((task) => task.completedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  const updateTask = (taskId, updater) => {
    updateBoard((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  };

  const closeCompletedGallery = () => {
    setCompletedGalleryOpen(false);
    setSelectedCompletedTaskId(null);
  };

  const playEmojiRain = (theme) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const drops = createEmojiRainDrops(theme, { width: rect?.width || window.innerWidth, height: rect?.height || window.innerHeight });
    setEmojiRain(drops);
    window.setTimeout(() => setEmojiRain([]), getEmojiRainLifetime(drops));
  };

  const createGoal = (position = { x: 760 + activeTasks.length * 80, y: 360 + activeTasks.length * 80 }) => {
    if (!quickGoal.trim()) return;
    updateBoard((current) => ({ ...current, tasks: [...current.tasks, buildTask(quickGoal, position, new Date())] }));
    setMenu(null);
  };

  const addMilestone = (taskId, nodeId, kind = "milestone") => {
    const task = board.tasks.find((candidate) => candidate.id === taskId);
    const node = task?.nodes.find((candidate) => candidate.id === nodeId);
    setNoteDraft({ taskId, nodeId, branchId: node?.branchId || null, kind, title: "", detail: "", timestamp: new Date().toISOString().slice(0, 16) });
  };

  const saveMilestone = (event) => {
    event.preventDefault();
    if (noteDraft.branchId) {
      updateBoard((current) => addBranchMilestoneAfter(current, noteDraft.branchId, noteDraft.nodeId, {
        title: noteDraft.title,
        detail: noteDraft.detail,
        timestamp: new Date(noteDraft.timestamp).toISOString(),
      }));
      setNoteDraft(null);
      return;
    }
    const addNode = noteDraft.kind === "plan-milestone" ? addPlanMilestoneAfter : addMilestoneAfter;
    updateTask(noteDraft.taskId, (task) =>
      addNode(task, noteDraft.nodeId, {
        title: noteDraft.title,
        detail: noteDraft.detail,
        timestamp: new Date(noteDraft.timestamp).toISOString(),
      }),
    );
    setNoteDraft(null);
  };

  const randomBranchAnchor = () => {
    const anchors = ["right-top", "right-bottom", "bottom", "left-bottom"];
    return anchors[Math.floor(Math.random() * anchors.length)];
  };

  const startBranchDraft = (event, node) => {
    event.stopPropagation();
    setBranchDraft({ type: "self", stage: "details", nodeId: node.id, label: "", partnerName: "" });
    setMenu(null);
  };

  const saveBranchDraft = (event) => {
    event.preventDefault();
    if (!branchDraft) return;
    updateBoard((current) => addBranch(current, branchDraft.nodeId, {
      type: branchDraft.type,
      anchor: randomBranchAnchor(),
      label: branchDraft.label.trim(),
      partnerName: branchDraft.partnerName,
    }));
    if (branchDraft.type === "lover") {
      const symbols = ["💗", "💖", "💕", "💘", "✨", "⭐", "🌟", "💫"];
      setLoveRain(Array.from({ length: 22 }, (_, index) => ({
        id: `${Date.now()}-${index}`,
        symbol: symbols[index % symbols.length],
        left: 4 + Math.random() * 92,
        delay: Math.random() * .8,
        duration: 2.4 + Math.random() * 1.5,
        size: 20 + Math.random() * 18,
        drift: -70 + Math.random() * 140,
        spin: -80 + Math.random() * 160,
      })));
      window.setTimeout(() => setLoveRain([]), 4600);
      showToast("心动支线已开启。");
    } else {
      showToast("支线已创建。");
    }
    setBranchDraft(null);
  };

  const startBranchLinkDrag = (event, node) => {
    event.stopPropagation();
    if (!node.branchId) return;
    const branch = board.branches.find((candidate) => candidate.id === node.branchId);
    if (!branch) return;
    setBranchLinkDrag({ branchId: branch.id, type: branch.type, fromNodeId: node.id, from: { x: node.x, y: node.y }, to: { x: node.x, y: node.y } });
    showToast("拖到主线节点接回。");
  };

  const finishBranchLinkDrag = (targetNode) => {
    if (!branchLinkDrag || branchLinkDrag.fromNodeId === targetNode.id || targetNode.branchId) return false;
    try {
      updateBoard((current) => connectBranchToNode(current, branchLinkDrag.branchId, targetNode.id));
      showToast("支线已接回主线。");
    } catch (error) {
      showToast(error.message);
    }
    setBranchLinkDrag(null);
    return true;
  };

  const deleteSelectedBranch = () => {
    if (!selectedBranchId) return;
    if (!confirm("删除这条支线？主线节点会保留。")) return;
    updateBoard((current) => deleteBranch(current, selectedBranchId));
    setSelectedBranchId(null);
    showToast("支线已删除。");
  };

  const deleteNodeFromBoard = (taskId, node) => {
    if (node.branchId) {
      updateBoard((current) => deleteBranchNode(current, node.id));
      return;
    }
    updateTask(taskId, (currentTask) => deleteNode(currentTask, node.id));
  };

  const clearBoard = () => {
    if (confirm("Think twice: this will permanently clear all active tasks, completed journeys, and stickers. Continue?")) updateBoard(INITIAL_BOARD);
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1700);
  };

  const cancelLinkDrag = () => {
    if (!linkDrag) return;
    setLinkDrag(null);
  };

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        cancelLinkDrag();
        setBranchLinkDrag(null);
        setSelectedLinkId(null);
        setSelectedBranchId(null);
        setBranchDraft(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedLinkId) {
        updateBoard((current) => deleteCrossTaskLink(current, selectedLinkId));
        setSelectedLinkId(null);
        showToast("Link deleted.");
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedBranchId) {
        deleteSelectedBranch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [linkDrag, selectedLinkId, selectedBranchId, updateBoard]);

  React.useEffect(() => {
    if (!linkDrag && !branchLinkDrag) return undefined;
    const onPointerMove = (event) => {
      setLinkDrag((current) => (current ? { ...current, to: screenToWorld(event, viewport, canvasRef.current) } : current));
      setBranchLinkDrag((current) => (current ? { ...current, to: screenToWorld(event, viewport, canvasRef.current) } : current));
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [linkDrag, branchLinkDrag, viewport]);

  const celebrateAt = (position) => {
    const burst = createConfettiBurst(position);
    setConfetti(burst);
    window.setTimeout(() => setConfetti([]), 1100);
  };

  const finishTask = (task, node) => {
    updateBoard((current) => completeTask(current, task.id, new Date()));
    celebrateAt({ x: node.x, y: node.y });
  };

  const completePlanMilestone = (task, node) => {
    updateTask(task.id, (currentTask) => togglePlanMilestoneComplete(currentTask, node.id, new Date()));
    if (node.status !== "completed") celebrateAt({ x: node.x, y: node.y });
  };

  const markKeyNode = (node) => {
    updateBoard((current) => toggleKeyNode(current, node.id));
  };

  const startLinkDrag = (event, task, node) => {
    event.stopPropagation();
    setLinkDrag({ taskId: task.id, nodeId: node.id, title: node.title, from: { x: node.x, y: node.y }, to: { x: node.x, y: node.y } });
  };

  const finishLinkDrag = (targetNode) => {
    if (!linkDrag || linkDrag.nodeId === targetNode.id) return false;
    try {
      const nextBoard = addCrossTaskLink(board, linkDrag.nodeId, targetNode.id, new Date());
      updateBoard(nextBoard);
      showToast("Link created.");
    } catch (error) {
      showToast(error.message);
    }
    setLinkDrag(null);
    return true;
  };

  const startPointerDrag = (event, type, id) => {
    event.stopPropagation();
    const world = screenToWorld(event, viewport, canvasRef.current);
    let origin = null;
    for (const task of board.tasks) {
      origin = task.nodes.find((node) => node.id === id);
      if (origin) break;
    }
    origin ||= board.stickers.find((sticker) => sticker.id === id);
    if (!origin) return;
    setDragState({ type, id, offsetX: world.x - origin.x, offsetY: world.y - origin.y });
  };

  const onPointerMove = (event) => {
    if (branchLinkDrag) {
      setBranchLinkDrag((current) => (current ? { ...current, to: screenToWorld(event, viewport, canvasRef.current) } : current));
      return;
    }
    if (linkDrag) {
      setLinkDrag((current) => (current ? { ...current, to: screenToWorld(event, viewport, canvasRef.current) } : current));
      return;
    }
    if (!dragState) return;
    if (dragState.type === "pan") {
      setViewport((current) => ({ ...current, x: event.clientX - dragState.startX, y: event.clientY - dragState.startY }));
      return;
    }
    const world = screenToWorld(event, viewport, canvasRef.current);
    updateBoard((current) => moveCanvasItem(current, dragState.id, { x: world.x - dragState.offsetX, y: world.y - dragState.offsetY }));
  };

  const onWheel = (event) => {
    event.preventDefault();
    setViewport((current) => ({ ...current, scale: getNextViewportScale(current.scale, event.deltaY) }));
  };

  const dropEmoji = (event) => {
    event.preventDefault();
    const droppedEmoji = event.dataTransfer.getData("text/emoji");
    const position = screenToWorld(event, viewport, canvasRef.current);
    const patternId = event.dataTransfer.getData("text/emoji-pattern");
    if (patternId) {
      const pattern = getEmojiPattern(patternId);
      const stickers = createEmojiPatternStickers(pattern, position);
      updateBoard((current) => ({ ...current, stickers: [...current.stickers, ...stickers] }));
      showToast(`${pattern.label} pattern placed.`);
      return;
    }
    if (!droppedEmoji) return;
    updateBoard((current) => ({ ...current, stickers: [...current.stickers, createEmojiSticker(droppedEmoji, position)] }));
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>{emoji(0x1fa90)}</span>
          <div>
            <strong>StepView ✨</strong>
          </div>
        </div>

        <form className="quickCreate" onSubmit={(event) => { event.preventDefault(); createGoal(); }}>
          <label>
            🎯 Goal
            <input value={quickGoal} onChange={(event) => setQuickGoal(event.target.value)} placeholder="What are we finishing?" />
          </label>
          <button className="primary" type="submit">Create 🏁</button>
          <button className="ghost" type="button" onClick={() => setTutorialOpen(true)}>Tutorial ✨</button>
          <button className="ghost" type="button" onClick={() => setViewport({ x: window.innerWidth / 2 - 400, y: window.innerHeight / 2 - 260, scale: 1 })}>Focus 🔍</button>
        </form>

        <section>
          <h2>🧩 Stickers</h2>
          <div className="emojiTabs" aria-label="Sticker categories">
            {EMOJI_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                className={emojiCategoryId === category.id ? "active" : ""}
                title={category.label}
                onClick={() => setEmojiCategoryId(category.id)}
              >
                <span>{category.icon}</span>
                <small>{category.label}</small>
              </button>
            ))}
          </div>
          <div className="emojiGrid">
            {activeEmojiCategory.items.map((item, index) => (
              <button key={`${item}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/emoji", item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="emojiPlayPanel">
            <h3>Emoji rain</h3>
            <div className="emojiPlayGrid">
              {EMOJI_RAIN_THEMES.map((theme) => (
                <button key={theme.id} type="button" onClick={() => playEmojiRain(theme)} title={theme.label}>
                  <span>{theme.icon}</span>
                  <small>{theme.label}</small>
                </button>
              ))}
            </div>
            <h3>Patterns</h3>
            <p className="emojiPlayHint">Drag a pattern onto the canvas to place it exactly where you want.</p>
            <div className="emojiPlayGrid">
              {EMOJI_PATTERNS.map((pattern) => (
                <button
                  key={pattern.id}
                  type="button"
                  draggable
                  title={`Drag ${pattern.label} to the canvas`}
                  onDragStart={(event) => event.dataTransfer.setData("text/emoji-pattern", pattern.id)}
                >
                  <span>{pattern.icon}</span>
                  <small>{pattern.label}</small>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2>🏆 Wins</h2>
          <div className="completedEntry">
            <div>
              <span>{emoji(0x1f3c6)}</span>
              <strong>{completedTasks.length} wins</strong>
              <small>{latestCompletedAt ? formatCompactDate(latestCompletedAt) : "Nothing yet"}</small>
            </div>
            <button className="primary" type="button" onClick={() => setCompletedGalleryOpen(true)} disabled={completedTasks.length === 0}>
              Gallery 🌟
            </button>
          </div>
        </section>

        <section>
          <h2>🏅 Achievements</h2>
          <div className="completedEntry achievementEntry">
            <div>
              <span>{emoji(0x1f3c5)}</span>
              <strong>{unlockedAchievements.length}/{achievementCollection.length} unlocked</strong>
              <small>{unlockedAchievements.at(-1)?.title || "No badges yet"}</small>
            </div>
            <button className="primary" type="button" onClick={() => setAchievementGalleryOpen(true)}>
              Collection ✨
            </button>
          </div>
        </section>

        <section>
          <h2>💾 Save</h2>
          <p className="storagePill">{desktopApi ? "Local file ✅" : "Browser ✅"}</p>
          {desktopApi && <button className="ghost" onClick={() => desktopApi.revealDataFile()}>Folder 📂</button>}
          <button className="danger wide" onClick={clearBoard}>Clear 🧹</button>
        </section>
      </aside>

      <section
        ref={canvasRef}
        className="canvas"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ type: "canvas", x: event.clientX, y: event.clientY, world: screenToWorld(event, viewport, canvasRef.current) });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (isCanvasPanTarget(event.target)) {
            if (linkDrag) cancelLinkDrag();
            if (branchLinkDrag) setBranchLinkDrag(null);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragState({ type: "pan", startX: event.clientX - viewport.x, startY: event.clientY - viewport.y });
          }
          setMenu(null);
          if (isCanvasPanTarget(event.target)) {
            setSelectedLinkId(null);
            setSelectedBranchId(null);
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          setDragState(null);
          if (isCanvasPanTarget(event.target)) cancelLinkDrag();
          if (isCanvasPanTarget(event.target)) setBranchLinkDrag(null);
        }}
        onPointerLeave={() => { setDragState(null); cancelLinkDrag(); setBranchLinkDrag(null); }}
        onWheel={onWheel}
        onDrop={dropEmoji}
        onDragOver={(event) => event.preventDefault()}
      >
        {isLoaded && activeTasks.length === 0 && board.stickers.length === 0 && (
          <div className="emptyState">
            <span>{emoji(0x1f680)}</span>
            <h1>Create your first goal</h1>
          </div>
        )}

        <div className="grid" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <svg className="edges">
            <defs>
              <marker id="crossTaskArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {activeTasks.flatMap((task) =>
              task.edges.map((edge) => {
                const from = task.nodes.find((node) => node.id === edge.from);
                const to = task.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              }),
            )}
            {getCrossTaskLinkSegments(board).map((link) => (
              <g key={link.id}>
                <line className="crossTaskEdgeHit" x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} onPointerDown={(event) => { event.stopPropagation(); setMenu(null); setSelectedLinkId(link.id); }} />
                <line className={`crossTaskEdge ${selectedLinkId === link.id ? "selected" : ""}`} x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} markerEnd="url(#crossTaskArrow)" />
              </g>
            ))}
            {getBranchSegments(board).map((branch) => (
              <g key={branch.id}>
                <line className="branchEdgeHit" x1={branch.x1} y1={branch.y1} x2={branch.x2} y2={branch.y2} onPointerDown={(event) => { event.stopPropagation(); setMenu(null); setSelectedLinkId(null); setSelectedBranchId(branch.branchId); }} />
                <line className={`branchEdge ${branch.type} ${branch.isMerge ? "merge" : ""} ${selectedBranchId === branch.id ? "selected" : ""}`} x1={branch.x1} y1={branch.y1} x2={branch.x2} y2={branch.y2} markerEnd="url(#crossTaskArrow)" />
                {(branch.partnerName || branch.label) && <text className={`branchLabel ${branch.type}`} x={(branch.x1 + branch.x2) / 2} y={(branch.y1 + branch.y2) / 2 - 10}>{branch.partnerName || branch.label}</text>}
              </g>
            ))}
            {linkDrag && <line className="linkPreviewEdge" x1={linkDrag.from.x} y1={linkDrag.from.y} x2={linkDrag.to.x} y2={linkDrag.to.y} />}
            {branchLinkDrag && <line className={`branchPreviewEdge ${branchLinkDrag.type}`} x1={branchLinkDrag.from.x} y1={branchLinkDrag.from.y} x2={branchLinkDrag.to.x} y2={branchLinkDrag.to.y} />}
          </svg>

          {activeTasks.map((task) => (
            <React.Fragment key={task.id}>
              {task.nodes.map((node) => (
                <article
                  key={node.id}
                  className={`node ${node.kind} ${node.branchId ? "branchNode" : ""} ${node.isKeyNode ? "keyNode" : ""} ${node.status === "completed" ? "completed" : ""} ${linkDrag?.nodeId === node.id ? "linkSource" : ""} ${linkDrag && linkDrag.taskId !== task.id ? "linkTarget" : ""} ${branchLinkDrag && !node.branchId ? "linkTarget" : ""} ${selectedNodeId === node.id ? "selected" : ""}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => startPointerDrag(event, "node", node.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId((id) => (id === node.id ? null : node.id));
                  }}
                  onPointerUp={(event) => {
                    if (branchLinkDrag) {
                      event.stopPropagation();
                      finishBranchLinkDrag(node);
                      return;
                    }
                    if (!linkDrag) return;
                    event.stopPropagation();
                    finishLinkDrag(node);
                  }}
                >
                  <div className="linkHandles" aria-hidden="true">
                    {['top', 'right', 'bottom', 'left'].map((side) => (
                      <button key={side} type="button" className={`linkHandle ${side}`} onPointerDown={(event) => startLinkDrag(event, task, node)} onClick={(event) => event.stopPropagation()} />
                    ))}
                  </div>
                  <div className="nodeTop">
                    <span className="nodeEmoji">{node.emoji}</span>
                    <div className="nodeTools">
                      <button
                        className={`keyToggle ${node.isKeyNode ? "active" : ""}`}
                        title={node.isKeyNode ? "Unset key node" : "Set as key node"}
                        aria-label={node.isKeyNode ? "Unset key node" : "Set as key node"}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); markKeyNode(node); }}
                      >
                        ★
                      </button>
                      {node.kind !== "finish" && (
                      <div className="addGroup">
                        <button className="add" title="Add milestone" onClick={(event) => { event.stopPropagation(); addMilestone(task.id, node.id); }}>+</button>
                        <button className="add planAdd" title="Add plan milestone" onClick={(event) => { event.stopPropagation(); addMilestone(task.id, node.id, "plan-milestone"); }}>＋</button>
                        <button className="add branchAdd" title="创建支线" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => startBranchDraft(event, node)}>⑂</button>
                        {node.branchId && <button className="add branchMergeAdd" title="接回主线：按住拖到主线节点" onPointerDown={(event) => startBranchLinkDrag(event, node)} onClick={(event) => event.stopPropagation()}>↩</button>}
                      </div>
                      )}
                    </div>
                  </div>
                  <strong className="nodeTitle">{node.isKeyNode && <span className="keyBadge">★</span>}{node.title}</strong>
                  <time>{formatCompactDate(node.timestamp)}</time>
                  {selectedNodeId === node.id && <p>{node.detail || "No details yet."}</p>}
                  {selectedNodeId === node.id && node.kind === "finish" && (
                    <div className="nodeActions">
                      <button className="done" onClick={(event) => { event.stopPropagation(); finishTask(task, node); }}>
                        Done ✅
                      </button>
                      <button className="danger" onClick={(event) => { event.stopPropagation(); updateBoard((current) => deleteTask(current, task.id)); }}>
                        Delete 🗑️
                      </button>
                    </div>
                  )}
                  {selectedNodeId === node.id && node.kind === "milestone" && (
                    <button className="danger" onClick={(event) => { event.stopPropagation(); deleteNodeFromBoard(task.id, node); }}>
                      Delete 🗑️
                    </button>
                  )}
                  {selectedNodeId === node.id && node.kind === "plan-milestone" && (
                    <div className="nodeActions">
                      <button className="done" onClick={(event) => { event.stopPropagation(); completePlanMilestone(task, node); }}>
                        {node.status === "completed" ? "Undo ↩️" : "Complete ✅"}
                      </button>
                      <button className="danger" onClick={(event) => { event.stopPropagation(); deleteNodeFromBoard(task.id, node); }}>
                        Delete 🗑️
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </React.Fragment>
          ))}

          {board.stickers.map((sticker) => (
            <button
              key={sticker.id}
              className="sticker"
              style={{ left: sticker.x, top: sticker.y }}
              onPointerDown={(event) => startPointerDrag(event, "emoji", sticker.id)}
              onDoubleClick={() => updateBoard((current) => ({ ...current, stickers: current.stickers.filter((item) => item.id !== sticker.id) }))}
            >
              {sticker.emoji}
            </button>
          ))}
          {confetti.map((piece) => (
            <span
              key={piece.id}
              className="confettiPiece"
              style={{
                left: piece.x,
                top: piece.y,
                "--dx": `${piece.dx}px`,
                "--dy": `${piece.dy}px`,
                "--color": piece.color,
                "--rotation": `${piece.rotation}deg`,
                animationDelay: `${piece.delay}ms`,
              }}
            />
          ))}
        </div>

        {toast && <div className="toast">{toast}</div>}
        {emojiRain.length > 0 && (
          <div className="emojiRain" aria-hidden="true">
            {emojiRain.map((drop) => (
              <span
                key={drop.id}
                style={{
                  left: drop.left,
                  top: drop.top,
                  fontSize: `${drop.size}px`,
                  animationDelay: `${drop.delay}ms`,
                  animationDuration: `${drop.duration}ms`,
                  "--fall-distance": `${drop.fallDistance}px`,
                }}
              >
                {drop.emoji}
              </span>
            ))}
          </div>
        )}
        {achievementPopup && (
          <div className="achievementPopup">
            <span>{achievementPopup.emoji}</span>
            <div>
              <small>Achievement unlocked</small>
              <strong>{achievementPopup.title}</strong>
              <p>{achievementPopup.detail}</p>
            </div>
          </div>
        )}
        {menu && (
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
            {menu.type === "canvas" && <button onClick={() => createGoal(menu.world)}>Create goal here {emoji(0x1f3c1)}</button>}
          </div>
        )}

        {selectedBranchId && (
          <div className="branchToolbar" onPointerDown={(event) => event.stopPropagation()}>
            <button className="danger" type="button" onClick={deleteSelectedBranch}>删除选中支线 🗑️</button>
          </div>
        )}

      </section>

      {noteDraft && (
        <div className="modalBackdrop" onPointerDown={() => setNoteDraft(null)}>
          <form className="modal" onSubmit={saveMilestone} onPointerDown={(event) => event.stopPropagation()}>
            <h2>{noteDraft.kind === "plan-milestone" ? "📝 Plan milestone" : "📍 Milestone"}</h2>
            <label>Name<input autoFocus required value={noteDraft.title} onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} /></label>
            <label>Note<textarea value={noteDraft.detail} onChange={(event) => setNoteDraft({ ...noteDraft, detail: event.target.value })} /></label>
            <label>Time<input type="datetime-local" value={noteDraft.timestamp} onChange={(event) => setNoteDraft({ ...noteDraft, timestamp: event.target.value })} /></label>
            <div className="modalActions"><button type="button" onClick={() => setNoteDraft(null)}>Cancel</button><button className="primary">Save ✅</button></div>
          </form>
        </div>
      )}

      {branchDraft?.stage === "details" && (
        <div className="modalBackdrop" onPointerDown={() => setBranchDraft(null)}>
          <form className="modal" onSubmit={saveBranchDraft} onPointerDown={(event) => event.stopPropagation()}>
            <h2>⑂ 创建支线</h2>
            <div className="branchTypePicker" role="radiogroup" aria-label="支线类型">
              {[
                ["self", "🧭", "我的分支", "自己的备用路线"],
                ["partner", "🤝", "伙伴支线", "朋友或队友参与"],
                ["lover", "💗", "恋人支线", "心动路线和彩蛋"],
              ].map(([type, icon, title, detail]) => (
                <button key={type} type="button" className={`branchTypeOption ${branchDraft.type === type ? "selected" : ""} ${type}`} onClick={() => setBranchDraft({ ...branchDraft, type })}>
                  <span>{icon}</span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
            {branchDraft.type === "lover" && <p className="modalHint">要不要开一条只属于 TA 的路线？</p>}
            <label>支线名称<input autoFocus required value={branchDraft.label} onChange={(event) => setBranchDraft({ ...branchDraft, label: event.target.value })} /></label>
            {branchDraft.type !== "self" && <label>{branchDraft.type === "lover" ? "昵称" : "伙伴名字"}<input value={branchDraft.partnerName} onChange={(event) => setBranchDraft({ ...branchDraft, partnerName: event.target.value })} /></label>}
            <div className="modalActions"><button type="button" onClick={() => setBranchDraft(null)}>Cancel</button><button className="primary">Create ✨</button></div>
          </form>
        </div>
      )}

      {loveRain.length > 0 && (
        <div className="loveRain" aria-hidden="true">
          {loveRain.map((drop) => (
            <span
              key={drop.id}
              style={{
                left: `${drop.left}%`,
                animationDelay: `${drop.delay}s`,
                animationDuration: `${drop.duration}s`,
                fontSize: `${drop.size}px`,
                "--drift": `${drop.drift}px`,
                "--spin": `${drop.spin}deg`,
              }}
            >
              {drop.symbol}
            </span>
          ))}
        </div>
      )}

      {tutorialOpen && (
        <div className="modalBackdrop" onPointerDown={() => setTutorialOpen(false)}>
          <section className="tutorialPanel" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <span>{emoji(0x1f9ed)}</span>
              <div>
                <h2>StepView Tutorial</h2>
                <p>Interactive guide content will live here.</p>
              </div>
            </header>
            <div className="tutorialPlaceholder">
              <strong>Coming soon</strong>
              <p>This panel will teach goals, milestones, plan milestones, purple links, and journeys without touching your board.</p>
            </div>
            <button className="primary" type="button" onClick={() => setTutorialOpen(false)}>Got it</button>
          </section>
        </div>
      )}

      {completedGalleryOpen && (
        <div className="galleryBackdrop" onPointerDown={closeCompletedGallery}>
          <section className="completedGallery" onPointerDown={(event) => event.stopPropagation()}>
            <header className="galleryHeader">
              <div>
                <span>{emoji(0x1f3c6)}</span>
                <div>
                  <h2>{selectedCompletedTask ? "Journey 🗺️" : "Gallery 🌟"}</h2>
                  <p>{selectedCompletedTask ? selectedCompletedTask.title : `${completedTasks.length} wins`}</p>
                </div>
              </div>
              <button className="galleryClose" type="button" onClick={closeCompletedGallery}>Close ✕</button>
            </header>

            {selectedCompletedTask ? (
              <div className="journeyView">
                <button className="ghost backButton" type="button" onClick={() => setSelectedCompletedTaskId(null)}>← Cards</button>
                <article className="journeyPanel">
                  {(() => {
                    const branchEntries = getTaskBranchEntries(board, selectedCompletedTask);
                    const summary = getCompletedTaskSummary(board, selectedCompletedTask);
                    return (
                      <>
                        <div className="journeyHero">
                          <span>{emoji(0x1f3c1)}</span>
                          <div>
                            <strong>{selectedCompletedTask.title}</strong>
                            <small>✅ {formatCompactDate(selectedCompletedTask.completedAt)}</small>
                          </div>
                          <div className="journeySummary">
                            <span>{summary.totalSteps} steps</span>
                            <span>{summary.milestoneCount} milestones</span>
                            <span>{summary.branchCount} branches</span>
                            <span>{summary.branchStepCount} branch steps</span>
                          </div>
                        </div>
                        <div className="journeyArchive">
                          <section className="archiveSection">
                            <header>
                              <small>Main line</small>
                              <strong>Completed path</strong>
                            </header>
                            <div className="processTimeline journeyTimeline">
                              {getTaskProcessEntries(board, selectedCompletedTask).map((entry) => (
                                <div key={entry.id} className={`processStep ${entry.kind} ${entry.status === "completed" ? "completed" : ""}`}>
                                  <span className="processDot">{entry.emoji}</span>
                                  <div>
                                    <small>{entry.label}{entry.taskId !== selectedCompletedTask.id ? ` · ${entry.taskTitle}` : ""}{entry.kind === "plan-milestone" ? ` · ${entry.status === "completed" ? "Completed" : "Planned"}` : ""} · {formatCompactDate(entry.timestamp)}</small>
                                    <strong>{entry.title}</strong>
                                    <p>{entry.detail || "No note."}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                          {branchEntries.length > 0 && (
                            <section className="archiveSection branchArchive">
                              <header>
                                <small>Side branches</small>
                                <strong>{branchEntries.length} archived branch{branchEntries.length > 1 ? "es" : ""}</strong>
                              </header>
                              <div className="branchArchiveList">
                                {branchEntries.map((branch) => (
                                  <article key={branch.id} className={`branchArchiveCard ${branch.type}`}>
                                    <div className="branchArchiveHeader">
                                      <span>{branch.type === "lover" ? "💗" : branch.type === "partner" ? "🤝" : "⑂"}</span>
                                      <div>
                                        <strong>{branch.partnerName || branch.label}</strong>
                                        <small>
                                          From {branch.sourceTitle || "unknown"}
                                          {branch.mergeTitle ? ` · merged to ${branch.mergeTitle}` : " · open ending"}
                                        </small>
                                      </div>
                                    </div>
                                    <div className="branchMiniTimeline">
                                      {branch.nodes.map((entry) => (
                                        <div key={entry.id} className="branchMiniStep">
                                          <span>{entry.emoji}</span>
                                          <div>
                                            <small>{entry.label} · {formatCompactDate(entry.timestamp)}</small>
                                            <strong>{entry.title}</strong>
                                            {entry.detail && <p>{entry.detail}</p>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </section>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </article>
              </div>
            ) : (
              <div className="galleryGrid">
                {completedTasks.map((task) => {
                  const summary = getCompletedTaskSummary(board, task);
                  return (
                    <article key={task.id} className="completedCard galleryCard">
                      <div className="completedCardHeader">
                        <span className="completedBadge">{emoji(0x1f31f)}</span>
                        <div>
                          <strong>{task.title}</strong>
                          <small>✅ {formatCompactDate(summary.completedAt)}</small>
                        </div>
                      </div>
                      <div className="completedStats">
                        <span>{summary.totalSteps} steps</span>
                        <span>{summary.milestoneCount} milestones</span>
                        {summary.branchCount > 0 && <span>{summary.branchCount} branches</span>}
                        {summary.branchStepCount > 0 && <span>{summary.branchStepCount} side steps</span>}
                      </div>
                      <div className="completedActions">
                        <button type="button" onClick={() => setSelectedCompletedTaskId(task.id)}>Journey 🗺️</button>
                        <button type="button" onClick={() => updateBoard((current) => restoreTask(current, task.id))}>↩</button>
                        <button type="button" onClick={() => updateBoard((current) => deleteTask(current, task.id))}>🗑️</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {achievementGalleryOpen && (
        <div className="galleryBackdrop" onPointerDown={() => setAchievementGalleryOpen(false)}>
          <section className="completedGallery achievementGallery" onPointerDown={(event) => event.stopPropagation()}>
            <header className="galleryHeader">
              <div>
                <span>{emoji(0x1f3c5)}</span>
                <div>
                  <h2>Achievements 🏅</h2>
                  <p>{unlockedAchievements.length} of {achievementCollection.length} unlocked</p>
                </div>
              </div>
              <button className="galleryClose" type="button" onClick={() => setAchievementGalleryOpen(false)}>Close ✕</button>
            </header>

            <div className="achievementGrid">
              {achievementCollection.map((achievement) => (
                <article key={achievement.id} className={`achievementCard ${achievement.unlocked ? "unlocked" : "locked"}`}>
                  <span>{achievement.unlocked ? achievement.emoji : "🔒"}</span>
                  <div>
                    <small>{achievement.unlocked ? "Unlocked" : "Locked"}</small>
                    <strong>{achievement.title}</strong>
                    <p>{achievement.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

