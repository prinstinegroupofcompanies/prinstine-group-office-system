import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import { normalizeUrl } from '../../utils/apiUrl';
import { useAuth } from '../../hooks/useAuth';

const InstructorForm = ({ instructor, courses, onClose }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    phone: '',
    specialization: '',
    courses_assigned: [],
    password: '',
    profile_image: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (instructor) {
      setFormData({
        name: instructor.name || '',
        email: instructor.email || '',
        username: instructor.username || '',
        phone: instructor.phone || '',
        specialization: instructor.specialization || '',
        courses_assigned: instructor.courses_assigned ? (typeof instructor.courses_assigned === 'string' ? JSON.parse(instructor.courses_assigned) : instructor.courses_assigned) : [],
        password: '',
        profile_image: instructor.profile_image || ''
      });
    }
  }, [instructor]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      const courses = [...formData.courses_assigned];
      if (checked) {
        courses.push(parseInt(value));
      } else {
        const index = courses.indexOf(parseInt(value));
        if (index > -1) courses.splice(index, 1);
      }
      setFormData({ ...formData, courses_assigned: courses });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      return;
    }

    setUploadingImage(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const uploadUrl = instructor?.id
        ? `/upload/entity-image/instructor/${instructor.id}`
        : '/upload/entity-image';
      const response = await api.post(uploadUrl, fd);
      const imageUrl = response.data?.imageUrl || '';
      setFormData(prev => ({ ...prev, profile_image: imageUrl }));
    } catch (err) {
      setError('Failed to upload image: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        username: formData.username,
        phone: formData.phone,
        specialization: formData.specialization,
        courses_assigned: formData.courses_assigned,
        profile_image: formData.profile_image
      };

      if (!instructor) {
        payload.password = formData.password && String(formData.password).trim()
          ? formData.password
          : 'Instructor@123';
      }

      if (instructor) {
        await api.put(`/academy/instructors/${instructor.id}`, payload);
      } else {
        const response = await api.post('/academy/instructors', payload);
        if (user?.role !== 'Admin' && response.data?.message) {
          alert(response.data.message);
        }
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save instructor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{instructor ? 'Edit Instructor' : 'Add Instructor'}</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              {!instructor && user?.role !== 'Admin' && (
                <div className="alert alert-info">
                  <i className="bi bi-info-circle me-2"></i>
                  This instructor will be created and submitted for admin approval before being activated.
                </div>
              )}

              <div className="row">
                <div className="col-md-4 mb-3">
                  <label className="form-label">Profile Image</label>
                  <div className="mb-2">
                    {formData.profile_image && (
                      <img src={formData.profile_image.startsWith('http') ? formData.profile_image : normalizeUrl(formData.profile_image)} alt="Profile" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '50%' }} />
                    )}
                  </div>
                  <input type="file" className="form-control" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                  {uploadingImage && <small className="text-muted">Uploading...</small>}
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label">Name *</label>
                  <input type="text" className="form-control" name="name" value={formData.name} onChange={handleChange} required />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label">Email *</label>
                  <input type="email" className="form-control" name="email" value={formData.email} onChange={handleChange} required disabled={!!instructor} />
                  {instructor && <small className="form-text text-muted">Email cannot be changed</small>}
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label">Username {!instructor && '*'}</label>
                  <input
                    type="text"
                    className="form-control"
                    name="username"
                    value={formData.username}
                    onChange={handleChange}
                    required={!instructor}
                    placeholder={!instructor ? 'Used to sign in' : ''}
                  />
                  {!instructor && (
                    <small className="text-muted">Instructors sign in with this username or their email.</small>
                  )}
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label">Phone</label>
                  <input type="tel" className="form-control" name="phone" value={formData.phone} onChange={handleChange} />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label">Specialization</label>
                <input type="text" className="form-control" name="specialization" value={formData.specialization} onChange={handleChange} placeholder="e.g., Web Development, Data Science" />
              </div>

              <div className="mb-3">
                <label className="form-label">Assign Courses</label>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #dee2e6', padding: '10px', borderRadius: '4px' }}>
                  {courses.length === 0 ? (
                    <p className="text-muted">No courses available. Create courses first.</p>
                  ) : (
                    courses.map((course) => (
                      <div key={course.id} className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          value={course.id}
                          checked={formData.courses_assigned.includes(course.id)}
                          onChange={handleChange}
                        />
                        <label className="form-check-label">
                          {course.course_code} - {course.title}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {!instructor && (
                <div className="mb-3">
                  <label className="form-label">Password</label>
                  <input type="password" className="form-control" name="password" value={formData.password} onChange={handleChange} placeholder="Leave empty for default password" />
                  <small className="form-text text-muted">Default: Instructor@123</small>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading || uploadingImage}>
                {loading ? 'Saving...' : instructor ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default InstructorForm;

