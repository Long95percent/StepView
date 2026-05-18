# Worklog 5-18

## Project

StepView - a desktop progress visualization app with an infinite canvas, goal nodes, milestones, completed board, emoji stickers, and local persistence.

## Completed Today

### Project Setup

- Created a Vite + React application structure.
- Added Electron desktop shell.
- Added one-click Windows startup script: `start.bat`.
- Added `.gitignore` for Node, Vite, Electron, build outputs, logs, local data, and editor files.

### Core Progress Model

- Added task creation with automatic start and finish nodes.
- Added milestone insertion between existing nodes.
- Added node and emoji sticker movement logic.
- Added milestone deletion with edge reconnection.
- Added task completion, restore, and deletion.
- Added board normalization for safe local data loading.
- Added compact date formatting for node labels.

### Canvas UI

- Built high-end dark glassmorphism visual style.
- Added infinite-feeling draggable canvas with grid background.
- Added draggable nodes and emoji stickers.
- Added SVG edges between task nodes.
- Added selected-node expanded detail view.
- Added visible node names so goal and milestone names are readable without clicking.
- Added highlighted finish-node title styling.

### Goal Creation Flow

- Reworked the goal creation panel after review.
- Removed the duplicated goal naming modal.
- Removed the old `prompt`-based creation flow.
- New model:
  - Type goal name once in the left panel.
  - Click `Create at auto spot` to create automatically.
  - Or right-click canvas and choose `Create goal here` to place it exactly.
- Right-click now controls placement only, not naming.

### Milestone Flow

- Added milestone creation from the `+` button on non-finish nodes.
- Milestone modal includes:
  - Milestone name
  - Details
  - Timestamp
- Milestone names now show directly on the node card.

### Completed Board

- Added completed-board section in the sidebar.
- Completed goals move out of the active canvas view.
- Completed goals can be restored or deleted.

### Emoji Features

- Added draggable emoji sticker library.
- Expanded emoji library from the initial small set to about 90 emojis.
- Added scrolling emoji panel.
- Added double-click deletion for emoji stickers.

### Desktop Persistence

- Added Electron preload bridge.
- Added IPC handlers for loading, saving, and revealing the local data file.
- Desktop data saves to Electron user data directory as `stepview-board.json`.
- Browser preview mode still falls back to `localStorage`.

### Encoding Stability

- Fixed repeated Windows encoding and literal newline issues.
- Rewrote key source files with ASCII-safe source where useful.
- Emoji are generated at runtime through code points to avoid source encoding corruption.

## Validation

Latest verified commands:

```bash
npm.cmd test
npm.cmd run build
```

Results:

- Tests: 6 passed.
- Production build: passed.
- Checked for literal `\r` / `\n` pollution in source during previous validation rounds.

## Key Files

- `src/main.jsx` - main React UI and canvas interactions.
- `src/progressCore.js` - task, node, board, and date logic.
- `src/styles.css` - visual design and layout.
- `electron/main.js` - Electron window and file persistence IPC.
- `electron/preload.js` - safe renderer bridge for desktop persistence.
- `tests/progressCore.test.js` - core behavior tests.
- `start.bat` - one-click desktop launcher.
- `.gitignore` - ignored dependencies, build outputs, local files, and editor artifacts.

## Known Limitations

- App is currently a development-mode Electron desktop app, not a packaged installer.
- Local persistence is JSON file based, not SQLite yet.
- UI text is currently mostly English to avoid Windows source encoding issues during rapid iteration.
- No undo/redo history yet.
- No zoom controls in the UI, only mouse wheel zoom.
- No explicit task editing flow after creation yet.

## Recommended Next Steps

1. Add packaged Windows build with `electron-builder`.
2. Add task and milestone edit actions.
3. Add explicit zoom controls and minimap.
4. Add SQLite persistence if richer querying/history is needed.
5. Add undo/redo for node movement and deletion.
6. Add Chinese UI through a safe i18n JSON pipeline after encoding rules are stable.