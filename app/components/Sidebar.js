'use client';
import { useState, useSyncExternalStore } from 'react';
import BrandLogo from './BrandLogo';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  );
}
function ChevronIcon({ flipped }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: flipped ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
  );
}
function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
  );
}

function subscribeSidebar(callback) {
  window.addEventListener('storage', callback);
  window.addEventListener('cft-sidebar-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('cft-sidebar-change', callback);
  };
}

function getSidebarSnapshot() {
  return localStorage.getItem('cft-sidebar-collapsed') === '1';
}

function getSidebarServerSnapshot() {
  return false;
}

/**
 * Shared sidebar navigation used by /dashboard and /admin.
 *
 * items: [{ key, label, icon(optional JSX), badge(optional number/string) }]
 * activeKey: currently selected item key
 * onSelect(key): called when a nav item is tapped
 * badgeText: small pill shown under the logo (e.g. "Super Admin")
 * extraLink: { label, onClick } - secondary link shown above sign out (e.g. "Admin" / "Dashboard")
 *
 * On mobile (<900px) the sidebar is a slide-in drawer, opened via the hamburger
 * button and closed via the overlay, a nav tap, or the in-drawer close button.
 * On desktop it can be collapsed to an icon-only rail via the chevron toggle;
 * the collapsed state is remembered across visits.
 */
export default function Sidebar({ items, activeKey, onSelect, badgeText, extraLink, dark, onToggleDark, onSignOut }) {
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, getSidebarServerSnapshot);

  function toggleCollapsed() {
    const next = !collapsed;
    localStorage.setItem('cft-sidebar-collapsed', next ? '1' : '0');
    window.dispatchEvent(new Event('cft-sidebar-change'));
  }

  function selectItem(key) {
    onSelect(key);
    setOpen(false);
  }

  return (
    <>
      {/* Mobile-only top bar with hamburger, shown instead of the desktop sidebar */}
      <div className="mobile-topbar">
        <button
          className="hamburger-btn"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <BrandLogo className="mobile-topbar-logo" />
        <button className="theme-btn" onClick={onToggleDark} title="Toggle dark mode">
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

      <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-brand">
          <BrandLogo className="sidebar-logo" />
          {badgeText && <span className="sidebar-badge">{badgeText}</span>}
          {/* Close button — mobile drawer only */}
          <button className="sidebar-close-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          {/* Collapse / expand toggle — desktop only. Stays visible (icon-only)
              even when the rail is collapsed, so there's a single, always-findable
              way to re-expand it instead of a separate floating button. */}
          <button
            className="sidebar-collapse-btn"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            <ChevronIcon flipped={collapsed} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {items.map(item => (
            <button
              key={item.key}
              className={activeKey === item.key ? 'active' : ''}
              onClick={() => selectItem(item.key)}
              title={collapsed ? item.label : undefined}
            >
              {item.icon && <span className="sidebar-nav-icon">{item.icon}</span>}
              <span className="sidebar-nav-label">{item.label}</span>
              {item.badge ? <span className="sidebar-nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {extraLink && (
            <button className="secondary" onClick={() => { extraLink.onClick(); setOpen(false); }} title={collapsed ? extraLink.label : undefined}>
              <span className="sidebar-nav-icon"><LinkIcon /></span>
              <span className="sidebar-nav-label">{extraLink.label}</span>
            </button>
          )}
          <button className="theme-btn sidebar-theme-btn" onClick={onToggleDark} title="Toggle dark mode">
            {dark ? <SunIcon /> : <MoonIcon />}
            <span className="sidebar-nav-label">{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button className="secondary" onClick={onSignOut} title={collapsed ? 'Sign out' : undefined}>
            <span className="sidebar-nav-icon"><LogoutIcon /></span>
            <span className="sidebar-nav-label">Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
