'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  filename,
  id,
  readOutbox,
  readCachedBoard,
  readSession,
  send,
  writeOutbox,
  writeCachedBoard,
  writeSession,
  type Board,
  type BoardObject,
  type ChatMessage,
  type Peer,
  type PendingOperation,
  type Session,
} from '../../lib/api';
import { ThemeToggle } from '../../components/theme-toggle';
import { SvgCanvasAdapter } from '@collabboard/canvas-adapter';

type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky'
  | 'eraser';
type Point = { x: number; y: number };
type HistoryEntry = {
  objectId: string;
  before: BoardObject | null;
  after: BoardObject | null;
};
type DragState = {
  id: string;
  ids?: string[];
  start: Point;
  origins?: Record<string, Point>;
  before?: Record<string, BoardObject>;
  origin: Point;
  size?: Point;
  mode?: 'pan' | 'move' | 'resize';
};
type Snapshot = { id: string; title: string; createdAt: string };
const canvasWidth = 1600;
const canvasHeight = 1000;
const colors = [
  '#283c35',
  '#458a72',
  '#e58b58',
  '#e1b94e',
  '#8e79bd',
  '#de7380',
  '#6d9db4',
  '#f6f0df',
];
const cursorColors = ['#4c9d7a', '#d98b48', '#8d79bd', '#df6c7a', '#5591af'];

function objectFields(object: BoardObject): Partial<BoardObject> {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => key !== 'id'),
  ) as Partial<BoardObject>;
}

function applyPendingOperations(
  objects: BoardObject[],
  pending: PendingOperation[],
) {
  let next = [...objects];
  for (const operation of pending) {
    if (operation.type === 'create' && operation.object) {
      next = [
        ...next.filter((item) => item.id !== operation.objectId),
        operation.object,
      ];
    } else if (operation.type === 'delete') {
      next = next.filter((item) => item.id !== operation.objectId);
    } else {
      next = next.map((item) =>
        item.id === operation.objectId
          ? { ...item, ...operation.fields }
          : item,
      );
    }
  }
  return next;
}

function shapePath(item: BoardObject) {
  const points = item.points ?? [];
  if (points.length < 4) return '';
  return `M ${points[0]} ${points[1]} L ${points[2]} ${points[3]}`;
}

