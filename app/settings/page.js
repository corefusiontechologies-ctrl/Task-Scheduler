'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDarkMode } from '../components/useDarkMode';
import Sidebar from '../components/Sidebar';
import BrandLogo from '../components/BrandLogo';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || `Request failed (${response.status})`;
    const err = new Error(message);
    err.fieldErrors = data.fields || null;
    throw err;
  }
  return data;
}

const NAV = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { key: 'tasks', label: 'Tasks', href: '/dashboard' },
  { key: 'board', label: 'Board', href: '/dashboard' },
  { key: 'calendar', label: 'Calendar', href: '/dashboard' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [dark, toggleDark] = useDarkMode();
  const toast = useToast();
  const confirm = useConfirm();
  const [user, setUser] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [theme, setTheme] = useState('auto');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then(readApiResponse)
      .then(data => {
        const u = data.user || {};
        setUser(u);
        setDisplayName(u.name || '');
        setEmail(u.email || '');
        setUsername(u.username || '');
        setTheme(u.theme || 'auto');
      })
      .catch(error => setLoadError(error.message));
  }, []);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const response = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: displayName.trim(),
          email: email.trim(),
          username: username.trim(),
          theme,
          current_password: currentPassword,
        }),
      });
      const data = await readApiResponse(response);
      setUser(data.user);
      setCurrentPassword('');
      toast.success('Your details were saved.');
      if (data.user.username !== username.trim()) {
        // Username feeds the session; keep the nav in sync with the new value.
        setUsername(data.user.username);
      }
    } catch (error) {
      toast.error('Could not save your details', { detail: error.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('The two new passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      toast.error('Use at least 12 characters.');
      return;
    }
    if (!(await confirm('Change your password?', {
      detail: 'Every other signed-in device will be signed out.',
      tone: 'danger',
    }))) return;

    setSavingPassword(true);
    try {
      const response = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: newPassword,
          current_password: currentPassword,
        }),
      });
      const data = await readApiResponse(response);
      setUser(data.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed.', 'Use it the next time you sign in.');
    } catch (error) {
      toast.error('Could not change your password', { detail: error.message });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandLogo className="sidebar-logo" />
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button key={item.key} className="active" onClick={() => router.push(item.href)}>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-heading">Workspace</div>
            <button className="active">
              <span className="sidebar-nav-label">Settings</span>
            </button>
          </div>
        </nav>
        <div className="sidebar-footer">
          <button className="secondary sidebar-theme-btn" onClick={toggleDark}>
            <span className="sidebar-nav-label">{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button className="secondary" onClick={() => router.push('/')}>
            <span className="sidebar-nav-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <div className="container app">
          <header className="dash-header">
            <div className="dash-header-text">
              <h1 className="dash-greeting">Your settings</h1>
              <p className="dash-subtitle">Manage the account you sign in with.</p>
            </div>
          </header>

          {loadError && <div className="alert error-alert" role="alert">{loadError}</div>}

          <div className="settings-grid">
            <form className="card settings-card" onSubmit={saveProfile}>
              <div className="card-head"><strong>Profile</strong></div>

              <label className="field">
                <span>Display name</span>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={150} />
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
                <small className="muted">Used for reminders. Leave blank if you do not want email.</small>
              </label>

              <label className="field">
                <span>Username</span>
                <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
              </label>

              <label className="field">
                <span>Theme</span>
                <select value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="auto">Match my system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>

              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <small className="muted">Needed to confirm any change to your name, email or username.</small>
              </label>

              <button className="primary" disabled={savingProfile} style={{ alignSelf: 'flex-start' }}>
                {savingProfile ? 'Saving…' : 'Save changes'}
              </button>
            </form>

            <form className="card settings-card" onSubmit={savePassword}>
              <div className="card-head"><strong>Password</strong></div>

              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>

              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <small className="muted">At least 12 characters.</small>
              </label>

              <label className="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>

              <button className="primary" disabled={savingPassword} style={{ alignSelf: 'flex-start' }}>
                {savingPassword ? 'Saving…' : 'Change password'}
              </button>

              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Changing your password signs out every other device. Roles and permissions are managed by a superadmin.
              </p>
            </form>
          </div>

          {user && (
            <p className="muted" style={{ fontSize: 13 }}>
              Signed in as {user.username} ({user.role}).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}