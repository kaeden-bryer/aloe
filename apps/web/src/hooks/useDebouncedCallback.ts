import { useEffect, useRef } from "react";

/**
 * Returns a function that waits until calls stop for `delay` ms, then runs
 * `fn` once with the last arguments. Used for the quota slider: dragging
 * from 20% to 80% sends one save, not twelve.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Keep the latest fn in a ref so the debounced wrapper never calls a stale closure.
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const debounced = useRef((...args: A) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(...args), delay);
  });
  return debounced.current;
}
