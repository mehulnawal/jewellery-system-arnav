import { createContext, useContext, useMemo, useState } from 'react'
const AuthContext = createContext(null)
export function AuthProvider({ children }) { const [user, setUser] = useState({ role: 'superadmin', allowedModules: ['inventory'] }); const value = useMemo(() => ({ user, setUser, isLoading: false }), [user]); return <AuthContext.Provider value={value}>{children}</AuthContext.Provider> }
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used within an AuthProvider'); return context }
