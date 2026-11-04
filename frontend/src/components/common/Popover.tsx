import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Shared positioning and dismissal for WeLink's menus and pickers. */
export function Popover({ open, anchorRef, onClose, children, minWidth = 220, className = '' }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  minWidth?: number;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const anchor = anchorRef.current;

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { closeRef.current(); return; }
      const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const flip = below < 280 && above > below;
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.max(80, Math.min(440, flip ? above : below)),
      });
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !panelRef.current?.contains(target)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const popovers = document.querySelectorAll('[data-welink-popover]');
      if (popovers[popovers.length - 1] !== panelRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
      anchor.focus();
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, anchor, minWidth]);

  if (!open || !anchor) return null;
  // Keep popup focus within the parent modal's focus boundary.
  const container = anchor.closest('[role="dialog"]') ?? document.body;
  return createPortal(<div ref={panelRef} data-welink-popover className={`ui-popover ${className}`} style={position}>{children}</div>, container);
}
