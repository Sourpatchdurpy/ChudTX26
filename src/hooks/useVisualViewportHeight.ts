import { useEffect, useState } from 'react';

/** Keeps the composer inside the visible area when a phone keyboard opens. */
export function useVisualViewportHeight() {
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Keep normal document sizing while the user pinch-zooms.
        setHeight(viewport && viewport.scale === 1 ? viewport.height : window.innerHeight);
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return height;
}
