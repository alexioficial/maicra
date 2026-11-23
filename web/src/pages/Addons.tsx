import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { Download, Folder, FolderOpen, Info, Package, Plug, Puzzle, RefreshCw, Trash2, Upload, type LucideIcon } from 'lucide-react';
import type { FileEntry, FileListing, PropertiesResponse, SoftwareType } from '@api/types';
import { ApiError, api, errorMessage, q, uploadFiles } from '../api';
import { Button, Modal, Spinner } from '../components/ui';
import { cx, formatBytes } from '../format';
import { decodeProperty } from '../mc';
import { isModLoader, isPluginServer, softwareName } from '../software';
import { useServer } from '../state/Server';
import { useToast } from '../state/Toast';

/** What makes the mods, plugins and datapacks pages differ. The page itself is the same for all three. */
interface AddonKind {
  title: string;
  icon: LucideIcon;
  singular: string;
  plural: string;
  /** Folder name. Datapacks live inside the world folder, the rest at the top of the server folder. */
  folder: string;
  inWorld: boolean;
  /** Which entries of the folder are shown as items. */
  isItem: (entry: FileEntry) => boolean;
  /** Which uploaded files are accepted. */
  uploadPattern: RegExp;
  accept: string;
  rejectMessage: string;
  /** Whether the current software can use this kind of add-on. */
  supports: (type: SoftwareType) => boolean;
  unsupported: string;
  hint: (software: string, location: string) => string;
  runningNote: string;
}

const isJar = (entry: FileEntry) => entry.type === 'file' && /\.jar(\.disabled)?$/i.test(entry.name);

const MODS: AddonKind = {
  title: 'Mods',
  icon: Puzzle,
  singular: 'mod',
  plural: 'mods',
  folder: 'mods',
  inWorld: false,
  isItem: isJar,
  uploadPattern: /\.jar$/i,
  accept: '.jar',
  rejectMessage: 'Only .jar files can be added as mods.',
  supports: isModLoader,
  unsupported: 'Mods work with Fabric, Quilt, NeoForge and Forge.',
  hint: (software) => `Add .jar files made for ${software}. They are loaded the next time the server starts.`,
  runningNote: 'The server is running. Restart it to load added or removed mods.',
};

const PLUGINS: AddonKind = {
  title: 'Plugins',
  icon: Plug,
  singular: 'plugin',
  plural: 'plugins',
  folder: 'plugins',
  inWorld: false,
  isItem: isJar,
  uploadPattern: /\.jar$/i,
  accept: '.jar',
  rejectMessage: 'Only .jar files can be added as plugins.',
  supports: isPluginServer,
  unsupported: 'Plugins work with Paper, Spigot and Purpur.',
  hint: (software) => `Add .jar files made for ${software}. They are loaded the next time the server starts. Each plugin keeps its settings in its own folder.`,
  runningNote: 'The server is running. Restart it to load added or removed plugins.',
};

/** A datapack is a .zip file or an unzipped folder. */
const DATAPACKS: AddonKind = {
  title: 'Datapacks',
  icon: Package,
  singular: 'datapack',
  plural: 'datapacks',
  folder: 'datapacks',
  inWorld: true,
  isItem: (entry) => entry.type === 'dir' || /\.zip$/i.test(entry.name),
  uploadPattern: /\.zip$/i,
  accept: '.zip',
  rejectMessage: 'Datapacks are .zip files.',
  supports: () => true,
  unsupported: '',
  hint: (_software, location) => `Add datapack .zip files. They go into ${location} and load when the world starts.`,
  runningNote: 'The server is running. Run /reload in the Console, or restart it, to load changes.',
};

export const ModsPage = () => <AddonsPage kind={MODS} />;
export const PluginsPage = () => <AddonsPage kind={PLUGINS} />;
export const DatapacksPage = () => <AddonsPage kind={DATAPACKS} />;

