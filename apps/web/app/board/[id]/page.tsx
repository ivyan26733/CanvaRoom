'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  api,
  ApiError,
  clearSession,
  id,
  readSession,
  send,
  writeSession,
  type Board,
  type BoardObject,
  type ChatMessage,
  type Operation,
  type Peer,
  type Session,
} from '../../lib/api';
import { AudioCall, type CallState } from '../../lib/audio';
import {
  applyOperations,
  defaultFontSize,
  FONT_FAMILY,
  intersects,
  layoutText,
  LINE_HEIGHT,
  objectBounds,
  round,
  STICKY_PADDING,
  unionBounds,
  type Bounds,
  type Point,
} from '../../lib/canvas';
import { exportBoard, prepareImage } from '../../lib/export';
import {
  RealtimeClient,
  type ConnectionStatus,
  type ServerMessage,
} from '../../lib/realtime';
import { ThemeToggle } from '../../components/theme-toggle';
import { BoardShape } from './board-shape';
import { CallControls } from './call-controls';
import { ChatPanel } from './chat-panel';
import {
  LocalOverlay,
  RemoteActivity,
  RemoteLayer,
  type LocalOverlayHandle,
} from './live-layers';

type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky';
type View = { x: number; y: number; zoom: number };
type Change = {
  objectId: string;
  before: BoardObject | null;
  after: BoardObject | null;
};
type Draft = Omit<Operation, 'id'>;
type Gesture =
  | { kind: 'pan'; start: Point; origin: View }
  | { kind: 'pinch'; distance: number; mid: Point; origin: View }
  | { kind: 'draw'; object: BoardObject; last: Point }
  | { kind: 'shape'; object: BoardObject; start: Point }
  | {
      kind: 'move';
      start: Point;
      originals: BoardObject[];
      moved: BoardObject[];
    }
  | {
      kind: 'resize';
      start: Point;
      original: BoardObject;
      moved: BoardObject;
    }
  | { kind: 'marquee'; start: Point; base: string[] }
  | { kind: 'erase'; erased: Set<string> };
type TextEditor = { object: BoardObject; isNew: boolean };

const TOOLS: { tool: Tool; icon: string; label: string; key?: string }[] = [
  { tool: 'select', icon: '↖', label: 'Select', key: 'V' },
  { tool: 'hand', icon: '✋', label: 'Pan', key: 'H' },
  { tool: 'pen', icon: '✎', label: 'Pen', key: 'P' },
  { tool: 'highlighter', icon: '▰', label: 'Marker', key: 'K' },
  { tool: 'eraser', icon: '⌫', label: 'Eraser', key: 'E' },
  { tool: 'rect', icon: '▭', label: 'Box', key: 'R' },
  { tool: 'ellipse', icon: '◯', label: 'Ellipse', key: 'O' },
  { tool: 'diamond', icon: '◇', label: 'Diamond', key: 'D' },
  { tool: 'line', icon: '／', label: 'Line', key: 'L' },
  { tool: 'arrow', icon: '↗', label: 'Arrow', key: 'A' },
  { tool: 'text', icon: 'T', label: 'Text', key: 'T' },
  { tool: 'sticky', icon: '▤', label: 'Note', key: 'N' },
];
const TOOL_KEYS = Object.fromEntries(
  TOOLS.filter((item) => item.key).map((item) => [
    item.key!.toLowerCase(),
    item.tool,
  ]),
) as Record<string, Tool>;
const COLORS = [
  '#1f2d27',
  '#2f8f68',
  '#2f6fb0',
  '#7a5cc4',
  '#d1495b',
  '#e58b3a',
  '#d6a21e',
  '#7d8a83',
];
const STICKY_COLORS = ['#f5cf4b', '#f59e8b', '#8fd1a6', '#8ec5f0', '#c8a8f0'];
const PEER_COLORS = [
  '#2f8f68',
  '#d9772e',
  '#7a5cc4',
  '#d1495b',
  '#2f6fb0',
  '#b08300',
];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const EMPTY_CALL: CallState = {
  joined: false,
  joining: false,
  muted: false,
  speaking: new Set(),
  connected: new Set(),
  error: '',
};

const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

function colorFor(userId: string) {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length]!;
}

