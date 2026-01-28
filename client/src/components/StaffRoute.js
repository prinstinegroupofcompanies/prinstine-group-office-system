import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const HR_OFFICER_EMAIL = 'samantha@prinstinegroup.org';

const StaffRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
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

  const email = (user.email || '').toLowerCase().trim();
  const hasAccess =
    user.role === 'Admin' ||
    user.role === 'HumanResourcesDepartmentHead' ||
    email === HR_OFFICER_EMAIL;

  if (!hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default StaffRoute;
