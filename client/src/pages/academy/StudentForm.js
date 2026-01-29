import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import { normalizeUrl } from '../../utils/apiUrl';

const StudentForm = ({ student, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    phone: '',
    enrollment_date: '',
    status: 'Active',
    profile_image: null,
    courses_enrolled: [],
    cohort_id: '',
    period: '',
    date_of_birth: '',
    place_of_birth: '',
    nationality: '',
    gender: '',
    marital_status: '',
    national_id: '',
    password: ''
  });

  const [courses, setCourses] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');

  /* =========================
     LOAD INITIAL DATA
  ========================= */

  useEffect(() => {
    fetchCourses();
    fetchCohorts();

    if (student) {
      setFormData({
        ...formData,
        ...student,
        enrollment_date: student.enrollment_date ? new Date(student.enrollment_date).toISOString().split('T')[0] : '',
        courses_enrolled: student.courses_enrolled ? (typeof student.courses_enrolled === 'string' ? JSON.parse(student.courses_enrolled) : student.courses_enrolled) : [],
        profile_image: student.profile_image || null,
        password: ''
      });
    }
    // eslint-disable-next-line
  }, [student]);

  const fetchCourses = async () => {
    try {
      const res = await api.get('/academy/courses');
      setCourses(res.data?.courses || []);
    } catch (err) {
      console.error('Failed to fetch courses:', err);
      setCourses([]);
    }
  };

  const fetchCohorts = async () => {
    try {
      const res = await api.get('/academy/cohorts', { params: { status: 'Active' } });
      setCohorts(res.data?.cohorts || []);
    } catch (err) {
      console.error('Failed to fetch cohorts:', err);
      setCohorts([]);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }
    setUploadingImage(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('type', 'student');

      const res = await api.post('/upload/entity-image', fd);
      const url = res.data?.imageUrl || '';
      setFormData(prev => ({ ...prev, profile_image: url }));
    } catch (err) {
      setError('Failed to upload image: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (type === 'checkbox') {
      const id = parseInt(value);
      setFormData(prev => ({
        ...prev,
        courses_enrolled: checked
          ? [...prev.courses_enrolled, id]
          : prev.courses_enrolled.filter(c => parseInt(c) !== id)
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  /* =========================
     SUBMIT
  ========================= */

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        username: formData.username || undefined,
        phone: formData.phone || undefined,
        enrollment_date: formData.enrollment_date || undefined,
        status: formData.status || 'Active',
        profile_image: (formData.profile_image != null && String(formData.profile_image).trim()) ? String(formData.profile_image).trim() : null,
        cohort_id: formData.cohort_id || null,
        period: formData.period || null,
        courses_enrolled: Array.isArray(formData.courses_enrolled) ? formData.courses_enrolled : [],
      };
      if (!student) {
        payload.password = formData.password || 'Student@123';
      }

      if (student) {
        await api.put(`/academy/students/${student.id}`, payload);
      } else {
        await api.post('/academy/students', payload);
      }

      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save student');
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     RENDER
  ========================= */

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
      <div className="modal-dialog modal-lg">
        <form className="modal-content" onSubmit={handleSubmit}>
          <div className="modal-header">
            <h5>{student ? 'Edit Student' : 'Add Student'}</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}

            {/* IMAGE */}
            <div className="mb-3">
              <label className="form-label">Student Profile Image</label>
              <div className="mb-2 d-flex align-items-center gap-2 flex-wrap">
                {formData.profile_image && String(formData.profile_image).trim() !== '' ? (
                  <>
                    <img
                      key={formData.profile_image}
                      src={formData.profile_image.startsWith('http') ? formData.profile_image : normalizeUrl(formData.profile_image)}
                      alt={formData.name || 'Student'}
                      className="img-fluid rounded-circle"
                      style={{ width: '100px', height: '100px', objectFit: 'cover', border: '3px solid #dee2e6' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setFormData(prev => ({ ...prev, profile_image: null }))}>
                      Remove
                    </button>
                  </>
                ) : (
                  <div className="bg-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: '100px', height: '100px', border: '3px solid #dee2e6' }}>
                    <i className="bi bi-person text-white" style={{ fontSize: '3rem' }} />
                  </div>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploadingImage}
                className="form-control"
              />
              {uploadingImage && <small className="text-muted">Uploading...</small>}
            </div>

            {/* BASIC INFO */}
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Name *</label>
                <input type="text" className="form-control" name="name" value={formData.name} onChange={handleChange} required />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Email *</label>
                <input type="email" className="form-control" name="email" value={formData.email} onChange={handleChange} required disabled={!!student} />
                {student && <small className="form-text text-muted">Email cannot be changed</small>}
              </div>
            </div>
            <input className="form-control mb-2" name="name" placeholder="Full Name" value={formData.name} onChange={handleChange} required />
            <input className="form-control mb-2" name="email" type="email" placeholder="Email" value={formData.email} onChange={handleChange} required />
            <input className="form-control mb-2" name="phone" type="tel" placeholder="Phone" value={formData.phone} onChange={handleChange} />
            <input className="form-control mb-2" name="enrollment_date" type="date" placeholder="Enrollment Date" value={formData.enrollment_date} onChange={handleChange} />
            <input className="form-control mb-2" name="status" type="text" placeholder="Status" value={formData.status} onChange={handleChange} />
            <input className="form-control mb-2" name="courses_enrolled" type="text" placeholder="Courses Enrolled" value={formData.courses_enrolled} onChange={handleChange} />
            <input className="form-control mb-2" name="cohort_id" type="text" placeholder="Cohort ID" value={formData.cohort_id} onChange={handleChange} />
            <input className="form-control mb-2" name="period" type="text" placeholder="Period" value={formData.period} onChange={handleChange} />
            <input className="form-control mb-2" name="date_of_birth" type="date" placeholder="Date of Birth" value={formData.date_of_birth} onChange={handleChange} />
            <input className="form-control mb-2" name="place_of_birth" type="text" placeholder="Place of Birth" value={formData.place_of_birth} onChange={handleChange} />
            <input className="form-control mb-2" name="nationality" type="text" placeholder="Nationality" value={formData.nationality} onChange={handleChange} />
            <input className="form-control mb-2" name="gender" type="text" placeholder="Gender" value={formData.gender} onChange={handleChange} />
            <input className="form-control mb-2" name="marital_status" type="text" placeholder="Marital Status" value={formData.marital_status} onChange={handleChange} />
            <input className="form-control mb-2" name="national_id" type="text" placeholder="National ID" value={formData.national_id} onChange={handleChange} />
            <input className="form-control mb-2" name="password" type="password" placeholder="Password" value={formData.password} onChange={handleChange} />
            {/* COURSES */}
            <div className="border p-2 mb-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {courses.map((c) => (
                <div key={c.id} className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    value={parseInt(c.id)}
                    checked={formData.courses_enrolled.includes(c.id)}
                    onChange={handleChange}
                  />
                  <label className="form-check-label">
                    {c.course_code} - {c.title}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={loading || uploadingImage}>
              {loading ? 'Saving...' : student ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StudentForm;
