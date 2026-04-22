import React, { useState } from 'react';
import api from '../../config/api';

const CohortForm = ({ cohort, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    start_date: '',
    end_date: '',
    period: '',
    description: '',
    status: 'Active',
    cert_access_enabled: false,
    cert_access_start: '',
    cert_access_end: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (cohort) {
      setFormData({
        name: cohort.name || '',
        start_date: cohort.start_date ? cohort.start_date.split('T')[0] : '',
        end_date: cohort.end_date ? cohort.end_date.split('T')[0] : '',
        period: cohort.period || '',
        description: cohort.description || '',
        status: cohort.status || 'Active',
        cert_access_enabled: Number(cohort.cert_access_enabled || 0) === 1,
        cert_access_start: cohort.cert_access_start ? cohort.cert_access_start.split('T')[0] : '',
        cert_access_end: cohort.cert_access_end ? cohort.cert_access_end.split('T')[0] : ''
      });
    }
  }, [cohort]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (cohort) {
        await api.put(`/academy/cohorts/${cohort.id}`, formData);
      } else {
        await api.post('/academy/cohorts', formData);
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save cohort');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{cohort ? 'Edit Cohort' : 'Add Cohort'}</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              <div className="mb-3">
                <label className="form-label">Cohort Name *</label>
                <input
                  type="text"
                  className="form-control"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="e.g., Full Stack Development 2024"
                />
              </div>

              <div className="row mb-3">
                <div className="col-md-6">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-control"
                    name="start_date"
                    value={formData.start_date}
                    onChange={handleChange}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">End Date</label>
                  <input
                    type="date"
                    className="form-control"
                    name="end_date"
                    value={formData.end_date}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label">Period</label>
                <input
                  type="text"
                  className="form-control"
                  name="period"
                  value={formData.period}
                  onChange={handleChange}
                  placeholder="e.g., Q1 2024, Fall 2024, 2024-2025"
                />
                <small className="form-text text-muted">
                  Academic period or term (e.g., Q1 2024, Fall 2024, 2024-2025)
                </small>
              </div>

              <div className="mb-3">
                <label className="form-label">Description</label>
                <textarea
                  className="form-control"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Optional description for this cohort"
                />
              </div>

              <div className="mb-3">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                >
                  <option value="Active">Active</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="border rounded p-3 bg-light">
                <h6 className="mb-3">Certificate Access Window (Student Verification)</h6>
                <div className="form-check mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="cert_access_enabled"
                    name="cert_access_enabled"
                    checked={!!formData.cert_access_enabled}
                    onChange={handleChange}
                  />
                  <label className="form-check-label" htmlFor="cert_access_enabled">
                    Enable certificate verification/access for this cohort
                  </label>
                </div>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Access Start</label>
                    <input
                      type="date"
                      className="form-control"
                      name="cert_access_start"
                      value={formData.cert_access_start}
                      onChange={handleChange}
                      disabled={!formData.cert_access_enabled}
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Access End</label>
                    <input
                      type="date"
                      className="form-control"
                      name="cert_access_end"
                      value={formData.cert_access_end}
                      onChange={handleChange}
                      disabled={!formData.cert_access_enabled}
                    />
                  </div>
                </div>
                <small className="text-muted">
                  Students can verify and download certificates only while this window is open.
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Saving...' : cohort ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CohortForm;

