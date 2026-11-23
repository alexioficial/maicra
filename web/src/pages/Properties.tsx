import { useCallback, useEffect, useState } from 'react';
import { Info, RotateCcw, Save } from 'lucide-react';
import { api, errorMessage, q } from '../api';
import { Button, Spinner } from '../components/ui';
import { useToast } from '../state/Toast';

const PATH = '/server.properties';

/** Raw editor for server.properties. Nothing is written until the user presses Save. */
export function PropertiesPage() {
  const toast = useToast();
  // `saved` is the text that is on disk right now. null while the file is loading.
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ content: string }>(`/api/files/content?path=${q(PATH)}`)
      .then((data) => {
        if (cancelled) return;
        setSaved(data.content);
        setText(data.content);
      })
      .catch((caught: unknown) => !cancelled && setError(errorMessage(caught)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const dirty = saved !== null && text !== saved;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.put('/api/files/content', { path: PATH, content: text });
      setSaved(text);
      toast.success('Saved. Changes apply the next time the server starts.');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [text, toast]);

  const reload = () => {
    if (dirty && !window.confirm('Discard your changes and load the file from the server again?')) return;
    setError(null);
    setSaved(null);
    setVersion((value) => value + 1);
  };

  // Ctrl+S saves. This is still a manual save, there is no autosave on this page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, saving, save]);

  // Warn before the edits are lost: closing the tab, and clicking a menu link inside the panel.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onLinkClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && !window.confirm('You have unsaved changes. Leave this page without saving?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture phase, so this runs before the router handles the click.
    document.addEventListener('click', onLinkClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onLinkClick, true);
    };
  }, [dirty]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">
          Properties
          {dirty ? (
            <span className="tag tag-working" style={{ marginLeft: 12, verticalAlign: 'middle' }}>
              Unsaved
            </span>
          ) : null}
        </h1>
        <div className="toolbar">
          <Button variant="dark" onClick={reload} disabled={saved === null && !error}>
            <RotateCcw size={16} />
            Reload
          </Button>
          <Button variant="green" onClick={() => void save()} busy={saving} disabled={!dirty}>
            <Save size={16} />
            Save
          </Button>
        </div>
      </div>

      <p className="hint">
        <Info size={18} style={{ flex: 'none', marginTop: 2 }} />
        <span>
          This is the raw <code>server.properties</code> file. Nothing is saved until you press Save. Changes apply the next time the server
          starts, and the Minecraft image may set a few keys again at that point, such as the port and the RCON settings.
        </span>
      </p>

      {error ? (
        <div className="notice">
          {error}. The file is created the first time the server starts.
        </div>
      ) : saved === null ? (
        <div className="loading">
          <Spinner />
        </div>
      ) : (
        <div className="card">
          <textarea
            className="editor"
            style={{ minHeight: '65vh' }}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Contents of server.properties"
          />
        </div>
      )}
    </div>
  );
}
