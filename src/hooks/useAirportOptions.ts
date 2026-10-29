"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CURATED_OPTIONS, loadMoreAirports, mergeAirportOptions, type AirportOption } from "@/lib/airportOptions";

/**
 * Every airport the picker can offer: the hand-kept ones at once, the rest
 * after `load()` (or right away with `eager`). `nameOf` and `isKnown` work
 * for either kind once loaded.
 */
export function useAirportOptions({ eager = false }: { eager?: boolean } = {}) {
  const [more, setMore] = useState<AirportOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    loadMoreAirports().then((options) => {
      setMore(options);
      setLoaded(options.length > 0);
    });
  }, []);

  useEffect(() => {
    if (eager) load();
  }, [eager, load]);

  const options = useMemo(() => mergeAirportOptions(CURATED_OPTIONS, more), [more]);
  const byCode = useMemo(() => new Map(options.map((o) => [o.code, o])), [options]);
  // Stable until the list changes, so effects can depend on them.
  const nameOf = useCallback((code: string) => byCode.get(code)?.name, [byCode]);
  const isKnown = useCallback((code: string) => byCode.has(code), [byCode]);

  return { options, loaded, load, nameOf, isKnown };
}
