import React, { useState, useEffect } from 'react';
import api from '../../config/api';

const CertificateForm = ({ certificate, onClose }) => {
  const [formData, setFormData] = useState({
    student_id: '',
    course_id: '',
    grade: '',
    issue_date: '',
    completion_date: ''
  });
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredStudents, setFilteredStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStudents();
    fetchCourses();
    if (certificate) {
      setFormData({
        student_id: certificate.student_id || '',
        course_id: certificate.course_id || '',
        grade: certificate.grade || '',
        issue_date: certificate.issue_date || '',
        completion_date: certificate.completion_date || ''
      });
      setSelectedStudent({
        id: certificate.student_id,
        name: certificate.student_name,
        student_id: certificate.student_code
      });
      setSearchQuery(certificate.student_name || '');
    }
  }, [certificate]);

  useEffect(() => {
    if (searchQuery) {
      const filtered = students.filter(student =>
        student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.student_id.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredStudents(filtered);
    } else {
      setFilteredStudents([]);
    }
  }, [searchQuery, students]);

  const fetchStudents = async () => {
    try {
      const response = await api.get('/academy/students');
      const studentsData = response.data.students || [];
      // Map students to include id, name, and student_id
      const mappedStudents = studentsData.map(student => ({
        id: student.id,
        name: student.name,
        student_id: student.student_id
      }));
      setStudents(mappedStudents);
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const fetchCourses = async () => {
    try {
      const response = await api.get('/academy/courses');
      setCourses(response.data.courses || []);
    } catch (error) {
      console.error('Error fetching courses:', error);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const fileType = selectedFile.type;
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
      
      if (!allowedTypes.includes(fileType)) {
        setError('Invalid file type. Only PNG, JPEG, and PDF files are allowed.');
        return;
      }
      
      setFile(selectedFile);
      setError('');
    }
  };

  const handleStudentSelect = (student) => {
    setSelectedStudent(student);
    setFormData({ ...formData, student_id: student.id });
    setSearchQuery(student.name);
    setFilteredStudents([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!certificate && !file) {
      setError('Certificate file is required');
      setLoading(false);
      return;
    }

    let resolvedStudentId = formData.student_id;
    if (!resolvedStudentId && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const exact = students.find((s) =>
        String(s.name || '').trim().toLowerCase() === q ||
        String(s.student_id || '').trim().toLowerCase() === q
      );
      if (exact) {
        resolvedStudentId = exact.id;
      }
    }

    if (!resolvedStudentId || !formData.course_id) {
      setError('Please select a student and course');
      setLoading(false);
      return;
    }

    try {
      const formDataObj = new FormData();
      formDataObj.append('student_id', resolvedStudentId);
      formDataObj.append('course_id', formData.course_id);
      if (formData.grade) formDataObj.append('grade', formData.grade);
      if (formData.issue_date) formDataObj.append('issue_date', formData.issue_date);
      if (formData.completion_date) formDataObj.append('completion_date', formData.completion_date);
      if (file) formDataObj.append('certificate_file', file);

      const uploadConfig = { timeout: 120000 };

      if (certificate) {
        await api.put(`/certificates/${certificate.id}`, formDataObj, uploadConfig);
      } else {
        await api.post('/certificates', formDataObj, uploadConfig);
      }
      
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save certificate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{certificate ? 'Edit Certificate' : 'Add Certificate'}</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              {/* Student Search */}
              <div className="mb-3">
                <label className="form-label">Student *</label>
                <div className="position-relative">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search student by name or ID..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedStudent(null);
                      setFormData((prev) => ({ ...prev, student_id: '' }));
                    }}
                    required
                  />
                  {selectedStudent && (
                    <div className="mt-2 p-2 bg-light rounded">
                      <strong>{selectedStudent.name}</strong> - {selectedStudent.student_id}
                    </div>
                  )}
                  {filteredStudents.length > 0 && (
                    <div className="list-group position-absolute w-100" style={{ zIndex: 1000, maxHeight: '200px', overflowY: 'auto' }}>
                      {filteredStudents.map((student) => (
                        <button
                          key={student.id}
                          type="button"
                          className="list-group-item list-group-item-action"
                          onClick={() => handleStudentSelect(student)}
                        >
                          <strong>{student.name}</strong> - {student.student_id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Course Selection */}
              <div className="mb-3">
                <label className="form-label">Course *</label>
                <select
                  className="form-select"
                  name="course_id"
                  value={formData.course_id}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.course_code} - {course.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* File Upload */}
              <div className="mb-3">
                <label className="form-label">
                  Certificate File {!certificate && '*'}
                  <small className="text-muted ms-2">(PNG, JPEG, or PDF)</small>
                </label>
                <input
                  type="file"
                  className="form-control"
                  accept=".png,.jpeg,.jpg,.pdf"
                  onChange={handleFileChange}
                  required={!certificate}
                />
                {file && (
                  <small className="text-muted d-block mt-1">
                    Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB). Keep files under 15MB for fastest upload.
                  </small>
                )}
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label">Grade</label>
                  <input
                    type="text"
                    className="form-control"
                    name="grade"
                    value={formData.grade}
                    onChange={handleChange}
                    placeholder="e.g., A, B, Pass"
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label">Issue Date</label>
                  <input
                    type="date"
                    className="form-control"
                    name="issue_date"
                    value={formData.issue_date}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label">Completion Date</label>
                <input
                  type="date"
                  className="form-control"
                  name="completion_date"
                  value={formData.completion_date}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading || !formData.course_id || (!certificate && !file)}>
                {loading ? (file ? 'Uploading certificate…' : 'Saving…') : certificate ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CertificateForm;

