import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { CollectionProvider } from './context/CollectionContext.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <CollectionProvider>
          <App />
        </CollectionProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)