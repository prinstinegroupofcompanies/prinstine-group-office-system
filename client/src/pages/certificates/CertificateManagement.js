import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import CertificateForm from './CertificateForm';
import CertificateView from './CertificateView';
import { useAuth } from '../../hooks/useAuth';
import { canManageAcademySection } from '../../utils/academyPermissions';
import { saveCertificateAxiosBlob } from '../../utils/certificateDownload';

const CertificateManagement = ({ embedded = false }) => {
  const { user } = useAuth();
  const canManageCerts = user && canManageAcademySection(user, 'certificates');
  const canManageCohorts = user && canManageAcademySection(user, 'cohorts');
  const [certificates, setCertificates] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortSavingId, setCohortSavingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState(null);
  const [viewingCertificate, setViewingCertificate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchCertificates();
  }, []);

  useEffect(() => {
    if (canManageCohorts) {
      fetchCohorts();
    }
  }, [canManageCohorts]);

  useEffect(() => {
    if (searchQuery) {
      searchCertificates();
    } else {
      fetchCertificates();
    }
  }, [searchQuery]);

  const fetchCertificates = async () => {
    try {
      setLoading(true);
      const response = await api.get('/certificates');
      setCertificates(response.data.certificates || []);
    } catch (error) {
      console.error('Error fetching certificates:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCohorts = async () => {
    try {
      setCohortLoading(true);
      const response = await api.get('/academy/cohorts');
      setCohorts(response.data.cohorts || []);
    } catch (error) {
      console.error('Error fetching cohorts:', error);
      setCohorts([]);
    } finally {
      setCohortLoading(false);
    }
  };

  const searchCertificates = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/certificates/search/${encodeURIComponent(searchQuery)}`);
      setCertificates(response.data.certificates || []);
    } catch (error) {
      console.error('Error searching certificates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingCertificate(null);
    setShowForm(true);
  };

  const handleEdit = (certificate) => {
    setEditingCertificate(certificate);
    setShowForm(true);
  };

  const handleView = async (certificate) => {
    try {
      const response = await api.get(`/certificates/${certificate.id}`);
      setViewingCertificate(response.data.certificate);
    } catch (error) {
      console.error('Error fetching certificate details:', error);
      setViewingCertificate(certificate);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this certificate? This action cannot be undone.')) {
      try {
        await api.delete(`/certificates/${id}`);
        fetchCertificates();
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting certificate');
      }
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingCertificate(null);
    fetchCertificates();
  };

  const handleDownload = async (certificate, format) => {
    try {
      const response = await api.get(`/certificates/${certificate.id}/download/${format}`, {
        responseType: 'blob',
        validateStatus: () => true
      });
      await saveCertificateAxiosBlob(response, `certificate-${certificate.certificate_id}`);
    } catch (error) {
      console.error('Download error:', error);
      alert(error.message || 'Failed to download certificate');
    }
  };

  const handleCohortWindowChange = async (cohortId, field, value) => {
    try {
      setCohortSavingId(cohortId);
      await api.put(`/academy/cohorts/${cohortId}`, { [field]: value });
      setCohorts((prev) =>
        prev.map((c) => (c.id === cohortId ? { ...c, [field]: value } : c))
      );
    } catch (error) {
      console.error('Error updating cohort certificate window:', error);
      alert(error.response?.data?.error || 'Failed to update certificate verification window');
    } finally {
      setCohortSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      <div className="row mb-4">
        <div className="col-12 d-flex justify-content-between align-items-center">
          {!embedded && <h1 className="h3 mb-0">Certificate Management</h1>}
          {canManageCerts && (
            <button className="btn btn-primary" onClick={handleAdd}>
              <i className="bi bi-plus-circle me-2"></i>Add Certificate
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="row mb-3">
        <div className="col-md-6">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by student name, ID, or certificate ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => setSearchQuery('')}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Certificate verification window controls */}
      {canManageCohorts && (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>Certificate Verification Window (Per Cohort)</strong>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={fetchCohorts} disabled={cohortLoading}>
              {cohortLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="card-body">
            {cohortLoading ? (
              <div className="text-muted">Loading cohorts...</div>
            ) : cohorts.length === 0 ? (
              <div className="text-muted">No cohorts found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Cohort</th>
                      <th>Period</th>
                      <th>Verification</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((cohort) => (
                      <tr key={cohort.id}>
                        <td>{cohort.name}</td>
                        <td>{cohort.period || '-'}</td>
                        <td>
                          <span className={`badge ${Number(cohort.cert_access_enabled || 0) === 1 ? 'bg-success' : 'bg-secondary'}`}>
                            {Number(cohort.cert_access_enabled || 0) === 1 ? 'Open' : 'Closed'}
                          </span>
                        </td>
                        <td>
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={cohort.cert_access_start ? String(cohort.cert_access_start).slice(0, 10) : ''}
                            onChange={(e) => handleCohortWindowChange(cohort.id, 'cert_access_start', e.target.value || null)}
                            disabled={cohortSavingId === cohort.id}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={cohort.cert_access_end ? String(cohort.cert_access_end).slice(0, 10) : ''}
                            onChange={(e) => handleCohortWindowChange(cohort.id, 'cert_access_end', e.target.value || null)}
                            disabled={cohortSavingId === cohort.id}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success me-2"
                            disabled={cohortSavingId === cohort.id || Number(cohort.cert_access_enabled || 0) === 1}
                            onClick={() => handleCohortWindowChange(cohort.id, 'cert_access_enabled', true)}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            disabled={cohortSavingId === cohort.id || Number(cohort.cert_access_enabled || 0) === 0}
                            onClick={() => handleCohortWindowChange(cohort.id, 'cert_access_enabled', false)}
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Certificates List */}
      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Certificate ID</th>
                  <th>Student Name</th>
                  <th>Student ID</th>
                  <th>Course</th>
                  <th>Issue Date</th>
                  <th>Grade</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {certificates.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center text-muted">
                      {searchQuery ? 'No certificates found matching your search.' : 'No certificates found. Click "Add Certificate" to create one.'}
                    </td>
                  </tr>
                ) : (
                  certificates.map((certificate) => (
                    <tr key={certificate.id}>
                      <td><strong>{certificate.certificate_id}</strong></td>
                      <td>{certificate.student_name}</td>
                      <td>{certificate.student_code}</td>
                      <td>
                        <div>
                          <strong>{certificate.course_code}</strong>
                          <br />
                          <small className="text-muted">{certificate.course_title}</small>
                        </div>
                      </td>
                      <td>{certificate.issue_date ? new Date(certificate.issue_date).toLocaleDateString() : 'N/A'}</td>
                      <td>
                        {certificate.grade ? (
                          <span className="badge bg-success">{certificate.grade}</span>
                        ) : (
                          <span className="text-muted">N/A</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-info me-2" onClick={() => handleView(certificate)}>
                          <i className="bi bi-eye me-1"></i>View
                        </button>
                        <button className="btn btn-sm btn-outline-success me-2" onClick={() => handleDownload(certificate, 'pdf')}>
                          <i className="bi bi-download me-1"></i>PDF
                        </button>
                        <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => handleDownload(certificate, 'png')}>
                          <i className="bi bi-download me-1"></i>Image
                        </button>
                        {canManageCerts && (
                          <>
                            <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEdit(certificate)}>
                              <i className="bi bi-pencil me-1"></i>Edit
                            </button>
                            <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(certificate.id)}>
                              <i className="bi bi-trash me-1"></i>Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showForm && (
        <CertificateForm
          certificate={editingCertificate}
          onClose={handleFormClose}
        />
      )}

      {viewingCertificate && (
        <CertificateView
          certificate={viewingCertificate}
          onClose={() => setViewingCertificate(null)}
        />
      )}
    </div>
  );
};

export default CertificateManagement;

