import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
const ThemeIcon = ({ theme }) => theme === 'light'
  ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.2 8.2 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2Z"/></svg>
  : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
export default function Login() {
  const { loginEmployee } = useAuth()
  const navigate = useNavigate()
  const [accessId, setAccessId] = useState(''), [password, setPassword] = useState(''), [showPassword, setShowPassword] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme) }, [theme])
  const submit = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await loginEmployee(accessId, password)
      navigate('/dashboard', { replace: true })
    } catch (reason) {
      setError(reason.message || 'Unable to sign in.')
    } finally {
      setSaving(false)
    }
  }
  return <main className="login-page">
    <button className="login-theme-toggle" type="button" onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')} aria-label="Toggle color theme">
      <ThemeIcon theme={theme}/><span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
    </button>
    <section className="login-card" aria-labelledby="login-title">
      <header className="login-intro"><div className="login-logo" aria-hidden="true">◆</div><div><p className="login-eyebrow">Grantha Exports</p><h1 id="login-title">Welcome back</h1></div></header>
      <p className="login-description">Admins sign in with their registered email. Staff sign in with the Access ID created in Admin Settings.</p>
      <form onSubmit={submit}>
        <label>Staff Access ID or admin email<input value={accessId} onChange={event => setAccessId(event.target.value)} autoComplete="username" placeholder="e.g. EMP123 or admin@email.com" required/></label>
        <label>Password<span className="login-password-control"><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required/><button type="button" className="login-password-toggle" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></span></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" disabled={saving}>{saving ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="login-note">Your theme preference is saved on this browser.</p>
    </section>
  </main>
}



