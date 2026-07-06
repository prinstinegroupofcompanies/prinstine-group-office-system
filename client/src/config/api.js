import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiUrl';

const API_BASE_URL = getApiBaseUrl();

const isRetryable = (error) => {
  if (!error.config || error.config.__retryCount >= 3) return false;
  if (error.response && error.response.status >= 400 && error.response.status < 500) return false;
  const code = error.code || '';
  return (
    !error.response ||
    code === 'ECONNABORTED' ||
    code === 'ERR_NETWORK' ||
    code === 'ETIMEDOUT' ||
    error.message?.includes('timeout') ||
    error.message?.includes('Network Error') ||
    (error.response && error.response.status >= 500)
  );
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90000,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    config.__retryCount = config.__retryCount || 0;

    if (isRetryable(error)) {
      config.__retryCount += 1;
      const backoff = Math.min(1000 * Math.pow(2, config.__retryCount - 1), 10000);
      console.log(`Retrying request (${config.__retryCount}/3) after ${backoff}ms: ${config.url}`);
      await delay(backoff);
      return api(config);
    }

    const isLoginPage = window.location.pathname.includes('/login');
    const isAuthRequest = config.url?.includes('/auth/login') || config.url?.includes('/auth/me');

    if (error.response?.status === 503 && error.response?.data?.code === 'SYSTEM_LOCKDOWN') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login') &&
          !window.location.pathname.includes('/verify-certificate') &&
          !window.location.pathname.includes('/submit-claim') &&
          !window.location.pathname.includes('/certificates/verify')) {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !isLoginPage && !isAuthRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

