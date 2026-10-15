import { z } from 'zod';

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const imageSchema = z
  .string()
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  .max(800_000);
const pointsSchema = z.array(z.number().finite()).max(100_000);

const fieldShape = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  points: pointsSchema.optional(),
  text: z.string().max(20_000).optional(),
  src: imageSchema.optional(),
  color: colorSchema,
  strokeWidth: z.number().min(0.5).max(160),
  rotation: z.number().finite().optional(),
  fontSize: z.number().min(8).max(160).optional(),
  opacity: z.number().min(0).max(1).optional(),
  fillColor: colorSchema.optional(),
};

export const objectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    'path',
    'line',
    'rect',
    'ellipse',
    'diamond',
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
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    token: z.string().min(1).max(4000),
    boardId: z.string().min(1).max(100),
    peerId: z.string().min(1).max(100),
    color: colorSchema,
    inCall: z.boolean().optional(),
    muted: z.boolean().optional(),
  }),
  z.object({ t: z.literal('op'), op: operationSchema }),
  // Everything a browser streams while someone works, batched once per frame:
  // the cursor, objects still being drawn/typed/moved (`upsert`), new points
  // for pen strokes the peers already have (`append`), and finished drafts.
  z.object({
    t: z.literal('live'),
    cursor: z
      .object({ x: z.number().finite(), y: z.number().finite() })
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
  }),
  z.object({
    t: z.literal('signal'),
    to: z.string().min(1).max(100),
    data: z.unknown(),
  }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
