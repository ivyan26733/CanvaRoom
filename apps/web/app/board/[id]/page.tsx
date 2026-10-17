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
  id,
  send,
  uploadImage,
  DEFAULT_PAGES,
  type Board,
  type BoardObject,
  type ChatMessage,
  type Operation,
  type Page,
  type Peer,
  type User,
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
  pageOf,
  round,
  STICKY_PADDING,
  unionBounds,
  type Bounds,
  type Point,
} from '../../lib/canvas';
import { dataUrl, exportBoard, prepareImage } from '../../lib/export';
import {
  RealtimeClient,
  type ConnectionStatus,
  type ServerMessage,
} from '../../lib/realtime';
import { AuthForm } from '../../components/auth-form';
import { Icon, Logo, type IconName } from '../../components/icons';
import { Modal } from '../../components/modal';
import { ThemeToggle } from '../../components/theme-toggle';
import { useDismiss, UserMenu } from '../../components/user-menu';
import { useAuth } from '../../lib/auth';
import { openUpgrade } from '../../lib/billing';
import { BOARD_NAV } from '../../lib/navigation';
import { BoardShape } from './board-shape';
import { CallControls } from './call-controls';
import { CanvasGuide } from './canvas-guide';
import { ChatPanel } from './chat-panel';
import { FollowChip, useFollow } from './follow';
import { InviteQr } from './invite-qr';
import {
  LocalOverlay,
  RemoteActivity,
  RemoteLayer,
  type LocalOverlayHandle,
} from './live-layers';
import { Minimap } from './minimap';
import { PagesPanel } from './pages-panel';
import { SessionRecorderControl } from './session-recorder';

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
  | { kind: 'erase'; erased: Set<string>; changes: Change[]; last: Point };
type TextEditor = { object: BoardObject; isNew: boolean };

