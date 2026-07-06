import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../config/api';
import SystemLockdownScreen from '../../components/SystemLockdownScreen';
import './Auth.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const { login, systemLocked, lockdownInfo } = useAuth();
  const navigate = useNavigate();

  // Wake up the backend immediately so it's ready by the time the user submits.
  // Render free-tier cold-starts can take 30+ seconds; this fires on page load.
  useEffect(() => {
    let cancelled = false;
    const warmup = async () => {
      try {
        await api.get('/health', { timeout: 60000 });
      } catch (_) {
        // Even a failed TCP handshake is enough to wake Render
      }
      if (!cancelled) setServerReady(true);
    };
    warmup();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const loginId = email.trim().toLowerCase();

    try {
      const result = await login(loginId, password);
      
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
            else if (role === 'instructor') navigate('/instructor-dashboard');
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

  if (systemLocked) {
    return <SystemLockdownScreen lockdown={lockdownInfo} />;
  }

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
              <i className="bi bi-person me-2"></i>Email or Username
            </label>
            <input
              type="text"
              className="form-control"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="password" className="form-label">
              <i className="bi bi-lock me-2"></i>Password
            </label>
            <div className="input-group">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
              </button>
            </div>
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

