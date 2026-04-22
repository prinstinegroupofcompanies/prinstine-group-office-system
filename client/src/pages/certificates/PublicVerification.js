import React, { useState } from 'react';
import api from '../../config/api';
import { normalizeUrl } from '../../utils/apiUrl';

const PublicVerification = () => {
  const [formData, setFormData] = useState({
    student_name: '',
    student_id: ''
  });
  const [studentInfo, setStudentInfo] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [accessWindow, setAccessWindow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setStudentInfo(null);
    setCertificates([]);
    setAccessWindow(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setStudentInfo(null);
    setCertificates([]);
    setAccessWindow(null);
    setLoading(true);

    try {
      const response = await api.post('/certificates/verify', formData);
      console.log('Verification response:', response.data);
      
      if (response.data && response.data.student && Array.isArray(response.data.certificates)) {
        setStudentInfo(response.data.student);
        setCertificates(response.data.certificates);
        setAccessWindow(response.data.access_window || null);
      } else {
        setError('Certificate data not found in response');
      }
    } catch (err) {
      console.error('Verification error:', err);
      console.error('Error response:', err.response?.data);
      setError(err.response?.data?.error || 'Certificate not found. Please verify the student name and ID.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (certId, certCode, format) => {
    try {
      // Use centralized API config for consistent error handling
      const downloadUrl = `/certificates/public/${certId}/download/${format}`;
      const response = await api.get(downloadUrl, {
        responseType: 'blob',
        headers: {
          'Accept': `image/${format}`
        }
      });
      
      // response.data is already a Blob when responseType is 'blob'
      const blob = response.data;
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `certificate-${certCode}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download certificate. Please try again.');
    }
  };

  const calculateDuration = (certificate) => {
    if (certificate?.course_start_date && certificate?.course_end_date) {
      const start = new Date(certificate.course_start_date);
      const end = new Date(certificate.course_end_date);
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const months = Math.floor(diffDays / 30);
      const days = diffDays % 30;
      
      if (months > 0) {
        return `${months} month${months > 1 ? 's' : ''}${days > 0 ? ` ${days} day${days > 1 ? 's' : ''}` : ''}`;
      }
      return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
    }
    return 'N/A';
  };

  const getFileUrl = (certificate) => {
    if (certificate?.file_path) {
      // Use centralized URL utility for production-ready URLs
      return normalizeUrl(certificate.file_path);
    }
    return null;
  };

  return (
    <div className="container mt-5">
      <div className="row justify-content-center">
        <div className="col-md-10">
          <div className="card shadow">
            <div className="card-body">
              <div className="text-center mb-4">
                <img 
                  src="/prinstine-logo.png" 
                  alt="Prinstine Group" 
                  style={{ maxWidth: '200px', height: 'auto', marginBottom: '2rem' }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                <h2>Certificate Verification</h2>
                <p className="text-muted">Verify student certificates using name and ID</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="row mb-3">
                  <div className="col-md-6">
                    <label className="form-label">Student Name *</label>
                    <input
                      type="text"
                      className="form-control"
                      name="student_name"
                      value={formData.student_name}
                      onChange={handleChange}
                      placeholder="Enter student full name"
                      required
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Student ID *</label>
                    <input
                      type="text"
                      className="form-control"
                      name="student_id"
                      value={formData.student_id}
                      onChange={handleChange}
                      placeholder="Enter student ID"
                      required
                    />
                  </div>
                </div>
                <div className="text-center">
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2"></span>
                        Verifying...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-search me-2"></i>Verify Certificate
                      </>
                    )}
                  </button>
                </div>
              </form>

              {error && (
                <div className="alert alert-danger mt-4">
                  <i className="bi bi-exclamation-triangle me-2"></i>
                  {error}
                </div>
              )}

              {studentInfo && certificates.length > 0 && (
                <div className="mt-4">
                  <div className="card bg-light">
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-4 text-center">
                          {studentInfo.profile_image ? (
                            <img
                              src={normalizeUrl(studentInfo.profile_image)}
                              alt={studentInfo.full_name}
                              className="img-fluid rounded-circle mb-3"
                              style={{ width: '150px', height: '150px', objectFit: 'cover' }}
                            />
                          ) : (
                            <div className="bg-info rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style={{ width: '150px', height: '150px' }}>
                              <i className="bi bi-person" style={{ fontSize: '4rem', color: 'white' }}></i>
                            </div>
                          )}
                          <h4>{studentInfo.full_name}</h4>
                          <p className="text-muted">Student ID: {studentInfo.student_id}</p>
                          <p className="text-muted mb-0">
                            Cohort: {studentInfo.cohort_name || 'N/A'}
                          </p>
                          {accessWindow && (
                            <div className="mt-2">
                              <span className={`badge ${accessWindow.enabled ? 'bg-success' : 'bg-secondary'}`}>
                                {accessWindow.enabled ? 'Access Window Enabled' : 'Access Window Disabled'}
                              </span>
                              <div className="small text-muted mt-1">
                                {accessWindow.start ? new Date(accessWindow.start).toLocaleDateString() : 'Now'} - {accessWindow.end ? new Date(accessWindow.end).toLocaleDateString() : 'Until closed'}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="col-md-8">
                          <h5 className="mb-3">Certificate Details ({certificates.length})</h5>
                          {certificates.map((certificate) => (
                            <div key={certificate.id} className="border rounded p-3 mb-3 bg-white">
                              <div className="row mb-2">
                                <div className="col-md-6">
                                  <strong>Certificate ID:</strong> {certificate.certificate_id}
                                </div>
                                <div className="col-md-6">
                                  <strong>Course:</strong> {certificate.course_code} - {certificate.course_title}
                                </div>
                              </div>
                              <div className="row mb-2">
                                <div className="col-md-6">
                                  <strong>Duration:</strong> {calculateDuration(certificate)}
                                </div>
                                <div className="col-md-6">
                                  <strong>Issue Date:</strong> {certificate.issue_date ? new Date(certificate.issue_date).toLocaleDateString() : 'N/A'}
                                </div>
                              </div>
                              {certificate.completion_date && (
                                <div className="row mb-2">
                                  <div className="col-md-6">
                                    <strong>Completion Date:</strong> {new Date(certificate.completion_date).toLocaleDateString()}
                                  </div>
                                  {certificate.grade && (
                                    <div className="col-md-6">
                                      <strong>Grade:</strong> <span className="badge bg-success">{certificate.grade}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                              {certificate.course_start_date && certificate.course_end_date && (
                                <div className="row mb-3">
                                  <div className="col-md-12">
                                    <strong>Course Period:</strong> {new Date(certificate.course_start_date).toLocaleDateString()} - {new Date(certificate.course_end_date).toLocaleDateString()}
                                  </div>
                                </div>
                              )}

                              {getFileUrl(certificate) && (
                                <div className="mb-3">
                                  <strong>Certificate:</strong>
                                  <div className="mt-2 text-center">
                                    {certificate.file_type === 'pdf' ? (
                                      <div className="p-3 bg-light rounded">
                                        <i className="bi bi-file-pdf" style={{ fontSize: '3rem', color: '#dc3545' }}></i>
                                        <p className="mt-2">PDF Certificate</p>
                                        <a href={getFileUrl(certificate)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-danger">
                                          <i className="bi bi-eye me-2"></i>View PDF
                                        </a>
                                      </div>
                                    ) : (
                                      <img
                                        src={getFileUrl(certificate)}
                                        alt="Certificate"
                                        className="img-fluid border rounded"
                                        style={{ maxHeight: '300px' }}
                                      />
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className="mt-3">
                                <strong>Download Certificate:</strong>
                                <div className="d-flex gap-2 flex-wrap mt-2">
                                  <button
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => handleDownload(certificate.id, certificate.certificate_id, 'png')}
                                  >
                                    <i className="bi bi-download me-1"></i>PNG
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-success"
                                    onClick={() => handleDownload(certificate.id, certificate.certificate_id, 'jpeg')}
                                  >
                                    <i className="bi bi-download me-1"></i>JPEG
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={() => handleDownload(certificate.id, certificate.certificate_id, 'pdf')}
                                  >
                                    <i className="bi bi-download me-1"></i>PDF
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicVerification;

