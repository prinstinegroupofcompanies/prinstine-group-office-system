import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../config/api';

const PETTY_CASH_OR_ASSETS_PATHS = ['/finance/petty-cash', '/finance/petty-cash-ledger', '/finance/assets'];

const FinanceRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkFinanceAccess = useCallback(async () => {
    try {
      const email = ((user?.email ?? '') + '').toLowerCase().trim();
      const role = (user?.role ?? '').toString();
      const isPettyOrAssets = PETTY_CASH_OR_ASSETS_PATHS.some(p => location.pathname.startsWith(p));
      if (email === 'sean@prinstinegroup.org' && isPettyOrAssets) {
        setHasAccess(false);
        setChecking(false);
        return;
      }
      if (role === 'Admin') {
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
        if (email === 'sean@prinstinegroup.org' && !isPettyOrAssets) {
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
  }, [user, location.pathname]);

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