const TOOLS: { tool: Tool; icon: IconName; label: string; key?: string }[] = [
  { tool: 'select', icon: 'select', label: 'Select', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
  { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker', key: 'K' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'diamond', icon: 'diamond', label: 'Diamond', key: 'D' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  { tool: 'sticky', icon: 'sticky', label: 'Sticky note', key: 'N' },
];
/** Where the dock draws dividers between tool groups. */
const DOCK_BREAKS = new Set<Tool>(['pen', 'rect', 'text']);
const TOOL_KEYS = Object.fromEntries(
  TOOLS.filter((item) => item.key).map((item) => [
    item.key!.toLowerCase(),
    item.tool,
  ]),
) as Record<string, Tool>;
const COLORS = [
  '#1b1b1b',
  '#ff4f1f',
  '#f5a623',
  '#12a150',
  '#2d5bff',
  '#7c4dff',
  '#e8458b',
  '#8a877f',
];
const STICKY_COLORS = ['#ffe45c', '#ffb4a2', '#9be7c4', '#a5c8ff', '#d7b8ff'];
const STROKES = [2, 4, 8, 14];
const PEER_COLORS = [
  '#ff4f1f',
  '#2d5bff',
  '#12a150',
  '#7c4dff',
  '#e8458b',
  '#f5a623',
];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const EMPTY_CALL: CallState = {
  joined: false,
  joining: false,
  muted: false,
  speaking: new Set(),
  connected: new Set(),
  needsTap: false,
  micPaused: false,
  error: '',
};

const LOCAL_USER: User = {
  id: 'local-user',
  name: 'You',
  color: '#ff4f1f',
  guest: true,
};

const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Records the current time in a ref, from event handlers. */
const stamp = (ref: { current: number }) => {
  ref.current = Date.now();
};
const newPageId = () => `pg${Math.random().toString(36).slice(2, 10)}`;

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

  // ---- Signed-in person and board ----
  const { user: authUser, setUser } = useAuth();
  // Local boards work without an account.
  const me: User | null | undefined = isLocal ? LOCAL_USER : authUser;
  const meId = me?.id;
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
  const [strokeWidth, setStrokeWidth] = useState(4);
  // New ink keeps the same on-screen size at any zoom, so zooming in gives
  // fine detail and zooming out gives bold overview strokes.
  const [inkFollowsZoom, setInkFollowsZoom] = useState(true);
  const [pageId, setPageId] = useState(search.get('page') ?? 'p1');
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
  // The empty-page guide fades for good once this person starts drawing.
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
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
  const pageViews = useRef(new Map<string, View>());
  const viewAnimation = useRef<number | undefined>(undefined);
  /** When this person last drew, erased, or typed, so following waits. */
  const lastLocalWrite = useRef(0);
  /** True while following moves the view, so it does not count as manual. */
  const followDriving = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, setMenuOpen, menuRef);
  useDismiss(zoomMenuOpen, setZoomMenuOpen, zoomMenuRef);
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

  // The owner's trial ended without a pass: the board turns view-only for
  // everyone, at the moment it ends rather than on the next reload.
  const accessUntil = board?.accessUntil;
  const [paywalled, setPaywalled] = useState(false);
  useEffect(() => {
    if (accessUntil === undefined) return setPaywalled(false);
    const left =
      accessUntil === null ? 0 : Date.parse(accessUntil) - Date.now();
    setPaywalled(left <= 0);
    if (left <= 0) return;
    // setTimeout caps at about 24.8 days; a longer pass is rechecked later.
    const timer = window.setTimeout(
      () => setPaywalled(Date.parse(accessUntil!) <= Date.now()),
      Math.min(left + 500, 2 ** 31 - 1),
    );
    return () => window.clearTimeout(timer);
  }, [accessUntil]);
  const readonly =
    !board || board.role === 'viewer' || board.locked || paywalled;
  const inviteLink =
    board?.inviteToken && !board.inviteRevoked && typeof window !== 'undefined'
      ? `${location.origin}/board/${board.id}?invite=${encodeURIComponent(board.inviteToken)}`
      : null;
  const pages: Page[] = board?.pages?.length ? board.pages : DEFAULT_PAGES;
  const currentPage = pages.find((page) => page.id === pageId) ?? pages[0]!;
  const pageObjects = useMemo(
    () => objects.filter((item) => pageOf(item, pages) === currentPage.id),
    [objects, pages, currentPage.id],
  );
  const pageObjectsRef = useRef<BoardObject[]>([]);
  const selectedObjects = useMemo(
    () => pageObjects.filter((item) => selected.includes(item.id)),
    [pageObjects, selected],
  );
  const selectedObject =
    selectedObjects.length === 1 ? selectedObjects[0] : undefined;
  const onlinePeople = useMemo(() => {
    // Someone with several tabs counts as here if any of them is in front.
    const byUser = new Map<string, Peer>();
    for (const peer of peers) {
      const known = byUser.get(peer.userId);
      if (!known || (known.away && !peer.away)) byUser.set(peer.userId, peer);
    }
    return [...byUser.values()];
  }, [peers]);

  useLayoutEffect(() => {
    objectsRef.current = objects;
  }, [objects]);
  useLayoutEffect(() => {
    pageObjectsRef.current = pageObjects;
  }, [pageObjects]);

  // Someone deleted the page this tab was on.
  useEffect(() => {
    if (board && currentPage.id !== pageId) setPageId(currentPage.id);
  }, [board, currentPage.id, pageId]);

  // Panels that only fit on wide screens start open there.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1100px)').matches;
    setPagesOpen(wide);
    setMinimapOpen(wide);
  }, []);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => () => remote.dispose(), [remote]);

  // ---- Board access (and joining through an invite link) ----
  useEffect(() => {
    if (!meId) return;
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
        pages: DEFAULT_PAGES,
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
        if (invite) {
          const page = search.get('page');
          window.history.replaceState(
            null,
            '',
            `/board/${boardId}${page ? `?page=${encodeURIComponent(page)}` : ''}`,
          );
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
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
  }, [meId, boardId, isLocal]);

  // ---- Realtime connection ----
  // Remote edits are applied once per frame, so a burst (a fast eraser
  // swipe, a pasted group) re-renders the board once instead of per edit.
  const remoteOperations = useRef<Operation[]>([]);
  const remoteFlush = useRef<number | undefined>(undefined);
  const flushRemoteOperations = useCallback(() => {
    remoteFlush.current = undefined;
    const operations = remoteOperations.current;
    remoteOperations.current = [];
    if (operations.length)
      setObjects((current) => applyOperations(current, operations));
  }, []);
  function queueRemoteOperation(op: Operation) {
    remoteOperations.current.push(op);
    if (remoteFlush.current !== undefined) return;
    // Hidden tabs get no animation frames.
    remoteFlush.current = document.hidden
      ? window.setTimeout(flushRemoteOperations, 30)
      : requestAnimationFrame(flushRemoteOperations);
  }

  const onServerMessage = useEffectEvent((message: ServerMessage) => {
    const client = clientRef.current;
    switch (message.t) {
      case 'welcome': {
        flushRemoteOperations();
        setSelfPeerId(message.self.peerId);
        setBoard(message.board);
        // Drafts of objects the snapshot already has are finished; the rest
        // are still being drawn and keep updating.
        remote.forget(message.objects.map((item) => item.id));
        setObjects(
          applyOperations(
            applyOperations(message.objects, client?.recentOperations ?? []),
            client?.pendingOperations ?? [],
          ),
        );
        setMessages((current) => [
          ...message.messages,
          ...current.filter((item) => item.pending),
        ]);
        setPeers(message.peers);
        // Anything still being drawn, moved, or typed was not seen by peers
        // that joined (or rejoined) while this tab was reconnecting.
        const current = gesture.current;
        const inProgress =
          current?.kind === 'draw' || current?.kind === 'shape'
            ? [current.object]
            : current?.kind === 'move'
              ? current.moved
              : current?.kind === 'resize'
                ? [current.moved]
                : [];
        if (editorRef.current) inProgress.push(editorRef.current.object);
        if (inProgress.length) client?.liveUpsert(inProgress);
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
        queueRemoteOperation(op);
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
        if (chat.userId !== me?.id) {
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
        callRef.current?.handleSignal(message.from, message.data);
        return;
      case 'board':
        setBoard(message.board);
        return;
      case 'reset':
        remoteOperations.current = [];
        remote.clear();
        setObjects(message.objects);
        setSelected([]);
        history.current = [];
        redoStack.current = [];
        setCanUndo(false);
        setCanRedo(false);
        return;
      case 'deleted':
        router.push('/', BOARD_NAV);
        return;
      case 'error':
        if (message.fatal) setLoadError(message.message);
        else setNotice(message.message);
        return;
    }
  });

  const boardReady = board !== null;
  useEffect(() => {
    if (!me || !boardReady || isLocal) return;
    const client = new RealtimeClient(boardId, me.id, me.color, {
      onMessage: (message) => onServerMessage(message),
      onStatus: setStatus,
      onPending: setPending,
      isBusy: () => gesture.current !== null || editorRef.current !== null,
    });
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
    // Reconnect only when the person changes, not when their profile does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, boardReady, boardId, isLocal]);

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

  /** Moves the camera, easing into place unless `animate` is false. */
  const moveView = useCallback(
    (target: View, animate = true, duration = 220) => {
      if (viewAnimation.current !== undefined)
        cancelAnimationFrame(viewAnimation.current);
      viewAnimation.current = undefined;
      const from = viewRef.current;
      if (
        !animate ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        setView(target);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = easeOut(Math.min(1, (now - start) / duration));
        // Zoom eases geometrically so the motion feels even at every scale.
        const zoom = from.zoom * (target.zoom / from.zoom) ** t;
        // Keep the screen centre on a straight path between the two views.
        const cx =
          from.x +
          size.width / from.zoom / 2 +
          (target.x +
            size.width / target.zoom / 2 -
            (from.x + size.width / from.zoom / 2)) *
            t;
        const cy =
          from.y +
          size.height / from.zoom / 2 +
          (target.y +
            size.height / target.zoom / 2 -
            (from.y + size.height / from.zoom / 2)) *
            t;
        setView({
          x: cx - size.width / zoom / 2,
          y: cy - size.height / zoom / 2,
          zoom,
        });
        viewAnimation.current = t < 1 ? requestAnimationFrame(step) : undefined;
      };
      viewAnimation.current = requestAnimationFrame(step);
    },
    [size],
  );

  const fitTo = useCallback(
    (bounds: Bounds | null, animate = true) => {
      if (!bounds) {
        moveView({ x: -size.width / 2, y: -size.height / 2, zoom: 1 }, animate);
        return;
      }
      const padding = Math.min(120, size.width * 0.08 + 40);
      const zoom = clampZoom(
        Math.min(
          1.5,
          (size.width - padding * 2) / Math.max(bounds.width, 1),
          (size.height - padding * 2) / Math.max(bounds.height, 1),
        ),
      );
      moveView(
        {
          x: bounds.x + bounds.width / 2 - size.width / zoom / 2,
          y: bounds.y + bounds.height / 2 - size.height / zoom / 2,
          zoom,
        },
        animate,
      );
    },
    [size, moveView],
  );

  // ---- Following whoever is writing ----
  const follow = useFollow({
    remote,
    enabled: !isLocal && boardReady,
    pageId: currentPage.id,
    pages,
    viewRef,
    size,
    moveView: (target, duration) => {
      followDriving.current = true;
      moveView(target, true, duration);
      followDriving.current = false;
    },
    goToPage: (target) => {
      followDriving.current = true;
      switchPage(target);
      followDriving.current = false;
    },
    isBusy: () =>
      gesture.current !== null ||
      editorRef.current !== null ||
      pointers.current.size > 0,
    lastLocalWrite,
  });
  const { noteManualView } = follow;
  /** Panning, zooming, or changing page by hand pauses following. */
  function markManualView() {
    if (!followDriving.current) noteManualView();
  }

  // Frame the content the first time the board appears.
  useEffect(() => {
    if (fittedOnce.current || size.width <= 1 || !boardReady) return;
    if (!isLocal && status !== 'live') return;
    fittedOnce.current = true;
    fitTo(unionBounds(pageObjects), false);
  }, [size, boardReady, status, isLocal, pageObjects, fitTo]);

  /** Zooms around the screen centre, keeping what is in the middle in place. */
  function zoomTo(zoom: number) {
    markManualView();
    const current = viewRef.current;
    const next = clampZoom(zoom);
    const cx = current.x + size.width / current.zoom / 2;
    const cy = current.y + size.height / current.zoom / 2;
    moveView({
      x: cx - size.width / next / 2,
      y: cy - size.height / next / 2,
      zoom: next,
    });
  }

  function zoomAt(factor: number) {
    zoomTo(viewRef.current.zoom * factor);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      noteManualView();
      if (viewAnimation.current !== undefined) {
        cancelAnimationFrame(viewAnimation.current);
        viewAnimation.current = undefined;
      }
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
  }, [boardReady, noteManualView]);

  /** The part of the canvas on screen, for people following this writer. */
  function visibleArea(): [number, number, number, number] {
    const current = viewRef.current;
    return [
      round(current.x),
      round(current.y),
      round(size.width / current.zoom),
      round(size.height / current.zoom),
    ];
  }

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
    if (!operations.length) return changes;
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
    return changes;
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

  function deleteObjects(ids: string[]) {
    if (readonly || !ids.length) return;
    perform(ids.map((objectId) => ({ type: 'delete', objectId })));
    setSelected((current) => current.filter((item) => !ids.includes(item)));
  }

  function pasteObjects(sources: BoardObject[], offset = 24) {
    if (readonly || !sources.length) return;
    const step = offset / viewRef.current.zoom;
    const copies = sources.map((item) => ({
      ...item,
      id: id(),
      x: round(item.x + step),
      y: round(item.y + step),
      page: currentPage.id,
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

  /** Converts an on-screen size to canvas units for new objects. */
  function screenSize(value: number, min: number, max: number) {
    const zoom = inkFollowsZoom ? viewRef.current.zoom : 1;
    return round(clamp(value / zoom, min, max));
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
      strokeWidth: screenSize(strokeWidth, 0.5, 160),
      page: currentPage.id,
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

  function newText(point: Point) {
    const fontSize = screenSize(28, 8, 160);
    return newObject(
      'text',
      { x: point.x, y: point.y - fontSize * 0.6 },
      { text: '', fontSize },
    );
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
    if (current?.kind === 'erase') finishErase(current);
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

  /**
   * Erases along the pointer's path since the last sample, so a fast swipe
   * misses nothing. Each object is deleted the moment it is touched, so
   * everyone watching sees the eraser work live; undo still restores the
   * whole swipe in one step.
   */
  function eraseTo(clientX: number, clientY: number) {
    const current = gesture.current;
    if (current?.kind !== 'erase') return;
    const { last } = current;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(clientX - last.x, clientY - last.y) / 6),
    );
    const hits: string[] = [];
    for (let step = 1; step <= steps; step++) {
      const oid = objectIdAt(
        last.x + ((clientX - last.x) * step) / steps,
        last.y + ((clientY - last.y) * step) / steps,
      );
      if (!oid || current.erased.has(oid)) continue;
      current.erased.add(oid);
      hits.push(oid);
    }
    current.last = { x: clientX, y: clientY };
    if (!hits.length) return;
    current.changes.push(
      ...perform(
        hits.map((objectId) => ({ type: 'delete', objectId })),
        { record: false },
      ),
    );
    setSelected((selection) =>
      selection.some((item) => current.erased.has(item))
        ? selection.filter((item) => !current.erased.has(item))
        : selection,
    );
  }

  function finishErase(current: Extract<Gesture, { kind: 'erase' }>) {
    if (!current.changes.length) return;
    history.current.push(current.changes);
    if (history.current.length > 200) history.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
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
      markManualView();
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
      markManualView();
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
    if (tool !== 'select') {
      setGuideDismissed(true);
      stamp(lastLocalWrite);
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
          const originals = pageObjectsRef.current.filter((item) =>
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
        gesture.current = {
          kind: 'erase',
          erased: new Set(),
          changes: [],
          last: { x: event.clientX, y: event.clientY },
        };
        eraseTo(event.clientX, event.clientY);
        return;
      case 'pen':
      case 'highlighter': {
        const highlighter = tool === 'highlighter';
        const object = newObject('path', point, {
          points: [0, 0],
          color: highlighter ? `${color.slice(0, 7)}66` : color,
          strokeWidth: screenSize(
            highlighter ? Math.max(12, strokeWidth * 4) : strokeWidth,
            0.5,
            160,
          ),
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
        return openText(newText(point), true);
      }
      case 'sticky': {
        const side = screenSize(200, 40, 4000);
        return openText(
          newObject(
            'sticky',
            { x: point.x - side / 2, y: point.y - side / 2 },
            {
              width: side,
              height: side,
              text: '',
              color: stickyColor,
              strokeWidth: 1,
              fontSize: screenSize(18, 8, 160),
            },
          ),
          true,
        );
      }
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
    const writing =
      current?.kind === 'draw' ||
      current?.kind === 'shape' ||
      current?.kind === 'erase';
    if (writing) stamp(lastLocalWrite);
    clientRef.current?.liveCursor({
      x: round(point.x),
      y: round(point.y),
      page: currentPage.id,
      ...(writing ? { active: true, view: visibleArea() } : {}),
    });
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
        const hits = pageObjectsRef.current
          .filter((item) => intersects(box, objectBounds(item)))
          .map((item) => item.id);
        setSelected([...new Set([...current.base, ...hits])]);
        return;
      }
      case 'erase': {
        if (!event.buttons) return;
        const samples =
          typeof event.nativeEvent.getCoalescedEvents === 'function'
            ? event.nativeEvent.getCoalescedEvents()
            : [];
        for (const sample of samples.length ? samples : [event.nativeEvent])
          eraseTo(sample.clientX, sample.clientY);
        return;
      }
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
        if (tiny) {
          const width = screenSize(120, 16, 20_000);
          const height = screenSize(80, 16, 20_000);
          object = {
            ...object,
            x: round(object.x - width / 2),
            y: round(object.y - height / 2),
            width,
            height,
          };
        }
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
        finishErase(current);
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
    if (!oid) openText(newText(toWorld(event.clientX, event.clientY)), true);
  }

  // ---- Pages ----
  function switchPage(target: string) {
    if (target === currentPage.id) return;
    markManualView();
    finishText();
    cancelGesture();
    setSelected([]);
    pageViews.current.set(currentPage.id, viewRef.current);
    setPageId(target);
    clientRef.current?.liveCursor(null);
    const url = new URL(location.href);
    if (target === pages[0]!.id) url.searchParams.delete('page');
    else url.searchParams.set('page', target);
    window.history.replaceState(null, '', url);
    const saved = pageViews.current.get(target);
    if (saved) moveView(saved, false);
    else
      fitTo(
        unionBounds(
          objectsRef.current.filter((item) => pageOf(item, pages) === target),
        ),
        false,
      );
  }

  /** Applies a page change locally, then confirms it with the server. */
  async function changePages(
    next: Page[],
    request?: () => Promise<{ pages: Page[] }>,
  ) {
    if (!board) return;
    const previous = board.pages;
    setBoard({ ...board, pages: next });
    if (!request) return;
    try {
      const result = await request();
      setBoard((current) =>
        current ? { ...current, pages: result.pages } : current,
      );
    } catch (error) {
      setBoard((current) =>
        current ? { ...current, pages: previous } : current,
      );
      setNotice((error as Error).message);
    }
  }

  function uniquePageName(base: string) {
    const names = new Set(pages.map((page) => page.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index++;
    return `${base} ${index}`;
  }

  function addPage(duplicateOf?: Page) {
    if (readonly) return;
    const page = {
      id: newPageId(),
      name: duplicateOf
        ? uniquePageName(`${duplicateOf.name} copy`.slice(0, 54))
        : uniquePageName(`Page ${pages.length + 1}`),
    };
    const next = [...pages];
    const at = duplicateOf
      ? pages.findIndex((item) => item.id === duplicateOf.id) + 1
      : pages.length;
    next.splice(at, 0, page);
    if (isLocal) {
      void changePages(next);
      if (duplicateOf) {
        const copies = objectsRef.current
          .filter((item) => pageOf(item, pages) === duplicateOf.id)
          .map((item) => ({ ...item, id: id(), page: page.id }));
        perform(
          copies.map((object) => ({
            type: 'create',
            objectId: object.id,
            object,
          })),
          { record: false },
        );
      }
    } else
      void changePages(next, () =>
        send(`/boards/${boardId}/pages`, 'POST', {
          ...page,
          ...(duplicateOf ? { duplicateOf: duplicateOf.id } : {}),
        }),
      );
    pageViews.current.set(currentPage.id, viewRef.current);
    if (duplicateOf) pageViews.current.set(page.id, viewRef.current);
    setSelected([]);
    setPageId(page.id);
    const url = new URL(location.href);
    url.searchParams.set('page', page.id);
    window.history.replaceState(null, '', url);
    if (!duplicateOf)
      moveView({ x: -size.width / 2, y: -size.height / 2, zoom: 1 }, false);
  }

  function renamePage(page: Page, name: string) {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed || trimmed === page.name || readonly) return;
    const next = pages.map((item) =>
      item.id === page.id ? { ...item, name: trimmed } : item,
    );
    void changePages(
      next,
      isLocal
        ? undefined
        : () =>
            send(`/boards/${boardId}/pages/${page.id}`, 'PATCH', {
              name: trimmed,
            }),
    );
  }

  function deletePage(page: Page) {
    if (readonly || pages.length < 2) return;
    const count = objectsRef.current.filter(
      (item) => pageOf(item, pages) === page.id,
    ).length;
    if (
      count &&
      !window.confirm(
        `Delete “${page.name}” and its ${count} ${count === 1 ? 'item' : 'items'} for everyone?`,
      )
    )
      return;
    const index = pages.findIndex((item) => item.id === page.id);
    const next = pages.filter((item) => item.id !== page.id);
    if (page.id === currentPage.id)
      switchPage((pages[index + 1] ?? pages[index - 1])!.id);
    if (isLocal) {
      perform(
        objectsRef.current
          .filter((item) => pageOf(item, pages) === page.id)
          .map((item) => ({ type: 'delete', objectId: item.id })),
        { record: false },
      );
      void changePages(next);
    } else
      void changePages(next, () =>
        send(`/boards/${boardId}/pages/${page.id}`, 'DELETE'),
      );
  }

  function movePage(page: Page, offset: number) {
    const index = pages.findIndex((item) => item.id === page.id);
    const target = index + offset;
    if (readonly || target < 0 || target >= pages.length) return;
    const next = [...pages];
    next.splice(index, 1);
    next.splice(target, 0, page);
    void changePages(
      next,
      isLocal
        ? undefined
        : () =>
            send(`/boards/${boardId}/pages/order`, 'PUT', {
              ids: next.map((item) => item.id),
            }),
    );
  }

  function moveSelectionTo(target: string) {
    if (readonly || target === currentPage.id) return;
    const name = pages.find((page) => page.id === target)?.name;
    updateSelected({ page: target });
    setSelected([]);
    setNotice(`Moved to ${name}.`);
  }

  // ---- History ----
  /** Shows the page a history step touches, so undo never acts out of sight. */
  function revealChange(entry: Change[]) {
    const change = entry[0];
    const object = change?.before ?? change?.after;
    if (!object) return;
    const target = pageOf(object, pages);
    if (target !== currentPage.id) switchPage(target);
  }

  function undo() {
    if (readonly) return;
    const entry = history.current.pop();
    if (!entry) return;
    revealChange(entry);
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
    revealChange(entry);
    history.current.push(entry);
    restore(entry, 'after');
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }

  // ---- Keyboard ----
  function chooseTool(next: Tool) {
    cancelGesture();
    setTool(next);
    if (next !== 'select') setSelected([]);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (shareOpen || membersOpen || snapshotsOpen || helpOpen) {
        setShareOpen(false);
        setMembersOpen(false);
        setSnapshotsOpen(false);
        setHelpOpen(false);
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
      setSelected(pageObjectsRef.current.map((item) => item.id));
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
      zoomAt(ZOOM_STEP);
    } else if (modifier && key === '-') {
      event.preventDefault();
      zoomAt(1 / ZOOM_STEP);
    } else if (modifier && key === '0') {
      event.preventDefault();
      zoomTo(1);
    } else if (event.shiftKey && (key === '1' || key === '!')) {
      markManualView();
      fitTo(unionBounds(pageObjectsRef.current));
    } else if (event.shiftKey && (key === '2' || key === '@')) {
      markManualView();
      fitTo(
        unionBounds(
          selectedObjects.length ? selectedObjects : pageObjectsRef.current,
        ),
      );
    } else if (key === 'pagedown' || key === 'pageup') {
      event.preventDefault();
      const index = pages.findIndex((page) => page.id === currentPage.id);
      const next = pages[index + (key === 'pagedown' ? 1 : -1)];
      if (next) switchPage(next.id);
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
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice(
        'Invite link copied. Anyone with the link can join as an editor.',
      );
    } catch {
      setNotice(inviteLink);
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
      // A 402 opens the upgrade dialog instead.
      if ((error as ApiError).code !== 'payment_required')
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
    if (!client || !me) return;
    const clientId = id();
    if (!client.sendChat(clientId, text)) {
      setNotice('You are offline. Your message was not sent.');
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: clientId,
        userId: me.id,
        name: me.name,
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
      // Boards kept only in this browser have nowhere to upload to.
      const src = isLocal
        ? await dataUrl(image.blob)
        : (await uploadImage(boardId, image.blob)).src;
      const scale =
        Math.min(1, 520 / image.width, 380 / image.height) /
        viewRef.current.zoom;
      const width = round(image.width * scale);
      const height = round(image.height * scale);
      const object = newObject(
        'image',
        {
          x: view.x + size.width / view.zoom / 2 - width / 2,
          y: view.y + size.height / view.zoom / 2 - height / 2,
        },
        { width, height, src },
      );
      perform([{ type: 'create', objectId: object.id, object }]);
      setTool('select');
      setSelected([object.id]);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function doExport(format: 'png' | 'pdf' | 'svg') {
    setMenuOpen(false);
    if (!board || !objectLayerRef.current) return;
    try {
      await exportBoard(
        objectLayerRef.current,
        pageObjectsRef.current,
        pages.length > 1 ? `${board.title} - ${currentPage.name}` : board.title,
        format,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  // ---- Render ----
  if (me === undefined)
    return (
      <main className="page-loading">
        <span className="loader" />
      </main>
    );

  if (!me)
    return (
      <main className="board-gate">
        <Link className="brand" href="/">
          <Logo />
          <span>CanvaRoom</span>
        </Link>
        <div className="gate-card">
          <span className="gate-icon">
            <Icon name={search.get('invite') ? 'users' : 'lock'} size={22} />
          </span>
          <h1>
            {search.get('invite')
              ? 'You’re invited to a board.'
              : 'Sign in to open this board.'}
          </h1>
          <p>
            {search.get('invite')
              ? 'Join as a guest to start drawing right away, or sign in to keep it in your boards.'
              : 'Boards are saved to your account.'}
          </p>
          <AuthForm
            initialMode={search.get('invite') ? 'guest' : 'login'}
            allowGuest={Boolean(search.get('invite'))}
          />
        </div>
      </main>
    );

  if (!board)
    return (
      <main className="page-loading">
        {!loadError && <span className="loader" />}
        <p>{loadError || 'Opening your board…'}</p>
        {loadError && (
          <Link
            className="button ghost"
            href="/"
            transitionTypes={BOARD_NAV.transitionTypes}
          >
            Back to boards
          </Link>
        )}
      </main>
    );

  const scale = 1 / view.zoom;
  const saveLabel = isLocal
    ? 'Scratch · not saved'
    : status === 'offline'
      ? pending
        ? `Offline · ${pending} unsynced`
        : 'Reconnecting…'
      : status === 'connecting'
        ? 'Connecting…'
        : pending
          ? 'Saving…'
          : 'Saved';
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
  const otherPeople = onlinePeople.filter((peer) => peer.userId !== me.id);
  const othersHere = otherPeople.filter((peer) => !peer.away);
  const drawingTool = !['select', 'hand', 'eraser'].includes(tool);
  const showStyle = drawingTool && !readonly && !selectedObjects.length;
  const zoomPercent = Math.round(view.zoom * 100);
  const gridStep = view.zoom < 0.5 ? 96 : view.zoom < 2 ? 24 : 12;
  const leave = (event: React.MouseEvent) => {
    if (
      isLocal &&
      objects.length &&
      !window.confirm('This scratch board is not saved. Leave it?')
    )
      event.preventDefault();
  };

  return (
    <main
      className={`editor ${pagesOpen ? 'pages-open' : ''} ${chatOpen && !isLocal ? 'chat-open' : ''}`}
    >
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
              width={gridStep}
              height={gridStep}
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx={gridStep / 2}
                cy={gridStep / 2}
                r={1.15 * scale}
                className="grid-dot"
              />
            </pattern>
          </defs>
          <rect
            className="stage-grid"
            x={view.x}
            y={view.y}
            width={size.width / view.zoom}
            height={size.height / view.zoom}
            fill={view.zoom > 0.15 ? 'url(#dot-grid)' : 'transparent'}
          />
          {textEditor && !textEditor.isNew && (
            <style>{`[data-oid="${CSS.escape(textEditor.object.id)}"]{visibility:hidden}`}</style>
          )}
          <g ref={objectLayerRef} className="objects-layer">
            {pageObjects.map((item) => {
              const isSelected = selected.includes(item.id);
              return (
                <BoardShape
                  key={item.id}
                  item={item}
                  selected={isSelected}
                  scale={isSelected ? scale : 1}
                  showHandle={isSelected && selected.length === 1 && !readonly}
                />
              );
            })}
          </g>
          <RemoteLayer
            activity={remote}
            peers={peers}
            zoom={view.zoom}
            page={currentPage.id}
            pages={pages}
          />
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
                editorObject.kind === 'sticky' ? '#22201c' : editorObject.color,
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
              stamp(lastLocalWrite);
              const bounds = objectBounds(object);
              clientRef.current?.liveUpsert([object]);
              clientRef.current?.liveCursor({
                x: round(bounds.x + bounds.width),
                y: round(bounds.y + bounds.height),
                page: currentPage.id,
                active: true,
                view: visibleArea(),
              });
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

        {pageObjects.length === 0 &&
          (readonly ? (
            <div className="canvas-empty-hint">
              <p>Nothing on this page yet.</p>
              <small>
                {isLocal
                  ? 'Scratch boards live only in this tab.'
                  : 'Everyone here sees each stroke as it is drawn.'}
              </small>
            </div>
          ) : (
            <CanvasGuide
              tools={TOOLS}
              hidden={
                guideDismissed || Boolean(textEditor) || Boolean(follow.focus)
              }
              isLocal={isLocal}
              canShare={board.role === 'owner' && !isLocal}
            />
          ))}
      </div>

      {/* ---- Top left: board identity ---- */}
      <header className="island island-board">
        <Link
          href="/"
          transitionTypes={BOARD_NAV.transitionTypes}
          className="island-logo"
          onClick={leave}
          title="All boards"
        >
          <Logo size={26} />
        </Link>
        <span className="island-sep" />
        <button
          className={`icon-button ${pagesOpen ? 'is-active' : ''}`}
          aria-label="Pages"
          aria-pressed={pagesOpen}
          title="Pages"
          onClick={() => setPagesOpen((open) => !open)}
        >
          <Icon name="pages" />
        </button>
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
          <span className="board-subtitle">
            {pages.length > 1 && (
              <>
                <span className="page-crumb">{currentPage.name}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="save-indicator" aria-live="polite">
              <span
                className={`status-dot ${isLocal ? 'local' : status === 'live' && pending ? 'saving' : status}`}
              />
              {saveLabel}
            </span>
          </span>
        </div>
      </header>

      {/* ---- Top right: people, call, chat, share ---- */}
      <div className="island island-people">
        {!isLocal && (
          <>
            <button
              className="participant-stack"
              title="People on this board"
              onClick={() => setMembersOpen(true)}
            >
              {onlinePeople.slice(0, 4).map((peer) => (
                <span
                  key={peer.userId}
                  className={`avatar ${peer.away ? 'is-away' : ''}`}
                  style={{ background: peer.color }}
                  title={
                    peer.userId === me.id
                      ? 'You'
                      : `${peer.name}${peer.away ? ' · away' : ''}`
                  }
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
              className={`icon-button chat-toggle ${chatOpen ? 'is-active' : ''}`}
              onClick={() => {
                setChatOpen((open) => !open);
                setUnread(0);
              }}
              aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
              title="Chat"
            >
              <Icon name="chat" />
              {unread > 0 && !chatOpen && (
                <span className="unread-badge">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </>
        )}
        {board.role === 'owner' && !isLocal && (
          <button
            className="button primary small share-button"
            onClick={() => setShareOpen(true)}
          >
            <Icon name="share" size={16} />
            <span>Share</span>
          </button>
        )}
        <SessionRecorderControl
          stageRef={stageRef}
          title={board.title}
          hasCall={!isLocal}
          callStreams={() => callRef.current?.remoteStreams() ?? []}
          callMicrophone={() => callRef.current?.microphoneStream() ?? null}
          onNotice={setNotice}
        />
        <div className="menu-anchor" ref={menuRef}>
          <button
            className={`icon-button ${menuOpen ? 'is-active' : ''}`}
            aria-label="Board menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="popover board-menu" role="menu">
              <p className="menu-label">
                Export {pages.length > 1 ? 'this page' : ''}
              </p>
              <button
                className="menu-row"
                role="menuitem"
                onClick={() => void doExport('png')}
              >
                <Icon name="image" />
                <span>PNG image</span>
              </button>
              <button
                className="menu-row"
                role="menuitem"
                onClick={() => void doExport('svg')}
              >
                <Icon name="download" />
                <span>SVG vector</span>
              </button>
              <button
                className="menu-row"
                role="menuitem"
                onClick={() => void doExport('pdf')}
              >
                <Icon name="download" />
                <span>PDF document</span>
              </button>
              {!isLocal && board.role !== 'viewer' && (
                <>
                  <div className="menu-divider" />
                  <button
                    className="menu-row"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void saveSnapshot();
                    }}
                  >
                    <Icon name="save" />
                    <span>Save a version</span>
                  </button>
                  <button
                    className="menu-row"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void openSnapshots();
                    }}
                  >
                    <Icon name="history" />
                    <span>Version history</span>
                  </button>
                </>
              )}
              {!isLocal && (
                <button
                  className="menu-row"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setMembersOpen(true);
                  }}
                >
                  <Icon name="users" />
                  <span>Participants</span>
                  <span className="menu-row-hint">{board.members.length}</span>
                </button>
              )}
              {board.role === 'owner' && !isLocal && (
                <button
                  className="menu-row"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void toggleLock();
                  }}
                >
                  <Icon name={board.locked ? 'unlock' : 'lock'} />
                  <span>
                    {board.locked
                      ? 'Resume editing for all'
                      : 'Pause editing for all'}
                  </span>
                </button>
              )}
              <div className="menu-divider" />
              <button
                className="menu-row"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setHelpOpen(true);
                }}
              >
                <Icon name="keyboard" />
                <span>Keyboard shortcuts</span>
                <span className="menu-row-hint">?</span>
              </button>
              <ThemeToggle withLabel />
              <Link
                className="menu-row"
                role="menuitem"
                href="/"
                transitionTypes={BOARD_NAV.transitionTypes}
                onClick={leave}
              >
                <Icon name="home" />
                <span>All boards</span>
              </Link>
            </div>
          )}
        </div>
        {!isLocal && <UserMenu />}
      </div>

      {/* ---- Banners and toasts ---- */}
      <div className="canvas-messages">
        {readonly && (
          <div className="banner">
            <Icon name="lock" size={15} />
            {board.role === 'viewer'
              ? 'You have view-only access.'
              : paywalled && board.role === 'owner'
                ? 'Your free trial has ended, so this board is view-only. You can still export it.'
                : paywalled
                  ? 'This board is view-only until its owner upgrades.'
                  : 'Editing is paused by the board owner.'}
            {paywalled && board.role === 'owner' && (
              <button className="banner-action" onClick={openUpgrade}>
                Upgrade
              </button>
            )}
          </div>
        )}
        {!isLocal && status === 'offline' && (
          <div className="banner warn" role="status">
            Connection lost — reconnecting. Your edits are kept and will sync.
          </div>
        )}
        {!isLocal && (
          <FollowChip
            focus={follow.focus}
            mode={follow.mode}
            peers={peers}
            pages={pages}
            pageId={currentPage.id}
            onResume={follow.resume}
            onStop={follow.stop}
            onGo={switchPage}
          />
        )}
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss" onClick={() => setNotice('')}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
      </div>

      {pagesOpen && (
        <PagesPanel
          pages={pages}
          current={currentPage.id}
          objects={objects}
          activity={remote}
          peers={
            otherPeople.length
              ? peers.filter((peer) => peer.userId !== me.id)
              : []
          }
          readonly={readonly}
          onSelect={switchPage}
          onAdd={() => addPage()}
          onDuplicate={(page) => addPage(page)}
          onRename={renamePage}
          onDelete={deletePage}
          onMove={movePage}
          onClose={() => setPagesOpen(false)}
        />
      )}

      {/* ---- Bottom centre: tools ---- */}
      <div className="dock-wrap">
        {showStyle && (
          <div className="style-strip" aria-label="Style">
            <div className="swatch-row">
              {(tool === 'sticky' ? STICKY_COLORS : COLORS).map((swatch) => (
                <button
                  key={swatch}
                  aria-label={`Colour ${swatch}`}
                  aria-pressed={
                    (tool === 'sticky' ? stickyColor : color) === swatch
                  }
                  className="swatch"
                  style={{ '--swatch': swatch } as React.CSSProperties}
                  onClick={() =>
                    tool === 'sticky'
                      ? setStickyColor(swatch)
                      : setColor(swatch)
                  }
                />
              ))}
              {tool !== 'sticky' && (
                <label className="swatch custom" title="Custom colour">
                  <input
                    type="color"
                    aria-label="Custom colour"
                    value={color.slice(0, 7)}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </label>
              )}
            </div>
            {tool !== 'sticky' && tool !== 'text' && (
              <>
                <span className="strip-sep" />
                <div className="stroke-row">
                  {STROKES.map((width) => (
                    <button
                      key={width}
                      aria-label={`Stroke ${width}`}
                      aria-pressed={strokeWidth === width}
                      onClick={() => setStrokeWidth(width)}
                    >
                      <span
                        style={{
                          width: Math.max(4, width + 2),
                          height: Math.max(4, width + 2),
                          background: color,
                        }}
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <nav className="dock" aria-label="Drawing tools">
          {TOOLS.map((item) => (
            <div key={item.tool} className="dock-slot">
              {DOCK_BREAKS.has(item.tool) && <span className="dock-sep" />}
              <button
                className={`dock-tool ${tool === item.tool ? 'is-active' : ''}`}
                onClick={() => chooseTool(item.tool)}
                aria-pressed={tool === item.tool}
                aria-label={item.label}
                data-tip={`${item.label}${item.key ? ` · ${item.key}` : ''}`}
                disabled={
                  readonly && item.tool !== 'select' && item.tool !== 'hand'
                }
              >
                <Icon name={item.icon} size={20} />
                {item.key && <kbd>{item.key}</kbd>}
              </button>
            </div>
          ))}
          <span className="dock-sep" />
          <button
            className="dock-tool"
            onClick={() => imagePicker.current?.click()}
            aria-label="Add an image"
            data-tip="Image"
            disabled={readonly}
          >
            <Icon name="image" size={20} />
          </button>
        </nav>
      </div>

      {/* ---- Bottom left: history and zoom ---- */}
      <div className="island island-zoom">
        <button
          className="icon-button"
          aria-label="Undo"
          title="Undo · Ctrl/⌘ Z"
          disabled={!canUndo || readonly}
          onClick={undo}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-button"
          aria-label="Redo"
          title="Redo · Ctrl/⌘ Shift Z"
          disabled={!canRedo || readonly}
          onClick={redo}
        >
          <Icon name="redo" />
        </button>
        <span className="island-sep" />
        <button
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out · Ctrl/⌘ −"
          onClick={() => zoomAt(1 / ZOOM_STEP)}
          disabled={view.zoom <= MIN_ZOOM + 0.001}
        >
          <Icon name="minus" />
        </button>
        <div className="menu-anchor" ref={zoomMenuRef}>
          <button
            className="zoom-value"
            aria-label={`Zoom ${zoomPercent}%. Zoom options`}
            aria-expanded={zoomMenuOpen}
            onClick={() => setZoomMenuOpen((open) => !open)}
          >
            {zoomPercent}%
          </button>
          {zoomMenuOpen && (
            <div className="popover zoom-menu above" role="menu">
              <input
                className="zoom-slider"
                type="range"
                min={Math.log(MIN_ZOOM)}
                max={Math.log(MAX_ZOOM)}
                step="0.01"
                value={Math.log(view.zoom)}
                aria-label="Zoom level"
                onChange={(event) =>
                  zoomTo(Math.exp(Number(event.target.value)))
                }
              />
              <div className="zoom-presets">
                {[0.5, 1, 2].map((preset) => (
                  <button
                    key={preset}
                    className={
                      Math.abs(view.zoom - preset) < 0.005 ? 'is-active' : ''
                    }
                    onClick={() => zoomTo(preset)}
                  >
                    {preset * 100}%
                  </button>
                ))}
              </div>
              <button
                className="menu-row"
                role="menuitem"
                onClick={() => {
                  setZoomMenuOpen(false);
                  markManualView();
                  fitTo(unionBounds(pageObjects));
                }}
              >
                <Icon name="fit" />
                <span>Zoom to fit</span>
                <span className="menu-row-hint">⇧1</span>
              </button>
              <button
                className="menu-row"
                role="menuitem"
                disabled={!selectedObjects.length}
                onClick={() => {
                  setZoomMenuOpen(false);
                  markManualView();
                  fitTo(unionBounds(selectedObjects));
                }}
              >
                <Icon name="select" />
                <span>Zoom to selection</span>
                <span className="menu-row-hint">⇧2</span>
              </button>
              <div className="menu-divider" />
              <label className="menu-row toggle-row">
                <Icon name="pen" />
                <span>Pen size follows zoom</span>
                <input
                  type="checkbox"
                  checked={inkFollowsZoom}
                  onChange={(event) => setInkFollowsZoom(event.target.checked)}
                />
              </label>
              <label className="menu-row toggle-row">
                <Icon name="map" />
                <span>Show minimap</span>
                <input
                  type="checkbox"
                  checked={minimapOpen}
                  onChange={(event) => setMinimapOpen(event.target.checked)}
                />
              </label>
            </div>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in · Ctrl/⌘ +"
          onClick={() => zoomAt(ZOOM_STEP)}
          disabled={view.zoom >= MAX_ZOOM - 0.001}
        >
          <Icon name="plus" />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom to fit"
          title="Zoom to fit · Shift 1"
          onClick={() => {
            markManualView();
            fitTo(unionBounds(pageObjects));
          }}
        >
          <Icon name="fit" />
        </button>
      </div>

      {/* ---- Bottom right: minimap and presence ---- */}
      <div className="corner-right">
        {otherPeople.length > 0 && !isLocal && (
          <div className="presence-chip" aria-live="polite">
            <span className={`status-dot ${othersHere.length ? 'live' : ''}`} />
            {othersHere.length === 0
              ? otherPeople.length === 1
                ? `${otherPeople[0]!.name} is away`
                : `${otherPeople.length} others away`
              : othersHere.length === 1
                ? `${othersHere[0]!.name} is here`
                : `${othersHere.length} others here`}
          </div>
        )}
        <Minimap
          open={minimapOpen}
          objects={pageObjects}
          view={view}
          size={size}
          activity={isLocal ? null : remote}
          peers={peers}
          page={currentPage.id}
          pages={pages}
          onMove={(target, animate) => {
            markManualView();
            moveView(target, animate);
          }}
          onGoToPage={switchPage}
        />
      </div>

      {/* ---- Selection inspector ---- */}
      {selectedObjects.length > 0 && (
        <aside className="inspector" aria-label="Selection">
          <div className="inspector-head">
            <div>
              <p className="kicker">
                {selectedObjects.length > 1 ? 'Selection' : 'Selected'}
              </p>
              <h2>
                {selectedObject
                  ? selectedObject.kind === 'sticky'
                    ? 'Sticky note'
                    : selectedObject.kind === 'path'
                      ? 'Drawing'
                      : selectedObject.kind[0]!.toUpperCase() +
                        selectedObject.kind.slice(1)
                  : `${selectedObjects.length} objects`}
              </h2>
            </div>
            <button
              className="icon-button"
              aria-label="Clear selection"
              onClick={() => setSelected([])}
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          {(!selectedObject || selectedObject.kind !== 'image') && (
            <div className="inspector-section">
              <span className="inspector-label">
                {selectedObject?.kind === 'sticky' ? 'Note colour' : 'Colour'}
              </span>
              <div className="swatch-row">
                {(selectedObject?.kind === 'sticky'
                  ? STICKY_COLORS
                  : COLORS
                ).map((swatch) => (
                  <button
                    key={swatch}
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={selectedObject?.color.slice(0, 7) === swatch}
                    className="swatch"
                    style={{ '--swatch': swatch } as React.CSSProperties}
                    disabled={readonly}
                    onClick={() =>
                      selectedObject
                        ? updateSelected({
                            color:
                              selectedObject.color.length === 9
                                ? `${swatch}${selectedObject.color.slice(7)}`
                                : swatch,
                          })
                        : updateSelected({ color: swatch })
                    }
                  />
                ))}
                {selectedObject && selectedObject.kind !== 'sticky' && (
                  <label className="swatch custom" title="Custom colour">
                    <input
                      type="color"
                      aria-label="Custom colour"
                      value={selectedObject.color.slice(0, 7)}
                      disabled={readonly}
                      onChange={(event) =>
                        updateSelected({ color: event.target.value })
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {selectedObject &&
            ['rect', 'ellipse', 'diamond'].includes(selectedObject.kind) && (
              <div className="inspector-section">
                <span className="inspector-label">Fill</span>
                <div className="segmented wide">
                  <button
                    aria-pressed={
                      !selectedObject.fillColor ||
                      (selectedObject.fillColor.length === 9 &&
                        !selectedObject.fillColor.endsWith('00'))
                    }
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
                    aria-pressed={Boolean(
                      selectedObject.fillColor?.endsWith('00'),
                    )}
                    disabled={readonly}
                    onClick={() => updateSelected({ fillColor: '#ffffff00' })}
                  >
                    None
                  </button>
                  <button
                    aria-pressed={selectedObject.fillColor?.length === 7}
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

          {selectedObject &&
            (selectedObject.kind === 'text' ||
              selectedObject.kind === 'sticky') && (
              <Slider
                label="Text size"
                unit="px"
                min={8}
                max={160}
                value={defaultFontSize(selectedObject)}
                disabled={readonly}
                onPreview={(value) =>
                  previewProperty(selectedObject, { fontSize: value })
                }
                onCommit={(value) =>
                  commitProperty(selectedObject, { fontSize: value })
                }
              />
            )}
          {selectedObject &&
            !['text', 'image', 'sticky'].includes(selectedObject.kind) && (
              <Slider
                label="Stroke"
                unit="px"
                min={1}
                max={Math.max(48, Math.ceil(selectedObject.strokeWidth))}
                value={selectedObject.strokeWidth}
                disabled={readonly}
                onPreview={(value) =>
                  previewProperty(selectedObject, { strokeWidth: value })
                }
                onCommit={(value) =>
                  commitProperty(selectedObject, { strokeWidth: value })
                }
              />
            )}
          {selectedObject && (
            <Slider
              label="Opacity"
              unit="%"
              min={10}
              max={100}
              value={Math.round((selectedObject.opacity ?? 1) * 100)}
              disabled={readonly}
              onPreview={(value) =>
                previewProperty(selectedObject, { opacity: value / 100 })
              }
              onCommit={(value) =>
                commitProperty(selectedObject, { opacity: value / 100 })
              }
            />
          )}

          {pages.length > 1 && !readonly && (
            <label className="inspector-section">
              <span className="inspector-label">Move to page</span>
              <span className="select-field">
                <select
                  value={currentPage.id}
                  onChange={(event) => moveSelectionTo(event.target.value)}
                >
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" size={15} />
              </span>
            </label>
          )}

          <div className="inspector-actions">
            <button
              className="button ghost small"
              disabled={readonly}
              onClick={() => pasteObjects(selectedObjects)}
            >
              <Icon name="copy" size={15} /> Duplicate
            </button>
            <button
              className="button danger small"
              disabled={readonly}
              onClick={() => deleteObjects(selected)}
            >
              <Icon name="trash" size={15} /> Delete
            </button>
          </div>
        </aside>
      )}

      {chatOpen && !isLocal && (
        <ChatPanel
          messages={messages}
          selfUserId={me.id}
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
          <p className="kicker">Bring people in</p>
          <h2>Share this board</h2>
          {paywalled && (
            <div className="notice" role="status">
              Your free trial has ended, so new people can’t join yet.
              <button
                className="button primary small"
                onClick={() => {
                  setShareOpen(false);
                  openUpgrade();
                }}
              >
                Upgrade
              </button>
            </div>
          )}
          <p className="modal-copy">
            Anyone with this link joins as an editor, with chat and voice. You
            can switch people to view-only or pause editing at any time.
          </p>
          <div className="share-link">
            <Icon name="link" size={16} />
            <span>{inviteLink ?? 'The invite link is turned off.'}</span>
          </div>
          {inviteLink && <InviteQr link={inviteLink} title={board.title} />}
          <div className="modal-actions">
            <button
              className="button ghost"
              onClick={() => void regenerateInvite()}
            >
              New link
            </button>
            <button
              className="button primary"
              onClick={() => void copyInvite()}
              disabled={!board.inviteToken || board.inviteRevoked}
            >
              <Icon name="copy" size={16} /> Copy invite link
            </button>
          </div>
          <button
            className="text-button danger"
            onClick={() => void revokeInvite()}
            disabled={!board.inviteToken || board.inviteRevoked}
          >
            Turn off this link
          </button>
        </Modal>
      )}

      {membersOpen && (
        <Modal onClose={() => setMembersOpen(false)} className="members-modal">
          <p className="kicker">Participants</p>
          <h2>People on this board</h2>
          <div className="members-list">
            {board.members.map((member) => {
              const online = onlinePeople.find(
                (peer) => peer.userId === member.userId,
              );
              return (
                <div className="member-row" key={member.userId}>
                  <span
                    className="avatar"
                    style={{
                      background: online?.color ?? colorFor(member.userId),
                    }}
                  >
                    {member.name[0]?.toUpperCase()}
                  </span>
                  <div className="member-name">
                    <strong>
                      {member.name}
                      {member.userId === me.id ? ' (you)' : ''}
                    </strong>
                    <small
                      className={online && !online.away ? 'is-online' : ''}
                    >
                      {online
                        ? `${online.away ? 'Away' : online.inCall ? 'Online' : 'Online now'}${online.inCall ? ' · in voice' : ''}`
                        : 'Offline'}
                    </small>
                  </div>
                  {member.role === 'owner' ? (
                    <span className="role-chip role-owner">Owner</span>
                  ) : board.role === 'owner' && !isLocal ? (
                    <span className="select-field">
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
                      <Icon name="chevronDown" size={15} />
                    </span>
                  ) : (
                    <span className={`role-chip role-${member.role}`}>
                      {member.role === 'editor' ? 'Editor' : 'Viewer'}
                    </span>
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
          <p className="kicker">Board history</p>
          <h2>Saved versions</h2>
          {snapshots.length ? (
            <div className="snapshot-list">
              {[...snapshots].reverse().map((snapshot) => (
                <div className="snapshot-row" key={snapshot.id}>
                  <Icon name="clock" />
                  <div>
                    <strong>{snapshot.title}</strong>
                    <small>
                      {new Date(snapshot.createdAt).toLocaleString()}
                    </small>
                  </div>
                  {board.role === 'owner' && (
                    <button
                      className="button ghost small"
                      onClick={() => void restoreSnapshot(snapshot.id)}
                    >
                      Restore
                    </button>
                  )}
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
              className="button ghost"
              onClick={() => void saveSnapshot()}
            >
              <Icon name="save" size={16} /> Save current version
            </button>
          </div>
        </Modal>
      )}

      {helpOpen && (
        <Modal onClose={() => setHelpOpen(false)} className="help-modal">
          <p className="kicker">Keyboard</p>
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
              ['Zoom in / out', 'Ctrl/⌘ + / −'],
              ['Reset zoom', 'Ctrl/⌘ 0'],
              ['Zoom to fit', 'Shift 1'],
              ['Zoom to selection', 'Shift 2'],
              ['Next / previous page', 'Page Down / Page Up'],
              ['Undo / redo', 'Ctrl/⌘ Z · Ctrl/⌘ Shift Z'],
              ['Copy / paste / duplicate', 'Ctrl/⌘ C · V · D'],
              ['Delete selection', 'Delete'],
              ['Nudge selection', 'Arrows (Shift ×10)'],
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

/** A range input that previews while dragging and records one undo step. */
function Slider({
  label,
  unit,
  min,
  max,
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="inspector-section">
      <span className="inspector-label">
        {label}
        <output>
          {Math.round(value * 10) / 10}
          {unit}
        </output>
      </span>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={unit === 'px' ? 0.5 : 1}
        disabled={disabled}
        value={value}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
      />
    </label>
  );
}
