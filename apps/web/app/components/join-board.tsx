'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send } from '../lib/api';
import { BOARD_NAV } from '../lib/navigation';
import { Modal } from './modal';

/** Paste an invite link someone sent you and join that board. */
export function JoinBoardModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    const match = link
      .trim()
      .match(/\/board\/([^/?#]+)\?(?:.*&)?invite=([^&#]+)/);
    if (!match) {
      setError('Paste the complete invite link, including “?invite=”.');
      return;
    }
    setBusy(true);
    try {
      await send(`/boards/${match[1]}/join`, 'POST', {
        inviteToken: decodeURIComponent(match[2]!),
      });
      router.push(`/board/${match[1]}`, BOARD_NAV);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={join}>
        <p className="kicker">Join a board</p>
        <h2>Paste your invite link</h2>
        <label className="field">
          <span>Invite link</span>
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://…/board/…?invite=…"
            autoFocus
          />
        </label>
        {error && <p className="notice error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !link.trim()}>
            Join board
          </button>
        </div>
      </form>
    </Modal>
  );
}
