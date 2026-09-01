import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Explore from '@/routes/Explore'
import ListingDetail from '@/routes/ListingDetail'
import Login from '@/routes/Login'
import AuthCallback from '@/routes/AuthCallback'
import Trips from '@/routes/Trips'
import Checkout from '@/routes/Checkout'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/explore" replace />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/listing/:id" element={<ListingDetail />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/trips" element={<Trips />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="*"
          element={
            <p className="text-sm text-ink/70">That page doesn't exist.</p>
          }
        />
      </Routes>
    </AppShell>
  )
}
