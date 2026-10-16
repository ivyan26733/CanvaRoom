// Applies db/schema.sql over the direct (unpooled) connection.
import { migrate } from '../src/db.js';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL.');
await migrate(url);
console.log('Schema is up to date.');
