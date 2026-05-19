import React from "react";
import { createRoot } from "react-dom/client";
import {
  addMilestoneAfter,
  addPlanMilestoneAfter,
  addCrossTaskLink,
  buildTask,
  completeTask,
  createConfettiBurst,
  createEmojiSticker,
  deleteCrossTaskLink,
  deleteNode,
  deleteTask,
  formatCompactDate,
  getCompletedTaskSummary,
  getCrossTaskLinkSegments,
  getTaskProcessEntries,
  hasBoardContent,
  moveCanvasItem,
  normalizeBoard,
  restoreTask,
  togglePlanMilestoneComplete,
} from "./progressCore";
import "./styles.css";

const STORAGE_KEY = "stepview-board-v1";
const emoji = (codePoint) => String.fromCodePoint(codePoint);
const EMOJI_LIBRARY = [
  0x2728, 0x1f525, 0x1f308, 0x1f4a1, 0x1f3af, 0x1f9e0, 0x2615, 0x1f9e9, 0x1f319, 0x1f48e,
  0x1f6a7, 0x1f389, 0x1f680, 0x1f3c1, 0x1f4cd, 0x2705, 0x2b50, 0x1f31f, 0x26a1, 0x1f4ab,
  0x1f52e, 0x1fa84, 0x1f9ed, 0x1f5fa, 0x1f4cc, 0x1f4ce, 0x1f4dd, 0x1f4da, 0x1f4e6, 0x1f6e0,
  0x2699, 0x1f527, 0x1f50d, 0x1f510, 0x1f9ea, 0x1f9ec, 0x1f4ca, 0x1f4c8, 0x1f4b0, 0x1f3c6,
  0x1f947, 0x1f396, 0x1f3a8, 0x1f3a7, 0x1f3ae, 0x1f579, 0x1f340, 0x1f331, 0x1f333, 0x1f30a,
  0x2601, 0x2600, 0x1f324, 0x1f30d, 0x1fa90, 0x1f30c, 0x1f431, 0x1f436, 0x1f43c, 0x1f98a,
  0x1f433, 0x1f984, 0x1f34e, 0x1f355, 0x1f354, 0x1f370, 0x1f37a, 0x1f3e0, 0x1f3e2, 0x1f6f8,
  0x1f697, 0x2708, 0x23f0, 0x1f5d3, 0x2764, 0x1f49c, 0x1f499, 0x1f5a4, 0x1f4a5, 0x1f441,
  0x1f9f2, 0x1f9f1, 0x1f4f8, 0x1f3ac, 0x1f3b5, 0x1f50b, 0x1f6a6, 0x1f9f0, 0x1f6e1, 0x1f5dd,
].map(emoji);
const INITIAL_BOARD = { tasks: [], stickers: [] };
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
  const [selectedNodeId, setSelectedNodeId] = React.useState(null);
  const [dragState, setDragState] = React.useState(null);
  const [noteDraft, setNoteDraft] = React.useState(null);
  const [linkDrag, setLinkDrag] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [completedGalleryOpen, setCompletedGalleryOpen] = React.useState(false);
  const [selectedCompletedTaskId, setSelectedCompletedTaskId] = React.useState(null);
  const [confetti, setConfetti] = React.useState([]);
  const [quickGoal, setQuickGoal] = React.useState("Ship StepView v1");
  const [isLoaded, setIsLoaded] = React.useState(false);
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (desktopApi) {
        let saved = normalizeBoard(await desktopApi.loadBoard());
        const legacyBrowserBoard = loadBrowserBoard();
        if (!hasBoardContent(saved) && hasBoardContent(legacyBrowserBoard)) saved = legacyBrowserBoard;
        if (!cancelled) {
          setBoard(saved);
          setIsLoaded(true);
        }
        return;
      }
      setBoard(loadBrowserBoard());
      setIsLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!isLoaded) return;
    if (desktopApi) {
      desktopApi.saveBoard(board);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board, isLoaded]);

  const activeTasks = board.tasks.filter((task) => task.status === "active");
  const completedTasks = board.tasks.filter((task) => task.status === "completed");
  const selectedCompletedTask = completedTasks.find((task) => task.id === selectedCompletedTaskId);
  const latestCompletedAt = completedTasks
    .map((task) => task.completedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  const updateTask = (taskId, updater) => {
    setBoard((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  };

  const closeCompletedGallery = () => {
    setCompletedGalleryOpen(false);
    setSelectedCompletedTaskId(null);
  };

  const createGoal = (position = { x: 760 + activeTasks.length * 80, y: 360 + activeTasks.length * 80 }) => {
    if (!quickGoal.trim()) return;
    setBoard((current) => ({ ...current, tasks: [...current.tasks, buildTask(quickGoal, position, new Date())] }));
    setMenu(null);
  };

  const loadDemoBoard = () => {
    const demo = buildTask("Ship StepView v1", { x: 820, y: 360 }, new Date());
    const withResearch = addMilestoneAfter(demo, demo.nodes[0].id, {
      title: "Product design",
      detail: "Define infinite canvas, notes, completed board, and emoji stickers.",
      timestamp: new Date().toISOString(),
    });
    const withDesktop = addMilestoneAfter(withResearch, withResearch.nodes[1].id, {
      title: "Desktop shell",
      detail: "Run in Electron and save data to a local JSON file.",
      timestamp: new Date().toISOString(),
    });
    setBoard({
      tasks: [withDesktop],
      stickers: [createEmojiSticker(emoji(0x2728), { x: 360, y: 210 }), createEmojiSticker(emoji(0x1f3af), { x: 980, y: 250 })],
    });
  };

  const addMilestone = (taskId, nodeId, kind = "milestone") => {
    setNoteDraft({ taskId, nodeId, kind, title: "", detail: "", timestamp: new Date().toISOString().slice(0, 16) });
  };

  const saveMilestone = (event) => {
    event.preventDefault();
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

  const clearBoard = () => {
    if (confirm("Think twice: this will permanently clear all active tasks, completed journeys, and stickers. Continue?")) setBoard(INITIAL_BOARD);
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
        setSelectedLinkId(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedLinkId) {
        setBoard((current) => deleteCrossTaskLink(current, selectedLinkId));
        setSelectedLinkId(null);
        showToast("Link deleted.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [linkDrag, selectedLinkId]);

  React.useEffect(() => {
    if (!linkDrag) return undefined;
    const onPointerMove = (event) => {
      setLinkDrag((current) => (current ? { ...current, to: screenToWorld(event, viewport, canvasRef.current) } : current));
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [linkDrag, viewport]);

  const celebrateAt = (position) => {
    const burst = createConfettiBurst(position);
    setConfetti(burst);
    window.setTimeout(() => setConfetti([]), 1100);
  };

  const finishTask = (task, node) => {
    setBoard((current) => completeTask(current, task.id, new Date()));
    celebrateAt({ x: node.x, y: node.y });
  };

  const completePlanMilestone = (task, node) => {
    updateTask(task.id, (currentTask) => togglePlanMilestoneComplete(currentTask, node.id, new Date()));
    if (node.status !== "completed") celebrateAt({ x: node.x, y: node.y });
  };

  const startLinkDrag = (event, task, node) => {
    event.stopPropagation();
    setLinkDrag({ taskId: task.id, nodeId: node.id, title: node.title, from: { x: node.x, y: node.y }, to: { x: node.x, y: node.y } });
  };

  const finishLinkDrag = (targetNode) => {
    if (!linkDrag || linkDrag.nodeId === targetNode.id) return false;
    try {
      setBoard(addCrossTaskLink(board, linkDrag.nodeId, targetNode.id, new Date()));
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
    setBoard((current) => moveCanvasItem(current, dragState.id, { x: world.x - dragState.offsetX, y: world.y - dragState.offsetY }));
  };

  const onWheel = (event) => {
    event.preventDefault();
    const nextScale = Math.min(1.8, Math.max(0.45, viewport.scale - event.deltaY * 0.001));
    setViewport((current) => ({ ...current, scale: nextScale }));
  };

  const dropEmoji = (event) => {
    event.preventDefault();
    const droppedEmoji = event.dataTransfer.getData("text/emoji");
    if (!droppedEmoji) return;
    const position = screenToWorld(event, viewport, canvasRef.current);
    setBoard((current) => ({ ...current, stickers: [...current.stickers, createEmojiSticker(droppedEmoji, position)] }));
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
          <button className="ghost" type="button" onClick={loadDemoBoard}>Demo ✨</button>
          <button className="ghost" type="button" onClick={() => setViewport({ x: window.innerWidth / 2 - 400, y: window.innerHeight / 2 - 260, scale: 1 })}>Focus 🔍</button>
        </form>

        <section>
          <h2>🧩 Stickers</h2>
          <div className="emojiGrid">
            {EMOJI_LIBRARY.map((item, index) => (
              <button key={`${item}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/emoji", item)}>
                {item}
              </button>
            ))}
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
          setMenu({ x: event.clientX, y: event.clientY, world: screenToWorld(event, viewport, canvasRef.current) });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (isCanvasPanTarget(event.target)) {
            if (linkDrag) cancelLinkDrag();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragState({ type: "pan", startX: event.clientX - viewport.x, startY: event.clientY - viewport.y });
          }
          setMenu(null);
          if (isCanvasPanTarget(event.target)) setSelectedLinkId(null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          setDragState(null);
          if (isCanvasPanTarget(event.target)) cancelLinkDrag();
        }}
        onPointerLeave={() => { setDragState(null); cancelLinkDrag(); }}
        onWheel={onWheel}
        onDrop={dropEmoji}
        onDragOver={(event) => event.preventDefault()}
      >
        {activeTasks.length === 0 && board.stickers.length === 0 && (
          <div className="emptyState">
            <span>{emoji(0x1f680)}</span>
            <h1>Create your first goal</h1>
            <button className="primary" onClick={() => createGoal()}>Launch 🚀</button>
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
            {linkDrag && <line className="linkPreviewEdge" x1={linkDrag.from.x} y1={linkDrag.from.y} x2={linkDrag.to.x} y2={linkDrag.to.y} />}
          </svg>

          {activeTasks.map((task) => (
            <React.Fragment key={task.id}>
              {task.nodes.map((node) => (
                <article
                  key={node.id}
                  className={`node ${node.kind} ${node.status === "completed" ? "completed" : ""} ${linkDrag?.nodeId === node.id ? "linkSource" : ""} ${linkDrag && linkDrag.taskId !== task.id ? "linkTarget" : ""} ${selectedNodeId === node.id ? "selected" : ""}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => startPointerDrag(event, "node", node.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId((id) => (id === node.id ? null : node.id));
                  }}
                  onPointerUp={(event) => {
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
                    {node.kind !== "finish" && (
                      <div className="addGroup">
                        <button className="add" title="Add milestone" onClick={(event) => { event.stopPropagation(); addMilestone(task.id, node.id); }}>+</button>
                        <button className="add planAdd" title="Add plan milestone" onClick={(event) => { event.stopPropagation(); addMilestone(task.id, node.id, "plan-milestone"); }}>＋</button>
                      </div>
                    )}
                  </div>
                  <strong className="nodeTitle">{node.title}</strong>
                  <time>{formatCompactDate(node.timestamp)}</time>
                  {selectedNodeId === node.id && <p>{node.detail || "No details yet."}</p>}
                  {selectedNodeId === node.id && node.kind === "finish" && (
                    <div className="nodeActions">
                      <button className="done" onClick={(event) => { event.stopPropagation(); finishTask(task, node); }}>
                        Done ✅
                      </button>
                      <button className="danger" onClick={(event) => { event.stopPropagation(); setBoard((current) => deleteTask(current, task.id)); }}>
                        Delete 🗑️
                      </button>
                    </div>
                  )}
                  {selectedNodeId === node.id && node.kind === "milestone" && (
                    <button className="danger" onClick={(event) => { event.stopPropagation(); updateTask(task.id, (currentTask) => deleteNode(currentTask, node.id)); }}>
                      Delete 🗑️
                    </button>
                  )}
                  {selectedNodeId === node.id && node.kind === "plan-milestone" && (
                    <div className="nodeActions">
                      <button className="done" onClick={(event) => { event.stopPropagation(); completePlanMilestone(task, node); }}>
                        {node.status === "completed" ? "Undo ↩️" : "Complete ✅"}
                      </button>
                      <button className="danger" onClick={(event) => { event.stopPropagation(); updateTask(task.id, (currentTask) => deleteNode(currentTask, node.id)); }}>
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
              onDoubleClick={() => setBoard((current) => ({ ...current, stickers: current.stickers.filter((item) => item.id !== sticker.id) }))}
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
        {menu && (
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => createGoal(menu.world)}>Create goal here {emoji(0x1f3c1)}</button>
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
                  <div className="journeyHero">
                    <span>{emoji(0x1f3c1)}</span>
                    <div>
                      <strong>{selectedCompletedTask.title}</strong>
                      <small>✅ {formatCompactDate(selectedCompletedTask.completedAt)}</small>
                    </div>
                    <div className="journeySummary">
                      <span>{getCompletedTaskSummary(board, selectedCompletedTask).totalSteps} steps</span>
                      <span>{getCompletedTaskSummary(board, selectedCompletedTask).milestoneCount} milestones</span>
                    </div>
                  </div>
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
                      </div>
                      <div className="completedActions">
                        <button type="button" onClick={() => setSelectedCompletedTaskId(task.id)}>Journey 🗺️</button>
                        <button type="button" onClick={() => setBoard((current) => restoreTask(current, task.id))}>↩</button>
                        <button type="button" onClick={() => setBoard((current) => deleteTask(current, task.id))}>🗑️</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
