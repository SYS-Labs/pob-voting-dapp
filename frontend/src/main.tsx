import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '~/index.css'
import App from '~/App'
import { AppStateProvider } from '~/contexts/AppStateContext'
import { cleanupLegacyCache } from '~/utils/cleanup'

// Remove legacy localStorage cache keys on startup
cleanupLegacyCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>,
)
