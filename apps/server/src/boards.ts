import { hasAccess, type BoardMeta, type Role } from './models.js';

/** The owner's trial has ended without a pass, so the board is view-only. */
export const paywalled = (board: BoardMeta) =>
  !hasAccess(board.ownerAccessUntil);

export const canEdit = (role: Role, board: BoardMeta) =>
  role !== 'viewer' && !board.locked && !paywalled(board);

export function editBlockedReason(role: Role, board: BoardMeta) {
  if (role === 'viewer') return 'You have view-only access.';
  if (paywalled(board))
    return role === 'owner'
      ? 'Your free trial has ended. Upgrade to keep editing this board.'
      : 'This board is view-only until its owner upgrades.';
  return 'The board owner has paused editing.';
}

/** The board settings a member may see. Only the owner sees the invite token. */
export function publicBoard(board: BoardMeta, role: Role) {
  return {
    id: board.id,
    title: board.title,
    ownerId: board.ownerId,
    role,
    locked: board.locked,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    pages: board.pages,
    members: Object.entries(board.members).map(([userId, member]) => ({
      userId,
      ...member,
    })),
    inviteToken: role === 'owner' ? board.inviteToken : undefined,
    inviteRevoked: role === 'owner' ? board.inviteRevoked : undefined,
    // Lets the page switch to view-only the moment the owner's access ends.
    accessUntil: board.ownerAccessUntil ?? null,
  };
}
