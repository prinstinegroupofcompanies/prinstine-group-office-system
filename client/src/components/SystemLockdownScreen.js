import React from 'react';

const SystemLockdownScreen = ({ lockdown, compact = false }) => {
  const info = lockdown || {};
  const dev = info.developer || {};

  return (
    <div className={compact ? 'text-center py-4' : 'auth-container'}>
      <div className={compact ? '' : 'auth-card'} style={compact ? undefined : { maxWidth: 520 }}>
        <div className="text-center mb-4">
          {!compact && (
            <img
              src="/prinstine-logo.png"
              alt="Prinstine Group"
              style={{ maxWidth: 160, height: 'auto', marginBottom: '1rem' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <div className="mb-3">
            <i className="bi bi-shield-lock text-danger" style={{ fontSize: compact ? '2rem' : '3rem' }} />
          </div>
          <h2 className={compact ? 'h4' : 'h3'}>{info.title || 'System Temporarily Offline'}</h2>
        </div>

        <div className="alert alert-warning">
          <p className="mb-2">
            {info.message ||
              'The Prinstine Management System is temporarily closed. All user logins are disabled.'}
          </p>
          {info.reopen && <p className="mb-0 small">{info.reopen}</p>}
        </div>

        <div className="card border-0 bg-light">
          <div className="card-body">
            <h6 className="card-title mb-2">
              <i className="bi bi-person-badge me-2" />
              Primary Developer
            </h6>
            <p className="mb-1 fw-semibold">{dev.name || 'Primary System Developer'}</p>
            {dev.email && (
              <p className="mb-2">
                <a href={`mailto:${dev.email}`}>{dev.email}</a>
              </p>
            )}
            <p className="text-muted small mb-0">
              {info.contact_instruction ||
                'Contact the primary developer to authorize system reopening.'}
            </p>
          </div>
        </div>

        {!compact && (
          <p className="text-muted small text-center mt-4 mb-0">
            Unauthorized deployments must remain locked. Only the primary developer may restore access.
          </p>
        )}
      </div>
    </div>
  );
};

export default SystemLockdownScreen;
