# CanvaRoom

A real-time collaborative whiteboard with live voice and chat. Everything one
person draws, moves, or types streams to everyone else as it happens.

## Run locally

Requirements: Node.js 20.9+ and npm.

```sh
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run dev` starts the
Next.js app and the Fastify API (port 4000). Without `DATABASE_URL` or
`REDIS_URL` the API keeps boards in memory and saves them to
`apps/server/data/state.json`; without `BLOB_READ_WRITE_TOKEN` uploaded images
go to `apps/server/data/images`.

```sh
npm run typecheck
npm run lint
npm run build
npm run format:check
```

## What works

- **Live drawing:** pen and marker strokes stream point by point while you draw;
  shapes, moves, resizes, slider changes, and typing stream live too, and remote
  cursors follow smoothly. Changes are committed as atomic per-object operations.
- **Voice:** "Start audio" opens a peer-to-peer WebRTC call over the board’s
  connection, with mute, speaking indicators, and a prompt for others to join.
- **Chat:** room chat with unread badges, typing indicators, and history.
- Pen, marker, eraser (drag to erase), box, ellipse, diamond, line, arrow, text,
  sticky notes, and images. Select, marquee-select, move, resize, nudge, style,
  duplicate, copy/paste, and undo/redo.
- **Pages:** each board holds up to 50 pages. Add, rename, duplicate, reorder,
  and delete them; everyone sees changes live, the pages panel shows who is on
  which page, and the current page is kept in the URL. Selections can be moved
  to another page.
- **Zoom:** 10%–800% with +/−, a slider, 50/100/200% presets, zoom to fit or
  selection, and a minimap. New ink keeps the same on-screen size at any zoom
  ("Pen size follows zoom"), so you can zoom in for fine detail.
- Infinite canvas: scroll to pan, Ctrl/⌘ + scroll or pinch to zoom, Space+drag.
- Accounts with profiles, guest access through invite links, and board
  templates (brainstorm, flowchart, kanban, retrospective) with live thumbnails
  on the dashboard.
- Invite links, editor/viewer roles, pausing editing, saved versions, and
  PNG/SVG/PDF export.
- Reconnects automatically. Unsent edits are kept in the browser and replayed,
  so nothing is lost when a connection drops.
- Light/dark theme, phone layout, and keyboard shortcuts (press `?`).

## Architecture

- `apps/web` — Next.js editor. `lib/realtime.ts` holds one WebSocket per board,
  batches live activity once per frame, and keeps an acknowledged outbox of
  edits. Rendering is SVG; shapes are memoized and in-progress gestures render
  in separate layers so drawing never re-renders the whole board.
- `apps/server` — Fastify API plus a WebSocket hub at `/api/ws`
  (`src/realtime.ts`). Rooms deliver to local sockets directly and fan out
  through Redis pub/sub only when another server instance has the same board
  open. Accounts, sessions, and boards live in Postgres (`src/pg-store.ts`,
  schema in `db/schema.sql`), one row per object, so concurrent edits to
  different objects never collide. Redis holds only presence, rate limits, and
  cross-instance fan-out. Images are uploaded to a private Vercel Blob store and
  served through `/api/boards/:id/images/:name` to board members only.
- `packages/canvas-adapter`, `packages/shared` — shared types and viewport math.

## Deploying to Vercel

`vercel.json` deploys both apps as [Vercel Services](https://vercel.com/docs/services)
in one project: `/api/*` (including the WebSocket) goes to the API, everything
else to Next.js. Functions are pinned to `bom1` (Mumbai) next to Redis and
Blob; Postgres is Neon in `sin1` (Singapore), the nearest region it offers.
The project’s Root Directory must be the repository root.

After changing `db/schema.sql`, apply it before deploying (it is safe to rerun):

```sh
DATABASE_URL_UNPOOLED=... npm run db:migrate -w @collabboard/server
```

`npm run db:import-redis -w @collabboard/server` copies boards from the older
Redis-only storage into Postgres, skipping boards already there.

Required environment variables:

| Variable                                        | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `AUTH_SECRET`                                   | Signs sessions. Use a long random value.  |
| `DATABASE_URL`                                  | Set by the Neon integration (pooled).     |
| `REDIS_URL` or `KV_URL`                         | Set by the Upstash for Redis integration. |
| `BLOB_READ_WRITE_TOKEN`                         | Set when the Blob store is connected.     |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Optional TURN relay for voice.            |

Vercel ends a WebSocket when the function reaches its maximum duration (5
minutes on Hobby). The client reconnects immediately and resyncs, and voice
calls continue because they are peer-to-peer.

## Limitations

- Voice is a full mesh, so it suits groups of up to about 8. Without a TURN
  server, some people on strict corporate or mobile networks may not connect.
- Two people editing the same text at the same moment: the last committed edit
  wins (no character-level merging).
- PDF export is a single raster page.
