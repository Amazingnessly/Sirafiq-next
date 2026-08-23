import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { installSyncTriggers } from './lib/sync';
import './styles/index.css';
import './styles/pdf-reader.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Runtime() {
  useEffect(() => installSyncTriggers(), []);
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Runtime />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
