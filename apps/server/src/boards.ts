import {
  tierEndsAt,
  tierOf,
  type BoardMeta,
  type Role,
  type User,
} from './models.js';

/** What the board allows comes from its owner's plan. */
export const boardTier = (board: BoardMeta, now = Date.now()) =>
  tierOf(board.ownerPlan, now);

/**
 * On the free plan a board is the owner's alone: nobody else may join or stay,
 * and the owner may edit only their first board.
 */
export const openToOthers = (board: BoardMeta, now = Date.now()) =>
  boardTier(board, now) !== 'free';

const freeLocked = (role: Role, board: BoardMeta) =>
  boardTier(board) === 'free' && !(role === 'owner' && board.ownerFirstBoard);

export const canEdit = (role: Role, board: BoardMeta) =>
  role !== 'viewer' && !board.locked && !freeLocked(role, board);

export function editBlockedReason(role: Role, board: BoardMeta) {
  if (role === 'viewer') return 'You have view-only access.';
  if (freeLocked(role, board))
    return role === 'owner'
      ? 'The free plan keeps your first board editable. Upgrade to Premium to edit this one.'
      : 'This board is closed until its owner upgrades.';
  return 'The board owner has paused editing.';
}

/**
 * Export, images, and recording: open when the board's owner or the person
 * using them has Premium.
 */
export const premiumUnlocked = (board: BoardMeta, user: User) =>
  boardTier(board) === 'premium' || tierOf(user.plan) === 'premium';

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
    // Lets the page apply the free plan the moment the owner's tier ends.
    plan: {
      tier: boardTier(board),
      until: tierEndsAt(board.ownerPlan) ?? null,
      firstBoard: board.ownerFirstBoard ?? false,
    },
  };
}
