import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App, { PublicSite } from './App';
import './index.css';
import './theme-refresh.css';
import './public-site-refresh.css';
import './public-home-layout-fix.css';

const deploymentMode = String((import.meta as any).env?.VITE_TRIDASH_DEPLOYMENT || 'combined');
const hostname = window.location.hostname.toLowerCase();

// Enforce the public/app boundary by hostname as well as build configuration.
// The public hostname must never mount the authenticated application, even if
// its Render environment variable is accidentally configured incorrectly.
const isPublicHost = hostname === 'tridash.onrender.com';
const isAppHost = hostname === 'app-tridash.onrender.com';
const publicOnly = isPublicHost || (deploymentMode === 'public' && !isAppHost);
const appOnly = isAppHost || (deploymentMode === 'app' && !isPublicHost);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {publicOnly ? <PublicSite /> : appOnly ? <App /> : <App />}
    </BrowserRouter>
  </StrictMode>
);
