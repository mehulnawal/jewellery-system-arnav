import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import './adminSettings.css'

const SETTINGS = doc(db, 'settings', 'inventory')
export default function AdminSettings() {
  const [allowDimensionSizes, setAllowDimensionSizes] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => onSnapshot(SETTINGS, (snapshot) => setAllowDimensionSizes(Boolean(snapshot.data()?.allowDimensionSizes))), [])
  const change = async (event) => {
    const next = event.target.checked
    setAllowDimensionSizes(next); setSaving(true)
    try { await setDoc(SETTINGS, { allowDimensionSizes: next }, { merge: true }) } finally { setSaving(false) }
  }
  return <section className="admin-settings"><h2>Admin Settings</h2><article><div><h3>Dimension-style sizes</h3><p>Allow Inventory sizes such as 4.3X2.0. Single-value sizes always remain available.</p></div><label className="admin-toggle"><input type="checkbox" checked={allowDimensionSizes} onChange={change} disabled={saving}/><span>{allowDimensionSizes ? 'Enabled' : 'Disabled'}</span></label></article></section>
}
