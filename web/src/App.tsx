import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { DatapacksPage, ModsPage, PluginsPage } from './pages/Addons';
import { ConsolePage } from './pages/Console';
import { FilesPage } from './pages/Files';
import { LogPage } from './pages/Log';
import { Login } from './pages/Login';
import { OptionsPage } from './pages/Options';
import { PlayersPage } from './pages/Players';
import { PropertiesPage } from './pages/Properties';
import { ServerPage } from './pages/Server';
import { SoftwarePage } from './pages/Software';
import { useAuth } from './state/Auth';
import { ServerProvider } from './state/Server';

export function App() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="loading" style={{ minHeight: '100%' }}>
        <Spinner />
      </div>
    );
  }
  if (state.status === 'out') return <Login />;

  return (
    <ServerProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ServerPage />} />
          <Route path="options" element={<OptionsPage />} />
          <Route path="properties" element={<PropertiesPage />} />
          <Route path="console" element={<ConsolePage />} />
          <Route path="log" element={<LogPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="software" element={<SoftwarePage />} />
          <Route path="mods" element={<ModsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="datapacks" element={<DatapacksPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ServerProvider>
  );
}
