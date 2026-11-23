import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { FileText, Send, Terminal as TerminalIcon } from 'lucide-react';
import { api, errorMessage } from '../api';
import { Terminal } from '../components/Terminal';
import { Button } from '../components/ui';
import { cx } from '../format';
import { STATUS_LABEL, useServer } from '../state/Server';
import { useToast } from '../state/Toast';

export function ConsolePage() {
  const { snapshot, logs } = useServer();
  const toast = useToast();
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const cursor = useRef(-1);

  const status = snapshot?.status ?? 'offline';
  const online = status === 'online';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = command.trim();
    if (text === '') return;
    setCommand('');
    setHistory((previous) => [text, ...previous.filter((item) => item !== text)].slice(0, 50));
    cursor.current = -1;
    try {
      // The response shows up in the console through the live connection.
      await api.post('/api/console/command', { command: text });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // Arrow keys walk through earlier commands, like a normal terminal.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = cursor.current + (event.key === 'ArrowUp' ? 1 : -1);
    if (next < -1 || next >= history.length) return;
    cursor.current = next;
    setCommand(next === -1 ? '' : (history[next] ?? ''));
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-head-title">
          <TerminalIcon size={22} />
          Console
          <span className={cx('tag', online && 'tag-online', (status === 'starting' || status === 'stopping') && 'tag-working')}>
            {STATUS_LABEL[status]}
          </span>
        </span>
        <Link className="btn btn-light btn-sm" to="/log">
          <FileText size={15} />
          Log
        </Link>
      </div>
      <Terminal
        lines={logs}
        label="Server console"
        empty={online ? 'Waiting for output…' : 'The server is not running. Start it to see the console.'}
      />
      <form className="command-bar" onSubmit={submit}>
        <span className="prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          className="input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!online}
          placeholder={online ? 'Type a command, for example: say hello' : 'Commands work while the server is online'}
          aria-label="Console command"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
        />
        <Button type="submit" variant="blue" size="sm" disabled={!online || command.trim() === ''}>
          <Send size={15} />
          Send
        </Button>
      </form>
    </div>
  );
}
