import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'
import Home from './pages/Home.jsx'
import History from './pages/History.jsx'
import IdentificationResult from './pages/IdentificationResult.jsx'
import Collection from './pages/Collection.jsx'
import Chatbot from './pages/Chatbot.jsx'
import CurrencyConverter from './pages/CurrencyConverter.jsx'
import Contact from './pages/Contact.jsx'
import { useAuth } from './context/AuthContext.jsx'
import CursorFX from './components/CursorFX.jsx'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return null
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return children
}

function PublicOnly({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (user) return <Navigate to="/home" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <CursorFX />
      <Routes>
        <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
        <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
        <Route path="/result" element={<RequireAuth><IdentificationResult /></RequireAuth>} />
        <Route path="/collection" element={<RequireAuth><Collection /></RequireAuth>} />
        <Route path="/chatbot" element={<RequireAuth><Chatbot /></RequireAuth>} />
        <Route path="/converter" element={<RequireAuth><CurrencyConverter /></RequireAuth>} />
        <Route path="/contact" element={<RequireAuth><Contact /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}