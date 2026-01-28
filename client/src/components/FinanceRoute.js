import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../config/api';

const FinanceRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkFinanceAccess = useCallback(async () => {
    try {
      const email = ((user?.email ?? '') + '').toLowerCase().trim();
      const role = (user?.role ?? '').toString();
      // Admin or Assistant Finance Officer (sean@prinstinegroup.org) always have access
      if (role === 'Admin' || email === 'sean@prinstinegroup.org') {
        setHasAccess(true);
        setChecking(false);
        return;
      }

      // Check if user is Finance Department Head
      if (role === 'DepartmentHead') {
        const response = await api.get('/departments');
        const financeDept = (response.data.departments || []).find(d =>
          (d.manager_id === user.id || ((d.head_email ?? '').toLowerCase().trim() === email)) &&
          (d.name || '').toLowerCase().includes('finance')
        );
        if (financeDept) {
          setHasAccess(true);
          setChecking(false);
          return;
        }
      }

      // Check if user is Assistant Finance Officer (Staff in Finance department or by email)
      if (role === 'Staff') {
        if (email === 'sean@prinstinegroup.org') {
          setHasAccess(true);
          setChecking(false);
          return;
        }
        const dept = ((user?.department ?? '') + '').toLowerCase();
        if (dept.includes('finance')) {
          setHasAccess(true);
          setChecking(false);
          return;
        }
      }

      setHasAccess(false);
      setChecking(false);
    } catch (error) {
      console.error('Error checking finance access:', error);
      setHasAccess(false);
      setChecking(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user && !loading) {
      setChecking(false);
      return;
    }
    if (user && !loading) {
      checkFinanceAccess();
    }
  }, [user, loading, checkFinanceAccess]);

  if (loading || checking) {
    return (
      <div className="d-flex flex-column justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default FinanceRoute;

