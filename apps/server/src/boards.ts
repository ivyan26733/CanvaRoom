import type { BoardMeta, Role } from './models.js';

export const canEdit = (role: Role, board: BoardMeta) =>
  role !== 'viewer' && !board.locked;

export const editBlockedReason = (role: Role, board: BoardMeta) =>
  board.locked && role !== 'viewer'
    ? 'The board owner has paused editing.'
    : 'You have view-only access.';

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
    members: Object.entries(board.members).map(([userId, member]) => ({
      userId,
      ...member,
    })),
    inviteToken: role === 'owner' ? board.inviteToken : undefined,
    inviteRevoked: role === 'owner' ? board.inviteRevoked : undefined,
  };
}
