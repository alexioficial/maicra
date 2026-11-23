import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, X } from 'lucide-react';
import { cx } from '../format';

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

type Variant = 'blue' | 'green' | 'red' | 'orange' | 'dark' | 'light';
type Size = 'sm' | 'md' | 'lg' | 'huge';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button. */
  busy?: boolean;
}

export function Button({ variant = 'blue', size = 'md', busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

interface ModalProps {
  title: string;
  color?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, color = 'var(--success)', onClose, children }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ '--modal-color': color } as CSSProperties}
      >
        <div className="modal-head">
          <span id={titleId}>{title}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={3} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob">{checked ? <Check size={22} strokeWidth={3.5} /> : <X size={22} strokeWidth={3.5} />}</span>
    </button>
  );
}

interface StepperProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: number;
  max?: number;
  icon?: ReactNode;
}

export function Stepper({ value, onChange, label, min = 0, max = 1_000_000, icon }: StepperProps) {
  const clamp = (n: number) => String(Math.min(max, Math.max(min, n)));
  const current = Number.parseInt(value, 10);
  const base = Number.isNaN(current) ? min : current;
  return (
    <div className="stepper">
      {icon ? <span style={{ display: 'grid', placeItems: 'center', paddingLeft: 10, color: '#fff' }}>{icon}</span> : null}
      <input
        className="input"
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => onChange(clamp(base))}
      />
      <div className="stepper-buttons">
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(clamp(base + 1))}>
          <Plus size={14} strokeWidth={3} />
        </button>
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(base - 1))}>
          <Minus size={14} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

interface InfoTileProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  action?: ReactNode;
}

/** A blue label tab on top of a dark box, as used for Address, Software and Version. */
export function InfoTile({ icon, label, children, action }: InfoTileProps) {
  return (
    <div>
      <div className="info-tile-label">
        {icon}
        {label}
      </div>
      <div className="info-tile-body">
        <div className="info-tile-value">{children}</div>
        {action}
      </div>
    </div>
  );
}
