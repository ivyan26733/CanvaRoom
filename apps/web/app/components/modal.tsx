'use client';

import { useEffect } from 'react';
import { Icon } from './icons';

export function Modal({
  children,
  onClose,
  className = '',
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`modal ${className}`} role="dialog" aria-modal="true">
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {children}
      </section>
    </div>
  );
}
