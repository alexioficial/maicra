import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LogLine, ServerSnapshot, ServerStatus, WsMessage } from '@api/types';
import { api } from '../api';

const MAX_LOG_LINES = 1500;

interface ServerState {
  snapshot: ServerSnapshot | null;
  logs: LogLine[];
  /** True while the live connection to the panel is open. */
  connected: boolean;
}

const ServerContext = createContext<ServerState | null>(null);

export const STATUS_LABEL: Record<ServerStatus, string> = {
  offline: 'Offline',
  starting: 'Starting',
  online: 'Online',
  stopping: 'Stopping',
};

export const STATUS_COLOR: Record<ServerStatus, string> = {
  offline: 'var(--danger)',
  starting: 'var(--warn)',
  online: 'var(--success)',
  stopping: 'var(--warn)',
};

/** A sleeping server is online for the API, but it is shown on its own so the user can tell. */
export function statusLook(snapshot: ServerSnapshot | null): { label: string; color: string } {
  if (snapshot?.sleeping) return { label: 'Sleeping', color: 'var(--main)' };
  const status = snapshot?.status ?? 'offline';
  return { label: STATUS_LABEL[status], color: STATUS_COLOR[status] };
}

/** Keeps one WebSocket open that streams the server status and console lines. */
export function ServerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let pending: LogLine[] = [];
    let frame = 0;

    // A busy start prints hundreds of lines per second. Applying them once per frame keeps the page smooth.
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length === 0) return;
      setLogs((previous) => {
        const next = previous.concat(batch);
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });
    };

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as WsMessage;
        if (message.type === 'status') setSnapshot(message.data);
        else if (message.type === 'history') {
          pending = [];
          setLogs(message.lines);
        } else {
          pending.push(message.line);
          if (!frame) frame = requestAnimationFrame(flush);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        retryTimer = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      socket?.close();
    };
  }, []);

  // While the live connection is down, poll so the page does not go stale.
  // This also notices an expired session, because the request is rejected with 401.
  useEffect(() => {
    if (connected) return;
    const poll = () => api.get<ServerSnapshot>('/api/server').then(setSnapshot).catch(() => undefined);
    void poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [connected]);

  const value = useMemo(() => ({ snapshot, logs, connected }), [snapshot, logs, connected]);
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerState {
  const value = useContext(ServerContext);
  if (!value) throw new Error('useServer must be used inside ServerProvider');
  return value;
}
