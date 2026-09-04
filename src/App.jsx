import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import DashboardLayout from './layouts/DashboardLayout'
import Inventory from './modules/inventory/Inventory'
import CheckInventory from './modules/checkInventory/CheckInventory'
import AdminSettings from './modules/admin/AdminSettings'
import ActivityLog from './modules/activityLog/ActivityLog'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
export default function App() { return <Routes><Route path="/login" element={<Login />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<DashboardLayout />}><Route index element={<Navigate to="inventory" replace />} /><Route path="inventory" element={<Inventory />} /><Route path="check-inventory" element={<CheckInventory />} /><Route path="activity-log" element={<ActivityLog />} /><Route path="admin-settings" element={<AdminSettings />} /></Route></Route><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="*" element={<NotFound />} /></Routes> }

