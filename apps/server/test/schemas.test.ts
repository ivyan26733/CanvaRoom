// What a browser may put on a board: only safe image sources, sane numbers.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clientMessageSchema,
  objectSchema,
  srcAllowedOn,
} from '../src/schemas.js';

const base = {
  id: 'o1',
  kind: 'image' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  color: '#112233',
  strokeWidth: 2,
};
const UPLOAD =
  '/api/boards/board1/images/0f8fad5b-d9cb-469f-a165-70867728950e.png';

describe('image sources', () => {
  test('accepts uploads, library files and raster data URLs', () => {
    for (const src of [
      UPLOAD,
      '/library/v1/maths/pythagoras.svg',
      'data:image/png;base64,iVBORw0KGgo=',
    ])
      assert.ok(objectSchema.safeParse({ ...base, src }).success, src);
  });

  test('rejects scripts, SVG/HTML data and other hosts', () => {
    for (const src of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGgxPg==',
      'https://evil.example/x.png',
      '//evil.example/x.png',
      '/api/boards/board1/images/../../auth/me',
      '/library/v1/maths/../../x.svg',
      `${UPLOAD}?x=1`,
    ])
      assert.ok(!objectSchema.safeParse({ ...base, src }).success, src);
  });

  test('uploads only appear on their own board', () => {
    assert.ok(srcAllowedOn('board1', UPLOAD));
    assert.ok(!srcAllowedOn('board2', UPLOAD));
    assert.ok(srcAllowedOn('board2', '/library/v1/maths/pythagoras.svg'));
    assert.ok(srcAllowedOn('board2', undefined));
  });
});

describe('object fields', () => {
  test('rejects unsafe colours and absurd numbers', () => {
    for (const bad of [
      { color: 'red;background:url(x)' },
      { color: '#112233" onload="x' },
      { x: Number.POSITIVE_INFINITY },
      { width: 1e12 },
      { points: [0, 0, 1e9, 1] },
      { strokeWidth: 10_000 },
      { fontSize: 1e6 },
    ])
      assert.ok(
        !objectSchema.safeParse({ ...base, ...bad }).success,
        JSON.stringify(bad),
      );
  });

  test('ops with extra fields are refused', () => {
    const parsed = clientMessageSchema.safeParse({
      t: 'op',
      op: {
        id: 'op1',
        type: 'update',
        objectId: 'o1',
        // As it arrives over the wire, `__proto__` is an own key.
        fields: JSON.parse('{"x":1,"__proto__":{"polluted":true}}'),
      },
    });
    assert.ok(!parsed.success);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});
