import { useMemo } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { LogLine } from '@api/types';
import { Terminal } from '../components/Terminal';
import { Button, Spinner } from '../components/ui';
import { useApi } from '../hooks';

const MAX_LINES = 3000;

export function LogPage() {
  const log = useApi<{ text: string }>('/api/log');

  const lines = useMemo<LogLine[]>(() => {
    const text = log.data?.text.replace(/\n$/, '') ?? '';
    if (text === '') return [];
    return text
      .split('\n')
      .slice(-MAX_LINES)
      .map((line) => ({ ts: 0, text: line, kind: 'out' as const }));
  }, [log.data]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Log</h1>
        <div className="toolbar">
          <Button variant="dark" onClick={log.reload} busy={log.loading}>
            <RefreshCw size={16} />
            Refresh
          </Button>
          <a className="btn btn-blue" href="/api/log/download">
            <Download size={16} />
            Download
          </a>
        </div>
      </div>

      {log.error ? <div className="notice">{log.error}</div> : null}
      {log.loading && !log.data ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : (
        <div className="card">
          <Terminal lines={lines} label="Server log" empty="Empty" />
        </div>
      )}
    </div>
  );
}
