import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import CertificateForm from './CertificateForm';
import CertificateView from './CertificateView';

const CertificateManagement = ({ embedded = false }) => {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState(null);
  const [viewingCertificate, setViewingCertificate] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchCertificates();
  }, []);

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
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `certificate-${certificate.certificate_id}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download certificate');
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
          <button className="btn btn-primary" onClick={handleAdd}>
            <i className="bi bi-plus-circle me-2"></i>Add Certificate
          </button>
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
                        <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEdit(certificate)}>
                          <i className="bi bi-pencil me-1"></i>Edit
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(certificate.id)}>
                          <i className="bi bi-trash me-1"></i>Delete
                        </button>
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

