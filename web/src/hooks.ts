import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Loads JSON from the API. Pass null to skip loading. Call reload() to fetch again. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: url !== null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    api
      .get<T>(url)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: unknown) => !cancelled && setState({ data: null, error: errorMessage(error), loading: false }));
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, setData };
}

/** The current time, refreshed on an interval. Use it to show timers. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
