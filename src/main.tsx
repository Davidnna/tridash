import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App, { PublicSite } from './App';
import './index.css';
import './theme-refresh.css';
import './public-site-refresh.css';
import './public-home-layout-fix.css';

const deploymentMode = String((import.meta as any).env?.VITE_TRIDASH_DEPLOYMENT || 'combined');

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            {deploymentMode === 'public' ? <PublicSite /> : <App />}
        </BrowserRouter>
    </StrictMode>
);
