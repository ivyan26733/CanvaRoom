'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/** Longer than the exit animation, in case `animationend` never fires. */
const EXIT_FALLBACK_MS = 260;

export function Modal({
  children,
  onClose,
  className = '',
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);
  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);
  // Plays the exit animation, then hands control back to the parent.
  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing, finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);
  return (
    <div
      className={`modal-backdrop ${closing ? 'is-closing' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) finish();
      }}
    >
      <section className={`modal ${className}`} role="dialog" aria-modal="true">
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={requestClose}
        >
          <Icon name="close" />
        </button>
        {children}
      </section>
    </div>
  );
}
