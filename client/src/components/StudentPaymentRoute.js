import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { checkStudentPaymentAccess } from '../utils/studentPaymentAccess';

const StudentPaymentRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user && !loading) {
      setChecking(false);
      return;
    }
    if (!user || loading) return;

    const check = async () => {
      try {
        setHasAccess(await checkStudentPaymentAccess(user));
      } catch {
        setHasAccess(false);
      }
      setChecking(false);
    };

    check();
  }, [user, loading]);

  if (loading || checking) {
    return (
      <div className="d-flex flex-column justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!hasAccess) return <Navigate to="/dashboard" replace />;

  return children;
};

export default StudentPaymentRoute;
