import { useLayoutEffect, useRef } from 'react';
import type { LogLine } from '@api/types';
import { cx } from '../format';

// "[12:00:00] [Server thread/INFO]: message"
const LEVEL_PATTERN = /^(\[[^\]]*\])\s*(\[[^\]]*\/(INFO|WARN|ERROR|FATAL|DEBUG)\]:?)\s?(.*)$/;

function TerminalLine({ line }: { line: LogLine }) {
  if (line.kind === 'cmd') return <div className="t-line t-cmd">{line.text}</div>;
  if (line.kind === 'sys') return <div className="t-line t-sys">{line.text}</div>;

  const match = LEVEL_PATTERN.exec(line.text);
  if (!match) return <div className="t-line">{line.text}</div>;

  const level = match[3];
  const tone = level === 'WARN' ? 't-warn' : level === 'ERROR' || level === 'FATAL' ? 't-error' : '';
  return (
    <div className={cx('t-line', tone)}>
      <span className="t-meta">
        {match[1]} {match[2]}
      </span>{' '}
      {match[4]}
    </div>
  );
}

interface TerminalProps {
  lines: LogLine[];
  empty: string;
  label: string;
}

/** Black terminal view. It follows new output unless the reader scrolled up. */
export function Terminal({ lines, empty, label }: TerminalProps) {
  const container = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    const element = container.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={container}
      className="terminal"
      role="log"
      aria-label={label}
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {lines.length === 0 ? <div className="terminal-empty">{empty}</div> : lines.map((line, index) => <TerminalLine key={`${line.ts}-${index}`} line={line} />)}
    </div>
  );
}
