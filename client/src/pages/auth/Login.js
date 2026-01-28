import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import './Auth.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Normalize email before sending
    const normalizedEmail = email.trim().toLowerCase();
    
    console.log('Login form submitted for:', normalizedEmail);
    
    try {
      const result = await login(normalizedEmail, password);
      
      console.log('Login result:', result);
      
      if (result && result.success) {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            const role = (user.role || '').toString().trim().toLowerCase();
            if (role === 'departmenthead') navigate('/department-dashboard');
            else if (role === 'staff') navigate('/staff-dashboard');
            else if (role === 'student') navigate('/student');
            else if (role === 'instructor') navigate('/academy');
            else navigate('/dashboard');
          } catch (parseError) {
            console.error('Error parsing user data:', parseError);
            navigate('/dashboard');
          }
        } else {
          navigate('/dashboard');
        }
      } else {
        const errorMsg = result?.error || 'Login failed. Please try again.';
        console.error('Login failed:', errorMsg);
        setError(errorMsg);
        setLoading(false);
      }
    } catch (err) {
      console.error('Login exception:', err);
      setError(err.message || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="text-center mb-4">
          <div className="auth-logo-container">
            <img 
              src="/prinstine-logo.png" 
              alt="Prinstine Group Logo" 
              className="auth-logo"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <i className="bi bi-building text-primary auth-logo-fallback" style={{ fontSize: '3rem', display: 'none' }}></i>
          </div>
          <h2 className="mt-3">Prinstine Management System</h2>
          <p className="text-muted">Sign in to your account</p>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="email" className="form-label">
              <i className="bi bi-envelope me-2"></i>Email Address
            </label>
            <input
              type="email"
              className="form-control"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="mb-3">
            <label htmlFor="password" className="form-label">
              <i className="bi bi-lock me-2"></i>Password
            </label>
            <input
              type="password"
              className="form-control"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="mb-3 d-flex justify-content-between">
            <div className="form-check">
              <input type="checkbox" className="form-check-input" id="remember" />
              <label className="form-check-label" htmlFor="remember">
                Remember me
              </label>
            </div>
            <Link to="/forgot-password" className="text-decoration-none">
              Forgot password?
            </Link>
          </div>

          <div className="text-center mt-3">
            <Link to="/verify-certificate" className="text-decoration-none">
              <i className="bi bi-award me-2"></i>Verify Certificate
            </Link>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-100 mb-3"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2"></span>
                Signing in...
              </>
            ) : (
              <>
                <i className="bi bi-box-arrow-in-right me-2"></i>
                Sign In
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
};

export default Login;

