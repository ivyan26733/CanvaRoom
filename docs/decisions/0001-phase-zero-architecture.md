# ADR 0001: Prototype architecture and next-step decisions

- Status: Implemented for the local prototype; production architecture still needs review.
- Date: 2026-10-11

## Context

The repository originally contained only `README-2.md`. The product needs a replaceable canvas, granular updates, real-time presence, durable boards, server authorization, chat, audio, and export. A local runnable implementation was built with the dependencies already installed in the workspace; registry access was unavailable when additional packages were considered.

## Current implementation

### Application and storage

Use an npm workspace modular monolith: Next.js App Router for the UI and a separate Fastify process for the API. Shared types live in `packages/shared`; `packages/canvas-adapter` exposes the native SVG viewport operations used by the editor. The server serializes writes in-process and atomically replaces a local JSON state file. This is for one local instance only; PostgreSQL, migration and backup management, and multi-instance persistence are not configured. Phase 1 also has an independent memory-only local board path that bypasses server sessions and APIs.

### Canvas and export

The editor uses native SVG/React rendering without an added canvas-engine dependency. Stable object IDs and object-level operations are used for server-backed boards. PNG output is rendered in the browser from SVG; PDF is one rasterized page. The current adapter isolates viewport coordinate conversion and content bounds; rendering and object interactions are still in the web app. A canvas library may be adopted behind a fuller adapter after interaction, text, accessibility, and export requirements are prototyped. Konva/React-Konva is a possible MIT-licensed option; tldraw was not selected during the original audit because its SDK terms require a production license key.

### Collaboration semantics

The browser sends `create`, partial `update`, and `delete` operations to Fastify. The server serializes accepted operations, persists them, and streams events through Server-Sent Events. Duplicate operation IDs are ignored. Patches to different fields merge. Updates to the same scalar field are ordered by server acceptance, with the latest accepted value winning. A delete creates a tombstone, so later edits do not recreate that object; undoing a delete creates a fresh object ID. Presence is ephemeral and expires after 15 seconds without a heartbeat.

These semantics are deterministic for this single-process prototype, but concurrent edits to the same text value can overwrite one another. Undo tracks the current browser's own local actions. An operation outbox and board cache in browser storage retry edits after reconnect, but this is not a CRDT/offline-first merge model and there is no multi-server convergence. Before claiming collaboration reliability, move to Yjs/CRDT or rigorously test and evolve this operation protocol, then run the original two-client conflict and reconnect matrix.

### Authentication and permissions

The local identity is a signed, name-only temporary session with a 14-day expiry. Board roles are checked by the API. `AUTH_SECRET` must be set outside local development; production startup refuses to use the development fallback. This is not a replacement for a real authentication provider, abuse controls, secure deployment, or student-data privacy review.

### Chat and audio

Chat messages are persisted with board metadata and streamed to connected clients. Voice calling is not implemented; the UI says so and does not request microphone access. A LiveKit or equivalent SFU must be deployed and integrated for opt-in group audio.

## Licensing and references

- [Konva project and MIT license](https://github.com/konvajs/konva)
- [React-Konva project and MIT license](https://github.com/konvajs/react-konva)
- [Yjs shared data types](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [tldraw SDK license](https://tldraw.dev/community/license)
- [LiveKit SFU architecture](https://docs.livekit.io/reference/internals/livekit-sfu/)

## Open risks

- No database migrations/backups, real authentication, rate limits, or multi-instance coordination.
- Per-field last-accepted-write does not merge simultaneous text edits.
- No audio implementation or automated tests.
- PDF pagination, large-board performance, advanced accessibility, image upload, and mobile tool parity remain open.
