import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Folder,
  LogOut,
  Package,
  Pickaxe,
  Plug,
  Power,
  Puzzle,
  Settings2,
  SlidersHorizontal,
  Square,
  Terminal,
  Users,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { cx } from '../format';
import { isModLoader, isPluginServer } from '../software';
import { useAuth } from '../state/Auth';
import { STATUS_COLOR, useServer } from '../state/Server';

const NAV = [
  { to: '/', label: 'Server', icon: Power, end: true },
  { to: '/options', label: 'Options', icon: SlidersHorizontal },
  { to: '/console', label: 'Console', icon: Terminal },
  { to: '/log', label: 'Log', icon: FileText },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/software', label: 'Software', icon: Settings2 },
  // Shown only when the software can use them. Datapacks work with every software, so they are always shown.
  { to: '/mods', label: 'Mods', icon: Puzzle, when: isModLoader },
  { to: '/plugins', label: 'Plugins', icon: Plug, when: isPluginServer },
  { to: '/datapacks', label: 'Datapacks', icon: Package },
  { to: '/files', label: 'Files', icon: Folder },
];

const COLLAPSE_KEY = 'maicra.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const { state, logout } = useAuth();
  const { snapshot } = useServer();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
      } catch {
        // Remembering the choice is optional.
      }
      return !value;
    });
  };

  const status = snapshot?.status ?? 'offline';
  const software = snapshot ? `${snapshot.software.type} ${snapshot.software.version}` : '';

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Maicra home">
          <span className="brand-mark">
            <Pickaxe size={24} strokeWidth={2.6} />
          </span>
          MAICRA
        </NavLink>
        <div className="topbar-right">
          {state.status === 'in' ? <span className="topbar-user">{state.email}</span> : null}
          <button type="button" className="btn btn-dark btn-sm" onClick={() => void logout()}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      <div className={cx('shell', collapsed && 'collapsed')}>
        <aside className="sidebar" style={{ '--status-color': STATUS_COLOR[status] } as CSSProperties}>
          <div className="sidebar-server">
            <div className="sidebar-server-text">
              <div className="sidebar-server-name">Minecraft server</div>
              <div className="sidebar-server-sub" style={{ textTransform: 'capitalize' }}>
                {software}
              </div>
            </div>
            <span className="status-dot" title={status} aria-label={`Server is ${status}`}>
              <Square size={11} fill="currentColor" strokeWidth={0} />
            </span>
          </div>

          <nav className="nav" aria-label="Main">
            {NAV.filter((item) => !item.when || (snapshot !== null && item.when(snapshot.software.type))).map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('nav-item', isActive && 'active')} title={label}>
                <Icon size={24} />
                <span className="nav-label">{label}</span>
                <ChevronRight className="nav-chevron" size={22} />
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-foot">
            <button type="button" className="icon-btn" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
              {collapsed ? <ChevronsRight size={24} /> : <ChevronsLeft size={24} />}
            </button>
          </div>
        </aside>

        <main className="main">
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
