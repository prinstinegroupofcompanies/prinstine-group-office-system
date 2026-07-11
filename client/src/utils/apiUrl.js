/**
 * Centralized API URL utility.
 *
 * Production: API calls use the same-origin "/api" path. Vercel rewrites
 * proxy these to the Render backend server-to-server, avoiding cross-origin
 * requests that some mobile carriers (Orange Liberia) block or throttle.
 *
 * Socket.IO still connects directly to Render because Vercel rewrites
 * cannot proxy WebSocket upgrade handshakes.
 */

function trimTrailingSlashes(s) {
  return (s || '').replace(/\/+$/, '');
}

const RENDER_BACKEND = 'https://prinstine-pms-backend.onrender.com';

/**
 * API base URL.
 * In production, returns "/api" (same-origin, proxied by Vercel).
 * In development, returns "http://localhost:3006/api".
 */
export const getApiBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return '/api';
  }
  const raw = (process.env.REACT_APP_API_URL || '').trim();
  if (raw) {
    let base = trimTrailingSlashes(raw);
    if (!/\/api$/i.test(base)) base = `${base}/api`;
    return base;
  }
  return 'http://localhost:3006/api';
};

export const getDirectApiUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return `${RENDER_BACKEND}/api`;
  }
  const raw = (process.env.REACT_APP_API_URL || '').trim();
  if (raw) {
    let base = trimTrailingSlashes(raw);
    if (!/\/api$/i.test(base)) base = `${base}/api`;
    return base;
  }
  return 'http://localhost:3006/api';
};

/**
 * Socket.IO connects directly to Render (WebSocket can't go through Vercel rewrites).
 */
export const getSocketBaseUrl = () => {
  const socketUrl = (process.env.REACT_APP_SOCKET_URL || '').trim();
  if (socketUrl) return trimTrailingSlashes(socketUrl);
  if (process.env.NODE_ENV === 'production') return RENDER_BACKEND;
  const raw = (process.env.REACT_APP_API_URL || '').trim();
  if (raw) return trimTrailingSlashes(raw).replace(/\/api\/?$/, '');
  return 'http://localhost:3006';
};

/**
 * Base URL (without /api) for file serving (uploads, profile images, etc.)
 * In production, files are served from Render so we use the full Render URL.
 */
export const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') return RENDER_BACKEND;
  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return '';
  return apiUrl.replace(/\/api\/?$/, '');
};

/**
 * Normalize a relative URL to full URL
 */
export const normalizeUrl = (relativeUrl) => {
  if (!relativeUrl) return '';
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://') || relativeUrl.startsWith('data:')) {
    return relativeUrl;
  }
  const normalizedPath = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
  const baseUrl = getBaseUrl();
  if (!baseUrl) return relativeUrl;
  return `${baseUrl}${normalizedPath}`;
};

