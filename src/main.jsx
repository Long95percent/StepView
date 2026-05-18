import React from "react";
import { createRoot } from "react-dom/client";
import {
  addMilestoneAfter,
  buildTask,
  completeTask,
  createEmojiSticker,
  deleteNode,
  deleteTask,
  formatCompactDate,
  moveCanvasItem,
  normalizeBoard,
  restoreTask,
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

function screenToWorld(event, viewport) {
  return {
    x: (event.clientX - viewport.x) / viewport.scale,
    y: (event.clientY - viewport.y) / viewport.scale,
  };
}

function App() {
  const [board, setBoard] = React.useState(INITIAL_BOARD);
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, scale: 1 });
  const [menu, setMenu] = React.useState(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState(null);
  const [dragState, setDragState] = React.useState(null);
  const [noteDraft, setNoteDraft] = React.useState(null);
  const [completedOpen, setCompletedOpen] = React.useState(true);
  const [quickGoal, setQuickGoal] = React.useState("Ship StepView v1");
  const [storageStatus, setStorageStatus] = React.useState("Loading local data...");
  const [isLoaded, setIsLoaded] = React.useState(false);
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (desktopApi) {
        const saved = await desktopApi.loadBoard();
        if (!cancelled) {
          setBoard(normalizeBoard(saved));
          setStorageStatus("Desktop local file storage connected");
          setIsLoaded(true);
        }
        return;
      }
      setBoard(loadBrowserBoard());
      setStorageStatus("Browser preview: saved to localStorage");
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
      desktopApi.saveBoard(board).then((result) => {
        if (result?.path) setStorageStatus(`Saved: ${result.path}`);
      });
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board, isLoaded]);

  const activeTasks = board.tasks.filter((task) => task.status === "active");
  const completedTasks = board.tasks.filter((task) => task.status === "completed");

  const updateTask = (taskId, updater) => {
    setBoard((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
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

  const addMilestone = (taskId, nodeId) => {
    setNoteDraft({ taskId, nodeId, title: "", detail: "", timestamp: new Date().toISOString().slice(0, 16) });
  };

  const saveMilestone = (event) => {
    event.preventDefault();
    updateTask(noteDraft.taskId, (task) =>
      addMilestoneAfter(task, noteDraft.nodeId, {
        title: noteDraft.title,
        detail: noteDraft.detail,
        timestamp: new Date(noteDraft.timestamp).toISOString(),
      }),
    );
    setNoteDraft(null);
  };

  const clearBoard = () => {
    if (confirm("Clear all active and completed tasks?")) setBoard(INITIAL_BOARD);
  };

  const startPointerDrag = (event, type, id) => {
    event.stopPropagation();
    const world = screenToWorld(event, viewport);
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
    if (!dragState) return;
    if (dragState.type === "pan") {
      setViewport((current) => ({ ...current, x: event.clientX - dragState.startX, y: event.clientY - dragState.startY }));
      return;
    }
    const world = screenToWorld(event, viewport);
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
    const position = screenToWorld(event, viewport);
    setBoard((current) => ({ ...current, stickers: [...current.stickers, createEmojiSticker(droppedEmoji, position)] }));
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>{emoji(0x1fa90)}</span>
          <div>
            <strong>StepView</strong>
            <small>Infinite goal progress canvas</small>
          </div>
        </div>

        <form className="quickCreate" onSubmit={(event) => { event.preventDefault(); createGoal(); }}>
          <label>
            Goal name
            <input value={quickGoal} onChange={(event) => setQuickGoal(event.target.value)} placeholder="Type the final goal" />
          </label>
          <button className="primary" type="submit">Create at auto spot {emoji(0x1f3c1)}</button>
          <p className="createHint">Or right-click the canvas and choose Create goal here.</p>
          <button className="ghost" type="button" onClick={loadDemoBoard}>Load demo board</button>
          <button className="ghost" type="button" onClick={() => setViewport({ x: window.innerWidth / 2 - 400, y: window.innerHeight / 2 - 260, scale: 1 })}>Focus canvas</button>
        </form>

        <section>
          <h2>Emoji Library</h2>
          <p>Drag any emoji to the canvas. Double-click a sticker to delete it.</p>
          <div className="emojiGrid">
            {EMOJI_LIBRARY.map((item, index) => (
              <button key={`${item}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/emoji", item)}>
                {item}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Completed Board</h2>
          <button className="ghost" onClick={() => setCompletedOpen((open) => !open)}>
            {completedTasks.length} completed goals
          </button>
          {completedOpen && (
            <div className="completedList">
              {completedTasks.length === 0 && <p>No completed goals yet.</p>}
              {completedTasks.map((task) => (
                <article key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{formatCompactDate(task.completedAt)}</small>
                  </div>
                  <button onClick={() => setBoard((current) => restoreTask(current, task.id))}>Restore</button>
                  <button onClick={() => setBoard((current) => deleteTask(current, task.id))}>Delete</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2>Data</h2>
          <p>{storageStatus}</p>
          {desktopApi && <button className="ghost" onClick={() => desktopApi.revealDataFile()}>Reveal data file</button>}
          <button className="danger wide" onClick={clearBoard}>Clear board</button>
        </section>
        <footer>One panel, one name. Right-click only controls placement.</footer>
      </aside>

      <section
        ref={canvasRef}
        className="canvas"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, world: screenToWorld(event, viewport) });
        }}
        onPointerDown={(event) => {
          if (event.target === canvasRef.current) setDragState({ type: "pan", startX: event.clientX - viewport.x, startY: event.clientY - viewport.y });
          setMenu(null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragState(null)}
        onPointerLeave={() => setDragState(null)}
        onWheel={onWheel}
        onDrop={dropEmoji}
        onDragOver={(event) => event.preventDefault()}
      >
        {activeTasks.length === 0 && board.stickers.length === 0 && (
          <div className="emptyState">
            <span>{emoji(0x1f3c1)}</span>
            <h1>Start with one named goal</h1>
            <p>Type the final goal on the left. Use auto placement, or right-click the canvas to place it exactly.</p>
            <button className="primary" onClick={() => createGoal()}>Create first goal</button>
          </div>
        )}

        <div className="grid" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <svg className="edges">
            {activeTasks.flatMap((task) =>
              task.edges.map((edge) => {
                const from = task.nodes.find((node) => node.id === edge.from);
                const to = task.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              }),
            )}
          </svg>

          {activeTasks.map((task) => (
            <React.Fragment key={task.id}>
              {task.nodes.map((node) => (
                <article
                  key={node.id}
                  className={`node ${node.kind} ${selectedNodeId === node.id ? "selected" : ""}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => startPointerDrag(event, "node", node.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId((id) => (id === node.id ? null : node.id));
                  }}
                >
                  <div className="nodeTop">
                    <span className="nodeEmoji">{node.emoji}</span>
                    {node.kind !== "finish" && (
                      <button className="add" onClick={(event) => { event.stopPropagation(); addMilestone(task.id, node.id); }}>+</button>
                    )}
                  </div>
                  <strong className="nodeTitle">{node.title}</strong>
                  <time>{formatCompactDate(node.timestamp)}</time>
                  {selectedNodeId === node.id && <p>{node.detail || "No details yet."}</p>}
                  {selectedNodeId === node.id && node.kind === "finish" && (
                    <div className="nodeActions">
                      <button className="done" onClick={(event) => { event.stopPropagation(); setBoard((current) => completeTask(current, task.id, new Date())); }}>
                        Mark complete
                      </button>
                      <button className="danger" onClick={(event) => { event.stopPropagation(); setBoard((current) => deleteTask(current, task.id)); }}>
                        Delete task
                      </button>
                    </div>
                  )}
                  {selectedNodeId === node.id && node.kind === "milestone" && (
                    <button className="danger" onClick={(event) => { event.stopPropagation(); updateTask(task.id, (currentTask) => deleteNode(currentTask, node.id)); }}>
                      Delete node
                    </button>
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
        </div>

        {menu && (
          <div className="contextMenu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => createGoal(menu.world)}>Create goal here {emoji(0x1f3c1)}</button>
          </div>
        )}
      </section>

      {noteDraft && (
        <div className="modalBackdrop" onPointerDown={() => setNoteDraft(null)}>
          <form className="modal" onSubmit={saveMilestone} onPointerDown={(event) => event.stopPropagation()}>
            <h2>Add milestone</h2>
            <label>Milestone name<input autoFocus required value={noteDraft.title} onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} /></label>
            <label>Details<textarea value={noteDraft.detail} onChange={(event) => setNoteDraft({ ...noteDraft, detail: event.target.value })} /></label>
            <label>Timestamp<input type="datetime-local" value={noteDraft.timestamp} onChange={(event) => setNoteDraft({ ...noteDraft, timestamp: event.target.value })} /></label>
            <div className="modalActions"><button type="button" onClick={() => setNoteDraft(null)}>Cancel</button><button className="primary">Save milestone</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);