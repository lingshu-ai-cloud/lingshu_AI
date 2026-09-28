import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppCrashBoundary } from './components/AppPageBoundary';
import './index.css';

const PRELOAD_RECOVERY_KEY = 'lingshu:vite-preload-recovery';
window.addEventListener('vite:preloadError', event => {
  // A page left open across a new build may still point at an old hashed chunk.
  // Reload once; repeated failures are left to the visible error boundary so we
  // never create a reload loop when the network is actually unavailable.
  event.preventDefault();
  try {
    const lastAttempt = Number(sessionStorage.getItem(PRELOAD_RECOVERY_KEY) || 0);
    if (Date.now() - lastAttempt < 30_000) return;
    sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(Date.now()));
  } catch {
    // Without a session-scoped guard an automatic reload could loop forever.
    return;
  }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppCrashBoundary>
      <App />
    </AppCrashBoundary>
  </StrictMode>
);
