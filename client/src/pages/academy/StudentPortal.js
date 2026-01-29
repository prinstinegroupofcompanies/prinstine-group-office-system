import React, { useEffect, useState, useCallback } from 'react';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import { Link } from 'react-router-dom';
import { normalizeUrl } from '../../utils/apiUrl';
import './StudentPortal.css';

const StudentPortal = () => {
  const { user } = useAuth();
  const [student, setStudent] = useState(null);
  const [stats, setStats] = useState({
    coursesCount: 0,
    balanceDue: 0,
    pendingCount: 0,
    certificatesCount: 0,
    gradesCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileImgError, setProfileImgError] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      setError(null);
      const [profileRes, coursesRes, billingRes, gradesRes, certsRes] = await Promise.all([
        api.get('/academy/students/me'),
        api.get('/academy/students/me/courses').catch(() => ({ data: { courses: [] } })),
        api.get('/academy/students/me/billing').catch(() => ({ data: { balances: [], pending: [] } })),
        api.get('/academy/students/me/grades').catch(() => ({ data: { grades: [] } })),
        api.get('/academy/students/me/certificates').catch(() => ({ data: { certificates: [] } }))
      ]);

      setStudent(profileRes.data.student);

      const courses = coursesRes.data?.courses || [];
      const balances = billingRes.data?.balances || [];
      const pending = billingRes.data?.pending || [];
      const grades = gradesRes.data?.grades || [];
      const certificates = certsRes.data?.certificates || [];

      const totalBalance = balances.reduce((sum, b) => sum + (parseFloat(b.balance) || 0), 0);

      setStats({
        coursesCount: courses.length,
        balanceDue: totalBalance,
        pendingCount: pending.length,
        certificatesCount: certificates.length,
        gradesCount: grades.length
      });
    } catch (err) {
      console.error('Failed to load student dashboard', err);
      setError(err.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    setProfileImgError(false);
  }, [student?.profile_image]);

  if (loading) {
    return (
      <div className="student-portal">
        <div className="container-fluid">
          <div className="student-portal__loading">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <span className="student-portal__loading-text">Loading your dashboard...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="student-portal">
        <div className="container-fluid">
          <div className="student-portal__error">
            <i className="bi bi-exclamation-triangle me-2" />
            {error || 'Student record not found.'}
          </div>
        </div>
      </div>
    );
  }

  const isPending = student.approved === 0 || student.approved === '0';
  const displayName = student.name || user?.name || student.email?.split('@')[0] || 'Student';
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const rawProfileImage = student.profile_image != null ? String(student.profile_image).trim() : '';
  const profileImageUrl = rawProfileImage !== '' && !profileImgError
    ? (rawProfileImage.startsWith('http') ? rawProfileImage : normalizeUrl(rawProfileImage))
    : null;

  return (
    <div className="student-portal" data-page="student-dashboard" data-portal-version="2">
      <div className="container-fluid">
        {/* Welcome header */}
        <div
          className="student-portal__welcome"
          style={{
            marginBottom: '1.5rem',
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%)',
            borderRadius: '12px',
            color: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.25rem 0' }}>
            {greeting}, {displayName}
          </h1>
          <p style={{ margin: 0, opacity: 0.92, fontSize: '0.95rem' }}>
            Welcome to your student portal. View courses, grades, billing, and certificates.
          </p>
        </div>

        {isPending && (
          <div className="student-portal__pending">
            <i className="bi bi-info-circle" />
            <span>
              Your account is pending approval. You can view your profile and sections; full access may apply after admin approval.
            </span>
          </div>
        )}

        {/* Profile card */}
        <div className="student-portal__profile-card">
          <div className="student-portal__profile-body">
            <div className="student-portal__avatar-wrap">
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={displayName}
                  className="student-portal__avatar"
                  onError={() => setProfileImgError(true)}
                />
              ) : (
                <div className="student-portal__avatar-placeholder">
                  <i className="bi bi-person-fill" />
                </div>
              )}
            </div>
            <div className="student-portal__profile-info">
              <h2 className="student-portal__profile-name">{displayName}</h2>
              <p className="student-portal__profile-email">{student.email}</p>
              <div className="student-portal__profile-meta">
                <span className={`student-portal__badge ${isPending ? 'student-portal__badge--warning' : 'student-portal__badge--success'}`}>
                  {isPending ? 'Pending approval' : (student.status || 'Active')}
                </span>
                {student.student_id && (
                  <span className="student-portal__profile-id">ID: {student.student_id}</span>
                )}
                {student.phone && (
                  <span className="student-portal__profile-id">
                    <i className="bi bi-telephone me-1" />
                    {student.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <h3 className="student-portal__section-title">Overview</h3>
        <div className="student-portal__stats">
          <div className="student-portal__stat-card">
            <div className="student-portal__stat-value student-portal__stat-value--primary">{stats.coursesCount}</div>
            <div className="student-portal__stat-label">Courses</div>
          </div>
          <div className="student-portal__stat-card">
            <div className={`student-portal__stat-value ${stats.balanceDue > 0 ? 'student-portal__stat-value--warning' : 'student-portal__stat-value--success'}`}>
              {stats.balanceDue > 0 ? `$${Number(stats.balanceDue).toFixed(2)}` : '$0'}
            </div>
            <div className="student-portal__stat-label">Balance due</div>
          </div>
          <div className="student-portal__stat-card">
            <div className={`student-portal__stat-value ${stats.pendingCount > 0 ? 'student-portal__stat-value--warning' : ''}`}>
              {stats.pendingCount}
            </div>
            <div className="student-portal__stat-label">Pending payments</div>
          </div>
          <div className="student-portal__stat-card">
            <div className="student-portal__stat-value">{stats.gradesCount}</div>
            <div className="student-portal__stat-label">Grades</div>
          </div>
          <div className="student-portal__stat-card">
            <div className="student-portal__stat-value student-portal__stat-value--success">{stats.certificatesCount}</div>
            <div className="student-portal__stat-label">Certificates</div>
          </div>
        </div>

        {/* Quick actions */}
        <h3 className="student-portal__section-title">Quick access</h3>
        <div className="student-portal__actions">
          <Link to="/student/courses" className="student-portal__action-card">
            <div className="student-portal__action-icon student-portal__action-icon--courses">
              <i className="bi bi-journal-bookmark-fill" />
            </div>
            <h4 className="student-portal__action-title">My Courses</h4>
            <p className="student-portal__action-desc">
              View enrolled courses, codes, and enrollment status.
            </p>
          </Link>
          <Link to="/student/grades" className="student-portal__action-card">
            <div className="student-portal__action-icon student-portal__action-icon--grades">
              <i className="bi bi-award-fill" />
            </div>
            <h4 className="student-portal__action-title">Grades</h4>
            <p className="student-portal__action-desc">
              View approved grades for your enrolled courses.
            </p>
          </Link>
          <Link to="/student/certificates" className="student-portal__action-card">
            <div className="student-portal__action-icon student-portal__action-icon--certificates">
              <i className="bi bi-patch-check-fill" />
            </div>
            <h4 className="student-portal__action-title">Certificates</h4>
            <p className="student-portal__action-desc">
              View and download your issued certificates.
            </p>
          </Link>
          <Link to="/student/billing" className="student-portal__action-card">
            <div className="student-portal__action-icon student-portal__action-icon--billing">
              <i className="bi bi-credit-card-2-front-fill" />
            </div>
            <h4 className="student-portal__action-title">Billing & Payments</h4>
            <p className="student-portal__action-desc">
              View balances, request payments, and see transaction history.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default StudentPortal;
