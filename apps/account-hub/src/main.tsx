import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import './standalone.css';
import App from './App';
import LingshuProvider from '../../../src/components/ui/LingshuProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LingshuProvider><App /></LingshuProvider>
  </StrictMode>,
);
