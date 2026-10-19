import { useEffect, useState, type ReactNode } from 'react';

/** Keep exit content alive for one transition, not every folder in the vault. */
export function AnimatedDisclosure({ open, children }: { open: boolean; children: () => ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    let frame = 0, enterFrame = 0, timer = 0;
    if (open) {
      setMounted(true);
      frame = requestAnimationFrame(() => { enterFrame = requestAnimationFrame(() => setExpanded(true)); });
    } else {
      setExpanded(false);
      timer = window.setTimeout(() => setMounted(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170);
    }
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(enterFrame); clearTimeout(timer); };
  }, [open]);
  if (!mounted) return null;
  return <div className="pm-tree-disclosure" data-expanded={expanded && open} inert={!open}>
    <div className="pm-folder-children">{children()}</div>
  </div>;
}
