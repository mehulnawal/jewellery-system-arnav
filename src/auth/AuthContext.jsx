import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { accountEmail, employeeProfile } from '../utils/accessAccounts'
import { captureFirstLogin } from '../utils/activityLog'
const AuthContext = createContext(null)
const ADMIN = { uid: 'fixed-superadmin', accessId: 'Admin', role: 'superadmin', allowedModules: ['inventory', 'purchase', 'challan-stage-1', 'challan-stage-2', 'challan-stage-3', 'challan-stage-4'], active: true }
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [remaining, setRemaining] = useState(0)
  const sessionStartedAt = useRef(0), sessionUser = useRef(null), expiryAt = useRef(0)
  const logout = async () => { if (user?.role !== 'superadmin') await signOut(auth); sessionUser.current = null; setUser(null); setRemaining(0); window.location.assign('/login') }
  const loginAdmin = () => { sessionStartedAt.current = Date.now(); sessionUser.current = ADMIN; setUser(ADMIN); setLoading(false) }
  const loginEmployee = async (accessId, password) => {
    const credential = await signInWithEmailAndPassword(auth, accountEmail(accessId), password)
    const profile = await employeeProfile(credential.user.uid)
    if (!profile.exists() || !profile.data().active) { await signOut(auth); throw new Error('This Access ID is inactive or unavailable.') }
    sessionStartedAt.current = Date.now(); sessionUser.current = profile.data(); setUser(profile.data()); await captureFirstLogin(profile.data())
  }
  useEffect(() => onAuthStateChanged(auth, async current => {
    if (!current) { if (sessionUser.current?.role !== 'superadmin') { setUser(null); setLoading(false) }; return }
    const profile = await employeeProfile(current.uid)
    if (!profile.exists() || !profile.data().active) { await signOut(auth); setUser(null); setLoading(false); return }
    sessionStartedAt.current = Date.now(); sessionUser.current = profile.data(); setUser(profile.data()); await captureFirstLogin(profile.data()); setLoading(false)
  }), [])
  useEffect(() => {
    if (!user?.uid || user.role === 'superadmin') return
    return onSnapshot(doc(db, 'employeeProfiles', user.uid), snapshot => {
      const latest = snapshot.data()
      const expiry = latest?.sessionExpireAt?.toMillis?.() || latest?.sessionExpireAtMs || 0
      if (!latest || !latest.active || (expiry > sessionStartedAt.current && expiry > Date.now())) { expiryAt.current = expiry; setRemaining(Math.max(0, expiry - Date.now())) }
    })
  }, [user?.uid, user?.role])
  useEffect(() => { if (!remaining) return; const timer = window.setInterval(() => setRemaining(value => value <= 1000 ? 0 : value - 1000), 1000); return () => clearInterval(timer) }, [remaining > 0])
  useEffect(() => { if (user?.role !== 'superadmin' && remaining === 0 && expiryAt.current > 0 && expiryAt.current <= Date.now()) void logout() }, [remaining])
  const value = useMemo(() => ({ user, isLoading: loading, loginAdmin, loginEmployee, logout, hasPermission: key => user?.role === 'superadmin' || Boolean(user?.permissions?.includes(key) || user?.allowedModules?.includes(key)), sessionRemaining: remaining, sessionExpiring: remaining > 0 }), [user, loading, remaining])
  return <AuthContext.Provider value={value}>{children}{remaining > 0 && <SessionNotice milliseconds={remaining}/>}</AuthContext.Provider>
}
function SessionNotice({ milliseconds }) { const seconds = Math.ceil(milliseconds / 1000), value = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; useEffect(() => { if (milliseconds <= 0) window.location.assign('/login') }, [milliseconds]); return <div className="session-expiry-notice"><b>Access updated by Admin</b><span>Session ending in {value}</span></div> }
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used within an AuthProvider'); return context }