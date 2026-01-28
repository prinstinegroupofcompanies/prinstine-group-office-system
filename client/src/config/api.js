import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiUrl';

const API_BASE_URL = getApiBaseUrl();

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 60 second timeout (increased for slow database operations)
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    // Log request for debugging
    if (config.url?.includes('/auth/login')) {
      console.log('=== AXIOS REQUEST SENT ===');
      console.log('URL:', config.baseURL + config.url);
      console.log('Method:', config.method);
      console.log('Timeout:', config.timeout, 'ms');
      console.log('Headers:', config.headers);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
api.interceptors.response.use(
  (response) => {
    // Log successful responses for debugging
    if (response.config?.url?.includes('/auth/login')) {
      console.log('=== LOGIN RESPONSE RECEIVED ===');
      console.log('Status:', response.status);
      console.log('Has token:', !!response.data?.token);
      console.log('Has user:', !!response.data?.user);
    }
    return response;
  },
  (error) => {
    // Log errors for debugging
    if (error.config?.url?.includes('/auth/login')) {
      console.error('=== LOGIN REQUEST ERROR ===');
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Response status:', error.response?.status);
      console.error('Response data:', error.response?.data);
    }
    
    // Don't redirect on login page 401 errors (those are expected)
    // Also don't redirect if we're currently on the login page (to avoid loops)
    const isLoginPage = window.location.pathname.includes('/login');
    const isAuthRequest = error.config?.url?.includes('/auth/login') || error.config?.url?.includes('/auth/me');
    
    if (error.response?.status === 401 && !isLoginPage && !isAuthRequest) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

