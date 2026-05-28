import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  // Touch cihazlar (pointer: coarse) her zaman mobil layout kullanır —
  // yatay modda genişlik 768px'i geçse bile.
  const isTouch = useMediaQuery('(pointer: coarse)');
  const isNarrow = useMediaQuery('(max-width: 768px)');
  return isTouch || isNarrow;
}

export function useIsTablet(): boolean {
  return useMediaQuery('(max-width: 1024px)');
}
