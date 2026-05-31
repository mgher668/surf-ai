import { useCallback, useRef, type RefObject } from "react";

type ScrollKey = "j" | "k";

interface UseKeyboardScrollResult {
  handleScrollKeyDown: (key: ScrollKey) => void;
  handleScrollKeyUp: (key: ScrollKey) => void;
  clearKeyboardScrollKeys: () => void;
}

export function useKeyboardScroll<T extends HTMLElement>(
  viewportRef: RefObject<T>,
  speedPxPerSecond: number
): UseKeyboardScrollResult {
  const loopRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const keysRef = useRef<{ j: boolean; k: boolean }>({ j: false, k: false });

  const stop = useCallback((): void => {
    if (loopRef.current) {
      window.cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    lastTsRef.current = null;
  }, []);

  const clearKeyboardScrollKeys = useCallback((): void => {
    keysRef.current.j = false;
    keysRef.current.k = false;
    stop();
  }, [stop]);

  const start = useCallback((): void => {
    if (loopRef.current) {
      return;
    }

    const step = (timestamp: number): void => {
      const viewport = viewportRef.current;
      if (!viewport) {
        stop();
        return;
      }

      const direction = (keysRef.current.j ? 1 : 0) + (keysRef.current.k ? -1 : 0);
      if (direction === 0) {
        stop();
        return;
      }

      const lastTs = lastTsRef.current ?? timestamp;
      const deltaMs = Math.max(0, timestamp - lastTs);
      lastTsRef.current = timestamp;
      const deltaPx = direction * speedPxPerSecond * (deltaMs / 1_000);
      if (deltaPx !== 0) {
        viewport.scrollTop += deltaPx;
      }

      loopRef.current = window.requestAnimationFrame(step);
    };

    lastTsRef.current = null;
    loopRef.current = window.requestAnimationFrame(step);
  }, [speedPxPerSecond, stop, viewportRef]);

  const handleScrollKeyDown = useCallback(
    (key: ScrollKey): void => {
      keysRef.current[key] = true;
      if (keysRef.current.j || keysRef.current.k) {
        start();
        return;
      }
      stop();
    },
    [start, stop]
  );

  const handleScrollKeyUp = useCallback(
    (key: ScrollKey): void => {
      keysRef.current[key] = false;
      if (keysRef.current.j || keysRef.current.k) {
        return;
      }
      stop();
    },
    [stop]
  );

  return {
    handleScrollKeyDown,
    handleScrollKeyUp,
    clearKeyboardScrollKeys
  };
}
