'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('cft-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  }, []);

  async function handleLogin() {
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setLoading(true); setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error || 'Invalid credentials'); return; }
    // Redirect superadmin to admin page, others to dashboard
    router.push(data.isSuperAdmin ? '/admin' : '/dashboard');
    router.refresh();
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',padding:'1rem'}}>
      <div className="card" style={{width:'100%',maxWidth:380,textAlign:'center'}}>
        <div className="login-header">
          <img src="/logo.png" alt="CoreFusion Technologies" className="login-logo" />
        </div>
        <h2 style={{margin:'0 0 1.5rem',fontSize:18}}>Sign in to your account</h2>
        {error && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,marginBottom:12,fontSize:14}}>{error}</p>}
        <div style={{textAlign:'left',marginBottom:12}}>
          <label style={{fontSize:13,color:'var(--ink-soft)'}}>Username</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key==='Enter' && handleLogin()}
            placeholder="your_username"
            autoComplete="username"
            style={{marginTop:4}}
          />
        </div>
        <div style={{textAlign:'left',marginBottom:20}}>
          <label style={{fontSize:13,color:'var(--ink-soft)'}}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key==='Enter' && handleLogin()}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{marginTop:4}}
          />
        </div>
        <button onClick={handleLogin} disabled={loading} style={{width:'100%'}}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
