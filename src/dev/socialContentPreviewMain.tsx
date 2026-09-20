import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SocialContentPreview from './SocialContentPreview';
import '../index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><SocialContentPreview /></StrictMode>);
