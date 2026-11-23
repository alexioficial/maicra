import { useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button, Modal } from './ui';
import { cx } from '../format';
import { ampersandToSection, MC_COLORS, MC_FORMATS, parseMotd } from '../mc';

/** Renders text that uses Minecraft formatting codes, for example the server description. */
export function Motd({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => parseMotd(text), [text]);
  return (
    <div className={cx('mc-text', className)}>
      {lines.map((spans, index) => (
        <div className="mc-line" key={index}>
          {spans.length === 0
            ? ' '
            : spans.map((span, i) => (
                <span
                  key={i}
                  className={cx(span.obfuscated && 'mc-obfuscated')}
                  style={{
                    color: span.color ?? undefined,
                    fontWeight: span.bold ? 700 : undefined,
                    fontStyle: span.italic ? 'italic' : undefined,
                    textDecoration: [span.underline && 'underline', span.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                  }}
                >
                  {span.text}
                </span>
              ))}
        </div>
      ))}
    </div>
  );
}

interface MotdEditorProps {
  title: string;
  initial: string;
  /** How many lines the text may have. */
  maxLines: number;
  onSave: (text: string) => void;
  onClose: () => void;
}

/** Text box with color and style buttons and a live preview. */
export function MotdEditor({ title, initial, maxLines, onSave, onClose }: MotdEditorProps) {
  const [value, setValue] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);

  const insert = (code: string) => {
    const element = area.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}§${code}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + 2, start + 2);
    });
  };

  return (
    <Modal title={title} color="var(--main)" onClose={onClose}>
      <div className="palette" role="group" aria-label="Colors">
        {MC_COLORS.map((color) => (
          <button
            key={color.code}
            type="button"
            className="swatch"
            style={{ background: color.hex }}
            title={color.name}
            aria-label={color.name}
            onClick={() => insert(color.code)}
          />
        ))}
      </div>
      <div className="palette" role="group" aria-label="Styles">
        {MC_FORMATS.map((format) => (
          <Button key={format.code} variant="dark" size="sm" onClick={() => insert(format.code)}>
            {format.name}
          </Button>
        ))}
      </div>
      <textarea
        ref={area}
        className="input"
        rows={maxLines}
        value={value}
        onChange={(event) => {
          if (event.target.value.split('\n').length <= maxLines) setValue(event.target.value);
        }}
        aria-label="Text"
        spellCheck={false}
        autoFocus
        style={{ resize: 'none', fontWeight: 500 }}
      />
      <div className="mc-card" style={{ padding: 14 }}>
        <Motd text={value} />
      </div>
      <p style={{ color: 'var(--gray-500)', fontSize: 14 }}>
        Tip: you can also type <b>&amp;a</b>, <b>&amp;c</b> and so on instead of using the buttons.
      </p>
      <div className="modal-actions">
        <Button variant="green" size="lg" onClick={() => onSave(ampersandToSection(value))}>
          <Check size={20} strokeWidth={3} />
          Save
        </Button>
        <Button variant="dark" size="lg" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
