# Completed Process Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the completed-board list into polished user-facing cards that reveal the full task process.

**Architecture:** Keep persistence and board shape unchanged. Add pure helpers in `src/progressCore.js` for completed-card summaries so behavior is testable, then render those summaries in `src/main.jsx` with expanded timeline cards. Polish `src/styles.css` with soft glass cards and custom scrollbars.

**Tech Stack:** React, Vite, Electron, Vitest, CSS.

---

### Task 1: Card Summary Helpers

**Files:**
- Modify: `src/progressCore.js`
- Test: `tests/progressCore.test.js`

- [ ] Add tests for completed task summary and ordered process entries.
- [ ] Run focused Vitest and confirm the new tests fail before implementation.
- [ ] Implement `getTaskProcessEntries` and `getCompletedTaskSummary`.
- [ ] Run focused Vitest and confirm the tests pass.

### Task 2: Completed Card UI

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

- [ ] Import the new summary helpers in `src/main.jsx`.
- [ ] Replace the simple completed list rows with expandable cards.
- [ ] Render full process timeline with title, date, kind label, and detail.
- [ ] Add soft card styling and custom sidebar scrollbars.
- [ ] Run `npm.cmd test` and `npm.cmd run build`.

---

## Revision: Completed Gallery Overlay

**Goal:** Move completed cards out of the sidebar into a polished, dismissible gallery overlay.

**Architecture:** Keep the existing completed-card data helpers. Replace the sidebar card list with a compact entry card that opens a gallery overlay. The overlay owns local UI state for the selected completed task and switches between a card grid and a single journey detail view.

### Task 3: Sidebar Entry and Overlay State

**Files:**
- Modify: `src/main.jsx`

- [ ] Add `completedGalleryOpen` and `selectedCompletedTaskId` state.
- [ ] Replace the sidebar completed list with a compact entry card and `Open Gallery` button.
- [ ] Reset `selectedCompletedTaskId` when closing the gallery.

### Task 4: Gallery Grid and Journey Detail

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

- [ ] Render a centered overlay panel when the gallery is open.
- [ ] Show completed cards in a responsive two-column grid.
- [ ] Add `Open Journey` per card to switch into a dedicated process timeline view.
- [ ] Add `Back to cards` and `Close` controls.
- [ ] Style overlay, cards, and scrollbars with soft glassmorphism.
