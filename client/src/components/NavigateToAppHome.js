import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Redirects authenticated user to role-appropriate home.
 * Use for path "/" inside PrivateRoute.
 */
const NavigateToAppHome = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  switch (user.role) {
    case 'DepartmentHead':
      return <Navigate to="/department-dashboard" replace />;
    case 'Staff':
      return <Navigate to="/staff-dashboard" replace />;
    case 'Student':
      return <Navigate to="/student" replace />;
    case 'Instructor':
      return <Navigate to="/instructor-dashboard" replace />;
    default:
      return <Navigate to="/dashboard" replace />;
  }
};

export default NavigateToAppHome;
