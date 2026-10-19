import { useEffect, type RefObject } from 'react';

/** Focus a requested tree input as soon as its animated ancestor is mounted. */
export function useTreeInputFocus(ref: RefObject<HTMLInputElement | null>, key: string, select = false) {
  useEffect(() => {
    if (!key) return;
    let frame = 0;
    const deadline = performance.now() + 300;
    const focus = () => {
      const input = ref.current;
      if (input && !input.closest('[inert]')) {
        input.focus({ preventScroll: true });
        if (document.activeElement === input) {
          if (select) input.select();
          input.scrollIntoView({ block: 'nearest' });
          return;
        }
      }
      if (performance.now() < deadline) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [ref, key, select]);
}