function diffFields(target: BoardObject, current: BoardObject) {
  const fields: Partial<BoardObject> = {};
  for (const [key, value] of Object.entries(target)) {
    if (key === 'id') continue;
    if (
      JSON.stringify(value) !==
      JSON.stringify(current[key as keyof BoardObject])
    )
      (fields as Record<string, unknown>)[key] = value;
  }
  return fields;
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.closest('input,textarea,select,[contenteditable="true"]') !==
      null ||
      target.closest('.modal') !== null)
  );
}

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const boardId = params.id;
  const isLocal = boardId.startsWith('local-');

  // ---- Session and board ----
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState('');
  const [objects, setObjects] = useState<BoardObject[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [pending, setPending] = useState(0);
  const [selfPeerId, setSelfPeerId] = useState('');

  // ---- Editor ----
  const [tool, setTool] = useState<Tool>('pen');
  const [selected, setSelected] = useState<string[]>([]);
  const [color, setColor] = useState(COLORS[0]!);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]!);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [textEditor, setTextEditorState] = useState<TextEditor | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  // ---- Panels ----
  const [notice, setNotice] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [typing, setTyping] = useState<
    { peerId: string; name: string; until: number }[]
  >([]);
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [shareOpen, setShareOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [snapshots, setSnapshots] = useState<
    { id: string; title: string; createdAt: string }[]
  >([]);

  const stageRef = useRef<SVGSVGElement>(null);
  const objectLayerRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<LocalOverlayHandle>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const clientRef = useRef<RealtimeClient | null>(null);
  const callRef = useRef<AudioCall | null>(null);
  const remote = useMemo(() => new RemoteActivity(), []);
  const objectsRef = useRef<BoardObject[]>([]);
  const viewRef = useRef(view);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const history = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const clipboard = useRef<BoardObject[]>([]);
  const propertyOrigin = useRef<BoardObject | null>(null);
  const fittedOnce = useRef(false);
  const callPeers = useRef(new Set<string>());
  // Mirrors `textEditor` so finishing is idempotent when both a click on the
  // canvas and the textarea's blur try to finish the same edit.
  const editorRef = useRef<TextEditor | null>(null);
  const setTextEditor = useCallback(
    (
      next:
        TextEditor | null | ((current: TextEditor | null) => TextEditor | null),
    ) => {
      editorRef.current =
        typeof next === 'function' ? next(editorRef.current) : next;
      setTextEditorState(editorRef.current);
    },
    [],
  );

  const readonly = !board || board.role === 'viewer' || board.locked;
  const selectedObjects = useMemo(
    () => objects.filter((item) => selected.includes(item.id)),
    [objects, selected],
  );
  const selectedObject =
    selectedObjects.length === 1 ? selectedObjects[0] : undefined;
  const onlinePeople = useMemo(() => {
    const byUser = new Map<string, Peer>();
    for (const peer of peers)
      if (!byUser.has(peer.userId)) byUser.set(peer.userId, peer);
    return [...byUser.values()];
  }, [peers]);

  useLayoutEffect(() => {
    objectsRef.current = objects;
  }, [objects]);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => () => remote.dispose(), [remote]);

  // ---- Session ----
  useEffect(() => {
    if (isLocal) {
      setSession({
        token: 'local-only',
        user: { id: 'local-user', name: 'You' },
      });
    } else {
      const existing = readSession();
      if (existing) {
        setSession(existing);
        setNameInput(existing.user.name);
      }
    }
    setSessionChecked(true);
  }, [isLocal]);

  // ---- Board access (and joining through an invite link) ----
  useEffect(() => {
    if (!session) return;
    if (isLocal) {
      const now = new Date().toISOString();
      setBoard({
        id: boardId,
        title: 'Untitled local board',
        ownerId: 'local-user',
        role: 'owner',
        locked: false,
        createdAt: now,
        updatedAt: now,
        members: [{ userId: 'local-user', role: 'owner', name: 'You' }],
      });
      setStatus('live');
      return;
    }
    let cancelled = false;
    const invite = search.get('invite');
    (async () => {
      try {
        const value = invite
          ? await send<Board>(`/boards/${boardId}/join`, 'POST', {
              inviteToken: invite,
            })
          : await api<Board>(`/boards/${boardId}`);
        if (cancelled) return;
        setBoard(value);
        setLoadError('');
        // Keep the invite token out of the address bar once it is used.
        if (invite) window.history.replaceState(null, '', `/board/${boardId}`);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          clearSession();
          setSession(null);
          return;
        }
        setLoadError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `search` is read once: replacing the URL must not reload the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, boardId, isLocal]);

  // ---- Realtime connection ----
  const onServerMessage = useEffectEvent((message: ServerMessage) => {
    const client = clientRef.current;
    switch (message.t) {
      case 'welcome': {
        setSelfPeerId(message.self.peerId);
        setBoard(message.board);
        remote.clear();
        setObjects(
          applyOperations(message.objects, client?.pendingOperations ?? []),
        );
        setMessages((current) => [
          ...message.messages,
          ...current.filter((item) => item.pending),
        ]);
        setPeers(message.peers);
        callRef.current?.setIceServers(message.iceServers);
        callRef.current?.syncPeers(message.peers);
        callPeers.current = new Set(
          message.peers
            .filter((peer) => peer.inCall)
            .map((peer) => peer.peerId),
        );
        return;
      }
      case 'op': {
        const { op } = message;
        remote.settle(op.objectId);
        setObjects((current) => applyOperations(current, [op]));
        if (op.type === 'delete') {
          setSelected((current) =>
            current.includes(op.objectId)
              ? current.filter((item) => item !== op.objectId)
              : current,
          );
          setTextEditor((current) =>
            current?.object.id === op.objectId ? null : current,
          );
        }
        return;
      }
      case 'nack':
        setNotice(message.message);
        client?.resync();
        return;
      case 'live':
        remote.apply(message);
        return;
      case 'chat': {
        const chat = message.message;
        setMessages((current) => {
          const index = current.findIndex(
            (item) => item.id === message.clientId,
          );
          if (index >= 0)
            return current.map((item, at) => (at === index ? chat : item));
          return current.some((item) => item.id === chat.id)
            ? current
            : [...current, chat];
        });
        if (chat.userId !== session?.user.id) {
          if (!chatOpen) setUnread((count) => count + 1);
          setTyping((current) =>
            current.filter((item) => item.name !== chat.name),
          );
        }
        return;
      }
      case 'typing':
        setTyping((current) => [
          ...current.filter((item) => item.peerId !== message.peerId),
          {
            peerId: message.peerId,
            name: message.name,
            until: Date.now() + 4000,
          },
        ]);
        return;
      case 'presence': {
        setPeers(message.peers);
        const present = new Set(message.peers.map((peer) => peer.peerId));
        for (const peerId of remote.cursors.keys())
          if (!present.has(peerId)) remote.dropPeer(peerId);
        callRef.current?.syncPeers(message.peers);
        const nowInCall = message.peers.filter(
          (peer) => peer.inCall && peer.peerId !== client?.peerId,
        );
        const started = nowInCall.find(
          (peer) => !callPeers.current.has(peer.peerId),
        );
        if (started && !call.joined && callPeers.current.size === 0)
          setNotice(`${started.name} started audio. Join from the top bar.`);
        callPeers.current = new Set(nowInCall.map((peer) => peer.peerId));
        return;
      }
      case 'signal':
        void callRef.current?.handleSignal(message.from, message.data);
        return;
      case 'board':
        setBoard(message.board);
        return;
      case 'reset':
        remote.clear();
        setObjects(message.objects);
        setSelected([]);
        history.current = [];
        redoStack.current = [];
        setCanUndo(false);
        setCanRedo(false);
        return;
      case 'deleted':
        router.push('/');
        return;
      case 'error':
        if (message.fatal) setLoadError(message.message);
        else setNotice(message.message);
        return;
    }
  });

  const boardReady = board !== null;
  useEffect(() => {
    if (!session || !boardReady || isLocal) return;
    const client = new RealtimeClient(
      boardId,
      session.token,
      colorFor(session.user.id),
      {
        onMessage: (message) => onServerMessage(message),
        onStatus: setStatus,
        onPending: setPending,
      },
    );
    clientRef.current = client;
    setPending(client.pendingOperations.length);
    const audio = new AudioCall(client, [], setCall);
    callRef.current = audio;
    return () => {
      audio.leave();
      client.close();
      clientRef.current = null;
      callRef.current = null;
    };
  }, [session, boardReady, boardId, isLocal]);

  // Expire "is typing" hints.
  useEffect(() => {
    if (!typing.length) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => current.filter((item) => item.until > now));
    }, 1000);
    return () => clearInterval(timer);
  }, [typing.length]);

  useEffect(() => {
    if (call.error) setNotice(call.error);
  }, [call.error]);

  // Local boards only live in this tab.
  useEffect(() => {
    if (!isLocal || objects.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isLocal, objects.length]);

  // ---- Viewport ----
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [boardReady]);

  const fitTo = useCallback(
    (bounds: Bounds | null) => {
      if (!bounds) {
        setView({ x: -size.width / 2, y: -size.height / 2, zoom: 1 });
        return;
      }
      const padding = 80;
      const zoom = clampZoom(
        Math.min(
          1.5,
          (size.width - padding * 2) / Math.max(bounds.width, 1),
          (size.height - padding * 2) / Math.max(bounds.height, 1),
        ),
      );
      setView({
        x: bounds.x + bounds.width / 2 - size.width / zoom / 2,
        y: bounds.y + bounds.height / 2 - size.height / zoom / 2,
        zoom,
      });
    },
    [size],
  );

  // Frame the content the first time the board appears.
  useEffect(() => {
    if (fittedOnce.current || size.width <= 1 || !boardReady) return;
    if (!isLocal && status !== 'live') return;
    fittedOnce.current = true;
    fitTo(unionBounds(objects));
  }, [size, boardReady, status, isLocal, objects, fitTo]);

  function zoomAt(factor: number, screen?: Point) {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const sx = screen?.x ?? size.width / 2;
      const sy = screen?.y ?? size.height / 2;
      const wx = current.x + sx / current.zoom;
      const wy = current.y + sy / current.zoom;
      return { x: wx - sx / zoom, y: wy - sy / zoom, zoom };
    });
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(
          -event.deltaY * (event.deltaMode ? 0.05 : 0.0075),
        );
        setView((current) => {
          const zoom = clampZoom(current.zoom * factor);
          const sx = event.clientX - rect.left;
          const sy = event.clientY - rect.top;
          return {
            x: current.x + sx / current.zoom - sx / zoom,
            y: current.y + sy / current.zoom - sy / zoom,
            zoom,
          };
        });
      } else {
        const unit =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
        const dx = (event.shiftKey ? event.deltaY : event.deltaX) * unit;
        const dy = (event.shiftKey ? 0 : event.deltaY) * unit;
        setView((current) => ({
          ...current,
          x: current.x + dx / current.zoom,
          y: current.y + dy / current.zoom,
        }));
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [boardReady]);

  function toWorld(clientX: number, clientY: number): Point {
    const rect = stageRef.current!.getBoundingClientRect();
    const current = viewRef.current;
    return {
      x: current.x + (clientX - rect.left) / current.zoom,
      y: current.y + (clientY - rect.top) / current.zoom,
    };
  }

  // ---- Applying and sharing edits ----
  function perform(
    drafts: Draft[],
    options: { record?: boolean; origins?: Record<string, BoardObject> } = {},
  ) {
    const current = objectsRef.current;
    const changes: Change[] = [];
    const operations: Operation[] = [];
    for (const draft of drafts) {
      const before =
        options.origins?.[draft.objectId] ??
        current.find((item) => item.id === draft.objectId) ??
        null;
      let after: BoardObject | null = null;
      if (draft.type === 'create') after = draft.object ?? null;
      else if (draft.type === 'update') {
        if (!before || !draft.fields) continue;
        after = { ...before, ...draft.fields };
        if (!Object.keys(diffFields(after, before)).length) continue;
      } else if (!before) continue;
      changes.push({ objectId: draft.objectId, before, after });
      operations.push({ ...draft, id: id() });
    }
    if (!operations.length) return;
    const next = applyOperations(current, operations);
    objectsRef.current = next;
    setObjects(next);
    if (options.record !== false) {
      history.current.push(changes);
      if (history.current.length > 200) history.current.shift();
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }
    const client = clientRef.current;
    if (client) {
      client.flushLive();
      for (const operation of operations) client.sendOperation(operation);
    }
  }

  function restore(entry: Change[], side: 'before' | 'after') {
    const drafts: Draft[] = [];
    const ordered = side === 'before' ? [...entry].reverse() : entry;
    for (const change of ordered) {
      const target = change[side];
      const current =
        objectsRef.current.find((item) => item.id === change.objectId) ?? null;
      if (!target) {
        if (current) drafts.push({ type: 'delete', objectId: current.id });
        continue;
      }
      if (!current) {
        // Deleted objects stay deleted on the server, so recreate under a new ID.
        const freshId = id();
        change.objectId = freshId;
        if (change.before) change.before = { ...change.before, id: freshId };
        if (change.after) change.after = { ...change.after, id: freshId };
        const object = change[side]!;
        drafts.push({ type: 'create', objectId: freshId, object });
        continue;
      }
      const fields = diffFields(target, current);
      if (Object.keys(fields).length)
        drafts.push({ type: 'update', objectId: current.id, fields });
    }
    perform(drafts, { record: false });
  }

  function undo() {
    if (readonly) return;
    const entry = history.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    restore(entry, 'before');
    setCanUndo(history.current.length > 0);
    setCanRedo(true);
    setSelected([]);
  }

  function redo() {
    if (readonly) return;
    const entry = redoStack.current.pop();
    if (!entry) return;
    history.current.push(entry);
    restore(entry, 'after');
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }

  function deleteObjects(ids: string[]) {
    if (readonly || !ids.length) return;
    perform(ids.map((objectId) => ({ type: 'delete', objectId })));
    setSelected((current) => current.filter((item) => !ids.includes(item)));
  }

  function pasteObjects(sources: BoardObject[], offset = 24) {
    if (readonly || !sources.length) return;
    const copies = sources.map((item) => ({
      ...item,
      id: id(),
      x: round(item.x + offset),
      y: round(item.y + offset),
    }));
    perform(
      copies.map((object) => ({ type: 'create', objectId: object.id, object })),
    );
    setSelected(copies.map((item) => item.id));
    return copies;
  }

  function updateSelected(fields: Partial<BoardObject>) {
    perform(
      selectedObjects.map((item) => ({
        type: 'update',
        objectId: item.id,
        fields,
      })),
    );
  }

  /** Live preview for sliders: peers see it move, history records one step. */
  function previewProperty(item: BoardObject, fields: Partial<BoardObject>) {
    if (!propertyOrigin.current) propertyOrigin.current = item;
    const next = { ...item, ...fields };
    setObjects((current) =>
      current.map((object) => (object.id === item.id ? next : object)),
    );
    clientRef.current?.liveUpsert([next]);
  }

  function commitProperty(item: BoardObject, fields: Partial<BoardObject>) {
    const origin = propertyOrigin.current ?? item;
    propertyOrigin.current = null;
    perform([{ type: 'update', objectId: item.id, fields }], {
      origins: { [item.id]: origin },
    });
  }

  function newObject(
    kind: BoardObject['kind'],
    point: Point,
    extra: Partial<BoardObject> = {},
  ): BoardObject {
    return {
      id: id(),
      kind,
      x: round(point.x),
      y: round(point.y),
      color,
      strokeWidth,
      ...extra,
    };
  }

  function shapeFrom(
    object: BoardObject,
    start: Point,
    end: Point,
    square: boolean,
  ) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if (object.kind === 'line' || object.kind === 'arrow') {
      if (square) {
        // Snap to 45° steps.
        const angle =
          Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(dx, dy);
        dx = Math.cos(angle) * length;
        dy = Math.sin(angle) * length;
      }
      return {
        ...object,
        x: round(start.x),
        y: round(start.y),
        points: [0, 0, round(dx), round(dy)],
      };
    }
    if (square) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * side;
      dy = Math.sign(dy || 1) * side;
    }
    return {
      ...object,
      x: round(Math.min(start.x, start.x + dx)),
      y: round(Math.min(start.y, start.y + dy)),
      width: round(Math.max(1, Math.abs(dx))),
      height: round(Math.max(1, Math.abs(dy))),
    };
  }

  // ---- Text editing ----
  function openText(object: BoardObject, isNew: boolean) {
    setSelected([]);
    setTextEditor({ object, isNew });
    clientRef.current?.liveUpsert([object]);
  }

  function finishText() {
    const editor = editorRef.current;
    if (!editor) return;
    setTextEditor(null);
    const object = editor.object;
    const text = (object.text ?? '').replace(/\s+$/, '');
    if (editor.isNew && !text.trim() && object.kind === 'text') {
      clientRef.current?.liveRemove([object.id]);
      return;
    }
    if (editor.isNew)
      perform([
        { type: 'create', objectId: object.id, object: { ...object, text } },
      ]);
    else {
      perform([{ type: 'update', objectId: object.id, fields: { text } }]);
      clientRef.current?.liveRemove([object.id]);
    }
    setSelected([object.id]);
  }

  // ---- Pointer gestures ----
  function setOverlay(state: Parameters<LocalOverlayHandle['set']>[0]) {
    overlayRef.current?.set(state);
  }

  function cancelGesture() {
    const current = gesture.current;
    gesture.current = null;
    setPanning(false);
    setOverlay({});
    if (current && (current.kind === 'draw' || current.kind === 'shape'))
      clientRef.current?.liveRemove([current.object.id]);
    if (current && (current.kind === 'move' || current.kind === 'resize'))
      clientRef.current?.liveRemove(
        current.kind === 'move'
          ? current.moved.map((item) => item.id)
          : [current.moved.id],
      );
  }

  function objectIdAt(clientX: number, clientY: number) {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const oid = element.closest('[data-oid]')?.getAttribute('data-oid');
      if (oid) return oid;
      if (element === stageRef.current) break;
    }
    return null;
  }

  function eraseAt(clientX: number, clientY: number) {
    const current = gesture.current;
    if (current?.kind !== 'erase') return;
    const oid = objectIdAt(clientX, clientY);
    if (!oid || current.erased.has(oid)) return;
    current.erased.add(oid);
    setOverlay({ hide: [...current.erased] });
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (editorRef.current) {
      // The first click outside an open text box just finishes it.
      finishText();
      return;
    }
    if (event.button === 2) return;
    // Stop the browser's mousedown focus change, which would immediately blur
    // a text box opened by this click. Clicking the canvas still leaves chat
    // and other fields so that shortcuts work.
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    const stage = event.currentTarget;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (event.pointerType === 'touch' && pointers.current.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        kind: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        origin: viewRef.current,
      };
      return;
    }
    if (pointers.current.size > 1) return;

    const point = toWorld(event.clientX, event.clientY);
    const target = event.target as Element;
    const oid = target.closest('[data-oid]')?.getAttribute('data-oid') ?? null;
    const onHandle = target.closest('[data-handle]') !== null;
    stage.setPointerCapture(event.pointerId);

    const pan = () => {
      gesture.current = {
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
        origin: viewRef.current,
      };
      setPanning(true);
    };
    if (event.button === 1 || spaceHeld || tool === 'hand' || readonly) {
      if (readonly && oid && tool === 'select') setSelected([oid]);
      return pan();
    }

    switch (tool) {
      case 'select': {
        if (onHandle && selectedObject) {
          gesture.current = {
            kind: 'resize',
            start: point,
            original: selectedObject,
            moved: selectedObject,
          };
          return;
        }
        if (oid) {
          if (event.shiftKey) {
            setSelected((current) =>
              current.includes(oid)
                ? current.filter((item) => item !== oid)
                : [...current, oid],
            );
            return;
          }
          const ids = selected.includes(oid) ? selected : [oid];
          setSelected(ids);
          const originals = objectsRef.current.filter((item) =>
            ids.includes(item.id),
          );
          gesture.current = {
            kind: 'move',
            start: point,
            originals,
            moved: originals,
          };
          return;
        }
        const base = event.shiftKey ? selected : [];
        setSelected(base);
        gesture.current = { kind: 'marquee', start: point, base };
        return;
      }
      case 'eraser':
        gesture.current = { kind: 'erase', erased: new Set() };
        eraseAt(event.clientX, event.clientY);
        return;
      case 'pen':
      case 'highlighter': {
        const highlighter = tool === 'highlighter';
        const object = newObject('path', point, {
          points: [0, 0],
          color: highlighter ? `${color.slice(0, 7)}66` : color,
          strokeWidth: highlighter
            ? Math.max(12, strokeWidth * 4)
            : strokeWidth,
        });
        gesture.current = { kind: 'draw', object, last: point };
        setOverlay({ objects: [object] });
        clientRef.current?.liveUpsert([object]);
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'diamond':
      case 'line':
      case 'arrow': {
        const object = shapeFrom(newObject(tool, point), point, point, false);
        gesture.current = { kind: 'shape', object, start: point };
        return;
      }
      case 'text': {
        const existing = oid
          ? objectsRef.current.find((item) => item.id === oid)
          : undefined;
        if (existing?.kind === 'text' || existing?.kind === 'sticky')
          return openText(existing, false);
        return openText(
          newObject(
            'text',
            { x: point.x, y: point.y - 16 },
            { text: '', fontSize: 28 },
          ),
          true,
        );
      }
      case 'sticky':
        return openText(
          newObject(
            'sticky',
            { x: point.x - 100, y: point.y - 100 },
            {
              width: 200,
              height: 200,
              text: '',
              color: stickyColor,
              strokeWidth: 1,
              fontSize: 18,
            },
          ),
          true,
        );
    }
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (pointers.current.has(event.pointerId))
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    const current = gesture.current;
    const point = toWorld(event.clientX, event.clientY);
    clientRef.current?.liveCursor({ x: round(point.x), y: round(point.y) });
    if (!current) return;

    switch (current.kind) {
      case 'pan': {
        const { origin } = current;
        setView({
          ...origin,
          x: origin.x - (event.clientX - current.start.x) / origin.zoom,
          y: origin.y - (event.clientY - current.start.y) / origin.zoom,
        });
        return;
      }
      case 'pinch': {
        const values = [...pointers.current.values()];
        if (values.length < 2) return;
        const [a, b] = values as [Point, Point];
        const rect = stageRef.current!.getBoundingClientRect();
        const { origin } = current;
        const zoom = clampZoom(
          origin.zoom *
            (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, current.distance)),
        );
        const mid = {
          x: (a.x + b.x) / 2 - rect.left,
          y: (a.y + b.y) / 2 - rect.top,
        };
        const startMid = {
          x: current.mid.x - rect.left,
          y: current.mid.y - rect.top,
        };
        const wx = origin.x + startMid.x / origin.zoom;
        const wy = origin.y + startMid.y / origin.zoom;
        setView({ x: wx - mid.x / zoom, y: wy - mid.y / zoom, zoom });
        return;
      }
      case 'draw': {
        const samples =
          typeof event.nativeEvent.getCoalescedEvents === 'function'
            ? event.nativeEvent.getCoalescedEvents()
            : [];
        const added: number[] = [];
        const minStep = 0.75 / viewRef.current.zoom;
        for (const sample of samples.length ? samples : [event.nativeEvent]) {
          const next = toWorld(sample.clientX, sample.clientY);
          if (
            Math.hypot(next.x - current.last.x, next.y - current.last.y) <
            minStep
          )
            continue;
          current.last = next;
          added.push(
            round(next.x - current.object.x),
            round(next.y - current.object.y),
          );
        }
        if (!added.length) return;
        current.object = {
          ...current.object,
          points: [...(current.object.points ?? []), ...added],
        };
        setOverlay({ objects: [current.object] });
        clientRef.current?.liveAppend(current.object.id, added);
        return;
      }
      case 'shape': {
        current.object = shapeFrom(
          current.object,
          current.start,
          point,
          event.shiftKey,
        );
        setOverlay({ objects: [current.object] });
        clientRef.current?.liveUpsert([current.object]);
        return;
      }
      case 'move': {
        const dx = point.x - current.start.x;
        const dy = point.y - current.start.y;
        current.moved = current.originals.map((item) => ({
          ...item,
          x: round(item.x + dx),
          y: round(item.y + dy),
        }));
        setOverlay({
          objects: current.moved,
          hide: current.originals.map((item) => item.id),
        });
        clientRef.current?.liveUpsert(current.moved);
        return;
      }
      case 'resize': {
        const { original } = current;
        let width = Math.max(
          16,
          (original.width ?? 100) + point.x - current.start.x,
        );
        let height = Math.max(
          16,
          (original.height ?? 100) + point.y - current.start.y,
        );
        if (event.shiftKey || original.kind === 'image') {
          const ratio = (original.width ?? 1) / (original.height ?? 1);
          if (width / height > ratio) height = width / ratio;
          else width = height * ratio;
        }
        current.moved = {
          ...original,
          width: round(width),
          height: round(height),
        };
        setOverlay({ objects: [current.moved], hide: [original.id] });
        clientRef.current?.liveUpsert([current.moved]);
        return;
      }
      case 'marquee': {
        const box = {
          x: Math.min(current.start.x, point.x),
          y: Math.min(current.start.y, point.y),
          width: Math.abs(point.x - current.start.x),
          height: Math.abs(point.y - current.start.y),
        };
        setOverlay({ marquee: box });
        const hits = objectsRef.current
          .filter((item) => intersects(box, objectBounds(item)))
          .map((item) => item.id);
        setSelected([...new Set([...current.base, ...hits])]);
        return;
      }
      case 'erase':
        if (event.buttons) eraseAt(event.clientX, event.clientY);
        return;
    }
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (!current) return;
    if (current.kind === 'pinch') {
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    gesture.current = null;
    setPanning(false);
    switch (current.kind) {
      case 'draw':
        perform([
          {
            type: 'create',
            objectId: current.object.id,
            object: current.object,
          },
        ]);
        break;
      case 'shape': {
        let object = current.object;
        const tiny =
          object.kind === 'line' || object.kind === 'arrow'
            ? Math.hypot(object.points?.[2] ?? 0, object.points?.[3] ?? 0) < 4
            : (object.width ?? 0) < 4 && (object.height ?? 0) < 4;
        if (tiny && (object.kind === 'line' || object.kind === 'arrow')) {
          clientRef.current?.liveRemove([object.id]);
          break;
        }
        // A click without dragging drops a default-sized shape.
        if (tiny)
          object = {
            ...object,
            x: round(object.x - 60),
            y: round(object.y - 40),
            width: 120,
            height: 80,
          };
        perform([{ type: 'create', objectId: object.id, object }]);
        setSelected([object.id]);
        break;
      }
      case 'move': {
        const changed = current.moved.filter((item, index) => {
          const original = current.originals[index]!;
          return item.x !== original.x || item.y !== original.y;
        });
        if (changed.length)
          perform(
            changed.map((item) => ({
              type: 'update',
              objectId: item.id,
              fields: { x: item.x, y: item.y },
            })),
          );
        else
          clientRef.current?.liveRemove(current.moved.map((item) => item.id));
        break;
      }
      case 'resize':
        perform([
          {
            type: 'update',
            objectId: current.original.id,
            fields: {
              width: current.moved.width!,
              height: current.moved.height!,
            },
          },
        ]);
        break;
      case 'erase':
        deleteObjects([...current.erased]);
        break;
    }
    setOverlay({});
  }

  function onDoubleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (readonly || tool !== 'select') return;
    const oid = (event.target as Element)
      .closest('[data-oid]')
      ?.getAttribute('data-oid');
    const item = oid
      ? objectsRef.current.find((object) => object.id === oid)
      : undefined;
    if (item?.kind === 'text' || item?.kind === 'sticky')
      return openText(item, false);
    if (!oid) {
      const point = toWorld(event.clientX, event.clientY);
      openText(
        newObject(
          'text',
          { x: point.x, y: point.y - 16 },
          { text: '', fontSize: 28 },
        ),
        true,
      );
    }
  }

  // ---- Keyboard ----
  function chooseTool(next: Tool) {
    cancelGesture();
    setTool(next);
    if (next !== 'select') setSelected([]);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (shareOpen || membersOpen || snapshotsOpen || helpOpen || exportOpen) {
        setShareOpen(false);
        setMembersOpen(false);
        setSnapshotsOpen(false);
        setHelpOpen(false);
        setExportOpen(false);
        return;
      }
    }
    if (isEditable(event.target) || textEditor) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (key === ' ' && !event.repeat) {
      setSpaceHeld(true);
      event.preventDefault();
      return;
    }
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (modifier && key === 'y') {
      event.preventDefault();
      redo();
    } else if (modifier && key === 'd') {
      event.preventDefault();
      pasteObjects(selectedObjects);
    } else if (modifier && key === 'a') {
      event.preventDefault();
      setTool('select');
      setSelected(objectsRef.current.map((item) => item.id));
    } else if (modifier && key === 'c' && selectedObjects.length) {
      clipboard.current = selectedObjects.map((item) => ({ ...item }));
    } else if (modifier && key === 'x' && selectedObjects.length) {
      clipboard.current = selectedObjects.map((item) => ({ ...item }));
      deleteObjects(selected);
    } else if (modifier && key === 'v' && clipboard.current.length) {
      event.preventDefault();
      const copies = pasteObjects(clipboard.current);
      if (copies) clipboard.current = copies;
    } else if (modifier && (key === '=' || key === '+')) {
      event.preventDefault();
      zoomAt(1.2);
    } else if (modifier && key === '-') {
      event.preventDefault();
      zoomAt(1 / 1.2);
    } else if (modifier && key === '0') {
      event.preventDefault();
      setView((current) => ({ ...current, zoom: 1 }));
    } else if (event.shiftKey && key === '1') {
      fitTo(unionBounds(objectsRef.current));
    } else if ((key === 'delete' || key === 'backspace') && selected.length) {
      event.preventDefault();
      deleteObjects(selected);
    } else if (key.startsWith('arrow') && selectedObjects.length && !readonly) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      perform(
        selectedObjects.map((item) => ({
          type: 'update',
          objectId: item.id,
          fields: { x: item.x + dx, y: item.y + dy },
        })),
      );
    } else if (key === 'escape') {
      cancelGesture();
      setSelected([]);
    } else if (!modifier && !event.altKey) {
      if (key === 'm' && call.joined) {
        callRef.current?.setMuted(!call.muted);
        return;
      }
      const next = TOOL_KEYS[key];
      if (next) chooseTool(next);
      else if (key === '?') setHelpOpen(true);
    }
  });

  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === ' ') setSpaceHeld(false);
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKeyDown(event);
    const up = (event: KeyboardEvent) => onKeyUp(event);
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ---- Board actions ----
  async function renameBoard(title: string) {
    setEditingTitle(false);
    if (!board || board.role !== 'owner') return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === board.title) return;
    if (isLocal) return setBoard({ ...board, title: trimmed });
    try {
      setBoard(
        await send<Board>(`/boards/${board.id}`, 'PATCH', { title: trimmed }),
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function copyInvite() {
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
      setBoard({
        ...board,
        inviteToken: result.inviteToken,
        inviteRevoked: false,
      });
      setNotice('A fresh invite link is ready. Previous links no longer work.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function revokeInvite() {
    if (
      !board ||
      !window.confirm(
        'Turn off this invite link? People who already joined keep access.',
      )
    )
      return;
    try {
      await send(`/boards/${board.id}/invites`, 'DELETE');
      setBoard({ ...board, inviteRevoked: true });
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function openSnapshots() {
    if (!board) return;
    try {
      setSnapshots(await api(`/boards/${board.id}/snapshots`));
      setSnapshotsOpen(true);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function saveSnapshot() {
    if (!board) return;
    try {
      await send(`/boards/${board.id}/snapshots`, 'POST', {});
      setSnapshots(await api(`/boards/${board.id}/snapshots`));
      setNotice('Version saved.');
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function restoreSnapshot(snapshotId: string) {
    if (
      !board ||
      !window.confirm(
        'Restore this version? The current canvas will be replaced for everyone.',
      )
    )
      return;
    try {
      const result = await send<{ objects: BoardObject[] }>(
        `/boards/${board.id}/snapshots/${snapshotId}/restore`,
        'POST',
        {},
      );
      setObjects(result.objects);
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
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function toggleLock() {
    if (!board) return;
    try {
      setBoard(
        await send<Board>(`/boards/${board.id}`, 'PATCH', {
          locked: !board.locked,
        }),
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  function sendChat(text: string) {
    const client = clientRef.current;
    if (!client || !session) return;
    const clientId = id();
    if (!client.sendChat(clientId, text)) {
      setNotice('You are offline. Your message was not sent.');
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: clientId,
        userId: session.user.id,
        name: session.user.name,
        text,
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);
  }

  async function addImage(file: File | undefined) {
    if (!file || readonly) return;
    try {
      const image = await prepareImage(file);
      const scale = Math.min(1, 520 / image.width, 380 / image.height);
      const width = round(image.width * scale);
      const height = round(image.height * scale);
      const object = newObject(
        'image',
        {
          x: view.x + size.width / view.zoom / 2 - width / 2,
          y: view.y + size.height / view.zoom / 2 - height / 2,
        },
        { width, height, src: image.src },
      );
      perform([{ type: 'create', objectId: object.id, object }]);
      setTool('select');
      setSelected([object.id]);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function doExport(format: 'png' | 'pdf' | 'svg') {
    setExportOpen(false);
    if (!board || !objectLayerRef.current) return;
    try {
      await exportBoard(
        objectLayerRef.current,
        objectsRef.current,
        board.title,
        format,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  // ---- Render ----
  if (!sessionChecked) return <main className="board-loading" />;

  if (!session)
    return (
      <main className="board-signin">
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span> CollabBoard
        </Link>
        <div className="signin-card">
          <div className="signin-icon">✎</div>
          <h1>Join the board.</h1>
          <p>Add your name so others know who’s drawing.</p>
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
          <span className="brand-mark">✳</span> CollabBoard
        </Link>
        {!loadError && <div className="loading-orbit" />}
        <p>{loadError || 'Opening your board…'}</p>
        {loadError && (
          <Link className="button subtle" href="/">
            Back to boards
          </Link>
        )}
      </main>
    );

  const scale = 1 / view.zoom;
  const saveLabel = isLocal
    ? 'Local · not saved'
    : status === 'offline'
      ? pending
        ? `Offline · ${pending} unsynced`
        : 'Reconnecting…'
      : status === 'connecting'
        ? 'Connecting…'
        : pending
          ? 'Saving…'
          : 'All changes saved';
  const editorObject = textEditor?.object;
  const editorFont = editorObject ? defaultFontSize(editorObject) : 0;
  const editorLayout =
    editorObject && editorObject.kind === 'text'
      ? layoutText(editorObject.text || ' ', editorFont)
      : null;
  const stageCursor = panning
    ? 'grabbing'
    : spaceHeld || tool === 'hand' || readonly
      ? 'grab'
      : undefined;
  const otherPeople = onlinePeople.filter(
    (peer) => peer.userId !== session.user.id,
  );

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <Link
          href="/"
          className="brand editor-brand"
          onClick={(event) => {
            if (
              isLocal &&
              objects.length &&
              !window.confirm('This board is not saved. Leave it?')
            )
              event.preventDefault();
          }}
        >
          <span className="brand-mark">✳</span>
          <span>CollabBoard</span>
        </Link>
        <div className="board-title-block">
          {editingTitle ? (
            <input
              className="board-title-input"
              defaultValue={board.title}
              maxLength={80}
              autoFocus
              aria-label="Board name"
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => void renameBoard(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setEditingTitle(false);
              }}
            />
          ) : (
            <button
              className="board-title"
              onClick={() => setEditingTitle(true)}
              disabled={board.role !== 'owner'}
              title={board.role === 'owner' ? 'Rename board' : board.title}
            >
              {board.title}
            </button>
          )}
          <div className="save-indicator" aria-live="polite">
            {!isLocal && (
              <span
                className={`connection-dot ${status === 'live' && pending ? 'saving' : status}`}
              />
            )}
            {saveLabel}
          </div>
        </div>
        <div className="top-history-actions" aria-label="History">
          <button
            aria-label="Undo"
            title="Undo · Ctrl/⌘ Z"
            disabled={!canUndo || readonly}
            onClick={undo}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo · Ctrl/⌘ Shift Z"
            disabled={!canRedo || readonly}
            onClick={redo}
          >
            ↷
          </button>
        </div>
        <div className="topbar-spacer" />
        {isLocal ? (
          <span className="local-mode-badge">Local board</span>
        ) : (
          <>
            <button
              className="participant-stack"
              title="People on this board"
              onClick={() => setMembersOpen(true)}
            >
              {onlinePeople.slice(0, 4).map((peer) => (
                <span
                  key={peer.userId}
                  className="avatar"
                  style={{ background: peer.color }}
                  title={peer.userId === session.user.id ? 'You' : peer.name}
                >
                  {peer.name[0]?.toUpperCase()}
                </span>
              ))}
              {onlinePeople.length > 4 && (
                <span className="avatar more-avatar">
                  +{onlinePeople.length - 4}
                </span>
              )}
            </button>
            <CallControls
              call={call}
              peers={peers}
              selfPeerId={selfPeerId}
              disabled={status !== 'live'}
              onJoin={() => void callRef.current?.join()}
              onLeave={() => callRef.current?.leave()}
              onToggleMute={() => callRef.current?.setMuted(!call.muted)}
            />
            <button
              className={`top-action ${chatOpen ? 'is-active' : ''}`}
              onClick={() => {
                setChatOpen((open) => !open);
                setUnread(0);
              }}
              aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
            >
              <span className="action-glyph" aria-hidden="true">
                💬
              </span>
              <span className="top-action-label">Chat</span>
              {unread > 0 && !chatOpen && (
                <span className="unread-badge">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {board.role === 'owner' && (
              <button
                className="button share-button"
                onClick={() => setShareOpen(true)}
              >
                Share
              </button>
            )}
          </>
        )}
        <div className="export-menu">
          <button
            className="button subtle export-button"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
          >
            Export
          </button>
          {exportOpen && (
            <div className="export-options" role="menu">
              <button role="menuitem" onClick={() => void doExport('png')}>
                PNG image
              </button>
              <button role="menuitem" onClick={() => void doExport('svg')}>
                SVG vector
              </button>
              <button role="menuitem" onClick={() => void doExport('pdf')}>
                PDF document
              </button>
            </div>
          )}
        </div>
        <ThemeToggle />
      </header>

      <section className="editor-main">
        <aside className="tool-rail" aria-label="Drawing tools">
          {TOOLS.map((item, index) => (
            <div key={item.tool} className="tool-slot">
              {(index === 2 || index === 5 || index === 10) && (
                <div className="rail-divider" />
              )}
              <button
                className={`tool-button ${tool === item.tool ? 'tool-selected' : ''}`}
                onClick={() => chooseTool(item.tool)}
                aria-pressed={tool === item.tool}
                aria-label={item.label}
                title={`${item.label}${item.key ? ` · ${item.key}` : ''}`}
                disabled={
                  readonly && item.tool !== 'select' && item.tool !== 'hand'
                }
              >
                <span aria-hidden="true">{item.icon}</span>
                <small>{item.label}</small>
              </button>
            </div>
          ))}
          <div className="rail-divider" />
          <button
            className="tool-button"
            onClick={() => imagePicker.current?.click()}
            title="Add an image"
            aria-label="Add an image"
            disabled={readonly}
          >
            <span aria-hidden="true">🖼</span>
            <small>Image</small>
          </button>
        </aside>

        <div className="canvas-region">
          <input
            ref={imagePicker}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Choose an image file"
            onChange={(event) => {
              void addImage(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {notice && (
            <div className="toast-notice" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {readonly && (
            <div className="readonly-banner">
              {board.locked && board.role !== 'viewer'
                ? 'Editing is paused by the board owner.'
                : 'You have view-only access.'}
            </div>
          )}
          {!isLocal && status === 'offline' && (
            <div className="offline-banner" role="status">
              Connection lost — reconnecting. Your edits are kept and will sync.
            </div>
          )}
          <svg
            ref={stageRef}
            className={`board-stage tool-${tool}`}
            style={stageCursor ? { cursor: stageCursor } : undefined}
            viewBox={`${view.x} ${view.y} ${size.width / view.zoom} ${size.height / view.zoom}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={(event) => {
              pointers.current.delete(event.pointerId);
              cancelGesture();
            }}
            onPointerLeave={() => clientRef.current?.liveCursor(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={(event) => event.preventDefault()}
          >
            <defs>
              <pattern
                id="dot-grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <circle
                  cx="1"
                  cy="1"
                  r={Math.min(1.6, 1.1 * scale)}
                  fill="#c9d3cb"
                />
              </pattern>
            </defs>
            <rect
              className="stage-grid"
              x={view.x}
              y={view.y}
              width={size.width / view.zoom}
              height={size.height / view.zoom}
              fill={view.zoom > 0.35 ? 'url(#dot-grid)' : 'transparent'}
            />
            {textEditor && !textEditor.isNew && (
              <style>{`[data-oid="${CSS.escape(textEditor.object.id)}"]{visibility:hidden}`}</style>
            )}
            <g ref={objectLayerRef} className="objects-layer">
              {objects.map((item) => {
                const isSelected = selected.includes(item.id);
                return (
                  <BoardShape
                    key={item.id}
                    item={item}
                    selected={isSelected}
                    scale={isSelected ? scale : 1}
                    showHandle={
                      isSelected && selected.length === 1 && !readonly
                    }
                  />
                );
              })}
            </g>
            <RemoteLayer activity={remote} peers={peers} zoom={view.zoom} />
            <LocalOverlay ref={overlayRef} zoom={view.zoom} />
          </svg>

          {editorObject && (
            <textarea
              className={`canvas-text-editor ${editorObject.kind === 'sticky' ? 'sticky-editor' : ''}`}
              aria-label={
                editorObject.kind === 'sticky' ? 'Sticky note text' : 'Text'
              }
              autoFocus
              value={editorObject.text ?? ''}
              placeholder={
                editorObject.kind === 'sticky' ? 'Write a note…' : 'Type here'
              }
              spellCheck
              style={{
                left: (editorObject.x - view.x) * view.zoom,
                top: (editorObject.y - view.y) * view.zoom,
                fontSize: editorFont * view.zoom,
                lineHeight: LINE_HEIGHT,
                fontFamily: FONT_FAMILY,
                color:
                  editorObject.kind === 'sticky'
                    ? '#2c3a33'
                    : editorObject.color,
                ...(editorObject.kind === 'sticky'
                  ? {
                      width: (editorObject.width ?? 200) * view.zoom,
                      height: (editorObject.height ?? 200) * view.zoom,
                      padding: STICKY_PADDING * view.zoom,
                      background: `linear-gradient(${editorObject.color.slice(0, 7)}59, ${editorObject.color.slice(0, 7)}59), #fffdf6`,
                    }
                  : {
                      width:
                        Math.max(80, editorLayout!.width + editorFont) *
                        view.zoom,
                      height: editorLayout!.height * view.zoom,
                    }),
              }}
              onChange={(event) => {
                const object = { ...editorObject, text: event.target.value };
                setTextEditor({ ...textEditor!, object });
                clientRef.current?.liveUpsert([object]);
              }}
              onBlur={finishText}
              onKeyDown={(event) => {
                if (
                  event.key === 'Escape' ||
                  (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                ) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          )}

          {objects.length === 0 && !textEditor && (
            <div className="canvas-empty-hint">
              <span className="hint-star">✳</span>
              <p>
                {readonly
                  ? 'Nothing here yet.'
                  : 'Pick a tool and start anywhere.'}
              </p>
              <small>
                {isLocal
                  ? 'This board lives only in this tab.'
                  : 'Everything appears for everyone as you draw.'}
              </small>
            </div>
          )}
          {otherPeople.length > 0 && !isLocal && (
            <div className="presence-chip" aria-live="polite">
              <span className="connection-dot live" />
              {otherPeople.length === 1
                ? `${otherPeople[0]!.name} is here`
                : `${otherPeople.length} others here`}
            </div>
          )}
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
          {selectedObject ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SELECTED</p>
                  <h2>
                    {selectedObject.kind === 'sticky'
                      ? 'Sticky note'
                      : selectedObject.kind === 'path'
                        ? 'Drawing'
                        : selectedObject.kind[0]!.toUpperCase() +
                          selectedObject.kind.slice(1)}
                  </h2>
                </div>
              </div>
              {selectedObject.kind !== 'image' && (
                <div className="property-section">
                  <span className="property-label">
                    {selectedObject.kind === 'sticky' ? 'Note color' : 'Color'}
                  </span>
                  <div className="color-swatches">
                    {(selectedObject.kind === 'sticky'
                      ? STICKY_COLORS
                      : COLORS
                    ).map((swatch) => (
                      <button
                        key={swatch}
                        aria-label={`Color ${swatch}`}
                        className={`color-swatch ${selectedObject.color.slice(0, 7) === swatch ? 'swatch-selected' : ''}`}
                        style={{ background: swatch }}
                        disabled={readonly}
                        onClick={() =>
                          updateSelected({
                            color:
                              selectedObject.color.length === 9
                                ? `${swatch}${selectedObject.color.slice(7)}`
                                : swatch,
                          })
                        }
                      />
                    ))}
                    <input
                      className="custom-color"
                      type="color"
                      aria-label="Custom color"
                      value={selectedObject.color.slice(0, 7)}
                      disabled={readonly}
                      onChange={(event) =>
                        updateSelected({ color: event.target.value })
                      }
                    />
                  </div>
                </div>
              )}
              {['rect', 'ellipse', 'diamond'].includes(selectedObject.kind) && (
                <div className="property-section">
                  <span className="property-label">Fill</span>
                  <div className="fill-options">
                    <button
                      className={!selectedObject.fillColor ? 'is-active' : ''}
                      disabled={readonly}
                      onClick={() =>
                        updateSelected({
                          fillColor: `${selectedObject.color.slice(0, 7)}1f`,
                        })
                      }
                    >
                      Tint
                    </button>
                    <button
                      className={
                        selectedObject.fillColor?.endsWith('00')
                          ? 'is-active'
                          : ''
                      }
                      disabled={readonly}
                      onClick={() => updateSelected({ fillColor: '#ffffff00' })}
                    >
                      None
                    </button>
                    <button
                      className={
                        selectedObject.fillColor?.length === 7
                          ? 'is-active'
                          : ''
                      }
                      disabled={readonly}
                      onClick={() =>
                        updateSelected({
                          fillColor: selectedObject.color.slice(0, 7),
                        })
                      }
                    >
                      Solid
                    </button>
                  </div>
                </div>
              )}
              {(selectedObject.kind === 'text' ||
                selectedObject.kind === 'sticky') && (
                <label className="property-label">
                  Text size <span>{defaultFontSize(selectedObject)}px</span>
                  <input
                    type="range"
                    min="12"
                    max="96"
                    disabled={readonly}
                    value={defaultFontSize(selectedObject)}
                    onChange={(event) =>
                      previewProperty(selectedObject, {
                        fontSize: Number(event.target.value),
                      })
                    }
                    onPointerUp={(event) =>
                      commitProperty(selectedObject, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                    onKeyUp={(event) =>
                      commitProperty(selectedObject, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                  />
                </label>
              )}
              {!['text', 'image', 'sticky'].includes(selectedObject.kind) && (
                <label className="property-label">
                  Stroke <span>{selectedObject.strokeWidth}px</span>
                  <input
                    type="range"
                    min="1"
                    max="48"
                    disabled={readonly}
                    value={selectedObject.strokeWidth}
                    onChange={(event) =>
                      previewProperty(selectedObject, {
                        strokeWidth: Number(event.target.value),
                      })
                    }
                    onPointerUp={(event) =>
                      commitProperty(selectedObject, {
                        strokeWidth: Number(event.currentTarget.value),
                      })
                    }
                    onKeyUp={(event) =>
                      commitProperty(selectedObject, {
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
                  disabled={readonly}
                  value={Math.round((selectedObject.opacity ?? 1) * 100)}
                  onChange={(event) =>
                    previewProperty(selectedObject, {
                      opacity: Number(event.target.value) / 100,
                    })
                  }
                  onPointerUp={(event) =>
                    commitProperty(selectedObject, {
                      opacity: Number(event.currentTarget.value) / 100,
                    })
                  }
                  onKeyUp={(event) =>
                    commitProperty(selectedObject, {
                      opacity: Number(event.currentTarget.value) / 100,
                    })
                  }
                />
              </label>
              <div className="panel-actions">
                <button
                  className="button subtle"
                  disabled={readonly}
                  onClick={() => pasteObjects(selectedObjects)}
                >
                  Duplicate
                </button>
                <button
                  className="button danger"
                  disabled={readonly}
                  onClick={() => deleteObjects(selected)}
                >
                  Delete
                </button>
              </div>
            </>
          ) : selected.length > 1 ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SELECTION</p>
                  <h2>{selected.length} objects</h2>
                </div>
              </div>
              <div className="property-section">
                <span className="property-label">Color</span>
                <div className="color-swatches">
                  {COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      aria-label={`Color ${swatch}`}
                      className="color-swatch"
                      style={{ background: swatch }}
                      disabled={readonly}
                      onClick={() => updateSelected({ color: swatch })}
                    />
                  ))}
                </div>
              </div>
              <div className="panel-actions">
                <button
                  className="button subtle"
                  disabled={readonly}
                  onClick={() => pasteObjects(selectedObjects)}
                >
                  Duplicate
                </button>
                <button
                  className="button danger"
                  disabled={readonly}
                  onClick={() => deleteObjects(selected)}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {tool === 'sticky' ? 'NOTE' : 'PEN & SHAPES'}
                  </p>
                  <h2>Style</h2>
                </div>
              </div>
              <div className="property-section">
                <span className="property-label">Color</span>
                <div className="color-swatches">
                  {(tool === 'sticky' ? STICKY_COLORS : COLORS).map(
                    (swatch) => (
                      <button
                        key={swatch}
                        aria-label={`Color ${swatch}`}
                        className={`color-swatch ${(tool === 'sticky' ? stickyColor : color) === swatch ? 'swatch-selected' : ''}`}
                        style={{ background: swatch }}
                        onClick={() =>
                          tool === 'sticky'
                            ? setStickyColor(swatch)
                            : setColor(swatch)
                        }
                      />
                    ),
                  )}
                  {tool !== 'sticky' && (
                    <input
                      className="custom-color"
                      type="color"
                      aria-label="Custom color"
                      value={color.slice(0, 7)}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  )}
                </div>
              </div>
              {tool !== 'sticky' && (
                <div className="property-section">
                  <span className="property-label">Stroke</span>
                  <div className="stroke-options">
                    {[2, 3, 6, 12].map((width) => (
                      <button
                        key={width}
                        className={strokeWidth === width ? 'is-active' : ''}
                        aria-label={`Stroke ${width}px`}
                        onClick={() => setStrokeWidth(width)}
                      >
                        <span
                          style={{
                            height: Math.min(width, 10),
                            background: color,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="panel-tip">
                <span>✦</span>
                <p>
                  Scroll to pan, pinch or Ctrl/⌘ + scroll to zoom, hold Space to
                  drag the canvas. Double-click to write.
                </p>
              </div>
              <div className="panel-divider" />
              <div className="board-settings">
                <p className="eyebrow">BOARD</p>
                <div className="setting-row">
                  <span>People here</span>
                  <strong>{isLocal ? 1 : onlinePeople.length}</strong>
                </div>
                <div className="setting-row">
                  <span>Canvas items</span>
                  <strong>{objects.length}</strong>
                </div>
                {isLocal && (
                  <p className="local-board-note">
                    This board only lives in this tab. Export your work before
                    you leave.
                  </p>
                )}
                {board.role === 'owner' && !isLocal && (
                  <>
                    <button
                      className="setting-button"
                      onClick={() => void toggleLock()}
                    >
                      {board.locked
                        ? '▶ Resume editing for everyone'
                        : 'Ⅱ Pause editing for others'}
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
          <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>
            −
          </button>
          <button
            className="zoom-value"
            title="Reset to 100%"
            onClick={() => setView((current) => ({ ...current, zoom: 1 }))}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button aria-label="Zoom in" onClick={() => zoomAt(1.2)}>
            +
          </button>
          <button
            className="fit-button"
            onClick={() => fitTo(unionBounds(objects))}
          >
            Fit
          </button>
        </div>
        <div className="footer-right">
          <span className="footer-tool-status">
            {objects.length} {objects.length === 1 ? 'object' : 'objects'}
          </span>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            Shortcuts
          </button>
          <button
            className="properties-toggle"
            aria-expanded={propertiesOpen}
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            Style
          </button>
        </div>
      </footer>

      <nav className="mobile-toolbar" aria-label="Tools">
        {TOOLS.filter((item) =>
          [
            'select',
            'hand',
            'pen',
            'eraser',
            'rect',
            'arrow',
            'text',
            'sticky',
          ].includes(item.tool),
        ).map((item) => (
          <button
            key={item.tool}
            aria-label={item.label}
            aria-pressed={tool === item.tool}
            className={tool === item.tool ? 'mobile-tool-active' : ''}
            disabled={
              readonly && item.tool !== 'select' && item.tool !== 'hand'
            }
            onClick={() => chooseTool(item.tool)}
          >
            {item.icon}
          </button>
        ))}
        <button
          aria-label="Undo"
          disabled={!canUndo || readonly}
          onClick={undo}
        >
          ↶
        </button>
      </nav>

      {chatOpen && !isLocal && (
        <ChatPanel
          messages={messages}
          selfUserId={session.user.id}
          onlineCount={onlinePeople.length}
          typing={typing.map((item) => item.name)}
          disabled={status !== 'live'}
          onSend={sendChat}
          onTyping={() => clientRef.current?.sendTyping()}
          onClose={() => setChatOpen(false)}
        />
      )}

      {shareOpen && (
        <Modal onClose={() => setShareOpen(false)}>
          <p className="eyebrow">BRING PEOPLE IN</p>
          <h2>Share this board</h2>
          <p className="modal-copy">
            Anyone with this link can join as an editor and use chat and audio.
            You can switch people to view-only or pause editing at any time.
          </p>
          <div className="share-link-preview">
            {board.inviteToken && !board.inviteRevoked
              ? `${location.origin}/board/${board.id}?invite=${board.inviteToken}`
              : 'The invite link is turned off.'}
          </div>
          <div className="modal-actions">
            <button
              className="button subtle"
              onClick={() => void regenerateInvite()}
            >
              New link
            </button>
            <button
              className="button primary"
              onClick={() => void copyInvite()}
              disabled={!board.inviteToken || board.inviteRevoked}
            >
              Copy invite link
            </button>
          </div>
          <button
            className="revoke-link"
            onClick={() => void revokeInvite()}
            disabled={!board.inviteToken || board.inviteRevoked}
          >
            Turn off this link
          </button>
        </Modal>
      )}

      {membersOpen && (
        <Modal onClose={() => setMembersOpen(false)} className="members-modal">
          <p className="eyebrow">PARTICIPANTS</p>
          <h2>People on this board</h2>
          <div className="members-list">
            {board.members.map((member) => {
              const online = peers.find(
                (peer) => peer.userId === member.userId,
              );
              return (
                <div className="member-row" key={member.userId}>
                  <span
                    className="avatar"
                    style={{ background: colorFor(member.userId) }}
                  >
                    {member.name[0]?.toUpperCase()}
                  </span>
                  <div className="member-name">
                    <strong>
                      {member.name}
                      {member.userId === session.user.id ? ' (you)' : ''}
                    </strong>
                    <small className={online ? 'is-online' : ''}>
                      {online
                        ? online.inCall
                          ? 'Online · in audio'
                          : 'Online now'
                        : 'Offline'}
                    </small>
                  </div>
                  {member.role === 'owner' ? (
                    <span className="role-badge">Owner</span>
                  ) : board.role === 'owner' && !isLocal ? (
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
                      <option value="editor">Can edit</option>
                      <option value="viewer">Can view</option>
                    </select>
                  ) : (
                    <span className="role-badge">{member.role}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {snapshotsOpen && (
        <Modal
          onClose={() => setSnapshotsOpen(false)}
          className="snapshots-modal"
        >
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
              No versions yet. Save one before making a big change.
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button subtle"
              onClick={() => void saveSnapshot()}
            >
              Save current version
            </button>
          </div>
        </Modal>
      )}

      {helpOpen && (
        <Modal onClose={() => setHelpOpen(false)}>
          <p className="eyebrow">KEYBOARD</p>
          <h2>Shortcuts</h2>
          <dl className="shortcut-list">
            {TOOLS.filter((item) => item.key).map((item) => (
              <div key={item.tool}>
                <dt>{item.label}</dt>
                <dd>
                  <kbd>{item.key}</kbd>
                </dd>
              </div>
            ))}
            {[
              ['Pan the canvas', 'Space + drag · scroll'],
              ['Zoom', 'Ctrl/⌘ + scroll · pinch'],
              ['Fit to content', 'Shift 1'],
              ['Undo / redo', 'Ctrl/⌘ Z · Ctrl/⌘ Shift Z'],
              ['Copy / paste / duplicate', 'Ctrl/⌘ C · V · D'],
              ['Delete selection', 'Delete'],
              ['Nudge selection', 'Arrow keys (Shift ×10)'],
              ['Mute in a call', 'M'],
              ['Finish text', 'Esc · Ctrl/⌘ Enter'],
            ].map(([label, keys]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </main>
  );
}

function Modal({
  children,
  onClose,
  className = '',
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`modal ${className}`} role="dialog" aria-modal="true">
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
