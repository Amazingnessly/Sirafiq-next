import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { installResilientSyncTriggers } from './lib/resilientSyncTriggers';
import './styles/index.css';
import './styles/pdf-reader.css';
import './styles/extraction-recovery.css';
import './styles/build-identity.css';
import './styles/import-feedback.css';
import './styles/library-filter.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Runtime() {
  useEffect(() => installResilientSyncTriggers(), []);
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Runtime />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
