# Phase 1 implementation summary

This pass follows [`../PHASE_1_README.md`](../PHASE_1_README.md), the detailed UI shell and local canvas brief.

## Implemented

- Added a browser-only local board flow from the landing page. It needs no session or API calls, stores work in memory only, identifies unsaved work clearly, and warns before refresh/close or leaving through the app logo.
- Added editable local board titles, empty-board hint, clear selection, selection and movement, Shift multi-select, group movement, resize handles for rectangles, ellipses, diamonds, and images, delete, and duplicate.
- Added line and diamond tools, plus live shape previews for lines, arrows, ellipses, rectangles, and diamonds.
- Added text and sticky-note editing, default sticky text, image type/size/load validation, and local-only image uploads. Shared/server boards reject new image data to avoid sending it to the API.
- Added fill color, opacity, font size, and relevant stroke controls in the object properties panel. The panel can be opened and closed on tablet/mobile widths.
- Added top-bar undo/redo, local history for create/move/resize/style/text/delete, and keyboard shortcuts for undo/redo, copy/paste, duplicate, select all, delete, Escape, zoom, and tool switching. Shortcuts ignore editable controls and dialogs.
- Implemented native SVG canvas viewport math and content bounds through `packages/canvas-adapter`; Fit canvas frames the content. Light/dark/system themes, reduced-motion styles, focus indicators, and accessible tool names/state are present.
- Updated the visible product name to CollabBoard and revised the app README and architecture notes.

## Verification

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm run build` — passed.
- `npm run dev` — could not start in this environment. Next.js failed to bind `0.0.0.0:3000` with `EPERM`; this is an environment port-binding restriction, so I could not verify the interactive UI in a browser here.
- No app-level test runner or UI test suite exists in this repository, and none was added. The brief’s interaction and responsive test cases therefore remain unverified by automated tests.

## Remaining limitations and decisions

- Native SVG/React remains selected. The adapter currently handles viewport coordinates and bounds; rendering and object interactions still live in the web app. A full renderer swap would require moving those behind the adapter.
- Rotation, grouping/ungrouping, layer ordering, wheel/pinch zoom, and keyboard-operated resize handles are not implemented. Image uploads are restricted to local boards; they are kept as in-memory data URLs and disappear when the board is left.
- On mobile, the tool rail is reduced to a compact toolbar; some desktop tools are not directly available there. The property panel can be opened from the footer on tablet widths.
- Server-backed boards and their collaboration/chat/persistence features remain available as existing prototype functionality. They are outside the Phase 1 local-board flow and are documented separately in `README.md`.
- Automated interaction tests, browser verification, large-board performance profiling, and production deployment configuration remain future work. Phase 2 should begin with a decision on whether to preserve the existing server-backed prototype path while adding durable database persistence.

## Files changed

- `apps/web/app/page.tsx`: local board entry points.
- `apps/web/app/board/[id]/page.tsx`: local-only lifecycle and core canvas tools, selection, resize, keyboard controls, and object properties.
- `apps/web/app/lib/api.ts`, `apps/server/src/index.ts`, `apps/server/src/models.ts`: line/diamond objects and opacity/fill styling schema.
- `apps/web/app/styles.css`: local-mode status, active/responsive properties controls, and resize affordance.
- `packages/canvas-adapter/src/index.ts`: viewport conversion and corrected bounds for relative path points.
- `README.md`, `docs/decisions/0001-phase-zero-architecture.md`: current behavior and architecture trade-offs.
