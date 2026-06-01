import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import './InstructorDashboard.css';

/**
 * Placeholder instructor home — content will be added in a future release.
 */
const InstructorDashboard = () => {
  const { user } = useAuth();

  return (
    <div className="instructor-dashboard">
      <div className="container-fluid py-4">
        <div className="instructor-dashboard__hero card border-0 shadow-sm">
          <div className="card-body text-center py-5">
            <i className="bi bi-person-workspace instructor-dashboard__icon text-primary" aria-hidden />
            <h1 className="h3 mt-3 mb-2">Instructor Dashboard</h1>
            <p className="text-muted mb-1">
              Welcome{user?.name ? `, ${user.name}` : ''}.
            </p>
            <p className="text-muted small mb-0">
              Your instructor workspace is being prepared. Check back soon for courses, schedules, and tools.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstructorDashboard;
