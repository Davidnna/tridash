import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App, { PublicSite } from './App';
import './index.css';
import './design-system.css';

function ScrollToTopOnRouteChange() {
    const { pathname } = useLocation();

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [pathname]);

    return null;
}

const deploymentMode = String((import.meta as any).env?.VITE_TRIDASH_DEPLOYMENT || 'combined');
const hostname = window.location.hostname.toLowerCase();

// Enforce the public/app boundary by hostname as well as build configuration.
// The public hostname must never mount the authenticated application, even if
// its Render environment variable is accidentally configured incorrectly.
const isPublicHost = hostname === 'tridash.onrender.com';
const isAppHost = hostname === 'app-tridash.onrender.com';

// Prefer the hostname for the two production domains so a mistaken Render
// environment value cannot expose the authenticated app on the public site.
// For local development and preview hosts, keep the deployment-mode switch.
const renderPublicSite = isPublicHost || (!isAppHost && deploymentMode === 'public');

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <ScrollToTopOnRouteChange />
            {renderPublicSite ? <PublicSite /> : <App />}
        </BrowserRouter>
    </StrictMode>
);
