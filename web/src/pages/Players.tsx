import { useState, type FormEvent } from 'react';
import { Ban, ShieldCheck, ShieldOff, Trash2, User, UserCheck, UserPlus, UserX, type LucideIcon } from 'lucide-react';
import type { PlayerEntry, PlayerListName } from '@api/types';
import { api, errorMessage, q } from '../api';
import { Button, Spinner } from '../components/ui';
import { useApi } from '../hooks';
import { useServer } from '../state/Server';
import { useToast } from '../state/Toast';

interface Tab {
  id: PlayerListName;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  placeholder: string;
  empty: string;
}

const TABS: Tab[] = [
  { id: 'whitelist', label: 'Whitelist', icon: UserCheck, placeholder: 'Player name', empty: 'Nobody is on the whitelist.' },
  { id: 'ops', label: 'OPs', icon: ShieldCheck, placeholder: 'Player name', empty: 'There are no operators.' },
  { id: 'banned-players', label: 'Banned players', icon: UserX, danger: true, placeholder: 'Player name', empty: 'No players are banned.' },
  { id: 'banned-ips', label: 'Banned IPs', icon: ShieldOff, danger: true, placeholder: 'IP address', empty: 'No IP addresses are banned.' },
];

interface ListResponse {
  entries: PlayerEntry[];
  message?: string;
}

export function PlayersPage() {
  const { snapshot } = useServer();
  const toast = useToast();
  const [tabId, setTabId] = useState<PlayerListName>('whitelist');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useApi<ListResponse>(`/api/players/${tabId}`);

  const tab = TABS.find((item) => item.id === tabId) ?? TABS[0]!;
  const transitioning = snapshot !== null && (snapshot.status === 'starting' || snapshot.status === 'stopping');

  const finish = (response: ListResponse, fallback: string) => {
    list.setData({ entries: response.entries });
    toast.success(response.message ? response.message : fallback);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() === '') return;
    setBusy(true);
    try {
      finish(await api.post<ListResponse>(`/api/players/${tabId}`, { value }), 'Added');
      setValue('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: PlayerEntry) => {
    try {
      finish(await api.del<ListResponse>(`/api/players/${tabId}?id=${q(entry.id)}`), 'Removed');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="stack">
      <div className="player-tabs" role="tablist" aria-label="Player lists">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tabId}
              className={item.danger ? 'player-tab danger' : 'player-tab'}
              onClick={() => {
                setTabId(item.id);
                setValue('');
              }}
            >
              <Icon size={30} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="card">
        <form className="add-row" onSubmit={add}>
          <input
            className="input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={tab.placeholder}
            aria-label={tab.placeholder}
            disabled={transitioning}
            maxLength={64}
            autoComplete="off"
          />
          <Button type="submit" variant={tab.danger ? 'red' : 'blue'} busy={busy} disabled={transitioning || value.trim() === ''}>
            {tab.danger ? <Ban size={16} /> : <UserPlus size={16} />}
            {tab.danger ? 'Ban' : 'Add'}
          </Button>
        </form>

        {transitioning ? <div className="empty">Lists can be edited again when the server has finished starting or stopping.</div> : null}
        {list.loading && !list.data ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : null}
        {list.error ? <div className="empty">{list.error}</div> : null}
        {list.data && list.data.entries.length === 0 ? <div className="empty">{tab.empty}</div> : null}
        {list.data?.entries.map((entry) => (
          <div className="row" key={entry.id}>
            <User size={22} />
            <div className="row-grow">
              {entry.name}
              {entry.detail ? <div className="row-sub">{entry.detail}</div> : null}
            </div>
            <Button variant="red" size="sm" onClick={() => void remove(entry)} aria-label={`Remove ${entry.name}`} disabled={transitioning}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
