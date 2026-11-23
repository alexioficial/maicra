import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { FileCode2, FileArchive, Image as ImageIcon, Info, Pencil, Pickaxe, Shield, Trash2, Users } from 'lucide-react';
import type { EnvironmentResponse, PropertiesResponse } from '@api/types';
import { api, errorMessage, uploadFiles } from '../api';
import { Motd, MotdEditor } from '../components/Motd';
import { Button, Modal, Spinner, Stepper, Toggle } from '../components/ui';
import { cx, formatMemory } from '../format';
import { useApi } from '../hooks';
import { decodeProperty, encodeProperty, readJsonText, writeJsonText } from '../mc';
import { useServer } from '../state/Server';
import { useToast } from '../state/Toast';

type Kind = 'number' | 'select' | 'toggle' | 'text' | 'rich';

interface Field {
  key: string;
  label: string;
  kind: Kind;
  /** Value Minecraft uses when the property is missing from the file. */
  fallback: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  /** The toggle shows the opposite of the stored true/false value. */
  invert?: boolean;
  icon?: ReactNode;
  placeholder?: string;
  wide?: boolean;
  /** Rich text stored as a JSON text component instead of plain text. */
  json?: boolean;
}

const choices = (values: string[]) => values.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));

// Same fields and order as the Aternos options page.
const FIELDS: Field[] = [
  { key: 'max-players', label: 'Slots', kind: 'number', fallback: '20', min: 1, max: 100000, icon: <Users size={18} /> },
  { key: 'gamemode', label: 'Gamemode', kind: 'select', fallback: 'survival', options: choices(['survival', 'creative', 'adventure', 'spectator']) },
  { key: 'difficulty', label: 'Difficulty', kind: 'select', fallback: 'easy', options: choices(['peaceful', 'easy', 'normal', 'hard']) },
  { key: 'white-list', label: 'Whitelist', kind: 'toggle', fallback: 'false' },
  { key: 'online-mode', label: 'Cracked', kind: 'toggle', fallback: 'true', invert: true },
  { key: 'pvp', label: 'PVP', kind: 'toggle', fallback: 'true' },
  { key: 'enable-command-block', label: 'Commandblocks', kind: 'toggle', fallback: 'false' },
  { key: 'allow-flight', label: 'Fly', kind: 'toggle', fallback: 'false' },
  { key: 'spawn-animals', label: 'Animals', kind: 'toggle', fallback: 'true' },
  { key: 'spawn-monsters', label: 'Monster', kind: 'toggle', fallback: 'true' },
  { key: 'spawn-npcs', label: 'Villagers', kind: 'toggle', fallback: 'true' },
  { key: 'allow-nether', label: 'Nether', kind: 'toggle', fallback: 'true' },
  { key: 'force-gamemode', label: 'Force Gamemode', kind: 'toggle', fallback: 'false' },
  { key: 'spawn-protection', label: 'Spawn Protection', kind: 'number', fallback: '16', min: 0, max: 1000, icon: <Shield size={18} /> },
  { key: 'require-resource-pack', label: 'Resource pack required', kind: 'toggle', fallback: 'false' },
  {
    key: 'resource-pack',
    label: 'Resource pack',
    kind: 'text',
    fallback: '',
    wide: true,
    placeholder: 'https://example.com/resource-pack.zip',
    icon: <FileArchive size={18} />,
  },
  { key: 'resource-pack-prompt', label: 'Resource pack prompt', kind: 'rich', fallback: '', wide: true, json: true },
];

const MOTD_KEY = 'motd';
const MOTD_FALLBACK = 'A Minecraft Server';
const SAVE_DELAY_MS = 600;

