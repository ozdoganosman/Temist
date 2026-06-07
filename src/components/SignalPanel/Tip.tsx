import { memo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal-based tooltip that renders at document.body level.
 * Never clipped by overflow:hidden/auto parent containers.
 * Always appears above the trigger element.
 */
const Tip = memo(function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const handleEnter = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      top: rect.top - 6,
      left: Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140),
    });
    setShow(true);
  }, []);

  const handleLeave = useCallback(() => setShow(false), []);

  return (
    <span
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
      {show &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              transform: 'translate(-50%, -100%)',
              background: '#1a1e2e',
              color: '#d4d8e0',
              fontSize: 11,
              fontWeight: 400,
              lineHeight: 1.45,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
              whiteSpace: 'normal',
              maxWidth: 280,
              width: 'max-content',
              pointerEvents: 'none' as const,
              zIndex: 99999,
            }}
          >
            {text}
            <div
              style={{
                position: 'absolute',
                bottom: -5,
                left: '50%',
                transform: 'translateX(-50%)',
                borderWidth: 5,
                borderStyle: 'solid',
                borderColor: '#1a1e2e transparent transparent transparent',
              }}
            />
          </div>,
          document.body,
        )}
    </span>
  );
});

export default Tip;
