import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, Cpu, Globe, Clock, Moon, Plug, Power, RotateCw, Settings2, Shuffle, Square, Tag, Users, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ApiError, api, errorMessage } from '../api';
import { Button, InfoTile, Modal, Spinner } from '../components/ui';
import { formatDuration, formatMemory, formatMinutes } from '../format';
import { useNow } from '../hooks';
import { statusLook, useServer } from '../state/Server';
import { useToast } from '../state/Toast';

type Action = 'start' | 'stop' | 'restart';

export function ServerPage() {
  const { snapshot } = useServer();
  const toast = useToast();
  const now = useNow();
  const [busy, setBusy] = useState<Action | null>(null);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  if (!snapshot) {
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  }

  const run = async (action: Action) => {
    setBusy(action);
    try {
      await api.post(`/api/server/${action}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'eula') setEulaOpen(true);
      else toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const acceptEula = async () => {
    try {
      await api.post('/api/server/eula', { accept: true });
      setEulaOpen(false);
      await run('start');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(snapshot.address);
      toast.success('Address copied');
    } catch {
      toast.error('Could not copy. Select the address and copy it by hand.');
    }
  };

  const { status, reinstalling, sleeping } = snapshot;
  const running = snapshot.startedAt !== null;
  const software = snapshot.software;
  const look = statusLook(snapshot);
  const uptimeNote = sleeping
    ? 'Sleeping until a player connects'
    : snapshot.sleepAfterMinutes !== null
      ? `Sleeps after ${formatMinutes(snapshot.sleepAfterMinutes)} without players`
      : 'The server stays on until you stop it';

  return (
    <div className="stack" style={{ '--status-color': reinstalling ? 'var(--warn)' : look.color } as CSSProperties}>
      <div>
        <div className="host-card">
          <div className="host-name">{snapshot.address}</div>
          <Button variant="light" size="sm" onClick={() => setConnectOpen(true)}>
            <Plug size={16} />
            Connect
          </Button>
        </div>
        <div className="status-bar" role="status" aria-live="polite">
          <div className="status-main">
            <span className="status-icon">
              {status === 'offline' && !reinstalling ? <Square size={14} fill="currentColor" strokeWidth={0} /> : null}
              {status === 'online' && !sleeping ? <Check size={22} strokeWidth={4} /> : null}
              {status === 'online' && sleeping ? <Moon size={20} fill="currentColor" strokeWidth={0} /> : null}
              {status === 'starting' || status === 'stopping' || reinstalling ? <Spinner /> : null}
            </span>
            {reinstalling ? 'Reinstalling' : look.label}
          </div>
          <div className="status-detail">{snapshot.detail ?? ''}</div>
        </div>
      </div>

      <div className="actions">
        {status === 'offline' && !reinstalling ? (
          <Button variant="green" size="huge" busy={busy === 'start'} onClick={() => void run('start')}>
            <Power size={40} strokeWidth={2.6} />
            Start
          </Button>
        ) : null}
        {reinstalling ? (
          <Button variant="dark" size="lg" disabled>
            <Spinner />
            Reinstalling
          </Button>
        ) : null}
        {status === 'online' ? (
          <>
            <Button variant="red" size="lg" busy={busy === 'stop'} onClick={() => void run('stop')}>
              <Square size={20} fill="currentColor" />
              Stop
            </Button>
            <Button variant="orange" size="lg" busy={busy === 'restart'} onClick={() => void run('restart')}>
              <RotateCw size={20} />
              Restart
            </Button>
          </>
        ) : null}
        {status === 'starting' ? (
          <Button variant="red" size="lg" busy={busy === 'stop'} onClick={() => void run('stop')}>
            <Square size={20} fill="currentColor" />
            Stop
          </Button>
        ) : null}
        {status === 'stopping' ? (
          <Button variant="dark" size="lg" disabled>
            <Spinner />
            Stopping
          </Button>
        ) : null}
      </div>

      <div className="info-grid">
        <InfoTile
          icon={<Plug size={18} />}
          label="Address"
          action={
            <Button size="sm" onClick={() => void copyAddress()}>
              <Copy size={15} />
              Copy
            </Button>
          }
        >
          {snapshot.address}
        </InfoTile>

        <InfoTile
          icon={<Settings2 size={18} />}
          label="Software"
          action={
            <Link className="btn btn-green btn-sm" to="/software">
              <Shuffle size={15} />
              Change
            </Link>
          }
        >
          <span style={{ textTransform: 'capitalize' }}>{software.type}</span>
        </InfoTile>

        <InfoTile
          icon={<Tag size={18} />}
          label="Version"
          action={
            <Link className="btn btn-green btn-sm" to="/software">
              <Shuffle size={15} />
              Change
            </Link>
          }
        >
          {software.version}
          <div className="info-tile-sub">Runs on Java {software.java}</div>
        </InfoTile>

        {status === 'online' ? (
          <InfoTile icon={<Users size={18} />} label="Players">
            {snapshot.players ? `${snapshot.players.online} / ${snapshot.players.max}` : '…'}
            <div className="info-tile-sub">
              {snapshot.players && snapshot.players.names.length > 0 ? snapshot.players.names.join(', ') : 'Nobody is online'}
            </div>
          </InfoTile>
        ) : null}

        {running ? (
          <InfoTile icon={<Cpu size={18} />} label="RAM">
            {snapshot.ram ? formatMemory(snapshot.ram.usedMb) : '…'}
            {snapshot.ram ? (
              <>
                <div className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (snapshot.ram.usedMb / snapshot.ram.limitMb) * 100)}%` }} />
                </div>
                <div className="info-tile-sub">of {formatMemory(snapshot.ram.limitMb)} allocated to Java</div>
              </>
            ) : null}
          </InfoTile>
        ) : null}

        {running && snapshot.startedAt !== null ? (
          <InfoTile icon={<Clock size={18} />} label="Uptime">
            {formatDuration(now - snapshot.startedAt)}
            <div className="info-tile-sub">{uptimeNote}</div>
          </InfoTile>
        ) : null}
      </div>

      {eulaOpen ? (
        <Modal title="EULA" onClose={() => setEulaOpen(false)}>
          <p>
            Do you accept the Minecraft EULA?
            <br />
            <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
              https://www.minecraft.net/eula
            </a>
          </p>
          <div className="modal-actions">
            <Button variant="green" size="lg" onClick={() => void acceptEula()}>
              <Check size={20} strokeWidth={3} />
              Yes, I accept the EULA.
            </Button>
            <Button variant="red" size="lg" onClick={() => setEulaOpen(false)}>
              <X size={20} strokeWidth={3} />
              No
            </Button>
          </div>
        </Modal>
      ) : null}

      {connectOpen ? (
        <Modal title="Connect to your server" color="var(--main)" onClose={() => setConnectOpen(false)}>
          <p>
            In Minecraft: Java Edition open <b>Multiplayer</b>, choose <b>Add Server</b> and paste this address.
          </p>
          <div className="copy-line">
            <code>{snapshot.address}</code>
            <Button size="lg" onClick={() => void copyAddress()}>
              <Copy size={18} />
              Copy
            </Button>
          </div>
          <p style={{ color: 'var(--gray-500)' }}>
            <Globe size={14} style={{ verticalAlign: '-2px' }} /> Use Minecraft {snapshot.software.version} or a version the server software supports.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
