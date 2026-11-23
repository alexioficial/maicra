import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  Download,
  File as FileIcon,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  House,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
  ChevronRight,
} from 'lucide-react';
import type { FileEntry, FileListing } from '@api/types';
import { api, errorMessage, q, uploadFiles } from '../api';
import { Button, Modal, Spinner } from '../components/ui';
import { cx, formatBytes } from '../format';
import { useApi } from '../hooks';
import { useToast } from '../state/Toast';

const BINARY_EXTENSIONS = new Set(['jar', 'zip', 'gz', 'tar', '7z', 'rar', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'dat', 'dat_old', 'mca', 'nbt', 'bin', 'exe', 'so', 'dll']);

const joinPath = (directory: string, name: string) => (directory === '/' ? `/${name}` : `${directory}/${name}`);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

type Dialog =
  | { kind: 'folder' }
  | { kind: 'file' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entry: FileEntry };

export function FilesPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const directory = params.get('path') ?? '/';
  const listing = useApi<FileListing>(`/api/files?path=${q(directory)}`);
  const [editing, setEditing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const go = useCallback(
    (path: string) => {
      setParams(path === '/' ? {} : { path });
    },
    [setParams],
  );

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setProgress(0);
    try {
      await uploadFiles(directory, files, setProgress);
      toast.success(files.length === 1 ? `Uploaded ${files[0]?.name}` : `Uploaded ${files.length} files`);
      listing.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setProgress(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  };

  const open = (entry: FileEntry) => {
    const path = joinPath(directory, entry.name);
    if (entry.type === 'dir') return go(path);
    if (BINARY_EXTENSIONS.has(extensionOf(entry.name))) {
      window.location.href = `/api/files/download?path=${q(path)}`;
      return;
    }
    setEditing(path);
  };

  if (editing !== null) {
    return (
      <Editor
        path={editing}
        onClose={() => {
          setEditing(null);
          listing.reload();
        }}
      />
    );
  }

  const segments = directory.split('/').filter(Boolean);
  const entries = listing.data?.entries ?? [];

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
      <div className="crumbs" aria-label="Current folder">
        <button type="button" className="crumb" onClick={() => go('/')} aria-label="Server folder">
          <House size={16} />
        </button>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ChevronRight size={16} className="crumb-sep" />
            <button type="button" className="crumb" onClick={() => go('/' + segments.slice(0, index + 1).join('/'))}>
              {segment}
            </button>
          </span>
        ))}
      </div>

      <div className="toolbar">
        <input ref={picker} type="file" multiple hidden onChange={(event) => {
          void upload([...(event.target.files ?? [])]);
          event.target.value = '';
        }} />
        <Button variant="blue" onClick={() => picker.current?.click()} disabled={progress !== null}>
          <Upload size={16} />
          Upload
        </Button>
        <Button variant="dark" onClick={() => setDialog({ kind: 'folder' })}>
          <FolderPlus size={16} />
          New folder
        </Button>
        <Button variant="dark" onClick={() => setDialog({ kind: 'file' })}>
          <FilePlus size={16} />
          New file
        </Button>
        <span className="toolbar-spacer" />
        <Button variant="dark" onClick={listing.reload} aria-label="Refresh" busy={listing.loading}>
          <RefreshCw size={16} />
        </Button>
      </div>

      {progress !== null ? (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}

      {listing.error ? <div className="notice">{listing.error}</div> : null}
      {listing.loading && !listing.data ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : null}

      {listing.data ? (
        <div className="file-list">
          {entries.length === 0 ? <div className="row empty">This folder is empty. Drop files here to upload them.</div> : null}
          {entries.map((entry) => {
            const path = joinPath(directory, entry.name);
            return (
              <div className="row" key={entry.name}>
                <button type="button" className="file-name" onClick={() => open(entry)}>
                  {entry.type === 'dir' ? <Folder size={22} /> : extensionOf(entry.name) === 'properties' || extensionOf(entry.name) === 'yml' ? <FileText size={22} /> : <FileIcon size={22} />}
                  {entry.name}
                </button>
                {entry.type === 'file' ? <span className="chip">{formatBytes(entry.size)}</span> : null}
                <Button variant="dark" size="sm" onClick={() => setDialog({ kind: 'rename', entry })} aria-label={`Rename ${entry.name}`}>
                  <Pencil size={15} />
                </Button>
                {entry.type === 'file' ? (
                  <a className="btn btn-blue btn-sm" href={`/api/files/download?path=${q(path)}`} aria-label={`Download ${entry.name}`}>
                    <Download size={15} />
                  </a>
                ) : null}
                <Button variant="red" size="sm" onClick={() => setDialog({ kind: 'delete', entry })} aria-label={`Delete ${entry.name}`}>
                  <Trash2 size={15} />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {dialog ? (
        <FileDialog
          dialog={dialog}
          directory={directory}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            toast.success(message);
            listing.reload();
          }}
        />
      ) : null}
    </div>
  );
}

interface FileDialogProps {
  dialog: Dialog;
  directory: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Create, rename and delete prompts share one modal. */
function FileDialog({ dialog, directory, onClose, onDone }: FileDialogProps) {
  const toast = useToast();
  const [name, setName] = useState(dialog.kind === 'rename' ? dialog.entry.name : '');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (dialog.kind === 'folder') {
        await api.post('/api/files/folder', { path: joinPath(directory, name.trim()) });
        onDone('Folder created');
      } else if (dialog.kind === 'file') {
        await api.post('/api/files/file', { path: joinPath(directory, name.trim()) });
        onDone('File created');
      } else if (dialog.kind === 'rename') {
        await api.post('/api/files/rename', { path: joinPath(directory, dialog.entry.name), name: name.trim() });
        onDone('Renamed');
      } else {
        await api.del(`/api/files?path=${q(joinPath(directory, dialog.entry.name))}`);
        onDone(`Deleted ${dialog.entry.name}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  if (dialog.kind === 'delete') {
    return (
      <Modal title={`Delete ${dialog.entry.name}?`} color="var(--danger)" onClose={onClose}>
        <form onSubmit={submit} className="modal-body" style={{ padding: 0 }}>
          <p>
            {dialog.entry.type === 'dir' ? 'This folder and everything inside it will be deleted.' : 'This file will be deleted.'} This cannot be undone.
          </p>
          <div className="modal-actions">
            <Button type="submit" variant="red" size="lg" busy={busy} autoFocus>
              <Trash2 size={18} />
              Delete
            </Button>
            <Button variant="dark" size="lg" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    );
  }

  const title = dialog.kind === 'folder' ? 'New folder' : dialog.kind === 'file' ? 'New file' : 'Rename';
  return (
    <Modal title={title} color="var(--main)" onClose={onClose}>
      <form onSubmit={submit} className="modal-body" style={{ padding: 0 }}>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          aria-label="Name"
          autoFocus
          required
          maxLength={255}
        />
        <div className="modal-actions">
          <Button type="submit" variant="green" size="lg" busy={busy} disabled={name.trim() === ''}>
            {dialog.kind === 'rename' ? 'Rename' : 'Create'}
          </Button>
          <Button variant="dark" size="lg" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Editor({ path, onClose }: { path: string; onClose: () => void }) {
  const toast = useToast();
  const [original, setOriginal] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ content: string }>(`/api/files/content?path=${q(path)}`)
      .then((data) => {
        if (cancelled) return;
        setOriginal(data.content);
        setContent(data.content);
      })
      .catch((caught: unknown) => !cancelled && setError(errorMessage(caught)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const dirty = original !== null && content !== original;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.put('/api/files/content', { path, content });
      setOriginal(content);
      toast.success('Saved');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [path, content, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, save]);

  const close = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onClose();
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-head-title" style={{ overflowWrap: 'anywhere' }}>
          <FileText size={22} />
          {path}
          {dirty ? <span className="tag tag-working">Unsaved</span> : null}
        </span>
        <span className="toolbar">
          <Button variant="green" size="sm" onClick={() => void save()} busy={saving} disabled={!dirty}>
            <Save size={15} />
            Save
          </Button>
          <Button variant="light" size="sm" onClick={close}>
            <X size={15} />
            Close
          </Button>
        </span>
      </div>
      {error ? (
        <div className="empty">{error}</div>
      ) : original === null ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <textarea
          className="editor"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          aria-label={`Contents of ${path}`}
        />
      )}
    </div>
  );
}
