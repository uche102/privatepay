import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PollarProvider } from '@pollar/react';
import App from './App';
import './styles.css';
import '@pollar/react/styles.css';

const apiKey = import.meta.env.VITE_POLLAR_API_KEY;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PollarProvider client={{ apiKey: apiKey ?? '' }}>
      <App />
    </PollarProvider>
  </StrictMode>,
);
