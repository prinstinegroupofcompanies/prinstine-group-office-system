import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import { normalizeUrl } from '../../utils/apiUrl';
import { STUDENT_ID_FORMAT_HINT, isValidStudentIdFormat, normalizeStudentIdInput } from '../../utils/studentIdFormat';

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
    password: '',
    student_id_mode: 'auto',
    student_id: ''
  });

  const [idPreview, setIdPreview] = useState('');
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
    if (!student) {
      api.get('/academy/students/id-format')
        .then((res) => setIdPreview(res.data?.example || ''))
        .catch(() => setIdPreview(''));
    }

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
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, GIF, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }
    setUploadingImage(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);

      const uploadUrl = student?.id
        ? `/upload/entity-image/student/${student.id}`
        : '/upload/entity-image';
      const res = await api.post(uploadUrl, fd);
      const url = (res.data?.imageUrl ?? res.data?.url ?? '').toString().trim();
      if (!url) {
        setError('Upload succeeded but no image URL was returned.');
        return;
      }
      setFormData(prev => ({ ...prev, profile_image: url }));
      e.target.value = '';
    } catch (err) {
      setError('Failed to upload image: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'courses_enrolled' && type !== 'checkbox') return;
    if (name === 'student_id_mode') {
      setFormData((prev) => ({ ...prev, student_id_mode: value }));
      return;
    }
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

    if (!student && formData.student_id_mode === 'manual') {
      const manualId = normalizeStudentIdInput(formData.student_id);
      if (!isValidStudentIdFormat(manualId)) {
        setError(`Student ID must match format ${STUDENT_ID_FORMAT_HINT}`);
        setLoading(false);
        return;
      }
    }

    try {
      const profileImageValue = (formData.profile_image != null && String(formData.profile_image).trim() !== '')
        ? String(formData.profile_image).trim()
        : null;
      const coursesEnrolled = Array.isArray(formData.courses_enrolled)
        ? formData.courses_enrolled.map((c) => parseInt(c, 10)).filter((n) => !isNaN(n))
        : [];
      const cohortId = formData.cohort_id && String(formData.cohort_id).trim() !== ''
        ? parseInt(formData.cohort_id, 10)
        : null;
      const payload = {
        name: String(formData.name || '').trim(),
        email: String(formData.email || '').trim().toLowerCase(),
        username: formData.username ? String(formData.username).trim() : undefined,
        phone: formData.phone ? String(formData.phone).trim() : undefined,
        enrollment_date: formData.enrollment_date && String(formData.enrollment_date).trim() ? formData.enrollment_date.trim().split('T')[0] : undefined,
        status: formData.status || 'Active',
        profile_image: profileImageValue,
        cohort_id: !isNaN(cohortId) ? cohortId : null,
        period: formData.period && String(formData.period).trim() ? String(formData.period).trim() : null,
        courses_enrolled: coursesEnrolled,
      };
      if (!student) {
        payload.password = formData.password && String(formData.password).trim() ? formData.password : 'Student@123';
        payload.student_id_mode = formData.student_id_mode === 'manual' ? 'manual' : 'auto';
        if (payload.student_id_mode === 'manual') {
          payload.student_id = normalizeStudentIdInput(formData.student_id);
        }
      }

      if (student) {
        await api.put(`/academy/students/${student.id}`, payload);
      } else {
        await api.post('/academy/students', payload);
      }

      onClose();
    } catch (err) {
      const data = err.response?.data;
      const message = data?.error || (data?.details ? `Error: ${data.details}` : null) || err.message || 'Failed to save student';
      setError(message);
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

            {!student && (
              <div className="mb-3 border rounded p-3 bg-light">
                <label className="form-label fw-semibold">Student ID</label>
                <div className="mb-2">
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="student_id_mode"
                      id="student_id_auto"
                      value="auto"
                      checked={formData.student_id_mode === 'auto'}
                      onChange={handleChange}
                    />
                    <label className="form-check-label" htmlFor="student_id_auto">
                      Generate automatically
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="student_id_mode"
                      id="student_id_manual"
                      value="manual"
                      checked={formData.student_id_mode === 'manual'}
                      onChange={handleChange}
                    />
                    <label className="form-check-label" htmlFor="student_id_manual">
                      Enter manually
                    </label>
                  </div>
                </div>
                {formData.student_id_mode === 'auto' ? (
                  <p className="small text-muted mb-0">
                    The system will assign an ID in format <code>{STUDENT_ID_FORMAT_HINT}</code>
                    {idPreview ? (
                      <>
                        {' '}
                        (example: <code>{idPreview}</code>)
                      </>
                    ) : null}
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="form-control font-monospace"
                      name="student_id"
                      value={formData.student_id}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          student_id: normalizeStudentIdInput(e.target.value)
                        }))
                      }
                      placeholder="STU-12345678-AB12"
                      required
                    />
                    <small className="text-muted">Format: {STUDENT_ID_FORMAT_HINT}</small>
                  </>
                )}
              </div>
            )}

            {student?.student_id && (
              <div className="mb-3">
                <label className="form-label">Student ID</label>
                <input type="text" className="form-control font-monospace" value={student.student_id} disabled readOnly />
              </div>
            )}

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
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Phone</label>
                <input type="tel" className="form-control" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Enrollment Date</label>
                <input type="date" className="form-control" name="enrollment_date" value={formData.enrollment_date} onChange={handleChange} />
              </div>
            </div>
            <div className="row">
              <div className="col-md-4 mb-3">
                <label className="form-label">Status</label>
                <input type="text" className="form-control" name="status" value={formData.status} onChange={handleChange} />
              </div>
              <div className="col-md-4 mb-3">
                <label className="form-label">Cohort</label>
                <select className="form-select" name="cohort_id" value={formData.cohort_id || ''} onChange={handleChange}>
                  <option value="">None</option>
                  {cohorts.map(c => <option key={c.id} value={c.id}>{c.name || c.code}</option>)}
                </select>
              </div>
              <div className="col-md-4 mb-3">
                <label className="form-label">Period</label>
                <input type="text" className="form-control" name="period" value={formData.period} onChange={handleChange} />
              </div>
            </div>
            {!student && (
              <div className="mb-3">
                <label className="form-label">Password</label>
                <input type="password" className="form-control" name="password" value={formData.password} onChange={handleChange} placeholder="Leave blank for default" />
              </div>
            )}
            {/* COURSES */}
            <div className="border p-2 mb-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {courses.map((c) => (
                <div key={c.id} className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    value={parseInt(c.id)}
                    checked={formData.courses_enrolled.some((id) => parseInt(id, 10) === parseInt(c.id, 10))}
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
