import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });

const environmentSchema = z.object({
  SERVER_HOST: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid server environment: ${parsed.error.message}`);
}

export const config = {
  serverHost: parsed.data.SERVER_HOST,
  serverPort: parsed.data.SERVER_PORT,
};
