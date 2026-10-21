import { z } from 'zod';

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
// Uploaded images are referenced by their app path. Inline data URLs are
// still accepted from boards and outboxes saved before uploads existed.
// Library items point at the web app's own versioned static SVGs, so a board
// never stores SVG markup from a browser.
export const LIBRARY_SRC =
  /^\/library\/v[0-9]{1,3}\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}\.svg$/;
// An uploaded image's app path; the board it names must be the board the
// object is on (checked where the board is known).
export const UPLOADED_SRC =
  /^\/api\/boards\/([A-Za-z0-9_-]{1,64})\/images\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/;
const imageSchema = z.union([
  z.string().regex(LIBRARY_SRC),
  z.string().regex(UPLOADED_SRC),
  z
    .string()
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(800_000),
]);
// Board coordinates and sizes. Far beyond any real board, but bounded, so a
// crafted object can't make every viewer's browser lay out or export a
// canvas billions of pixels wide.
const COORD = 10_000_000;
const coordSchema = z.number().min(-COORD).max(COORD);
const pointsSchema = z.array(coordSchema).max(100_000);

const fieldShape = {
  x: coordSchema,
  y: coordSchema,
  width: coordSchema.optional(),
  height: coordSchema.optional(),
  points: pointsSchema.optional(),
  text: z.string().max(20_000).optional(),
  src: imageSchema.optional(),
  color: colorSchema,
  strokeWidth: z.number().min(0.5).max(160),
  rotation: z.number().min(-COORD).max(COORD).optional(),
  fontSize: z.number().min(8).max(160).optional(),
  opacity: z.number().min(0).max(1).optional(),
  fillColor: colorSchema.optional(),
  page: z.string().min(1).max(40).optional(),
};

export const objectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    'path',
    'line',
    'rect',
    'ellipse',
    'diamond',
    'triangle',
    'right-triangle',
    'parallelogram',
    'trapezoid',
    'pentagon',
    'hexagon',
    'star',
    'cylinder',
    'bubble',
    'arrow',
    'text',
    'sticky',
    'image',
  ]),
  ...fieldShape,
});

export const fieldsSchema = z
  .object({
    ...fieldShape,
    x: fieldShape.x.optional(),
    y: fieldShape.y.optional(),
    color: fieldShape.color.optional(),
    strokeWidth: fieldShape.strokeWidth.optional(),
  })
  .strict();

export const operationSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(['create', 'update', 'delete']),
    objectId: z.string().min(1).max(100),
    object: objectSchema.optional(),
    fields: fieldsSchema.optional(),
  })
  .refine(
    (op) =>
      (op.type === 'create' && op.object?.id === op.objectId) ||
      (op.type === 'update' &&
        op.fields !== undefined &&
        Object.keys(op.fields).length > 0) ||
      op.type === 'delete',
    'Canvas update is incomplete.',
  );

/** Messages a browser may send over the board WebSocket. */
// A microphone published to the SFU, with the token the server issued for it.
const audioTrackSchema = z.object({
  session: z.string().regex(/^[0-9a-f]{16,128}$/),
  track: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  token: z.string().regex(/^[0-9a-f]{64}$/),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    boardId: z.string().min(1).max(100),
    peerId: z.string().min(1).max(100),
    color: colorSchema,
    inCall: z.boolean().optional(),
    muted: z.boolean().optional(),
    audio: audioTrackSchema.optional(),
    away: z.boolean().optional(),
  }),
  z.object({ t: z.literal('op'), op: operationSchema }),
  // Everything a browser streams while someone works, batched once per frame:
  // the cursor, objects still being drawn/typed/moved (`upsert`), new points
  // for pen strokes the peers already have (`append`), and finished drafts.
  z.object({
    t: z.literal('live'),
    cursor: z
      .object({
        x: coordSchema,
        y: coordSchema,
        page: z.string().min(1).max(40).optional(),
        // Set while drawing, erasing, or typing, so others can follow along.
        active: z.boolean().optional(),
        view: z
          .tuple([coordSchema, coordSchema, coordSchema, coordSchema])
          .optional(),
      })
      .nullable()
      .optional(),
    upsert: z.array(objectSchema).max(200).optional(),
    append: z
      .array(z.object({ id: z.string().min(1).max(100), points: pointsSchema }))
      .max(50)
      .optional(),
    remove: z.array(z.string().min(1).max(100)).max(200).optional(),
  }),
  z.object({
    t: z.literal('chat'),
    clientId: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({ t: z.literal('typing') }),
  z.object({
    t: z.literal('call'),
    inCall: z.boolean(),
    muted: z.boolean(),
    audio: audioTrackSchema.optional(),
  }),
  z.object({
    t: z.literal('signal'),
    to: z.string().min(1).max(100),
    data: z.unknown(),
  }),
  z.object({ t: z.literal('ping') }),
  // The tab has been in the background for a while (or is back).
  z.object({ t: z.literal('away'), away: z.boolean() }),
  // The tab is closing or leaving the board: drop its presence right away.
  z.object({ t: z.literal('bye') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const pageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
export const pageNameSchema = z.string().trim().min(1).max(60);

/** Whether an object's image, if any, may appear on board `boardId`. */
export const srcAllowedOn = (boardId: string, src: string | undefined) =>
  !src || (UPLOADED_SRC.exec(src)?.[1] ?? boardId) === boardId;
