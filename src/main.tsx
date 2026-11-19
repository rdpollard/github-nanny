import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OwnerSettings } from './OwnerSettings';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname === '/settings' ? <OwnerSettings /> : <App />}</StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Dashboard still works online if installation is unavailable.
    });
  });
}
