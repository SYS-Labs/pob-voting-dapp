import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '~/index.css'
import App from '~/App.tsx'
import { AppStateProvider } from '~/contexts/AppStateContext'
import { IterationDataProvider } from '~/contexts/IterationDataContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppStateProvider>
        <IterationDataProvider>
          <App />
        </IterationDataProvider>
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>,
)
