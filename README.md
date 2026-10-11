# CollabBoard

A collaborative classroom whiteboard prototype built from the requirements in [`../README-2.md`](../README-2.md). It includes a board library, drawing/editor UI, persistent board operations, room chat, invite links, role controls, version snapshots, and PNG/PDF export.

## Run locally

Requirements: Node.js 20.9+ and npm. The dependencies are installed in this workspace.

```sh
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API health endpoint is [http://localhost:4000/health](http://localhost:4000/health). `npm run dev` starts both the Next.js app and Fastify API. The server writes local data to `apps/server/data/state.json`.

Useful commands:

```sh
npm run typecheck
npm run lint
npm run build
npm run format:check
```

## What works

- Create, rename, duplicate, and delete boards; reopen saved boards.
- Open a browser-only local board without creating a session. Local boards support freehand/highlighter strokes, lines, arrows, rectangles, ellipses, diamonds, text, sticky notes, and PNG/JPEG/WebP uploads up to 500 KB. Select, multi-select, move, resize supported shapes/images, duplicate/copy/paste, style, erase, undo, and redo. Local work is lost on refresh or when leaving the board; the editor warns before navigation.
- Server-backed prototype boards remain available from the board library with the existing persistence and collaboration features. Image uploads are disabled for those boards so image data is not sent to the server.
- Share invite links, revoke/regenerate links, set participant roles, and pause/resume editing.
- See live cursor presence, room participants, chat, and reconnection state.
- Save and restore board snapshots.
- Download a PNG or a one-page, image-based PDF.
- Responsive layout, light/dark/system theme, keyboard shortcuts, accessible tool state and keyboard object selection, and reduced-motion support.

## Architecture

- `apps/web`: Next.js App Router UI and SVG canvas renderer.
- `apps/server`: Fastify API, signed temporary sessions, SSE room updates, and atomic JSON persistence.
- `packages/shared`: cross-app board types.
- `packages/canvas-adapter`: engine-neutral viewport boundary, currently implemented by the native SVG adapter used by the editor for pointer coordinates and fit-to-content. Rendering and pointer interactions still live in the web app.

See [ADR 0001](docs/decisions/0001-phase-zero-architecture.md) for current decisions and trade-offs.

## Current limitations

This is a runnable local prototype; it is not production-ready and does not yet meet every P0 requirement in the original brief. Phase 1 local mode is memory-only by design; it does not save or sync its work. The current canvas engine decision is native SVG/React behind a small adapter, not a third-party canvas SDK. Replaceability is established for viewport operations; rendering and object interaction still live in the web app and would need moving behind the boundary before swapping rendering engines.

- Collaboration uses server-serialized, per-object field operations over HTTP and Server-Sent Events. Concurrent changes to separate fields/objects are preserved; simultaneous edits to the same scalar/text field use last accepted update. A browser-local board cache and operation outbox allow edits to queue and retry after reconnect, but there is no Yjs/CRDT text merge, WebSocket transport, or multi-instance coordination yet.
- Data is stored in one local JSON file. PostgreSQL, migrations, database backups, and object storage are not wired up.
- Authentication is a signed, name-only temporary session. It is suitable for local prototyping only; use a real identity provider and set a strong `AUTH_SECRET` outside local development.
- Audio UI explicitly reports that calling is unavailable. A LiveKit/SFU integration, device selection, mute controls, and reconnect states still need implementation; microphone access is not requested.
- PDF output is a single-page rasterized image. Large-board pagination and engine-native/vector export are not implemented.
- Mobile supports simple board edits and chat, but the desktop toolbar/property layout is reduced.
- No automated test runner or production deployment configuration has been added. The available typecheck, lint, formatting, and build commands pass.
- The SVG canvas is responsive, but large-board performance has not been profiled. Resize handles are pointer-operated; object selection can also be reached by keyboard.

Do not expose this prototype to student data or the public internet until authentication, authorization, persistence, privacy, transport security, rate limits, and collaboration conflict behavior have been hardened.
