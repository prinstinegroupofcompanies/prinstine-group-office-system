import React from 'react';

const SystemLockdownScreen = ({ lockdown, compact = false }) => {
  const info = lockdown || {};

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
            <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: compact ? '2rem' : '3rem' }} />
          </div>
          <h2 className={compact ? 'h4' : 'h3'}>{info.title || 'System Currently Unavailable'}</h2>
        </div>

        <div className="alert alert-warning mb-0">
          <p className="mb-2">
            {info.message ||
              'The Prinstine Management System is currently down due to server issues affecting the backend and frontend. Please try again later.'}
          </p>
          {info.detail && <p className="mb-0 small text-muted">{info.detail}</p>}
        </div>
      </div>
    </div>
  );
};

export default SystemLockdownScreen;
