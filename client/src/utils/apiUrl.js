/**
 * Centralized API URL utility for production-ready URL handling
 * Ensures all URLs use environment variables in production
 */

/**
 * Get the API base URL from environment variable
 * In production, REACT_APP_API_URL must be set
 * @returns {string} API base URL
 */
export const getApiBaseUrl = () => {
  const apiUrl = process.env.REACT_APP_API_URL;
  
  if (!apiUrl && process.env.NODE_ENV === 'production') {
    console.error('REACT_APP_API_URL is not set in production! Please configure it.');
    // Return empty string to force errors rather than using localhost in production
    return '';
  }
  
  // In development, fallback to localhost if not set
  return apiUrl || 'http://localhost:3006/api';
};

/**
 * Get the base URL (without /api) for file serving
 * @returns {string} Base URL without /api
 */
export const getBaseUrl = () => {
  const apiUrl = getApiBaseUrl();
  if (!apiUrl) return '';
  
  // Remove /api suffix if present
  return apiUrl.replace(/\/api\/?$/, '');
};

/**
 * Normalize a relative URL to full URL
 * @param {string} relativeUrl - Relative URL path (e.g., /uploads/file.jpg)
 * @returns {string} Full URL
 */
export const normalizeUrl = (relativeUrl) => {
  if (!relativeUrl) return '';
  
  // If already a full URL, return as is
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }

  // If data URL, return as is
  if (relativeUrl.startsWith('data:')) {
    return relativeUrl;
  }
  
  // Ensure relative URL starts with /
  const normalizedPath = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
  const baseUrl = getBaseUrl();
  
  if (!baseUrl) {
    console.error('Cannot normalize URL - base URL not available');
    return relativeUrl;
  }
  
  return `${baseUrl}${normalizedPath}`;
};