export function OptionsPage() {
  const { snapshot } = useServer();
  const toast = useToast();
  const properties = useApi<PropertiesResponse>('/api/options/properties');
  const environment = useApi<EnvironmentResponse>('/api/environment');

  // Edits are collected and written together shortly after the last change.
  const pending = useRef<Record<string, string>>({});
  const timer = useRef<number | undefined>(undefined);
  // Raw values as they appear in the file. Text fields decode and encode on the way in and out.
  const [local, setLocal] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<'motd' | 'prompt' | null>(null);
  const [reinstallOpen, setReinstallOpen] = useState(false);

  const flush = useCallback(async () => {
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length === 0) return;
    try {
      await api.put<PropertiesResponse>('/api/options/properties', { properties: changes });
      toast.success('Saved. Changes apply the next time the server starts.');
    } catch (error) {
      toast.error(errorMessage(error));
      properties.reload();
      setLocal({});
    }
  }, [toast, properties.reload]);

  // Write any unsaved edit when leaving the page.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  const change = (key: string, raw: string) => {
    setLocal((previous) => ({ ...previous, [key]: raw }));
    pending.current[key] = raw;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const rawValue = (key: string, fallback: string): string => local[key] ?? properties.data?.properties[key] ?? fallback;

  const offline = snapshot?.status === 'offline';
  const canReinstall = offline && !snapshot?.reinstalling;

  const saveEnvironment = async (patch: { java?: string; timezone?: string; memoryMb?: number }) => {
    try {
      environment.setData(await api.put<EnvironmentResponse>('/api/environment', patch));
      toast.success('Saved. It applies the next time the server starts.');
    } catch (error) {
      toast.error(errorMessage(error));
      environment.reload();
    }
  };

  const motdRaw = rawValue(MOTD_KEY, encodeProperty(MOTD_FALLBACK));
  const motd = decodeProperty(motdRaw);
  const promptField = FIELDS.find((field) => field.key === 'resource-pack-prompt')!;
  const promptRaw = rawValue(promptField.key, promptField.fallback);
  const prompt = readJsonText(promptRaw);

  return (
    <div className="stack">
      {properties.error ? <div className="notice">{properties.error}</div> : null}
      {properties.loading && !properties.data ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : null}

      {properties.data ? (
        <>
          <ServerCard
            address={snapshot?.address ?? ''}
            motd={motd}
            onEditMotd={() => setEditing('motd')}
            canReinstall={canReinstall}
            onReinstall={() => setReinstallOpen(true)}
          />

          <div className="card">
            <div className="card-head">
              <span className="card-head-title">
                <FileCode2 size={24} />
                server.properties
              </span>
            </div>
            {!properties.data.exists ? (
              <div className="empty">
                <Info size={16} style={{ verticalAlign: '-3px' }} /> The file does not exist yet. It is created the first time the server starts, or when you change an option here.
              </div>
            ) : null}
            <div className="option-grid">
              {FIELDS.map((field) => {
                const raw = rawValue(field.key, field.json ? '' : field.fallback);
                return (
                  <div key={field.key} className={cx('option', field.wide && 'wide')}>
                    <div className="option-main">
                      <label htmlFor={`opt-${field.key}`}>{field.label}</label>
                      <Control
                        field={field}
                        raw={raw}
                        prompt={prompt}
                        onChange={(next) => change(field.key, next)}
                        onEditRich={() => setEditing('prompt')}
                      />
                    </div>
                    <div className="option-key">
                      {field.key}=<b>{raw === '' && field.json ? '""' : raw}</b>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {environment.data ? (
        <div className="row-fields">
          <div className="field">
            <label className="field-label" htmlFor="opt-timezone">
              Timezone
            </label>
            <select
              id="opt-timezone"
              className="input"
              value={environment.data.timezone}
              disabled={!offline}
              onChange={(event) => void saveEnvironment({ timezone: event.target.value })}
            >
              {environment.data.timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="opt-java">
              Environment
            </label>
            <select
              id="opt-java"
              className="input"
              value={environment.data.java}
              disabled={!offline}
              onChange={(event) => void saveEnvironment({ java: event.target.value })}
            >
              {environment.data.javaVersions.map((version) => (
                <option key={version} value={version}>
                  Java {version}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="opt-ram">
              Maximum RAM
            </label>
            <select
              id="opt-ram"
              className="input"
              value={environment.data.memoryMb}
              disabled={!offline}
              onChange={(event) => void saveEnvironment({ memoryMb: Number(event.target.value) })}
            >
              {environment.data.memoryOptionsMb.map((megabytes) => (
                <option key={megabytes} value={megabytes}>
                  {formatMemory(megabytes)}
                </option>
              ))}
            </select>
            {environment.data.hostMemoryMb !== null ? (
              <span className="field-hint">
                This machine has {formatMemory(environment.data.hostMemoryMb)} in total. Recommended maximum: {formatMemory(environment.data.recommendedMemoryMb)}.
              </span>
            ) : null}
          </div>
          {environment.data.hostMemoryMb !== null && environment.data.memoryMb > environment.data.recommendedMemoryMb ? (
            <div className="notice" style={{ flex: '1 1 100%' }}>
              <Info size={18} />
              {formatMemory(environment.data.memoryMb)} is more than the recommended {formatMemory(environment.data.recommendedMemoryMb)}. The system and your other apps may run out of memory.
            </div>
          ) : null}
          {!offline ? (
            <div className="notice" style={{ flex: '1 1 100%' }}>
              <Info size={18} />
              Stop the server to change the timezone, Java version or RAM.
            </div>
          ) : null}
        </div>
      ) : null}

      {reinstallOpen ? (
        <ReinstallModal
          current={snapshot ? `${snapshot.software.type[0]?.toUpperCase()}${snapshot.software.type.slice(1)} ${snapshot.software.version}` : undefined}
          onClose={() => setReinstallOpen(false)}
        />
      ) : null}
      {editing === 'motd' ? (
        <MotdEditor
          title="Server description (MOTD)"
          initial={motd}
          maxLines={2}
          onClose={() => setEditing(null)}
          onSave={(text) => {
            change(MOTD_KEY, encodeProperty(text));
            setEditing(null);
          }}
        />
      ) : null}
      {editing === 'prompt' ? (
        <MotdEditor
          title="Resource pack prompt"
          initial={prompt}
          maxLines={3}
          onClose={() => setEditing(null)}
          onSave={(text) => {
            change(promptField.key, writeJsonText(text));
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Looks like an entry of the Minecraft multiplayer list: icon, address and description. */
interface ServerCardProps {
  address: string;
  motd: string;
  onEditMotd: () => void;
  canReinstall: boolean;
  onReinstall: () => void;
}

function ServerCard({ address, motd, onEditMotd, canReinstall, onReinstall }: ServerCardProps) {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [iconVersion, setIconVersion] = useState(() => Date.now());
  const [hasIcon, setHasIcon] = useState(true);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadFiles('/', [await toIconFile(file)], () => undefined);
      setHasIcon(true);
      setIconVersion(Date.now());
      toast.success('Icon saved. Players see it after the next start.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mc-card">
      <div className="mc-icon">
        {hasIcon ? (
          <img src={`/api/server/icon?v=${iconVersion}`} alt="Server icon" width={64} height={64} onError={() => setHasIcon(false)} />
        ) : (
          <Pickaxe size={36} />
        )}
        <button type="button" className="mc-icon-edit" onClick={() => picker.current?.click()} disabled={uploading} aria-label="Change server icon" title="Change server icon">
          {uploading ? <Spinner /> : <ImageIcon size={14} />}
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      <div className="mc-info">
        <div className="mc-name">{address}</div>
        <div className="mc-motd">
          <Motd text={motd} />
          <button type="button" className="mc-edit" onClick={onEditMotd} aria-label="Edit server description" title="Edit server description">
            <Pencil size={14} />
          </button>
        </div>
      </div>
      <Button
        variant="red"
        size="lg"
        onClick={onReinstall}
        disabled={!canReinstall}
        title={canReinstall ? 'Delete everything and start from scratch' : 'Stop the server first'}
      >
        <Trash2 size={20} />
        Reinstall
      </Button>
    </div>
  );
}

/** Last chance before everything is deleted. The user has to type a word to continue. */
function ReinstallModal({ current, onClose }: { current: string | undefined; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = word.trim().toUpperCase() === 'REINSTALL';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api.post('/api/server/reinstall', { confirm: 'REINSTALL' });
      toast.success('Reinstalling. Start the server when it finishes.');
      navigate('/');
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Modal title="Reinstall the server?" color="var(--danger)" onClose={onClose}>
      <form className="modal-body" style={{ padding: 0 }} onSubmit={submit}>
        <p>
          <b>This cannot be undone.</b> It permanently deletes:
        </p>
        <ul className="confirm-list">
          <li>every world: overworld, nether and end</li>
          <li>plugins, mods and their settings</li>
          <li>server.properties and all other server files</li>
          <li>the whitelist, operators and bans</li>
          <li>the server icon and the logs</li>
        </ul>
        <p>
          The software goes back to the newest Vanilla{current ? ` instead of ${current}` : ''}. Your panel login, the accepted EULA, the RAM and the timezone are
          kept. Download anything you want to keep from the Files page first.
        </p>
        <label className="field">
          <span className="field-label">
            Type <b>REINSTALL</b> to confirm
          </span>
          <input
            className="input"
            value={word}
            onChange={(event) => setWord(event.target.value)}
            placeholder="REINSTALL"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <Button type="submit" variant="red" size="lg" busy={busy} disabled={!ready}>
            <Trash2 size={18} />
            Delete everything and reinstall
          </Button>
          <Button variant="dark" size="lg" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Minecraft shows server icons at exactly 64 by 64 pixels in PNG format. */
async function toIconFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the image');
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 64, 64);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not convert the image to PNG');
  return new File([blob], 'server-icon.png', { type: 'image/png' });
}

interface ControlProps {
  field: Field;
  raw: string;
  prompt: string;
  onChange: (raw: string) => void;
  onEditRich: () => void;
}

function Control({ field, raw, prompt, onChange, onEditRich }: ControlProps) {
  const id = `opt-${field.key}`;
  switch (field.kind) {
    case 'toggle': {
      const on = raw === 'true';
      return <Toggle label={field.label} checked={field.invert ? !on : on} onChange={(checked) => onChange(String(field.invert ? !checked : checked))} />;
    }
    case 'number':
      return <Stepper label={field.label} value={raw} onChange={onChange} min={field.min} max={field.max} icon={field.icon} />;
    case 'select':
      return (
        <select id={id} className="input" value={raw} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'text':
      return (
        <span className="input-box grow">
          {field.icon}
          <input
            id={id}
            className="input"
            value={decodeProperty(raw)}
            placeholder={field.placeholder}
            onChange={(event) => onChange(encodeProperty(event.target.value))}
            maxLength={2000}
            autoComplete="off"
          />
        </span>
      );
    case 'rich':
      return (
        <span className="rich-field">
          <button type="button" className="rich-edit" onClick={onEditRich} aria-label={`Edit ${field.label}`}>
            <Pencil size={18} />
          </button>
          <button type="button" className="rich-preview" onClick={onEditRich} aria-label={`Edit ${field.label}`}>
            {prompt === '' ? <span className="mc-placeholder">Click to write a message</span> : <Motd text={prompt} />}
          </button>
        </span>
      );
  }
}