function BoardShape({
  item,
  selected,
  readonly,
  handTool,
  onSelect,
  onDragStart,
  onResizeStart,
  onUpdateText,
  onDelete,
}: {
  item: BoardObject;
  selected: boolean;
  readonly: boolean;
  handTool: boolean;
  onSelect: () => void;
  onDragStart: (
    event: React.PointerEvent<SVGGElement>,
    item: BoardObject,
  ) => void;
  onResizeStart: (
    event: React.PointerEvent<SVGCircleElement>,
    item: BoardObject,
  ) => void;
  onUpdateText: (text: string) => void;
  onDelete: () => void;
}) {
  const stroke = item.color;
  const shape =
    item.kind === 'path' ? (
      <polyline
        points={(item.points ?? [])
          .reduce<string[]>((acc, point, index, points) => {
            if (index % 2 === 0) acc.push(`${point},${points[index + 1]}`);
            return acc;
          }, [])
          .join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={item.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : item.kind === 'line' ? (
      <path
        d={shapePath(item)}
        fill="none"
        stroke={stroke}
        strokeWidth={item.strokeWidth}
      />
    ) : item.kind === 'diamond' ? (
      <polygon
        points={`${(item.width ?? 1) / 2},0 ${item.width ?? 1},${(item.height ?? 1) / 2} ${(item.width ?? 1) / 2},${item.height ?? 1} 0,${(item.height ?? 1) / 2}`}
        fill={item.fillColor ?? `${stroke}14`}
        stroke={stroke}
        strokeWidth={item.strokeWidth}
      />
    ) : item.kind === 'rect' ? (
      <rect
        x="0"
        y="0"
        width={Math.max(1, item.width ?? 1)}
        height={Math.max(1, item.height ?? 1)}
        rx="4"
        fill={item.fillColor ?? `${stroke}14`}
        stroke={stroke}
        strokeWidth={item.strokeWidth}
      />
    ) : item.kind === 'ellipse' ? (
      <ellipse
        cx={(item.width ?? 1) / 2}
        cy={(item.height ?? 1) / 2}
        rx={Math.max(1, (item.width ?? 1) / 2)}
        ry={Math.max(1, (item.height ?? 1) / 2)}
        fill={item.fillColor ?? `${stroke}12`}
        stroke={stroke}
        strokeWidth={item.strokeWidth}
      />
    ) : item.kind === 'arrow' ? (
      <path
        d={shapePath(item)}
        fill="none"
        stroke={stroke}
        strokeWidth={item.strokeWidth}
        markerEnd="url(#arrowhead)"
      />
    ) : item.kind === 'sticky' ? (
      <g>
        <rect
          width={item.width ?? 188}
          height={item.height ?? 164}
          rx="5"
          fill={stroke === '#f6f0df' ? '#f6f0df' : `${stroke}35`}
          stroke={`${stroke}55`}
        />
        <path
          d={`M 18 28 H ${(item.width ?? 188) - 18}`}
          stroke={`${stroke}70`}
          strokeWidth="1"
        />
        <text
          x="18"
          y="55"
          fill="#33433c"
          fontSize={item.fontSize ?? 18}
          fontFamily="Arial, sans-serif"
        >
          {(item.text ?? '')
            .split('\n')
            .slice(0, 5)
            .map((line, index) => (
              <tspan key={`${line}-${index}`} x="18" dy={index === 0 ? 0 : 24}>
                {line}
              </tspan>
            ))}
        </text>
      </g>
    ) : item.kind === 'image' ? (
      <image
        role="img"
        aria-label="Uploaded image"
        href={item.src}
        x="0"
        y="0"
        width={item.width ?? 180}
        height={item.height ?? 140}
        preserveAspectRatio="xMidYMid meet"
      />
    ) : (
      <text
        x="0"
        y="0"
        fill={stroke}
        fontSize={item.fontSize ?? 30}
        fontFamily="Arial, sans-serif"
        dominantBaseline="hanging"
      >
        {item.text}
      </text>
    );
  return (
    <g
      transform={`translate(${item.x} ${item.y}) rotate(${item.rotation ?? 0})`}
      opacity={item.opacity ?? 1}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!readonly || handTool) onDragStart(event, item);
        else onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!readonly && (item.kind === 'text' || item.kind === 'sticky')) {
          const next = window.prompt('Edit text', item.text ?? '');
          if (next !== null) onUpdateText(next);
        }
      }}
      onContextMenu={(event) => {
        if (!readonly) {
          event.preventDefault();
          onDelete();
        }
      }}
      className={readonly ? 'canvas-object readonly' : 'canvas-object'}
      role="button"
      tabIndex={0}
      aria-label={`Canvas object: ${item.kind}${item.text ? `, ${item.text.slice(0, 80)}` : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {shape}
      {selected && (
        <>
          <rect
            x="-7"
            y="-7"
            width={Math.max(item.width ?? 150, 18) + 14}
            height={Math.max(item.height ?? item.fontSize ?? 40, 24) + 14}
            fill="none"
            stroke="#3c9672"
            strokeWidth="1.5"
            strokeDasharray="6 5"
            pointerEvents="none"
          />
          {!readonly &&
            ['rect', 'ellipse', 'diamond', 'image'].includes(item.kind) && (
              <circle
                cx={Math.max(item.width ?? 180, 18) + 7}
                cy={Math.max(item.height ?? 140, 24) + 7}
                r="7"
                fill="#fff"
                stroke="#3c9672"
                strokeWidth="2"
                className="resize-handle"
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onResizeStart(event, item);
                }}
              />
            )}
        </>
      )}
    </g>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportImage(
  objects: BoardObject[],
  title: string,
  format: 'png' | 'pdf',
) {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="100%" height="100%" fill="#fffefa"/><defs><marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0L10 4L0 8z" fill="#283c35"/></marker></defs>${objects
    .map((item) => {
      const text = (item.text ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      const stroke = item.color;
      const transform = `translate(${item.x} ${item.y}) rotate(${item.rotation ?? 0})`;
      if (item.kind === 'path') {
        const points = item.points ?? [];
        const path = points
          .reduce<string[]>((list, value, index) => {
            if (index % 2 === 0) list.push(`${value},${points[index + 1]}`);
            return list;
          }, [])
          .join(' ');
        return `<polyline transform="${transform}" points="${path}" fill="none" stroke="${stroke}" stroke-width="${item.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      if (item.kind === 'line')
        return `<path transform="${transform}" d="${shapePath(item)}" fill="none" stroke="${stroke}" stroke-width="${item.strokeWidth}"/>`;
      if (item.kind === 'diamond')
        return `<polygon transform="${transform}" points="${(item.width ?? 1) / 2},0 ${item.width ?? 1},${(item.height ?? 1) / 2} ${(item.width ?? 1) / 2},${item.height ?? 1} 0,${(item.height ?? 1) / 2}" fill="${item.fillColor ?? `${stroke}14`}" stroke="${stroke}" stroke-width="${item.strokeWidth}"/>`;
      if (item.kind === 'rect')
        return `<rect transform="${transform}" width="${item.width ?? 1}" height="${item.height ?? 1}" rx="4" fill="${item.fillColor ?? `${stroke}14`}" stroke="${stroke}" stroke-width="${item.strokeWidth}"/>`;
      if (item.kind === 'ellipse')
        return `<ellipse transform="${transform}" cx="${(item.width ?? 1) / 2}" cy="${(item.height ?? 1) / 2}" rx="${(item.width ?? 1) / 2}" ry="${(item.height ?? 1) / 2}" fill="${item.fillColor ?? `${stroke}14`}" stroke="${stroke}" stroke-width="${item.strokeWidth}"/>`;
      if (item.kind === 'arrow')
        return `<path transform="${transform}" d="${shapePath(item)}" fill="none" stroke="${stroke}" stroke-width="${item.strokeWidth}" marker-end="url(#arrowhead)"/>`;
      if (item.kind === 'sticky')
        return `<g transform="${transform}"><rect width="${item.width ?? 188}" height="${item.height ?? 164}" rx="5" fill="${stroke}35"/><text x="18" y="38" fill="#33433c" font-size="18" font-family="Arial">${text.split('\n').join('&#10;')}</text></g>`;
      if (item.kind === 'image')
        return `<image transform="${transform}" href="${item.src ?? ''}" width="${item.width ?? 180}" height="${item.height ?? 140}" preserveAspectRatio="xMidYMid meet"/>`;
      return `<text transform="${transform}" fill="${stroke}" font-size="${item.fontSize ?? 30}" font-family="Arial">${text}</text>`;
    })
    .join('')}</svg>`;
  const image = new Image();
  image.src = URL.createObjectURL(
    new Blob([markup], { type: 'image/svg+xml' }),
  );
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error('Unable to render this board for export.'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Canvas export is unavailable in this browser.');
  context.fillStyle = '#fffefa';
  context.fillRect(0, 0, 1600, 1000);
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(image.src);
  if (format === 'png') {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename(title, 'png'));
    }, 'image/png');
    return;
  }
  const jpeg = canvas.toDataURL('image/jpeg', 0.94).split(',')[1]!;
  const binary = atob(jpeg);
  const content = `q\n960 0 0 600 0 0 cm\n/Im0 Do\nQ`;
  const pdfObjects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 600] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    `<< /Type /XObject /Subtype /Image /Width 1600 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${binary.length} >>\nstream\n${binary}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  pdfObjects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index++)
    bytes[index] = pdf.charCodeAt(index);
  downloadBlob(
    new Blob([bytes], { type: 'application/pdf' }),
    filename(title, 'pdf'),
  );
}

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const boardId = params.id;
  const isLocalBoard = boardId.startsWith('local-');
  const [session, setSession] = useState<Session | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peersState, setPeersState] = useState<Peer[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [color, setColor] = useState(colors[1]!);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [chatOpen, setChatOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [notice, setNotice] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>(
    'connecting',
  );
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>(
    'saved',
  );
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [lastCursor, setLastCursor] = useState<Point | null>(null);
  const stageRef = useRef<SVGSVGElement>(null);
  const canvasAdapter = useRef(new SvgCanvasAdapter<BoardObject>());
  const imagePicker = useRef<HTMLInputElement>(null);
  const boardRef = useRef<Board | null>(null);
  const localObjects = useRef<BoardObject[]>([]);
  const history = useRef<HistoryEntry[]>([]);
  const redoHistory = useRef<HistoryEntry[]>([]);
  const propertyEditOrigin = useRef<BoardObject | null>(null);
  const textEditOrigins = useRef<Record<string, BoardObject>>({});
  const clipboard = useRef<BoardObject[]>([]);
  const pendingOperations = useRef(0);
  const flushingOutbox = useRef(false);
  const offlineOperations = useRef<PendingOperation[]>([]);
  const readonly = board?.role === 'viewer' || board?.locked;
  const boardReady = board !== null;
  const selectedObject = useMemo(
    () => objects.find((item) => selected.at(-1) === item.id),
    [objects, selected],
  );

  useEffect(() => {
    canvasAdapter.current.load(objects);
  }, [objects]);

  useEffect(() => () => canvasAdapter.current.destroy(), []);

  function chooseTool(next: Tool) {
    setDraft(null);
    setDrag(null);
    setTool(next);
  }

  useEffect(() => {
    if (isLocalBoard) {
      const localSession = {
        token: 'local-only',
        user: { id: 'local-user', name: 'You' },
      };
      setSession(localSession);
      setNameInput(localSession.user.name);
      return;
    }
    const existing = readSession();
    if (existing) {
      setSession(existing);
      setNameInput(existing.user.name);
    }
  }, [isLocalBoard]);

  useEffect(() => {
    if (!isLocalBoard) return;
    const now = new Date().toISOString();
    const localBoard: Board = {
      id: boardId,
      title: 'Untitled local board',
      ownerId: 'local-user',
      role: 'owner',
      locked: false,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      objects: [],
      messages: [],
      members: [
        { userId: 'local-user', role: 'owner', name: 'You', online: true },
      ],
    };
    boardRef.current = localBoard;
    setBoard(localBoard);
    setObjects([]);
    localObjects.current = [];
    setMessages([]);
    setStatus('live');
    setNotice(
      'This local board only lives in this tab. Copy or export your work before refreshing or closing it.',
    );
  }, [boardId, isLocalBoard]);

  const loadBoard = useCallback(
    async (current: Session) => {
      try {
        const invite = search.get('invite');
        let value: Board;
        try {
          value = await api<Board>(`/boards/${boardId}`);
        } catch (error) {
          if (!invite) throw error;
          await send(`/boards/${boardId}/join`, 'POST', {
            inviteToken: invite,
          });
          value = await api<Board>(`/boards/${boardId}`);
        }
        boardRef.current = value;
        setBoard(value);
        offlineOperations.current = readOutbox(boardId);
        setObjects(
          applyPendingOperations(value.objects, offlineOperations.current),
        );
        setMessages(value.messages);
        setStatus('connecting');
        setNotice('');
        return current;
      } catch (error) {
        const cached =
          error instanceof ApiError ? null : readCachedBoard(boardId);
        if (cached) {
          boardRef.current = cached;
          setBoard(cached);
          offlineOperations.current = readOutbox(boardId);
          setObjects(
            applyPendingOperations(cached.objects, offlineOperations.current),
          );
          setMessages(cached.messages);
          setStatus('offline');
          setNotice(
            'Offline mode. New edits are saved in this browser and will sync when you reconnect.',
          );
          return current;
        }
        setNotice((error as Error).message);
        setStatus('offline');
        return current;
      }
    },
    [boardId, search],
  );

  useEffect(() => {
    if (session && !isLocalBoard) void loadBoard(session);
  }, [session, loadBoard, isLocalBoard]);

  useEffect(() => {
    if (!session || !boardReady || isLocalBoard) return;
    let cancelled = false;
    const controller = new AbortController();
    const consume = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(`/api/boards/${boardId}/events`, {
            headers: { Authorization: `Bearer ${session.token}` },
            signal: controller.signal,
          });
          if (!response.ok || !response.body)
            throw new Error('Connection unavailable');
          setStatus('live');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let carry = '';
          while (!cancelled) {
            const { value, done } = await reader.read();
            if (done) break;
            carry += decoder.decode(value, { stream: true });
            const parts = carry.split('\n\n');
            carry = parts.pop() ?? '';
            for (const part of parts) {
              const line = part
                .split('\n')
                .find((value) => value.startsWith('data: '));
              if (!line) continue;
              const event = JSON.parse(line.slice(6)) as {
                type: string;
                board?: Board;
                operation?: {
                  type: 'create' | 'update' | 'delete';
                  objectId: string;
                  object?: BoardObject;
                  fields?: Partial<BoardObject>;
                };
                message?: ChatMessage;
                peers?: Peer[];
                members?: Board['members'];
              };
              if (
                event.type === 'snapshot' ||
                event.type === 'reset' ||
                event.type === 'board'
              ) {
                if (event.board) {
                  boardRef.current = event.board;
                  setBoard(event.board);
                  setObjects(
                    applyPendingOperations(
                      event.board.objects,
                      offlineOperations.current,
                    ),
                  );
                  if (event.type === 'snapshot')
                    setMessages(event.board.messages);
                }
                if (event.peers) setPeersState(event.peers);
              } else if (event.type === 'operation' && event.operation) {
                const op = event.operation;
                setObjects((current) =>
                  op.type === 'create' && op.object
                    ? [
                        ...current.filter((item) => item.id !== op.objectId),
                        op.object,
                      ]
                    : op.type === 'delete'
                      ? current.filter((item) => item.id !== op.objectId)
                      : current.map((item) =>
                          item.id === op.objectId
                            ? { ...item, ...op.fields }
                            : item,
                        ),
                );
              } else if (event.type === 'message' && event.message)
                setMessages((current) =>
                  current.some((item) => item.id === event.message!.id)
                    ? current
                    : [...current, event.message!],
                );
              else if (event.type === 'presence' && event.peers)
                setPeersState(event.peers);
              else if (
                event.type === 'members' &&
                boardRef.current &&
                event.members
              ) {
                const next = { ...boardRef.current, members: event.members };
                boardRef.current = next;
                setBoard(next);
              } else if (event.type === 'deleted') {
                router.push('/');
              }
            }
          }
          if (!cancelled) throw new Error('Connection closed');
        } catch {
          if (cancelled) break;
          setStatus('offline');
          await new Promise((resolve) => setTimeout(resolve, 1800));
        }
      }
    };
    void consume();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, boardId, boardReady, router, isLocalBoard]);

  useEffect(() => {
    if (!session || !board || !lastCursor || isLocalBoard) return;
    const timer = setTimeout(() => {
      void send(`/boards/${boardId}/presence`, 'POST', {
        ...lastCursor,
        color:
          cursorColors[session.user.id.charCodeAt(0) % cursorColors.length],
      }).catch(() => undefined);
    }, 120);
    return () => clearTimeout(timer);
  }, [session, board, boardId, lastCursor, isLocalBoard]);

  useEffect(() => {
    if (!session || !board || isLocalBoard) return;
    const color =
      cursorColors[session.user.id.charCodeAt(0) % cursorColors.length];
    const announce = () => {
      void send(`/boards/${boardId}/presence`, 'POST', { color }).catch(
        () => undefined,
      );
    };
    announce();
    const timer = setInterval(announce, 5000);
    return () => clearInterval(timer);
  }, [session, board, boardId, isLocalBoard]);

  useEffect(() => {
    if (!board || isLocalBoard) return;
    writeCachedBoard({ ...board, objects, messages });
  }, [board, objects, messages, isLocalBoard]);

  useEffect(() => {
    if (!isLocalBoard || objects.length === 0) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isLocalBoard, objects.length]);

  const flushOfflineOperations = useCallback(
    async (currentSession: Session, currentBoardId: string) => {
      if (flushingOutbox.current) return;
      flushingOutbox.current = true;
      const queued = [...offlineOperations.current];
      while (queued.length) {
        const operation = queued[0]!;
        try {
          await send(`/boards/${currentBoardId}/operations`, 'POST', operation);
          queued.shift();
          offlineOperations.current = [...queued];
          writeOutbox(currentBoardId, queued);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            queued.shift();
            offlineOperations.current = [...queued];
            writeOutbox(currentBoardId, queued);
            setNotice((error as Error).message);
            void loadBoard(currentSession);
            continue;
          }
          break;
        }
      }
      flushingOutbox.current = false;
      if (queued.length === 0) {
        setStatus('live');
        if (pendingOperations.current === 0) setSaveStatus('saved');
      } else setStatus('offline');
    },
    [loadBoard],
  );

  useEffect(() => {
    if (
      !session ||
      isLocalBoard ||
      !boardReady ||
      status !== 'live' ||
      !offlineOperations.current.length
    )
      return;
    void flushOfflineOperations(session, boardId);
  }, [
    session,
    boardReady,
    status,
    boardId,
    flushOfflineOperations,
    isLocalBoard,
  ]);

  useEffect(() => {
    if (!session || isLocalBoard) return;
    const retry = () => {
      if (offlineOperations.current.length)
        void flushOfflineOperations(session, boardId);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [session, boardId, flushOfflineOperations, isLocalBoard]);

  function pointAt(event: React.PointerEvent<Element>): Point {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return { x: 0, y: 0 };
    return canvasAdapter.current.toCanvasPoint(
      event.clientX,
      event.clientY,
      bounds,
      {
        x: viewport.x,
        y: viewport.y,
        width: canvasWidth / zoom,
        height: canvasHeight / zoom,
      },
    );
  }

  function fitCanvas() {
    const bounds = canvasAdapter.current.getBounds();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!bounds || !stage?.width || !stage.height) {
      setZoom(1);
      setViewport({ x: 0, y: 0 });
      return;
    }
    const padding = 80;
    const nextZoom = Math.min(
      2,
      Math.max(
        0.1,
        Math.min(
          (canvasWidth * (stage.width - padding)) / stage.width / bounds.width,
          (canvasHeight * (stage.height - padding)) /
            stage.height /
            bounds.height,
        ),
      ),
    );
    const viewWidth = canvasWidth / nextZoom;
    const viewHeight = canvasHeight / nextZoom;
    setZoom(nextZoom);
    setViewport({
      x: bounds.x + bounds.width / 2 - viewWidth / 2,
      y: bounds.y + bounds.height / 2 - viewHeight / 2,
    });
  }

  async function rawOperation(
    type: 'create' | 'update' | 'delete',
    objectId: string,
    object?: BoardObject,
    fields?: Partial<BoardObject>,
  ) {
    if (!board || !session) return;
    if (isLocalBoard) {
      const nextObjects =
        type === 'create' && object
          ? [...localObjects.current, object]
          : type === 'delete'
            ? localObjects.current.filter((item) => item.id !== objectId)
            : localObjects.current.map((item) =>
                item.id === objectId ? { ...item, ...fields } : item,
              );
      localObjects.current = nextObjects;
      setObjects(nextObjects);
      const nextBoard = { ...board, objects: nextObjects };
      boardRef.current = nextBoard;
      setBoard(nextBoard);
      return;
    }
    pendingOperations.current += 1;
    setSaveStatus('saving');
    const operationId = id();
    const operation: PendingOperation = {
      id: operationId,
      type,
      objectId,
      ...(object ? { object } : {}),
      ...(fields ? { fields } : {}),
    };
    setObjects((current) =>
      type === 'create' && object
        ? [...current, object]
        : type === 'delete'
          ? current.filter((item) => item.id !== objectId)
          : current.map((item) =>
              item.id === objectId ? { ...item, ...fields } : item,
            ),
    );
    try {
      await send(`/boards/${board.id}/operations`, 'POST', operation);
      pendingOperations.current -= 1;
      if (pendingOperations.current === 0) setSaveStatus('saved');
    } catch (error) {
      pendingOperations.current = Math.max(0, pendingOperations.current - 1);
      if (!(error instanceof ApiError) || error.status >= 500) {
        if (
          !offlineOperations.current.some((item) => item.id === operation.id)
        ) {
          offlineOperations.current = [...offlineOperations.current, operation];
          writeOutbox(board.id, offlineOperations.current);
        }
        setSaveStatus('saving');
        setStatus('offline');
        setNotice(
          'Connection lost. Your change is saved in this browser and will retry when you reconnect.',
        );
      } else {
        setSaveStatus('error');
        setNotice((error as Error).message);
        void loadBoard(session);
      }
    }
  }

  async function commit(
    type: 'create' | 'update' | 'delete',
    objectId: string,
    object?: BoardObject,
    fields?: Partial<BoardObject>,
    historyBefore?: BoardObject,
  ) {
    if (
      !isLocalBoard &&
      ((type === 'create' && object?.kind === 'image') ||
        fields?.src !== undefined)
    ) {
      setNotice(
        'Images stay on your device and can only be added to a local board.',
      );
      return;
    }
    const before =
      historyBefore ?? objects.find((item) => item.id === objectId) ?? null;
    let after = before;
    if (type === 'create') after = object ?? null;
    if (type === 'update' && before && fields) after = { ...before, ...fields };
    if (type === 'delete') after = null;
    if (
      type === 'update' &&
      before &&
      fields &&
      Object.entries(fields).every(([key, value]) =>
        Object.is(before[key as keyof BoardObject], value),
      )
    )
      return;
    history.current.push({ objectId, before, after });
    redoHistory.current = [];
    setCanUndo(true);
    setCanRedo(false);
    await rawOperation(type, objectId, object, fields);
  }

  function previewObjectFields(objectId: string, fields: Partial<BoardObject>) {
    setObjects((current) =>
      current.map((item) =>
        item.id === objectId ? { ...item, ...fields } : item,
      ),
    );
  }

  function beginPropertyEdit(item: BoardObject) {
    if (!propertyEditOrigin.current) propertyEditOrigin.current = { ...item };
  }

  function finishPropertyEdit(item: BoardObject, fields: Partial<BoardObject>) {
    const origin = propertyEditOrigin.current ?? item;
    propertyEditOrigin.current = null;
    void commit('update', item.id, undefined, fields, origin);
  }

  async function restoreEntry(
    entry: HistoryEntry,
    snapshot: BoardObject | null,
  ) {
    const current = objects.find((item) => item.id === entry.objectId) ?? null;
    if (snapshot === null) {
      if (current) await rawOperation('delete', current.id);
      return;
    }
    if (current === null) {
      const replacement = { ...snapshot, id: id() };
      entry.objectId = replacement.id;
      await rawOperation('create', replacement.id, replacement);
      return;
    }
    const other = entry.before === snapshot ? entry.after : entry.before;
    const keys = new Set([
      ...Object.keys(objectFields(snapshot)),
      ...(other ? Object.keys(objectFields(other)) : []),
    ]);
    const changedKeys = [...keys].filter((key) => {
      const left = snapshot[key as keyof BoardObject];
      const right = other?.[key as keyof BoardObject];
      return JSON.stringify(left) !== JSON.stringify(right);
    });
    const fields = Object.fromEntries(
      changedKeys
        .filter((key) => snapshot[key as keyof BoardObject] !== undefined)
        .map((key) => [key, snapshot[key as keyof BoardObject]]),
    ) as Partial<BoardObject>;
    await rawOperation('update', current.id, undefined, fields);
  }

  async function undo() {
    const entry = history.current.pop();
    if (!entry) return;
    redoHistory.current.push(entry);
    setCanUndo(history.current.length > 0);
    setCanRedo(true);
    await restoreEntry(entry, entry.before);
  }
  async function redo() {
    const entry = redoHistory.current.pop();
    if (!entry) return;
    history.current.push(entry);
    setCanUndo(true);
    setCanRedo(redoHistory.current.length > 0);
    await restoreEntry(entry, entry.after);
  }

  async function duplicateSelected() {
    const sources = objects.filter((item) => selected.includes(item.id));
    const copies = sources.map((item) => ({
      ...item,
      id: id(),
      x: item.x + 24,
      y: item.y + 24,
    }));
    for (const copy of copies) await commit('create', copy.id, copy);
    setSelected(copies.map((item) => item.id));
  }

  async function deleteSelected() {
    const ids = [...selected];
    for (const objectId of ids) await commit('delete', objectId);
    setSelected([]);
  }

  function newObject(
    kind: BoardObject['kind'],
    point: Point,
    extra: Partial<BoardObject> = {},
  ): BoardObject {
    return {
      id: id(),
      kind,
      x: point.x,
      y: point.y,
      color,
      strokeWidth,
      ...extra,
    };
  }

  function chooseImage(file: File | undefined) {
    if (file && !isLocalBoard) {
      setNotice(
        'Images are kept on your device. Open a local board to add one.',
      );
      return;
    }
    if (
      !file ||
      !board ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      if (file) setNotice('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 500_000) {
      setNotice('Images must be 500 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setNotice('This image could not be opened.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const image = new Image();
      image.onerror = () => setNotice('This image could not be opened.');
      image.onload = () => {
        const scale = Math.min(1, 520 / image.width, 380 / image.height);
        const width = Math.max(1, image.width * scale);
        const height = Math.max(1, image.height * scale);
        const point = {
          x: viewport.x + canvasWidth / zoom / 2 - width / 2,
          y: viewport.y + canvasHeight / zoom / 2 - height / 2,
        };
        const item = newObject('image', point, {
          width,
          height,
          src: reader.result as string,
        });
        void commit('create', item.id, item);
        setSelected([item.id]);
        chooseTool('select');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function onStageDown(event: React.PointerEvent<SVGSVGElement>) {
    if (readonly && tool !== 'hand') return;
    const point = pointAt(event);
    setLastCursor(point);
    if (tool === 'pen' || tool === 'highlighter') {
      setDraft([point]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'diamond' ||
      tool === 'line' ||
      tool === 'arrow'
    ) {
      setDraft([point, point]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === 'text' || tool === 'sticky') {
      const text =
        tool === 'sticky'
          ? (window.prompt('Add a thought to this note', 'Add your thought…') ??
            '')
          : (window.prompt('Write something', '') ?? '');
      if (!text.trim()) return;
      const item = newObject(
        tool === 'sticky' ? 'sticky' : 'text',
        point,
        tool === 'sticky'
          ? { width: 188, height: 164, text, color: '#e1b94e', strokeWidth: 1 }
          : { text, fontSize: 30 },
      );
      void commit('create', item.id, item);
      setSelected([item.id]);
      chooseTool('select');
      return;
    }
    setSelected([]);
    if (tool === 'hand') {
      setDrag({ id: '$pan', start: point, origin: point, mode: 'pan' });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onStageMove(event: React.PointerEvent<SVGSVGElement>) {
    const point = pointAt(event);
    setLastCursor(point);
    if (draft)
      setDraft((current) => {
        if (!current) return current;
        const first = current[0]!;
        if (tool === 'pen' || tool === 'highlighter')
          return [...current, point];
        return [first, point];
      });
    if (drag?.mode === 'pan' || drag?.id === '$pan')
      setViewport((current) => ({
        x: current.x - (point.x - drag.start.x),
        y: current.y - (point.y - drag.start.y),
      }));
    else if (drag?.mode === 'resize')
      setObjects((current) =>
        current.map((item) =>
          item.id === drag.id
            ? {
                ...item,
                width: Math.max(
                  24,
                  (drag.size?.x ?? 100) + point.x - drag.start.x,
                ),
                height: Math.max(
                  24,
                  (drag.size?.y ?? 70) + point.y - drag.start.y,
                ),
              }
            : item,
        ),
      );
    else if (drag)
      setObjects((current) =>
        current.map((item) =>
          drag.ids?.includes(item.id) || item.id === drag.id
            ? {
                ...item,
                x:
                  (drag.origins?.[item.id]?.x ?? drag.origin.x) +
                  point.x -
                  drag.start.x,
                y:
                  (drag.origins?.[item.id]?.y ?? drag.origin.y) +
                  point.y -
                  drag.start.y,
              }
            : item,
        ),
      );
  }

  function onStageUp() {
    if (draft?.length) {
      const [start, end] = [draft[0]!, draft[draft.length - 1]!];
      if (tool === 'pen' || tool === 'highlighter') {
        const item = newObject('path', start, {
          points: draft
            .map((point) => [point.x - start.x, point.y - start.y])
            .flat(),
          strokeWidth: tool === 'highlighter' ? strokeWidth * 4 : strokeWidth,
          color: tool === 'highlighter' ? `${color}77` : color,
        });
        void commit('create', item.id, item);
      } else {
        const x = Math.min(start.x, end.x),
          y = Math.min(start.y, end.y),
          width = Math.max(2, Math.abs(end.x - start.x)),
          height = Math.max(2, Math.abs(end.y - start.y));
        const item = newObject(
          tool === 'rect'
            ? 'rect'
            : tool === 'ellipse'
              ? 'ellipse'
              : tool === 'diamond'
                ? 'diamond'
                : tool === 'line'
                  ? 'line'
                  : 'arrow',
          { x, y },
          {
            width,
            height,
            ...(tool === 'arrow' || tool === 'line'
              ? { points: [start.x - x, start.y - y, end.x - x, end.y - y] }
              : {}),
          },
        );
        void commit('create', item.id, item);
      }
      setDraft(null);
    }
    if (drag && drag.mode !== 'pan' && drag.id !== '$pan') {
      const ids = drag.ids ?? [drag.id];
      for (const movedId of ids) {
        const moved = objects.find((item) => item.id === movedId);
        const origin = drag.origins?.[movedId] ?? drag.origin;
        if (moved && (moved.x !== origin.x || moved.y !== origin.y))
          void commit(
            'update',
            moved.id,
            undefined,
            {
              x: moved.x,
              y: moved.y,
            },
            drag.before?.[moved.id],
          );
        else if (moved && drag.mode === 'resize')
          void commit(
            'update',
            moved.id,
            undefined,
            {
              width: moved.width ?? drag.size?.x ?? 100,
              height: moved.height ?? drag.size?.y ?? 70,
            },
            drag.before?.[moved.id],
          );
      }
    }
    setDrag(null);
  }

  function beginDrag(
    event: React.PointerEvent<SVGGElement>,
    item: BoardObject,
  ) {
    if (tool === 'hand') {
      const point = pointAt(
        event as unknown as React.PointerEvent<SVGSVGElement>,
      );
      setDrag({ id: '$pan', start: point, origin: point, mode: 'pan' });
      stageRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (readonly) return;
    if (tool === 'eraser') {
      void commit('delete', item.id);
      setSelected([]);
      return;
    }
    if (tool !== 'select') return;
    if (event.shiftKey) {
      setSelected((current) =>
        current.includes(item.id)
          ? current.filter((selectedId) => selectedId !== item.id)
          : [...current, item.id],
      );
      return;
    }
    const selectedIds = selected.includes(item.id) ? selected : [item.id];
    setSelected(selectedIds);
    const point = pointAt(
      event as unknown as React.PointerEvent<SVGSVGElement>,
    );
    const origins = Object.fromEntries(
      selectedIds.map((selectedId) => {
        const selectedItem = objects.find(
          (candidate) => candidate.id === selectedId,
        );
        return [
          selectedId,
          { x: selectedItem?.x ?? item.x, y: selectedItem?.y ?? item.y },
        ];
      }),
    );
    const before = Object.fromEntries(
      selectedIds.flatMap((selectedId) => {
        const selectedItem = objects.find(
          (candidate) => candidate.id === selectedId,
        );
        return selectedItem ? [[selectedId, { ...selectedItem }]] : [];
      }),
    );
    setDrag({
      id: item.id,
      ids: selectedIds,
      start: point,
      origin: origins[item.id] ?? { x: item.x, y: item.y },
      origins,
      before,
      mode: 'move',
    });
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function beginResize(
    event: React.PointerEvent<SVGCircleElement>,
    item: BoardObject,
  ) {
    if (readonly || !stageRef.current) return;
    const point = pointAt(
      event as unknown as React.PointerEvent<SVGSVGElement>,
    );
    setSelected([item.id]);
    setDrag({
      id: item.id,
      start: point,
      origin: { x: item.x, y: item.y },
      size: { x: item.width ?? 180, y: item.height ?? 140 },
      before: { [item.id]: { ...item } },
      mode: 'resize',
    });
    stageRef.current.setPointerCapture(event.pointerId);
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key === 'Escape' &&
        (shareOpen || membersOpen || snapshotsOpen)
      ) {
        setShareOpen(false);
        setMembersOpen(false);
        setSnapshotsOpen(false);
        return;
      }
      if (
        target.closest(
          'button,input,textarea,select,[contenteditable="true"],.modal',
        ) ||
        event.repeat
      )
        return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      } else if (modifier && key === 'y') {
        event.preventDefault();
        void redo();
      } else if (modifier && key === 'd') {
        event.preventDefault();
        void duplicateSelected();
      } else if (modifier && key === 'a') {
        event.preventDefault();
        setSelected(objects.map((item) => item.id));
      } else if (modifier && key === 'c' && selected.length) {
        event.preventDefault();
        clipboard.current = objects
          .filter((item) => selected.includes(item.id))
          .map((item) => ({ ...item }));
      } else if (modifier && key === 'v' && clipboard.current.length) {
        event.preventDefault();
        const copies = clipboard.current.map((item) => ({
          ...item,
          id: id(),
          x: item.x + 24,
          y: item.y + 24,
        }));
        clipboard.current = copies.map((item) => ({ ...item }));
        void (async () => {
          for (const copy of copies) await commit('create', copy.id, copy);
          setSelected(copies.map((item) => item.id));
        })();
      } else if (modifier && (key === '+' || key === '=')) {
        event.preventDefault();
        setZoom((value) => Math.min(2, value + 0.1));
      } else if (modifier && key === '-') {
        event.preventDefault();
        setZoom((value) => Math.max(0.1, value - 0.1));
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selected.length &&
        !readonly
      ) {
        event.preventDefault();
        for (const itemId of selected) void commit('delete', itemId);
        setSelected([]);
      } else if (event.key === 'Escape') {
        if (draft) event.preventDefault();
        setDraft(null);
        setDrag(null);
        setSelected([]);
        chooseTool('select');
      } else if (!modifier && !event.altKey) {
        const keys: Record<string, Tool> = {
          v: 'select',
          h: 'hand',
          p: 'pen',
          e: 'eraser',
          r: 'rect',
          o: 'ellipse',
          d: 'diamond',
          l: 'line',
          t: 'text',
        };
        const next = keys[event.key.toLowerCase()];
        if (next) chooseTool(next);
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });

  async function changeTitle() {
    if (!board || board.role !== 'owner') return;
    const title = window.prompt('Board name', board.title);
    if (!title?.trim()) return;
    if (isLocalBoard) {
      const next = { ...board, title: title.trim() };
      boardRef.current = next;
      setBoard(next);
      return;
    }
    try {
      const next = await send<Board>(`/boards/${board.id}`, 'PATCH', {
        title: title.trim(),
      });
      setBoard(next);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function createAnotherLocalBoard() {
    if (
      objects.length &&
      !window.confirm(
        'This board is not saved. Start a new local board anyway?',
      )
    )
      return;
    router.push(`/board/local-${crypto.randomUUID()}`);
  }

  async function share() {
    if (!board?.inviteToken || board.inviteRevoked) return;
    const link = `${location.origin}/board/${board.id}?invite=${encodeURIComponent(board.inviteToken)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(
        'Invite link copied. Anyone with the link can join as an editor.',
      );
    } catch {
      setNotice(link);
    }
  }

  async function regenerateInvite() {
    if (!board) return;
    try {
      const result = await send<{ inviteToken: string }>(
        `/boards/${board.id}/invites/regenerate`,
        'POST',
        {},
      );
      setBoard((current) =>
        current
          ? {
              ...current,
              inviteToken: result.inviteToken,
              inviteRevoked: false,
            }
          : current,
      );
      setNotice('A fresh invite link is ready. Previous links no longer work.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function revokeInvite() {
    if (
      !board ||
      !window.confirm(
        'Revoke this invite link? People who have already joined will keep access.',
      )
    )
      return;
    try {
      await send(`/boards/${board.id}/invites`, 'DELETE');
      setBoard((current) =>
        current ? { ...current, inviteRevoked: true } : current,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function openSnapshots() {
    if (!board) return;
    try {
      setSnapshots(await api<Snapshot[]>(`/boards/${board.id}/snapshots`));
      setSnapshotsOpen(true);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function restoreSnapshot(snapshotId: string) {
    if (
      !board ||
      !window.confirm(
        'Restore this version? Your current canvas items will be replaced.',
      )
    )
      return;
    try {
      const next = await send<Board>(
        `/boards/${board.id}/snapshots/${snapshotId}/restore`,
        'POST',
        {},
      );
      boardRef.current = next;
      setBoard(next);
      setObjects(next.objects);
      setSelected([]);
      setSnapshotsOpen(false);
      setNotice('Version restored.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function setMemberRole(memberId: string, role: 'editor' | 'viewer') {
    if (!board) return;
    try {
      await send(`/boards/${board.id}/members/${memberId}`, 'PATCH', { role });
      setBoard((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.userId === memberId ? { ...member, role } : member,
              ),
            }
          : current,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function sendChat(event: React.FormEvent) {
    event.preventDefault();
    if (!messageInput.trim() || !board) return;
    try {
      const message = await send<ChatMessage>(
        `/boards/${board.id}/messages`,
        'POST',
        { text: messageInput.trim() },
      );
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message],
      );
      setMessageInput('');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function toggleLock() {
    if (!board) return;
    try {
      const next = await send<Board>(`/boards/${board.id}`, 'PATCH', {
        locked: !board.locked,
      });
      setBoard(next);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function saveSnapshot() {
    if (!board) return;
    try {
      await send(`/boards/${board.id}/snapshots`, 'POST', {});
      setSnapshots(await api<Snapshot[]>(`/boards/${board.id}/snapshots`));
      setNotice('Version saved.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function startAudio() {
    setNotice(
      'Voice calling is not connected yet. Configure a LiveKit service before enabling microphone access.',
    );
  }

  async function doExport(format: 'png' | 'pdf') {
    if (!board) return;
    try {
      await exportImage(objects, board.title, format);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  if (!session)
    return (
      <main className="board-signin">
        <Link className="brand" href="/">
          ✳ CollabBoard
        </Link>
        <div className="signin-card">
          <div className="signin-icon">✎</div>
          <h1>Join the conversation.</h1>
          <p>Add your name to open this board and work together.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const result = await send<Session>('/session', 'POST', {
                  name: nameInput,
                });
                writeSession(result);
                setSession(result);
              } catch (error) {
                setNotice((error as Error).message);
              }
            }}
          >
            <input
              aria-label="Your name"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Your name"
              required
              maxLength={48}
              autoFocus
            />
            <button className="button primary">
              Join board <span aria-hidden="true">→</span>
            </button>
          </form>
          {notice && <p className="notice error">{notice}</p>}
        </div>
      </main>
    );

  if (!board)
    return (
      <main className="board-loading">
        <Link className="brand" href="/">
          ✳ CollabBoard
        </Link>
        <div className="loading-orbit" />
        <p>{notice || 'Opening your board…'}</p>
        {notice && (
          <Link className="button subtle" href="/">
            Back to boards
          </Link>
        )}
      </main>
    );

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <Link
          href="/"
          className="brand editor-brand"
          onClick={(event) => {
            if (
              isLocalBoard &&
              objects.length &&
              !window.confirm('This board is not saved. Leave this board?')
            )
              event.preventDefault();
          }}
        >
          <span className="brand-mark">✳</span>
          <span>CollabBoard</span>
        </Link>
        <div className="board-title-block">
          <button
            className="board-title"
            onClick={() => void changeTitle()}
            disabled={board.role !== 'owner'}
          >
            {board.title}
            {board.role === 'owner' && <span className="title-chevron">⌄</span>}
          </button>
          <div className="save-indicator">
            {isLocalBoard ? (
              <span className="local-unsaved-label">Local · not saved</span>
            ) : (
              <>
                <span
                  className={`connection-dot ${saveStatus === 'error' ? 'offline' : status}`}
                />
                {saveStatus === 'saving'
                  ? 'Saving…'
                  : saveStatus === 'error'
                    ? 'Save failed'
                    : status === 'live'
                      ? 'All changes saved'
                      : status === 'offline'
                        ? 'Reconnecting…'
                        : 'Connecting…'}
              </>
            )}
          </div>
        </div>
        <div className="top-history-actions" aria-label="History controls">
          <button
            aria-label="Undo"
            title="Undo · Ctrl/Cmd+Z"
            disabled={!canUndo || readonly}
            onClick={() => void undo()}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo · Ctrl/Cmd+Shift+Z"
            disabled={!canRedo || readonly}
            onClick={() => void redo()}
          >
            ↷
          </button>
        </div>
        <div className="top-zoom-controls" aria-label="Canvas zoom controls">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))}
          >
            −
          </button>
          <button
            className="top-zoom-value"
            onClick={() => {
              setZoom(1);
              setViewport({ x: 0, y: 0 });
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
          >
            ＋
          </button>
        </div>
        <div className="topbar-spacer" />
        {isLocalBoard ? (
          <>
            <span className="local-mode-badge">Local board</span>
            <button
              className="button subtle new-local-board"
              onClick={createAnotherLocalBoard}
            >
              + New
            </button>
          </>
        ) : (
          <>
            <button
              className="participant-stack"
              title="Participants and roles"
              onClick={() => setMembersOpen(true)}
            >
              {board.members.slice(0, 3).map((member, index) => (
                <span key={member.userId} className={`avatar avatar-${index}`}>
                  {member.name[0]?.toUpperCase()}
                </span>
              ))}
              {board.members.length > 3 && (
                <span className="avatar more-avatar">
                  +{board.members.length - 3}
                </span>
              )}
            </button>
            <button
              className={`top-action ${chatOpen ? 'is-active' : ''}`}
              onClick={() => setChatOpen((value) => !value)}
            >
              <span className="action-glyph">▤</span>
              <span>Chat</span>
              {messages.length > 0 && <span className="unread-dot" />}
            </button>
            <button
              className="top-action audio-action"
              onClick={() => void startAudio()}
              title="Check microphone and connect audio"
            >
              <span className="action-glyph">◖</span>
              <span>Audio</span>
            </button>
            <button
              className="button share-button"
              onClick={() => setShareOpen(true)}
              disabled={board.role !== 'owner'}
            >
              ↗ Share
            </button>
          </>
        )}
        <div className="export-menu">
          <button className="button subtle export-button">
            Export <span>⌄</span>
          </button>
          <div className="export-options">
            <button onClick={() => void doExport('png')}>Download PNG</button>
            <button onClick={() => void doExport('pdf')}>Download PDF</button>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <section className="editor-main">
        <aside className="tool-rail" aria-label="Drawing tools">
          <div className="tool-group">
            <button
              className={`tool-button ${tool === 'select' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('select')}
              aria-pressed={tool === 'select'}
              title="Select · V"
            >
              <span>↖</span>
              <small>Select</small>
            </button>
            <button
              className={`tool-button ${tool === 'hand' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('hand')}
              aria-pressed={tool === 'hand'}
              title="Pan · H"
            >
              <span>✋</span>
              <small>Pan</small>
            </button>
          </div>
          <div className="rail-divider" />
          <div className="tool-group">
            <button
              className={`tool-button ${tool === 'pen' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('pen')}
              aria-pressed={tool === 'pen'}
              title="Pen · P"
            >
              <span>✎</span>
              <small>Pen</small>
            </button>
            <button
              className={`tool-button ${tool === 'highlighter' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('highlighter')}
              aria-pressed={tool === 'highlighter'}
              title="Highlighter"
            >
              <span>▰</span>
              <small>Highlight</small>
            </button>
            <button
              className={`tool-button ${tool === 'eraser' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('eraser')}
              aria-pressed={tool === 'eraser'}
              title="Eraser · E"
            >
              <span>⌫</span>
              <small>Eraser</small>
            </button>
          </div>
          <div className="rail-divider" />
          <div className="tool-group">
            <button
              className={`tool-button ${tool === 'rect' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('rect')}
              aria-pressed={tool === 'rect'}
              title="Rectangle · R"
            >
              <span>▱</span>
              <small>Shape</small>
            </button>
            <button
              className={`tool-button ${tool === 'ellipse' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('ellipse')}
              aria-pressed={tool === 'ellipse'}
              title="Ellipse · O"
            >
              <span>◯</span>
              <small>Ellipse</small>
            </button>
            <button
              className={`tool-button ${tool === 'diamond' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('diamond')}
              aria-pressed={tool === 'diamond'}
              title="Diamond · D"
              aria-label="Diamond tool"
            >
              <span>◇</span>
              <small>Diamond</small>
            </button>
            <button
              className={`tool-button ${tool === 'line' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('line')}
              aria-pressed={tool === 'line'}
              title="Line · L"
              aria-label="Line tool"
            >
              <span>／</span>
              <small>Line</small>
            </button>
            <button
              className={`tool-button ${tool === 'arrow' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('arrow')}
              aria-pressed={tool === 'arrow'}
              title="Arrow"
            >
              <span>↗</span>
              <small>Arrow</small>
            </button>
          </div>
          <div className="rail-divider" />
          <div className="tool-group">
            <button
              className={`tool-button ${tool === 'text' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('text')}
              aria-pressed={tool === 'text'}
              title="Text · T"
            >
              <span>T</span>
              <small>Text</small>
            </button>
            <button
              className={`tool-button ${tool === 'sticky' ? 'tool-selected' : ''}`}
              onClick={() => chooseTool('sticky')}
              aria-pressed={tool === 'sticky'}
              title="Sticky note"
            >
              <span className="sticky-icon">▧</span>
              <small>Note</small>
            </button>
            <button
              className="tool-button"
              onClick={() => imagePicker.current?.click()}
              title="Upload an image"
            >
              <span>▧</span>
              <small>Image</small>
            </button>
          </div>
          <div className="rail-bottom">
            <button
              className="tool-button"
              onClick={() => void undo()}
              disabled={!canUndo || readonly}
              title="Undo · Ctrl Z"
            >
              <span>↶</span>
              <small>Undo</small>
            </button>
            <button
              className="tool-button"
              onClick={() => void redo()}
              disabled={!canRedo || readonly}
              title="Redo · Ctrl Y"
            >
              <span>↷</span>
              <small>Redo</small>
            </button>
          </div>
        </aside>

        <div className="canvas-region">
          <input
            ref={imagePicker}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Choose an image file"
            onChange={(event) => {
              chooseImage(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {notice && (
            <button className="toast-notice" onClick={() => setNotice('')}>
              {notice}
              <span>×</span>
            </button>
          )}
          {readonly && (
            <div className="readonly-banner">
              {board.locked
                ? 'Editing is paused by the board owner.'
                : 'You have view-only access.'}
            </div>
          )}
          <svg
            ref={stageRef}
            className={`board-stage tool-${tool}`}
            viewBox={`${viewport.x} ${viewport.y} ${canvasWidth / zoom} ${canvasHeight / zoom}`}
            preserveAspectRatio="none"
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
            onPointerCancel={() => {
              setDraft(null);
              setDrag(null);
            }}
          >
            <defs>
              <pattern
                id="dot-grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1.2" cy="1.2" r="1.1" fill="#dce3dc" />
              </pattern>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="8"
                refX="9"
                refY="4"
                orient="auto"
              >
                <path d="M0 0L10 4L0 8z" fill={color} />
              </marker>
            </defs>
            <rect
              x={viewport.x - canvasWidth * 2}
              y={viewport.y - canvasHeight * 2}
              width={canvasWidth * 5}
              height={canvasHeight * 5}
              fill="#fbfcf9"
            />
            <rect
              x={viewport.x - canvasWidth * 2}
              y={viewport.y - canvasHeight * 2}
              width={canvasWidth * 5}
              height={canvasHeight * 5}
              fill="url(#dot-grid)"
            />
            {objects.map((item) => (
              <BoardShape
                key={item.id}
                item={item}
                selected={selected.includes(item.id)}
                readonly={!!readonly}
                handTool={tool === 'hand'}
                onSelect={() => setSelected([item.id])}
                onDragStart={beginDrag}
                onResizeStart={beginResize}
                onUpdateText={(text) =>
                  void commit('update', item.id, undefined, { text })
                }
                onDelete={() => void commit('delete', item.id)}
              />
            ))}
            {draft?.length &&
              (tool === 'pen' || tool === 'highlighter' ? (
                <polyline
                  points={draft
                    .map((point) => `${point.x},${point.y}`)
                    .join(' ')}
                  fill="none"
                  stroke={color}
                  strokeOpacity={tool === 'highlighter' ? 0.45 : 1}
                  strokeWidth={
                    tool === 'highlighter' ? strokeWidth * 4 : strokeWidth
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : tool === 'line' || tool === 'arrow' ? (
                <path
                  d={`M ${draft[0]!.x} ${draft[0]!.y} L ${draft.at(-1)!.x} ${draft.at(-1)!.y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth}
                  markerEnd={tool === 'arrow' ? 'url(#arrowhead)' : undefined}
                />
              ) : tool === 'diamond' ? (
                <polygon
                  points={`${(draft[0]!.x + draft.at(-1)!.x) / 2},${draft[0]!.y} ${draft.at(-1)!.x},${(draft[0]!.y + draft.at(-1)!.y) / 2} ${(draft[0]!.x + draft.at(-1)!.x) / 2},${draft.at(-1)!.y} ${draft[0]!.x},${(draft[0]!.y + draft.at(-1)!.y) / 2}`}
                  fill={`${color}14`}
                  stroke={color}
                />
              ) : tool === 'ellipse' ? (
                <ellipse
                  cx={(draft[0]!.x + draft.at(-1)!.x) / 2}
                  cy={(draft[0]!.y + draft.at(-1)!.y) / 2}
                  rx={Math.abs(draft[0]!.x - draft.at(-1)!.x) / 2}
                  ry={Math.abs(draft[0]!.y - draft.at(-1)!.y) / 2}
                  fill={`${color}14`}
                  stroke={color}
                  strokeDasharray="5 4"
                />
              ) : (
                <rect
                  x={Math.min(draft[0]!.x, draft.at(-1)!.x)}
                  y={Math.min(draft[0]!.y, draft.at(-1)!.y)}
                  width={Math.abs(draft[0]!.x - draft.at(-1)!.x)}
                  height={Math.abs(draft[0]!.y - draft.at(-1)!.y)}
                  fill="none"
                  stroke={color}
                  strokeDasharray="5 4"
                />
              ))}
            {peersState
              .filter(
                (peer) =>
                  peer.userId !== session.user.id &&
                  peer.x !== undefined &&
                  peer.y !== undefined,
              )
              .map((peer) => (
                <g
                  key={peer.userId}
                  transform={`translate(${peer.x} ${peer.y})`}
                  pointerEvents="none"
                >
                  <path
                    d="M0 0L0 19L5 14L10 23L14 21L9 12L17 12Z"
                    fill={peer.color}
                  />
                  <text
                    x="20"
                    y="19"
                    fill={peer.color}
                    fontSize="14"
                    fontWeight="700"
                  >
                    {peer.name}
                  </text>
                </g>
              ))}
          </svg>
          {objects.length === 0 && (
            <div className="canvas-empty-hint">
              <span className="hint-star">✳</span>
              <p>Pick a tool and start anywhere.</p>
              <small>Everything you make is shared as you go.</small>
            </div>
          )}
          <div className="canvas-help-chip">
            {readonly
              ? 'View mode'
              : tool === 'select'
                ? 'Select and move · Del to remove'
                : tool === 'pen'
                  ? 'Draw freely on the canvas'
                  : `Click or drag to use ${tool}`}
          </div>
        </div>

        <aside
          className={`properties-panel ${propertiesOpen ? 'properties-open' : ''}`}
        >
          <button
            className="property-close"
            aria-label="Close properties panel"
            onClick={() => setPropertiesOpen(false)}
          >
            ×
          </button>
          {selectedObject && selected.length === 1 ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">OBJECT</p>
                  <h2>
                    {selectedObject.kind === 'sticky'
                      ? 'Sticky note'
                      : selectedObject.kind[0]!.toUpperCase() +
                        selectedObject.kind.slice(1)}
                  </h2>
                </div>
                <button
                  className="icon-button"
                  title="Delete selected"
                  onClick={() => void commit('delete', selectedObject.id)}
                >
                  ⌫
                </button>
              </div>
              {(selectedObject.kind === 'text' ||
                selectedObject.kind === 'sticky') && (
                <label className="property-label">
                  Text
                  <textarea
                    value={selectedObject.text ?? ''}
                    maxLength={2000}
                    onFocus={() => {
                      textEditOrigins.current[selectedObject.id] = {
                        ...selectedObject,
                      };
                    }}
                    onChange={(event) =>
                      setObjects((current) =>
                        current.map((item) =>
                          item.id === selectedObject.id
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={(event) =>
                      (() => {
                        const origin =
                          textEditOrigins.current[selectedObject.id];
                        delete textEditOrigins.current[selectedObject.id];
                        void commit(
                          'update',
                          selectedObject.id,
                          undefined,
                          { text: event.target.value },
                          origin,
                        );
                      })()
                    }
                  />
                </label>
              )}
              {selectedObject.kind !== 'image' && (
                <div className="property-section">
                  <span className="property-label">Color</span>
                  <div className="color-swatches">
                    {colors.map((swatch) => (
                      <button
                        key={swatch}
                        aria-label={`Set color ${swatch}`}
                        className={`color-swatch ${selectedObject.color === swatch ? 'swatch-selected' : ''}`}
                        style={{ background: swatch }}
                        onClick={() =>
                          void commit('update', selectedObject.id, undefined, {
                            color: swatch,
                          })
                        }
                      />
                    ))}
                  </div>
                  <input
                    className="custom-color"
                    type="color"
                    aria-label="Choose a custom color"
                    value={selectedObject.color.slice(0, 7)}
                    onChange={(event) =>
                      void commit('update', selectedObject.id, undefined, {
                        color: event.target.value,
                      })
                    }
                  />
                </div>
              )}
              {['rect', 'ellipse', 'diamond'].includes(selectedObject.kind) && (
                <label className="property-label">
                  Fill color
                  <input
                    className="custom-color"
                    type="color"
                    aria-label="Choose fill color"
                    value={selectedObject.fillColor ?? '#ffffff'}
                    onChange={(event) =>
                      void commit('update', selectedObject.id, undefined, {
                        fillColor: event.target.value,
                      })
                    }
                  />
                </label>
              )}
              {(selectedObject.kind === 'text' ||
                selectedObject.kind === 'sticky') && (
                <label className="property-label">
                  Font size
                  <span>
                    {selectedObject.fontSize ??
                      (selectedObject.kind === 'sticky' ? 18 : 30)}
                    px
                  </span>
                  <input
                    type="range"
                    min="12"
                    max="64"
                    value={
                      selectedObject.fontSize ??
                      (selectedObject.kind === 'sticky' ? 18 : 30)
                    }
                    onPointerDown={() => beginPropertyEdit(selectedObject)}
                    onKeyDown={() => beginPropertyEdit(selectedObject)}
                    onChange={(event) =>
                      previewObjectFields(selectedObject.id, {
                        fontSize: Number(event.target.value),
                      })
                    }
                    onPointerUp={(event) =>
                      finishPropertyEdit(selectedObject, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                    onKeyUp={(event) =>
                      finishPropertyEdit(selectedObject, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                  />
                </label>
              )}
              {selectedObject.kind !== 'text' &&
                selectedObject.kind !== 'image' && (
                  <label className="property-label">
                    Stroke <span>{selectedObject.strokeWidth}px</span>
                    <input
                      type="range"
                      min="1"
                      max="18"
                      value={selectedObject.strokeWidth}
                      onPointerDown={() => beginPropertyEdit(selectedObject)}
                      onKeyDown={() => beginPropertyEdit(selectedObject)}
                      onChange={(event) =>
                        previewObjectFields(selectedObject.id, {
                          strokeWidth: Number(event.target.value),
                        })
                      }
                      onPointerUp={(event) =>
                        finishPropertyEdit(selectedObject, {
                          strokeWidth: Number(event.currentTarget.value),
                        })
                      }
                      onKeyUp={(event) =>
                        finishPropertyEdit(selectedObject, {
                          strokeWidth: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                )}
              <label className="property-label">
                Opacity{' '}
                <span>{Math.round((selectedObject.opacity ?? 1) * 100)}%</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={Math.round((selectedObject.opacity ?? 1) * 100)}
                  onPointerDown={() => beginPropertyEdit(selectedObject)}
                  onKeyDown={() => beginPropertyEdit(selectedObject)}
                  onChange={(event) =>
                    previewObjectFields(selectedObject.id, {
                      opacity: Number(event.target.value) / 100,
                    })
                  }
                  onPointerUp={(event) =>
                    finishPropertyEdit(selectedObject, {
                      opacity: Number(event.currentTarget.value) / 100,
                    })
                  }
                  onKeyUp={(event) =>
                    finishPropertyEdit(selectedObject, {
                      opacity: Number(event.currentTarget.value) / 100,
                    })
                  }
                />
              </label>
              <button
                className="button subtle full-width"
                onClick={() => void duplicateSelected()}
              >
                Duplicate object
              </button>
              <button
                className="button danger full-width"
                onClick={() => void commit('delete', selectedObject.id)}
              >
                Delete object
              </button>
            </>
          ) : selected.length > 1 ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SELECTION</p>
                  <h2>{selected.length} objects</h2>
                </div>
              </div>
              <button
                className="button subtle full-width"
                onClick={() => void duplicateSelected()}
              >
                Duplicate selection
              </button>
              <button
                className="button danger full-width"
                onClick={() => void deleteSelected()}
              >
                Delete selection
              </button>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">QUICK STYLE</p>
                  <h2>Make it yours</h2>
                </div>
                <span className="panel-spark">✳</span>
              </div>
              <div className="property-section">
                <span className="property-label">Color</span>
                <div className="color-swatches">
                  {colors.map((swatch) => (
                    <button
                      key={swatch}
                      aria-label={`Set color ${swatch}`}
                      className={`color-swatch ${color === swatch ? 'swatch-selected' : ''}`}
                      style={{ background: swatch }}
                      onClick={() => setColor(swatch)}
                    />
                  ))}
                </div>
                <input
                  className="custom-color"
                  type="color"
                  aria-label="Choose a custom color"
                  value={color.slice(0, 7)}
                  onChange={(event) => setColor(event.target.value)}
                />
              </div>
              <label className="property-label">
                Stroke <span>{strokeWidth}px</span>
                <input
                  type="range"
                  min="1"
                  max="18"
                  value={strokeWidth}
                  onChange={(event) =>
                    setStrokeWidth(Number(event.target.value))
                  }
                />
              </label>
              <div className="panel-tip">
                <span>✦</span>
                <p>Tip: Double-click text or a note to edit it.</p>
              </div>
              <div className="panel-divider" />
              <div className="board-settings">
                <p className="eyebrow">BOARD</p>
                <div className="setting-row">
                  <span>People here</span>
                  <strong>{peersState.length || 1}</strong>
                </div>
                <div className="setting-row">
                  <span>Canvas items</span>
                  <strong>{objects.length}</strong>
                </div>
                {isLocalBoard && (
                  <p className="local-board-note">
                    This board only lives in this tab. Export or copy your work
                    before you leave.
                  </p>
                )}
                {board.role === 'owner' && !isLocalBoard && (
                  <>
                    <button
                      className="setting-button"
                      onClick={() => void toggleLock()}
                    >
                      {board.locked ? '▶ Resume editing' : 'Ⅱ Pause editing'}
                    </button>
                    <button
                      className="setting-button"
                      onClick={() => void saveSnapshot()}
                    >
                      ◷ Save a version
                    </button>
                    <button
                      className="setting-button"
                      onClick={() => void openSnapshots()}
                    >
                      ↻ Version history
                    </button>
                    <button
                      className="setting-button"
                      onClick={() => setMembersOpen(true)}
                    >
                      ♙ Manage participants
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      <footer className="editor-footer">
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))}
          >
            −
          </button>
          <button
            className="zoom-value"
            onClick={() => {
              setZoom(1);
              setViewport({ x: 0, y: 0 });
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
          >
            ＋
          </button>
          <button className="fit-button" onClick={fitCanvas}>
            Fit canvas
          </button>
        </div>
        <div className="footer-right">
          {!isLocalBoard && (
            <>
              <span className={`connection-dot ${status}`} />
              {status === 'live'
                ? 'Live with your team'
                : status === 'offline'
                  ? 'Trying to reconnect'
                  : 'Joining room'}
            </>
          )}
          <span className="footer-tool-status">
            {tool} · {objects.length}{' '}
            {objects.length === 1 ? 'object' : 'objects'}
          </span>
          <button
            className="help-button"
            onClick={() =>
              setNotice(
                'Shortcuts: V select · H pan · P pen · E eraser · L line · R rectangle · O ellipse · D diamond · T text · Ctrl/Cmd+Z undo · Shift+Ctrl/Cmd+Z redo · Ctrl/Cmd+D duplicate',
              )
            }
          >
            ? Help
          </button>
          <button
            className="properties-toggle"
            aria-expanded={propertiesOpen}
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            Properties
          </button>
        </div>
      </footer>

      {chatOpen && (
        <div className="chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">ROOM CHAT</p>
              <h2>Talk it through</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>
          <div className="chat-presence">
            <span className="connection-dot live" />
            {peersState.length || 1} in this room
          </div>
          <div className="chat-messages">
            {messages.length ? (
              messages.map((message) => (
                <article
                  className={`chat-message ${message.userId === session.user.id ? 'mine' : ''}`}
                  key={message.id}
                >
                  <span className="chat-avatar">
                    {message.name[0]?.toUpperCase()}
                  </span>
                  <div>
                    <div className="message-meta">
                      <strong>
                        {message.userId === session.user.id
                          ? 'You'
                          : message.name}
                      </strong>
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <p>{message.text}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="chat-empty">
                <span>☏</span>
                <p>Good thinking happens out loud.</p>
                <small>Start the conversation with your group.</small>
              </div>
            )}
          </div>
          <form className="chat-compose" onSubmit={sendChat}>
            <textarea
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="Write a message…"
              maxLength={2000}
              rows={2}
            />
            <button
              className="send-message"
              aria-label="Send message"
              disabled={!messageInput.trim()}
            >
              ↑
            </button>
          </form>
          <div className="chat-footer-note">
            Messages are saved with this board.
          </div>
        </div>
      )}
      {shareOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShareOpen(false);
          }}
        >
          <section className="modal">
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setShareOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">BRING PEOPLE IN</p>
            <h2>Share this board.</h2>
            <p className="modal-copy">
              Anyone with this invite can join as an editor. You can pause
              editing or change roles any time.
            </p>
            <div className="share-link-preview">
              {board.inviteToken && !board.inviteRevoked
                ? `${location.origin}/board/${board.id}?invite=${board.inviteToken}`
                : 'Invite link is turned off'}
            </div>
            <div className="modal-actions">
              <button
                className="button subtle"
                onClick={() => void regenerateInvite()}
              >
                ↻ New link
              </button>
              <button
                className="button primary"
                onClick={() => void share()}
                disabled={!board.inviteToken || board.inviteRevoked}
              >
                Copy invite
              </button>
            </div>
            <button
              className="revoke-link"
              onClick={() => void revokeInvite()}
              disabled={!board.inviteToken || board.inviteRevoked}
            >
              Revoke current invite link
            </button>
          </section>
        </div>
      )}
      {membersOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMembersOpen(false);
          }}
        >
          <section className="modal members-modal">
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setMembersOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">BOARD PARTICIPANTS</p>
            <h2>People in the room</h2>
            <div className="members-list">
              {board.members.map((member, index) => (
                <div className="member-row" key={member.userId}>
                  <span className={`avatar avatar-${index % 3}`}>
                    {member.name[0]?.toUpperCase()}
                  </span>
                  <div className="member-name">
                    <strong>
                      {member.name}
                      {member.userId === session.user.id ? ' · you' : ''}
                    </strong>
                    <small>
                      {peersState.some((peer) => peer.userId === member.userId)
                        ? 'Online now'
                        : 'Member'}
                    </small>
                  </div>
                  {member.role === 'owner' ? (
                    <span className="role-badge">Owner</span>
                  ) : board.role === 'owner' ? (
                    <select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(event) =>
                        void setMemberRole(
                          member.userId,
                          event.target.value as 'editor' | 'viewer',
                        )
                      }
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="role-badge">{member.role}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="modal-footnote">
              Invite links give new members edit access. You can switch them to
              view-only here.
            </p>
          </section>
        </div>
      )}
      {snapshotsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSnapshotsOpen(false);
          }}
        >
          <section className="modal snapshots-modal">
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setSnapshotsOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">BOARD HISTORY</p>
            <h2>Saved versions</h2>
            {snapshots.length ? (
              <div className="snapshot-list">
                {[...snapshots].reverse().map((snapshot) => (
                  <div className="snapshot-row" key={snapshot.id}>
                    <div>
                      <strong>{snapshot.title}</strong>
                      <small>
                        {new Date(snapshot.createdAt).toLocaleString()}
                      </small>
                    </div>
                    <button
                      className="button subtle"
                      onClick={() => void restoreSnapshot(snapshot.id)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="modal-copy">
                No versions yet. Save one from the board panel before making a
                big change.
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button subtle"
                onClick={() => void saveSnapshot()}
              >
                ＋ Save current version
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="mobile-toolbar">
        <button
          aria-label="Select tool"
          aria-pressed={tool === 'select'}
          className={tool === 'select' ? 'mobile-tool-active' : ''}
          onClick={() => chooseTool('select')}
        >
          ↖
        </button>
        <button
          aria-label="Pen tool"
          aria-pressed={tool === 'pen'}
          className={tool === 'pen' ? 'mobile-tool-active' : ''}
          onClick={() => chooseTool('pen')}
        >
          ✎
        </button>
        <button
          aria-label="Sticky note tool"
          aria-pressed={tool === 'sticky'}
          className={tool === 'sticky' ? 'mobile-tool-active' : ''}
          onClick={() => chooseTool('sticky')}
        >
          ▧
        </button>
        {isLocalBoard && (
          <button
            aria-label="Upload image"
            onClick={() => imagePicker.current?.click()}
          >
            ▧
          </button>
        )}
        {!isLocalBoard && (
          <button aria-label="Open chat" onClick={() => setChatOpen(true)}>
            ▤
          </button>
        )}
        <button
          aria-label="Undo"
          title="Undo"
          disabled={!canUndo || readonly}
          onClick={() => void undo()}
        >
          ↶
        </button>
        <button
          aria-label="Redo"
          title="Redo"
          disabled={!canRedo || readonly}
          onClick={() => void redo()}
        >
          ↷
        </button>
      </div>
    </main>
  );
}
