import React, { createContext, useState, useEffect } from 'react';
import api from '../config/api';
import { initSocket, disconnectSocket } from '../config/socket';
import { normalizeUrl, getBaseUrl } from '../utils/apiUrl';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [systemLocked, setSystemLocked] = useState(false);
  const [lockdownInfo, setLockdownInfo] = useState(null);

  const applyLockdown = (info) => {
    setSystemLocked(true);
    setLockdownInfo(info || null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    disconnectSocket();
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        const statusRes = await api.get('/system/status');
        if (!isMounted) return;
        if (statusRes.data?.locked) {
          applyLockdown(statusRes.data);
          setLoading(false);
          return;
        }
        setSystemLocked(false);
        setLockdownInfo(null);
      } catch (_err) {
        if (isMounted) setLoading(false);
        return;
      }

      const token = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (token && savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          if (isMounted) setUser(parsedUser);

          const timeoutId = setTimeout(() => {
            if (isMounted) {
              console.warn('Auth check timeout - proceeding with cached user');
              setLoading(false);
            }
          }, 3000);

          api.get('/auth/me')
            .then((response) => {
              clearTimeout(timeoutId);
              if (isMounted && response.data?.user) {
                const userData = response.data.user;
                const normalizeImageUrl = (url) => {
                  if (!url) return '';
                  if (url.startsWith('http://') || url.startsWith('https://')) return url;
                  return normalizeUrl(url);
                };
                const normalizedUserData = {
                  ...userData,
                  profile_image: normalizeImageUrl(userData.profile_image)
                };
                setUser(normalizedUserData);
                localStorage.setItem('user', JSON.stringify(normalizedUserData));
                try {
                  initSocket(userData.id);
                } catch (socketError) {
                  console.warn('Socket initialization failed:', socketError);
                }
              }
              if (isMounted) setLoading(false);
            })
            .catch((error) => {
              clearTimeout(timeoutId);
              if (error.response?.status === 503 && error.response?.data?.code === 'SYSTEM_LOCKDOWN') {
                if (isMounted) applyLockdown(error.response.data.lockdown);
              } else if (isMounted) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                setUser(null);
                disconnectSocket();
              }
              if (isMounted) setLoading(false);
            });
        } catch (error) {
          console.error('Error parsing user data:', error);
          if (isMounted) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            disconnectSocket();
            setLoading(false);
          }
        }
      } else if (isMounted) {
        setLoading(false);
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
      disconnectSocket();
    };
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      
      if (!response.data) {
        return {
          success: false,
          error: 'Empty response from server. Please try again.'
        };
      }
      
      const { token, user } = response.data;
      
      if (!token || !user) {
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
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(normalizedUser));
      setUser(normalizedUser);

      try {
        initSocket(user.id);
      } catch (socketError) {
        console.warn('WebSocket initialization failed (non-critical):', socketError);
      }

      return { success: true };
    } catch (error) {
      
      let errorMessage = 'Login failed';
      
      if (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error') || error.message?.includes('NetworkError')) {
        errorMessage = 'Cannot connect to server. Please check your internet connection and try again.';
      } else if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        errorMessage = 'Connection is slow. Please wait a moment and try again.';
      } else if (error.code === 'ERR_NETWORK') {
        errorMessage = 'Network error. Please check your internet connection and try again.';
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
      } else if (error.response?.status === 503 && error.response?.data?.code === 'SYSTEM_LOCKDOWN') {
        applyLockdown(error.response.data.lockdown);
        errorMessage = error.response.data?.error || 'System is temporarily offline.';
        return { success: false, error: errorMessage, lockdown: error.response.data.lockdown };
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
              const baseUrl = getBaseUrl() || 'http://localhost:3006';
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
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading, systemLocked, lockdownInfo }}>
      {children}
    </AuthContext.Provider>
  );
};

