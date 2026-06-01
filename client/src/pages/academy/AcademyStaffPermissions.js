import React, { useState, useEffect, useMemo } from 'react';
import api from '../../config/api';

const AcademyStaffPermissions = () => {
  const [definitions, setDefinitions] = useState([]);
  const [assignableKeys, setAssignableKeys] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [defRes, staffRes] = await Promise.all([
          api.get('/academy/permissions/definitions'),
          api.get('/academy/permissions/staff')
        ]);
        setDefinitions(defRes.data?.definitions || []);
        setAssignableKeys(defRes.data?.assignableKeys || []);
        setStaffList(staffRes.data?.staff || []);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load academy permissions');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const g = {};
    for (const d of definitions) {
      if (!assignableKeys.includes(d.key)) continue;
      const group = d.group || 'Other';
      if (!g[group]) g[group] = [];
      g[group].push(d);
    }
    return g;
  }, [definitions, assignableKeys]);

  const handleSelectStaff = (userId) => {
    setSelectedUserId(userId);
    setMessage('');
    const row = staffList.find((s) => String(s.user_id) === String(userId));
    setSelectedPerms(row?.permissions ? [...row.permissions] : []);
  };

  const togglePerm = (key) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.put(`/academy/permissions/user/${selectedUserId}`, {
        permissions: selectedPerms
      });
      setMessage('Permissions saved. The user will see Academy in the sidebar after they refresh the page or log in again.');
      const staffRes = await api.get('/academy/permissions/staff');
      setStaffList(staffRes.data?.staff || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body">
        <h5 className="card-title">Academy permissions</h5>
        <p className="text-muted small">
          Assign permissions to any <strong>Staff</strong> or <strong>Department Head</strong>. Users only
          see Academy menu items and actions for permissions you select. Academy department heads automatically
          receive full access (except Admin final grade approval). Others need explicit assignments and must
          log out/in after changes.
        </p>
        {error && <div className="alert alert-danger">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <div className="row">
          <div className="col-md-4 mb-3">
            <label className="form-label">Staff or department head</label>
            <select
              className="form-select"
              value={selectedUserId}
              onChange={(e) => handleSelectStaff(e.target.value)}
            >
              <option value="">Select user…</option>
              {staffList.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.name} ({s.role}) — {s.department || '—'}
                </option>
              ))}
            </select>
            {staffList.length === 0 && (
              <p className="small text-muted mt-2">No staff or department heads found.</p>
            )}
          </div>
          <div className="col-md-8">
            {!selectedUserId ? (
              <p className="text-muted">Select a staff member to assign permissions.</p>
            ) : (
              <>
                {Object.entries(grouped).map(([group, perms]) => (
                  <div key={group} className="mb-3 border rounded p-3">
                    <h6 className="fw-semibold mb-2">{group}</h6>
                    {perms.map((p) => (
                      <div key={p.key} className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`perm-${p.key}`}
                          checked={selectedPerms.includes(p.key)}
                          onChange={() => togglePerm(p.key)}
                        />
                        <label className="form-check-label" htmlFor={`perm-${p.key}`}>
                          {p.label}
                        </label>
                      </div>
                    ))}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : 'Save permissions'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcademyStaffPermissions;
