import { useEffect, useRef, useState } from "react";

/**
 * A value that only updates every `ms` while `active`, and is passed through
 * untouched otherwise.
 *
 * Written for live-rendering a streaming answer as Markdown: re-parsing on
 * every token means one parse + full subtree reconciliation per token (50+/s on
 * a fast model), which is what made the chat render plain text until the answer
 * was finished. Bounding it to ~10 fps keeps the render cost independent of the
 * token rate, and is imperceptible next to the typing itself.
 *
 * Passing the value straight through when inactive matters: a settled message
 * must never lag behind by a throttle interval, and the cleanup flush covers
 * the moment streaming stops.
 */
export function useThrottledValue<T>(value: T, ms: number, active: boolean): T {
  const latest = useRef(value);
  latest.current = value;
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (!active) return;
    setShown(latest.current);
    const id = setInterval(() => setShown(latest.current), ms);
    return () => {
      clearInterval(id);
      setShown(latest.current); // flush whatever arrived in the last interval
    };
  }, [active, ms]);

  return active ? shown : value;
}
