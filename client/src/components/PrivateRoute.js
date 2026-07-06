import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

import SystemLockdownScreen from './SystemLockdownScreen';

const PrivateRoute = ({ children, requiredRole = null, requiredRoles = null }) => {
  const { user, loading, systemLocked, lockdownInfo } = useAuth();

  if (loading) {
    return (
      <div className="d-flex flex-column justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <img 
          src="/prinstine-logo.png" 
          alt="Prinstine Group" 
          style={{ maxWidth: '200px', height: 'auto', marginBottom: '2rem' }}
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (systemLocked) {
    return <SystemLockdownScreen lockdown={lockdownInfo} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const roleDenied = requiredRoles
    ? !requiredRoles.includes(user.role)
    : requiredRole && user.role !== requiredRole;

  if (roleDenied) {
    if (user.role === 'DepartmentHead') {
      return <Navigate to="/department-dashboard" replace />;
    }
    if (user.role === 'Staff') {
      return <Navigate to="/staff-dashboard" replace />;
    }
    if (user.role === 'Student') {
      return <Navigate to="/student" replace />;
    }
    if (user.role === 'Instructor') {
      return <Navigate to="/instructor-dashboard" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default PrivateRoute;

