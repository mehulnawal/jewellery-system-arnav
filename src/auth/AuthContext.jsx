import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { accountEmail, employeeProfile } from '../utils/accessAccounts'
import { captureFirstLogin } from '../utils/activityLog'
import './authContext.css'

const AuthContext = createContext(null)
const SUPERADMIN_UID = 'rK6ZhxFiauVodjzbssviy5sUyP03'
const REVOCATION_GRACE_MS = 2 * 60 * 1000
const SUPERADMIN_PROFILE = { accessId: 'granthaexports@gmail.com', role: 'superadmin', allowedModules: ['inventory', 'purchase', 'challan-stage-1', 'challan-stage-2', 'challan-stage-3', 'challan-stage-4'], active: true }
const timestampMs = value => value?.toMillis?.() ?? (Number(value) || 0)
const resolveProfile = async current => {
  let profile = await employeeProfile(current.uid)
  if (!profile.exists() && current.uid === SUPERADMIN_UID) {
    await setDoc(doc(db, 'employeeProfiles', current.uid), { uid: current.uid, ...SUPERADMIN_PROFILE, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    profile = await employeeProfile(current.uid)
  }
  return profile
}
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [remaining, setRemaining] = useState(0)
  const expiryAt = useRef(0)
  const logout = async () => { await signOut(auth); setUser(null); setRemaining(0); expiryAt.current = 0; window.location.assign('/login') }
  const activateProfile = async profile => { setUser(profile); try { await captureFirstLogin(profile) } catch (error) { console.warn('First-login audit could not be saved.', error) } }
  const loginEmployee = async (accessId, password) => {
    const credential = await signInWithEmailAndPassword(auth, accountEmail(accessId), password)
    const profile = await resolveProfile(credential.user)
    if (!profile.exists() || !profile.data().active) { await signOut(auth); throw new Error('This Access ID is inactive or unavailable.') }
    await activateProfile(profile.data())
  }
  useEffect(() => onAuthStateChanged(auth, async current => {
    if (!current) { setUser(null); setLoading(false); return }
    const profile = await resolveProfile(current)
    const data = profile.data()
    const deadline = timestampMs(data?.accessRevokedAt) + REVOCATION_GRACE_MS
    if (!profile.exists() || (!data.active && (!timestampMs(data.accessRevokedAt) || deadline <= Date.now()))) { await signOut(auth); setUser(null); setLoading(false); return }
    if (!data.active) { expiryAt.current = deadline; setRemaining(Math.max(0, deadline - Date.now())) }
    await activateProfile(data); setLoading(false)
  }), [])
  useEffect(() => {
    if (!user?.uid || user.role === 'superadmin') return
    return onSnapshot(doc(db, 'employeeProfiles', user.uid), snapshot => {
      const latest = snapshot.data()
      const revokedAt = timestampMs(latest?.accessRevokedAt)
      const deadline = revokedAt + REVOCATION_GRACE_MS
      if (!latest) { void logout(); return }
      if (latest.active) { expiryAt.current = 0; setRemaining(0); setUser(latest); return }
      if (!revokedAt || deadline <= Date.now()) { void logout(); return }
      expiryAt.current = deadline; setUser(latest); setRemaining(Math.max(0, deadline - Date.now()))
    })
  }, [user?.uid, user?.role])
  useEffect(() => { if (!expiryAt.current) return; const timer = window.setInterval(() => { const next = Math.max(0, expiryAt.current - Date.now()); setRemaining(next); if (!next) void logout() }, 1000); return () => clearInterval(timer) }, [Boolean(expiryAt.current)])
  const value = useMemo(() => ({ user, isLoading: loading, loginEmployee, logout, hasPermission: key => user?.role === 'superadmin' || Boolean(user?.permissions?.includes(key) || user?.allowedModules?.includes(key)), sessionRemaining: remaining, sessionExpiring: remaining > 0 }), [user, loading, remaining])
  return <AuthContext.Provider value={value}>{children}{remaining > 0 && <RevocationNotice milliseconds={remaining}/>}</AuthContext.Provider>
}
function RevocationNotice({ milliseconds }) { const seconds = Math.ceil(milliseconds / 1000), value = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; return <div className="access-revocation-notice" role="alert"><b>Your account access has been revoked.</b><span>Please save your current work.</span><strong>Automatic logout in {value}</strong></div> }
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used within an AuthProvider'); return context }