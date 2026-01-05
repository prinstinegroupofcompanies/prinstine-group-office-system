import React, { createContext, useState, useEffect } from 'react';
import api from '../config/api';
import { initSocket, disconnectSocket } from '../config/socket';
import { normalizeUrl } from '../utils/apiUrl';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    // Check if user is logged in
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        if (isMounted) {
          setUser(parsedUser);
        }
        
        // Verify token is still valid with timeout
        const timeoutId = setTimeout(() => {
          if (isMounted) {
            console.warn('Auth check timeout - proceeding with cached user');
            setLoading(false);
          }
        }, 3000); // 3 second timeout

        api.get('/auth/me')
          .then(response => {
            clearTimeout(timeoutId);
            if (isMounted && response.data?.user) {
              const userData = response.data.user;
              
              // Normalize profile_image URL if it exists
              const normalizeImageUrl = (url) => {
                if (!url) return '';
                // If already a full URL, return as is
                if (url.startsWith('http://') || url.startsWith('https://')) {
                  return url;
                }
                // Use centralized URL utility
                return normalizeUrl(url);
              };
              
              const normalizedUserData = {
                ...userData,
                profile_image: normalizeImageUrl(userData.profile_image)
              };
              
              setUser(normalizedUserData);
              localStorage.setItem('user', JSON.stringify(normalizedUserData));
              // Initialize WebSocket connection
              try {
                initSocket(userData.id);
              } catch (socketError) {
                console.warn('Socket initialization failed:', socketError);
              }
              setLoading(false);
            } else if (isMounted) {
              setLoading(false);
            }
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            console.warn('Auth verification failed:', error.message);
            // Token invalid, clear storage
            if (isMounted) {
              localStorage.removeItem('token');
              localStorage.removeItem('user');
              setUser(null);
              disconnectSocket();
              setLoading(false);
            }
          });
      } catch (error) {
        console.error('Error parsing user data:', error);
        if (isMounted) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setLoading(false);
          disconnectSocket();
        }
      }
    } else {
      setLoading(false);
    }

    // Cleanup on unmount
    return () => {
      isMounted = false;
      disconnectSocket();
    };
  }, []);

  const login = async (email, password) => {
    try {
      console.log('=== LOGIN ATTEMPT START ===');
      console.log('Email:', email);
      console.log('API Base URL:', api.defaults.baseURL);
      console.log('Axios timeout:', api.defaults.timeout, 'ms');
      console.log('Full URL will be:', `${api.defaults.baseURL}/auth/login`);
      
      const startTime = Date.now();
      console.log('Sending login request at:', new Date().toISOString());
      
      // Use axios directly - it already has a 60 second timeout configured
      const response = await api.post('/auth/login', { email, password });
      
      const endTime = Date.now();
      console.log('Response received in:', endTime - startTime, 'ms');
      
      console.log('Login response received:', response.status);
      console.log('Response data:', response.data);
      
      if (!response.data) {
        console.error('Empty response from server');
        return {
          success: false,
          error: 'Empty response from server. Please try again.'
        };
      }
      
      const { token, user } = response.data;
      
      if (!token || !user) {
        console.error('Invalid response from server:', response.data);
        return {
          success: false,
          error: 'Invalid response from server. Please try again.'
        };
      }
      
      // Normalize profile_image URL if it exists
      const normalizeImageUrl = (url) => {
        if (!url) return '';
        // If already a full URL, return as is
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return url;
        }
        // Use centralized URL utility
        return normalizeUrl(url);
      };
      
      const normalizedUser = {
        ...user,
        profile_image: normalizeImageUrl(user.profile_image)
      };
      
      console.log('Storing token and user data...');
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(normalizedUser));
      setUser(normalizedUser);
      
      // Initialize WebSocket connection asynchronously (don't block login)
      try {
        initSocket(user.id);
        console.log('WebSocket initialized');
      } catch (socketError) {
        console.warn('WebSocket initialization failed (non-critical):', socketError);
        // Don't fail login if socket fails
      }
      
      console.log('Login successful for user:', user.email);
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      
      let errorMessage = 'Login failed';
      
      if (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error') || error.message?.includes('NetworkError')) {
        errorMessage = 'Cannot connect to server. Please make sure the backend server is running on port 3006.';
      } else if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        errorMessage = 'Request timed out. The server may be slow or not responding. Please try again.';
      } else if (error.code === 'ERR_NETWORK') {
        errorMessage = 'Network error. Please check your internet connection and ensure the server is running.';
      } else if (error.response?.status === 400) {
        // Handle validation errors
        const validationErrors = error.response.data?.errors;
        if (validationErrors && Array.isArray(validationErrors) && validationErrors.length > 0) {
          errorMessage = validationErrors.map(e => e.msg || e.message).join(', ');
        } else {
          errorMessage = error.response.data?.error || 'Invalid request. Please check your input.';
        }
      } else if (error.response?.status === 401) {
        errorMessage = error.response.data?.error || 'Invalid email or password';
      } else if (error.response?.status === 403) {
        const errorData = error.response.data?.error || '';
        if (errorData.includes('Login access restricted')) {
          errorMessage = errorData;
        } else {
          errorMessage = errorData || 'Account is deactivated';
        }
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    disconnectSocket();
    // Use window.location for full page reload to clear all state
    // Always redirect to /login - the server will serve index.html which React Router will handle
    window.location.href = '/login';
  };

  const updateUser = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  // Listen for real-time profile updates via Socket.IO
  useEffect(() => {
    if (user) {
      const socket = initSocket(user.id);
      if (socket) {
        const handleProfileUpdate = (data) => {
          if (data.user_id === user.id) {
            console.log('Profile updated via socket in AuthContext:', data);
            
            // Normalize profile_image URL if it exists
            const normalizeImageUrl = (url) => {
              if (!url) return '';
              if (url.startsWith('http://') || url.startsWith('https://')) {
                return url;
              }
              const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3006/api';
              const baseUrl = API_BASE_URL.replace('/api', '');
              const relativeUrl = url.startsWith('/') ? url : `/${url}`;
              return `${baseUrl}${relativeUrl}`;
            };
            
            // Fetch updated user data from server to ensure consistency
            api.get('/auth/me')
              .then(response => {
                if (response.data?.user) {
                  const updatedUser = response.data.user;
                  // Normalize profile_image URL
                  const normalizedUser = {
                    ...updatedUser,
                    profile_image: normalizeImageUrl(updatedUser.profile_image || '')
                  };
                  setUser(normalizedUser);
                  localStorage.setItem('user', JSON.stringify(normalizedUser));
                }
              })
              .catch(err => {
                console.error('Error fetching updated profile:', err);
                // Fallback: update with socket data if API call fails
                if (data.profile_image) {
                  const normalizedImageUrl = normalizeImageUrl(data.profile_image);
                  const updatedUser = {
                    ...user,
                    profile_image: normalizedImageUrl,
                    name: data.name || user.name,
                    phone: data.phone || user.phone
                  };
                  setUser(updatedUser);
                  localStorage.setItem('user', JSON.stringify(updatedUser));
                }
              });
          }
        };

        socket.on('profile_updated', handleProfileUpdate);

        return () => {
          socket.off('profile_updated', handleProfileUpdate);
        };
      }
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

