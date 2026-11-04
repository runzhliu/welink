import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  descriptionId?: string;
  initialFocusRef?: React.RefObject<HTMLElement>;
}

/** Shared modal surface: keyboard containment, Escape, and return focus. */
export const Dialog: React.FC<DialogProps> = ({ open, title, onClose, children, className = '', descriptionId, initialFocusRef }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (initialFocusRef?.current ?? panelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('[data-welink-popover], [data-popup-open="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter(el => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      const inside = panelRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current || !inside)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;
  return createPortal(
    <div className="ui-dialog-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className={`ui-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="ui-dialog-header">
          <h2 id={titleId} className="ui-dialog-title">{title}</h2>
          <button type="button" className="ui-icon-button" onClick={onClose} aria-label={`关闭${title}`}><X size={18} /></button>
        </header>
        <div className="ui-dialog-content">{children}</div>
      </div>
    </div>, document.body
  );
};