/** A folder of the server shown as a simple list with upload, download and delete. No online search. */
function AddonsPage({ kind }: { kind: AddonKind }) {
  const { snapshot } = useServer();
  const toast = useToast();
  const Icon = kind.icon;
  const [directory, setDirectory] = useState<string | null>(kind.inWorld ? null : `/${kind.folder}`);
  const [items, setItems] = useState<FileEntry[] | null>(null);
  const [others, setOthers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<FileEntry | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const supported = snapshot !== null && kind.supports(snapshot.software.type);

  // Datapacks sit in the folder of the world, whose name is a server setting.
  useEffect(() => {
    if (!kind.inWorld || !supported) return;
    let cancelled = false;
    api
      .get<PropertiesResponse>('/api/options/properties')
      .then((response) => {
        const level = decodeProperty(response.properties['level-name'] ?? '') || 'world';
        if (!cancelled) setDirectory(`/${level}/${kind.folder}`);
      })
      .catch(() => !cancelled && setDirectory(`/world/${kind.folder}`));
    return () => {
      cancelled = true;
    };
  }, [kind, supported]);

  const load = useCallback(async () => {
    if (directory === null) return;
    setLoading(true);
    try {
      const listing = await api.get<FileListing>(`/api/files?path=${q(directory)}`);
      setItems(listing.entries.filter(kind.isItem));
      setOthers(listing.entries.filter((entry) => !kind.isItem(entry)).length);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        // The server creates the folder the first time it runs. Until then, create it so uploads work.
        try {
          await api.post('/api/files/folder', { path: directory, parents: true });
          setItems([]);
          setOthers(0);
          setError(null);
        } catch (inner) {
          setError(errorMessage(inner));
        }
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setLoading(false);
    }
  }, [directory, kind]);

  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  if (!snapshot) {
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="stack">
        <h1 className="page-title">{kind.title}</h1>
        <div className="notice">
          <Info size={20} />
          {kind.unsupported} You are using {softwareName(snapshot.software.type)}.
        </div>
        <div>
          <Link className="btn btn-green btn-lg" to="/software">
            Change software
          </Link>
        </div>
      </div>
    );
  }

  const software = `${softwareName(snapshot.software.type)} ${snapshot.software.version}`;
  const running = snapshot.startedAt !== null;
  const location = directory === null ? kind.folder : directory.slice(1);

  const upload = async (files: File[]) => {
    if (directory === null) return;
    const accepted = files.filter((file) => kind.uploadPattern.test(file.name));
    if (accepted.length !== files.length) toast.error(kind.rejectMessage);
    if (accepted.length === 0) return;
    setProgress(0);
    try {
      await uploadFiles(directory, accepted, setProgress);
      toast.success(accepted.length === 1 ? `Added ${accepted[0]?.name}` : `Added ${accepted.length} ${kind.plural}`);
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setProgress(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  };

  const remove = async (entry: FileEntry) => {
    try {
      await api.del(`/api/files?path=${q(`${directory}/${entry.name}`)}`);
      toast.success(`Deleted ${entry.name}`);
      setDeleting(null);
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  return (
    <div
      className={cx('stack', dragging && 'dropzone')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="page-head">
        <h1 className="page-title">{kind.title}</h1>
        <div className="toolbar">
          <input
            ref={picker}
            type="file"
            accept={kind.accept}
            multiple
            hidden
            onChange={(event) => {
              void upload([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <Button variant="blue" onClick={() => picker.current?.click()} disabled={progress !== null || directory === null}>
            <Upload size={16} />
            Upload
          </Button>
          <Link className="btn btn-dark" to={`/files?path=${q(directory ?? '/')}`}>
            <FolderOpen size={16} />
            Open in Files
          </Link>
          <Button variant="dark" onClick={() => void load()} aria-label="Refresh" busy={loading}>
            <RefreshCw size={16} />
          </Button>
        </div>
      </div>

      {running ? (
        <div className="notice">
          <Info size={20} />
          {kind.runningNote}
        </div>
      ) : (
        <p className="hint">
          <Info size={16} />
          {kind.hint(software, location)}
        </p>
      )}

      {progress !== null ? (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}

      {error ? <div className="notice">{error}</div> : null}
      {items === null && !error ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : null}

      {items ? (
        <div className="file-list">
          {items.length === 0 ? (
            <div className="row empty">
              No {kind.plural} yet. Drop {kind.accept} files here or press Upload.
            </div>
          ) : null}
          {items.map((item) => (
            <div className="row" key={item.name}>
              {item.type === 'dir' ? <Folder size={22} /> : <Icon size={22} />}
              <div className="row-grow">{item.name}</div>
              {item.type === 'file' ? <span className="chip">{formatBytes(item.size)}</span> : null}
              {item.type === 'file' ? (
                <a className="btn btn-blue btn-sm" href={`/api/files/download?path=${q(`${directory}/${item.name}`)}`} aria-label={`Download ${item.name}`}>
                  <Download size={15} />
                </a>
              ) : null}
              <Button variant="red" size="sm" onClick={() => setDeleting(item)} aria-label={`Delete ${item.name}`}>
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {items && others > 0 ? (
        <p className="hint">
          <Info size={16} />
          <span>
            {others === 1 ? '1 other item is' : `${others} other items are`} in the {kind.folder} folder. <Link to={`/files?path=${q(directory ?? '/')}`}>Open it in Files</Link> to see{' '}
            {others === 1 ? 'it' : 'them'}.
          </span>
        </p>
      ) : null}

      {deleting ? (
        <Modal title={`Delete ${deleting.name}?`} color="var(--danger)" onClose={() => setDeleting(null)}>
          <p>This {kind.singular} will be removed from the server. This cannot be undone.</p>
          <div className="modal-actions">
            <Button variant="red" size="lg" onClick={() => void remove(deleting)} autoFocus>
              <Trash2 size={18} />
              Delete
            </Button>
            <Button variant="dark" size="lg" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
