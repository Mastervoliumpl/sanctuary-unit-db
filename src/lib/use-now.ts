// A once-a-second clock for countdowns and elapsed timers. Server polls are
// every few seconds; anything that should visibly tick derives from this
// instead, and re-anchors on each poll so it never drifts.

import { useEffect, useState } from 'react';

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
