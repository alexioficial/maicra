import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  Box,
  Check,
  Droplets,
  FlaskConical,
  Hammer,
  Info,
  LayoutGrid,
  Rabbit,
  Send,
  Shirt,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import type { SoftwareCatalogEntry, SoftwareResponse, SoftwareType } from '@api/types';
import { api, errorMessage } from '../api';
import { Button, Modal, Spinner } from '../components/ui';
import { cx } from '../format';
import { useApi } from '../hooks';
import { useServer } from '../state/Server';
import { useToast } from '../state/Toast';

const ICONS: Record<SoftwareType, LucideIcon> = {
  vanilla: Box,
  snapshot: FlaskConical,
  paper: Send,
  spigot: Droplets,
  purpur: Sparkles,
  fabric: Shirt,
  quilt: LayoutGrid,
  neoforge: Rabbit,
  forge: Hammer,
};

export function SoftwarePage() {
  const { snapshot } = useServer();
  const toast = useToast();
  const navigate = useNavigate();
  const software = useApi<SoftwareResponse>('/api/software');
  const [selected, setSelected] = useState<SoftwareCatalogEntry | null>(null);
  const versions = useApi<{ versions: string[] }>(selected ? `/api/software/${selected.id}/versions` : null);
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = snapshot !== null && snapshot.status !== 'offline';

  const install = async () => {
    if (!selected || !pending) return;
    setSaving(true);
    try {
      await api.put('/api/software', { type: selected.id, version: pending });
      toast.success(
        `${selected.label} ${pending} selected. It installs on the next start.${selected.badge ? ` Add your ${selected.badge} on the new ${selected.badge === 'mods' ? 'Mods' : 'Plugins'} page.` : ''}`,
      );
      navigate('/');
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
      setPending(null);
    }
  };

  const banner = locked ? (
    <div className="notice">
      <Info size={20} />
      Stop the server before changing the software or its version.
    </div>
  ) : null;

  if (selected) {
    const currentVersion = software.data?.current.type === selected.id ? software.data.current.version : null;
    return (
      <div className="stack">
        <div className="page-head">
          <h1 className="page-title">{selected.label}</h1>
          <Button variant="dark" onClick={() => setSelected(null)}>
            <ArrowLeft size={18} />
            Software
          </Button>
        </div>
        {banner}
        {versions.loading ? (
          <div className="loading">
            <Spinner />
          </div>
        ) : null}
        {versions.error ? (
          <div className="notice">
            {versions.error}
            <Button variant="light" size="sm" onClick={versions.reload}>
              Retry
            </Button>
          </div>
        ) : null}
        <div className="version-grid">
          {versions.data?.versions.map((version) => (
            <button
              key={version}
              type="button"
              className={cx('version-btn', version === currentVersion && 'current')}
              disabled={locked}
              onClick={() => setPending(version)}
              style={locked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
            >
              {version === currentVersion ? <Check size={22} strokeWidth={3} /> : <Tag size={22} />}
              {version}
            </button>
          ))}
        </div>

        {pending ? (
          <Modal title={`Install ${selected.label} ${pending}?`} onClose={() => setPending(null)}>
            <p>
              Your worlds and files stay as they are. The new software is downloaded the next time the server starts.
              Going back to an older Minecraft version can damage worlds that were already loaded in a newer one.
            </p>
            <div className="modal-actions">
              <Button variant="green" size="lg" busy={saving} onClick={() => void install()}>
                <Check size={20} strokeWidth={3} />
                Install
              </Button>
              <Button variant="dark" size="lg" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      {banner}
      <h1 className="section-title">Minecraft: Java Edition</h1>
      {software.loading ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : null}
      {software.error ? <div className="notice">{software.error}</div> : null}
      <div className="software-grid">
        {software.data?.catalog.map((entry) => {
          const Icon = ICONS[entry.id];
          const active = software.data?.current.type === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={cx('software-tile', active && 'active')}
              onClick={() => setSelected(entry)}
              title={entry.description}
            >
              {entry.badge ? (
                <span className="tile-badge">
                  <Info size={13} />
                  For {entry.badge}
                </span>
              ) : null}
              <span className="tile-icon">
                {active ? (
                  <span className="active-pill">
                    <Check size={22} strokeWidth={3} />
                    Active
                  </span>
                ) : (
                  <Icon size={64} strokeWidth={1.6} />
                )}
              </span>
              <span className="tile-name">{entry.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
