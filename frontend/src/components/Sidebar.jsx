import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import lguLogo from '../assets/LGU_LOGO.png';
import { LGU_NAME } from './Brand.jsx';

const ICON_PROPS = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const Icons = {
  draw: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /><path d="M5 3l2 2M19 3l-2 2" /></svg>
  ),
  winners: (
    <svg {...ICON_PROPS}><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" /></svg>
  ),
  audit: (
    <svg {...ICON_PROPS}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  admin: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  pin: (
    <svg {...ICON_PROPS} width={20} height={20}><path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3H7l3-3z" /></svg>
  ),
  menu: (
    <svg {...ICON_PROPS}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
  close: (
    <svg {...ICON_PROPS}><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
};

export const NAV_ITEMS = [
  { to: '/', label: 'Live Draw', icon: Icons.draw, end: true },
  { to: '/winners', label: 'Winners', icon: Icons.winners },
  { to: '/audit', label: 'Audit / Verify', icon: Icons.audit },
  { to: '/admin', label: 'Admin', icon: Icons.admin },
];

const STORAGE_KEY = 'sidebar_pinned';
const COLLAPSE_DELAY_MS = 180; // small grace period so the sidebar doesn't flicker when the cursor skims its edge

export default function Sidebar() {
  const location = useLocation();
  // pinned = stays expanded and pushes the page content over.
  // Otherwise the sidebar rests collapsed (icons only) and expands over the
  // content while the cursor (or keyboard focus) is inside it.
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const leaveTimer = useRef(null);
  const expanded = pinned || hovered;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, pinned ? '1' : '0'); } catch { /* ignore */ }
    document.documentElement.classList.toggle('sidebar-pinned', pinned);
  }, [pinned]);

  const open = () => { clearTimeout(leaveTimer.current); setHovered(true); };
  const close = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), COLLAPSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Esc closes the mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const activeIndex = NAV_ITEMS.findIndex((it) =>
    it.end ? location.pathname === it.to : location.pathname.startsWith(it.to));

  return (
    <>
      <button
        className="sidebar-burger"
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((o) => !o)}
      >
        {mobileOpen ? Icons.close : Icons.menu}
      </button>
      <div className={`sidebar-overlay ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} />

      <aside
        className={`sidebar ${expanded ? '' : 'collapsed'} ${pinned ? 'pinned' : ''} ${mobileOpen ? 'open' : ''}`}
        aria-label="Main navigation"
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}
      >
        <NavLink to="/" className="sidebar-brand" title={LGU_NAME}>
          <img src={lguLogo} alt="Municipality of General Luna Logo" className="sidebar-logo" />
          <span className="sidebar-brand-text">
            <span className="sidebar-brand-title">{LGU_NAME}</span>
            <span className="sidebar-brand-sub">Raffle Draw System</span>
          </span>
        </NavLink>

        <nav className="sidebar-nav" style={{ '--active-index': activeIndex }}>
          <span className={`sidebar-indicator ${activeIndex < 0 ? 'hidden' : ''}`} aria-hidden="true" />
          {NAV_ITEMS.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
              style={{ '--i': i }}
              title={expanded ? undefined : item.label}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <button
          className={`sidebar-toggle ${pinned ? 'on' : ''}`}
          onClick={() => setPinned((p) => !p)}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin sidebar (auto-hide on mouse leave)' : 'Pin sidebar open'}
          title={pinned ? 'Unpin — auto-hide' : 'Pin open'}
        >
          <span className="sidebar-icon sidebar-toggle-icon">{Icons.pin}</span>
          <span className="sidebar-label">{pinned ? 'Pinned open' : 'Pin open'}</span>
        </button>
      </aside>
    </>
  );
}
