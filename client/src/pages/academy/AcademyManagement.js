import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import { isAcademyStaff, canApproveAcademy } from '../../utils/academyUtils';
import { getSocket } from '../../config/socket';
import StudentForm from './StudentForm';
import CourseForm from './CourseForm';
import InstructorForm from './InstructorForm';
import CohortForm from './CohortForm';

const AcademyManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Academy disabled for cvulue@prinstinegroup.org – redirect to dashboard
  useEffect(() => {
    const email = (user?.email || '').toLowerCase().trim();
    if (email === 'cvulue@prinstinegroup.org') {
      navigate('/dashboard', { replace: true });
    }
  }, [user?.email, navigate]);
  const [activeTab, setActiveTab] = useState('courses');
  const [courses, setCourses] = useState([]);
  const [students, setStudents] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showInstructorForm, setShowInstructorForm] = useState(false);
  const [showCohortForm, setShowCohortForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingCourse, setEditingCourse] = useState(null);
  const [editingInstructor, setEditingInstructor] = useState(null);
  const [editingCohort, setEditingCohort] = useState(null);

  const [gradesPending, setGradesPending] = useState([]);
  const [gradesPendingLoading, setGradesPendingLoading] = useState(false);
  const [gradeForm, setGradeForm] = useState({ student_id: '', course_id: '', proposed_grade: '' });
  const [gradeEnrolledCourses, setGradeEnrolledCourses] = useState([]);
  const [gradeSubmitting, setGradeSubmitting] = useState(false);
  const [gradeActionId, setGradeActionId] = useState(null);
  const [gradeActionMode, setGradeActionMode] = useState(null);
  const [gradeNotes, setGradeNotes] = useState('');
  
  // Filter states for students
  const [studentFilters, setStudentFilters] = useState({
    cohort_id: '',
    period: '',
    start_date: '',
    end_date: '',
    status: '',
    search: ''
  });
  
  // Check if user is Academy staff (can add/edit/view)
  const userIsAcademyStaff = isAcademyStaff(user);
  // Check if user can approve (Admin only)
  const userCanApprove = canApproveAcademy(user);

  // Refetch data when user object changes (in case department/position are loaded later)
  useEffect(() => {
    if (user && (userIsAcademyStaff || user.role === 'Admin' || user.role === 'Instructor')) {
      if (activeTab === 'courses') fetchCourses();
      else if (activeTab === 'students') fetchStudents();
      else if (activeTab === 'instructors') fetchInstructors();
      else if (activeTab === 'cohorts') fetchCohorts();
      else if (activeTab === 'grades') {
        fetchCourses();
        fetchStudents();
        if (userCanApprove) fetchGradesPending();
      }
    }
  }, [user?.department, user?.position, user?.email]);

  useEffect(() => {
    if (activeTab === 'courses') {
      fetchCourses();
    } else if (activeTab === 'students') {
      fetchStudents();
    } else if (activeTab === 'instructors') {
      fetchInstructors();
    } else if (activeTab === 'cohorts') {
      fetchCohorts();
    } else if (activeTab === 'grades') {
      fetchCourses();
      fetchStudents();
      if (userCanApprove) fetchGradesPending();
    }
  }, [activeTab]);
  
  // Fetch students when filters change
  useEffect(() => {
    if (activeTab === 'students') {
      fetchStudents();
    }
  }, [studentFilters]);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const response = await api.get('/academy/courses');
      setCourses(response.data.courses || []);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (studentFilters.cohort_id) params.append('cohort_id', studentFilters.cohort_id);
      if (studentFilters.period) params.append('period', studentFilters.period);
      if (studentFilters.start_date) params.append('start_date', studentFilters.start_date);
      if (studentFilters.end_date) params.append('end_date', studentFilters.end_date);
      if (studentFilters.status) params.append('status', studentFilters.status);
      if (studentFilters.search) params.append('search', studentFilters.search);
      
      const response = await api.get(`/academy/students?${params.toString()}`);
      setStudents(response.data.students);
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchCohorts = async () => {
    try {
      setLoading(true);
      const response = await api.get('/academy/cohorts');
      setCohorts(response.data.cohorts || []);
    } catch (error) {
      console.error('Error fetching cohorts:', error);
      setCohorts([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchInstructors = async () => {
    try {
      setLoading(true);
      const response = await api.get('/academy/instructors');
      console.log('Instructors fetched:', response.data);
      setInstructors(response.data.instructors || []);
    } catch (error) {
      console.error('Error fetching instructors:', error);
      setInstructors([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchGradesPending = async () => {
    setGradesPendingLoading(true);
    try {
      const res = await api.get('/academy/grades/pending');
      setGradesPending(res.data.pending || []);
    } catch (e) {
      console.error('Fetch pending grades error:', e);
      setGradesPending([]);
    } finally {
      setGradesPendingLoading(false);
    }
  };

  const fetchGradeEnrolledCourses = async (studentId) => {
    if (!studentId) { setGradeEnrolledCourses([]); return; }
    try {
      const res = await api.get(`/academy/students/${studentId}/enrolled-courses`);
      setGradeEnrolledCourses(res.data.courses || []);
    } catch (e) {
      console.error('Fetch enrolled courses error:', e);
      setGradeEnrolledCourses([]);
    }
  };

  useEffect(() => {
    if (activeTab !== 'grades' || !userCanApprove) return;
    const socket = getSocket();
    if (!socket) return;
    const onNotification = (n) => {
      const link = n && typeof n === 'object' && n.link ? n.link : null;
      if (link && String(link).includes('academy')) fetchGradesPending();
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [activeTab, userCanApprove]);

  const handleAddStudent = () => {
    setEditingStudent(null);
    setShowStudentForm(true);
  };

  const handleEditStudent = (student) => {
    setEditingStudent(student);
    setShowStudentForm(true);
  };

  const handleDeleteStudent = async (id) => {
    if (window.confirm('Are you sure you want to delete this student?')) {
      try {
        await api.delete(`/academy/students/${id}`);
        fetchStudents();
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting student');
      }
    }
  };

  const handleAddCourse = () => {
    setEditingCourse(null);
    setShowCourseForm(true);
  };

  const handleAddInstructor = () => {
    setEditingInstructor(null);
    setShowInstructorForm(true);
  };
  
  const handleAddCohort = () => {
    setEditingCohort(null);
    setShowCohortForm(true);
  };
  
  const handleEditCohort = (cohort) => {
    setEditingCohort(cohort);
    setShowCohortForm(true);
  };
  
  const handleDeleteCohort = async (id) => {
    if (window.confirm('Are you sure you want to delete this cohort?')) {
      try {
        await api.delete(`/academy/cohorts/${id}`);
        fetchCohorts();
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting cohort');
      }
    }
  };
  
  const handleFilterChange = (name, value) => {
    setStudentFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const clearFilters = () => {
    setStudentFilters({
      cohort_id: '',
      period: '',
      start_date: '',
      end_date: '',
      status: '',
      search: ''
    });
  };

  const handleGradeStudentChange = (studentId) => {
    setGradeForm((f) => ({ ...f, student_id: studentId, course_id: '', proposed_grade: f.proposed_grade }));
    fetchGradeEnrolledCourses(studentId);
  };

  const handleGradeSubmit = async (e) => {
    e.preventDefault();
    const { student_id, course_id, proposed_grade } = gradeForm;
    if (!student_id || !course_id || !proposed_grade?.trim()) return;
    setGradeSubmitting(true);
    try {
      await api.post('/academy/grades/submit', { student_id: parseInt(student_id, 10), course_id: parseInt(course_id, 10), proposed_grade: proposed_grade.trim() });
      setGradeForm({ student_id: '', course_id: '', proposed_grade: '' });
      setGradeEnrolledCourses([]);
      alert('Grade submitted for approval.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit grade');
    } finally {
      setGradeSubmitting(false);
    }
  };

  const handleGradeApprove = async (id) => {
    try {
      await api.put(`/academy/grades/${id}/approve`, { notes: gradeNotes || undefined });
      setGradeActionId(null);
      setGradeActionMode(null);
      setGradeNotes('');
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
  };

  const handleGradeReject = async (id) => {
    try {
      await api.put(`/academy/grades/${id}/reject`, { notes: gradeNotes || undefined });
      setGradeActionId(null);
      setGradeActionMode(null);
      setGradeNotes('');
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
  };

  const handleEditInstructor = async (instructor) => {
    try {
      const response = await api.get(`/academy/instructors/${instructor.id}`);
      setEditingInstructor(response.data.instructor);
      setShowInstructorForm(true);
    } catch (error) {
      console.error('Error fetching instructor details:', error);
      setEditingInstructor(instructor);
      setShowInstructorForm(true);
    }
  };

  const handleDeleteInstructor = async (id) => {
    if (window.confirm('Are you sure you want to delete this instructor?')) {
      try {
        await api.delete(`/academy/instructors/${id}`);
        fetchInstructors();
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting instructor');
      }
    }
  };

  const handleEditCourse = async (course) => {
    try {
      const response = await api.get(`/academy/courses/${course.id}`);
      setEditingCourse(response.data.course);
      setShowCourseForm(true);
    } catch (error) {
      console.error('Error fetching course details:', error);
      setEditingCourse(course);
      setShowCourseForm(true);
    }
  };

  const handleDeleteCourse = async (id) => {
    if (window.confirm('Are you sure you want to delete this course?')) {
      try {
        await api.delete(`/academy/courses/${id}`);
        fetchCourses();
      } catch (error) {
        alert(error.response?.data?.error || 'Error deleting course');
      }
    }
  };

  const handleApproveCourseFee = async (courseId, approved) => {
    try {
      await api.put(`/academy/courses/${courseId}/approve-fee`, { approved });
      fetchCourses();
      alert(`Course fee ${approved ? 'approved' : 'rejected'} successfully`);
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to process approval');
    }
  };

  const handleApproveInstructor = async (instructorId, approved) => {
    try {
      await api.put(`/academy/instructors/${instructorId}/approve`, { approved });
      fetchInstructors();
      alert(`Instructor ${approved ? 'approved' : 'rejected'} successfully`);
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to process approval');
    }
  };

  const handleApproveStudent = async (studentId, approved) => {
    try {
      await api.put(`/academy/students/${studentId}/approve`, { approved });
      fetchStudents();
      alert(`Student ${approved ? 'approved' : 'rejected'} successfully`);
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to process approval');
    }
  };

  // Academy disabled for cvulue@prinstinegroup.org – don't render or run fetches
  const email = (user?.email || '').toLowerCase().trim();
  if (email === 'cvulue@prinstinegroup.org') {
    return null;
  }

  // Don't block rendering - show content with individual loading states per tab
  return (
    <div className="container-fluid">
      <div className="row mb-4">
        <div className="col-12 d-flex justify-content-between align-items-center">
          <h1 className="h3 mb-0">Academy Management</h1>
          {(user?.role === 'Admin' || userIsAcademyStaff) && (
            <div>
              {activeTab === 'courses' && (
                <button className="btn btn-primary me-2" onClick={handleAddCourse}>
                  <i className="bi bi-plus-circle me-2"></i>Add Course
                </button>
              )}
              {activeTab === 'students' && (
                <button className="btn btn-primary me-2" onClick={handleAddStudent}>
                  <i className="bi bi-plus-circle me-2"></i>Add Student
                </button>
              )}
              {activeTab === 'instructors' && (
                <button className="btn btn-primary me-2" onClick={handleAddInstructor}>
                  <i className="bi bi-plus-circle me-2"></i>Add Instructor
                </button>
              )}
              {activeTab === 'cohorts' && (
                <button className="btn btn-primary" onClick={handleAddCohort}>
                  <i className="bi bi-plus-circle me-2"></i>Add Cohort
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ul className="nav nav-tabs mb-4">
        {(user?.role === 'Admin' || userIsAcademyStaff || user?.role === 'Instructor' || user?.role === 'Student') && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'courses' ? 'active' : ''}`}
              onClick={() => setActiveTab('courses')}
            >
              Courses
            </button>
          </li>
        )}
        {(user?.role === 'Admin' || userIsAcademyStaff) && (
          <>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'students' ? 'active' : ''}`}
                onClick={() => setActiveTab('students')}
              >
                Students
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'instructors' ? 'active' : ''}`}
                onClick={() => setActiveTab('instructors')}
              >
                Instructors
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'cohorts' ? 'active' : ''}`}
                onClick={() => setActiveTab('cohorts')}
              >
                Cohorts
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'grades' ? 'active' : ''}`}
                onClick={() => setActiveTab('grades')}
              >
                Grades {userCanApprove && gradesPending.length > 0 && <span className="badge bg-warning text-dark">{gradesPending.length}</span>}
              </button>
            </li>
          </>
        )}
        {user?.role === 'Instructor' && !userIsAcademyStaff && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'grades' ? 'active' : ''}`}
              onClick={() => setActiveTab('grades')}
            >
              Grades
            </button>
          </li>
        )}
      </ul>

      {activeTab === 'courses' && (
        <div className="card">
          <div className="card-body">
            {loading ? (
              <div className="text-center">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : courses.length === 0 ? (
              <div className="text-center text-muted">
                {(user?.role === 'Admin' || userIsAcademyStaff) ? 'No courses found. Click "Add Course" to create one.' : 'No courses found.'}
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Course Code</th>
                      <th>Title</th>
                      <th>Fee</th>
                      <th>Fee Approval</th>
                      <th>Mode</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course) => (
                      <tr key={course.id}>
                        <td><strong>{course.course_code}</strong></td>
                        <td>{course.title}</td>
                        <td>${parseFloat(course.course_fee || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>
                          {course.fee_approved === 1 ? (
                            <span className="badge bg-success">Approved</span>
                          ) : course.fee_approved === 2 ? (
                            <span className="badge bg-danger">Rejected</span>
                          ) : (
                            <span className="badge bg-warning">Pending</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge bg-${
                            course.mode === 'Online' ? 'primary' :
                            course.mode === 'In-person' ? 'success' : 'warning'
                          }`}>
                            {course.mode}
                          </span>
                        </td>
                        <td>
                          <span className={`badge bg-${
                            course.status === 'Active' ? 'success' : 'secondary'
                          }`}>
                            {course.status}
                          </span>
                        </td>
                        <td>
                          <Link to={`/academy/courses/view/${course.id}`} className="btn btn-sm btn-outline-info me-2">
                            <i className="bi bi-eye me-1"></i>View
                          </Link>
                          {userIsAcademyStaff && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditCourse(course)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {userCanApprove && course.fee_approved === 0 && (
                                <>
                                  <button 
                                    className="btn btn-sm btn-outline-success me-2" 
                                    onClick={() => handleApproveCourseFee(course.id, true)}
                                  >
                                    <i className="bi bi-check-circle me-1"></i>Approve Fee
                                  </button>
                                  <button 
                                    className="btn btn-sm btn-outline-danger me-2" 
                                    onClick={() => handleApproveCourseFee(course.id, false)}
                                  >
                                    <i className="bi bi-x-circle me-1"></i>Reject Fee
                                  </button>
                                </>
                              )}
                              <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteCourse(course.id)}>
                                <i className="bi bi-trash me-1"></i>Delete
                              </button>
                            </>
                          )}
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

      {activeTab === 'students' && (
        <div className="card">
          <div className="card-body">
            {loading ? (
              <div className="text-center">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : (
              <>
            {/* Filters */}
            <div className="row mb-3">
              <div className="col-md-2">
                <label className="form-label">Cohort</label>
                <select
                  className="form-select form-select-sm"
                  value={studentFilters.cohort_id}
                  onChange={(e) => handleFilterChange('cohort_id', e.target.value)}
                >
                  <option value="">All Cohorts</option>
                  {cohorts.filter(c => c.status === 'Active').map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Period</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="e.g., Q1 2024"
                  value={studentFilters.period}
                  onChange={(e) => handleFilterChange('period', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Start Date</label>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={studentFilters.start_date}
                  onChange={(e) => handleFilterChange('start_date', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">End Date</label>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={studentFilters.end_date}
                  onChange={(e) => handleFilterChange('end_date', e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select
                  className="form-select form-select-sm"
                  value={studentFilters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                >
                  <option value="">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Graduated">Graduated</option>
                  <option value="Suspended">Suspended</option>
                  <option value="Dropped">Dropped</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Name, email, ID"
                  value={studentFilters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                />
              </div>
            </div>
            <div className="mb-3">
              <button className="btn btn-sm btn-outline-secondary" onClick={clearFilters}>
                <i className="bi bi-x-circle me-1"></i>Clear Filters
              </button>
            </div>
            
            <div className="table-responsive">
              <table className="table table-hover">
                  <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Cohort</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Approval Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center text-muted">
                        No students found. Click "Add Student" to create one.
                      </td>
                    </tr>
                  ) : (
                    students.map((student) => (
                      <tr key={student.id}>
                        <td>{student.student_id}</td>
                        <td>{student.name}</td>
                        <td>{student.email}</td>
                        <td>{student.cohort_name || <span className="text-muted">-</span>}</td>
                        <td>{student.period || <span className="text-muted">-</span>}</td>
                        <td>
                          <span className={`badge bg-${
                            student.status === 'Active' ? 'success' : 'secondary'
                          }`}>
                            {student.status}
                          </span>
                        </td>
                        <td>
                          {student.approved === 1 ? (
                            <span className="badge bg-success">Approved</span>
                          ) : student.approved === 2 ? (
                            <span className="badge bg-danger">Rejected</span>
                          ) : (
                            <span className="badge bg-warning">Pending</span>
                          )}
                        </td>
                        <td>
                          <Link to={`/academy/students/view/${student.id}`} className="btn btn-sm btn-outline-info me-2">
                            <i className="bi bi-eye me-1"></i>View
                          </Link>
                          {userIsAcademyStaff && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditStudent(student)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {userCanApprove && student.approved === 0 && (
                                <>
                                  <button 
                                    className="btn btn-sm btn-outline-success me-2" 
                                    onClick={() => handleApproveStudent(student.id, true)}
                                  >
                                    <i className="bi bi-check-circle me-1"></i>Approve
                                  </button>
                                  <button 
                                    className="btn btn-sm btn-outline-danger me-2" 
                                    onClick={() => handleApproveStudent(student.id, false)}
                                  >
                                    <i className="bi bi-x-circle me-1"></i>Reject
                                  </button>
                                </>
                              )}
                              <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteStudent(student.id)}>
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
              </>
            )}
          </div>
        </div>
      )}

      {showStudentForm && (
        <StudentForm
          student={editingStudent}
          onClose={() => {
            setShowStudentForm(false);
            setEditingStudent(null);
            fetchStudents();
          }}
        />
      )}

      {activeTab === 'instructors' && (
        <div className="card">
          <div className="card-body">
            {loading ? (
              <div className="text-center">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : instructors.length === 0 ? (
              <div className="text-center text-muted">No instructors found. Click "Add Instructor" to create one.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Instructor ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Specialization</th>
                      <th>Courses Assigned</th>
                      <th>Approval Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instructors.map((instructor) => (
                      <tr key={instructor.id}>
                        <td><strong>{instructor.instructor_id}</strong></td>
                        <td>{instructor.name}</td>
                        <td>{instructor.email}</td>
                        <td>{instructor.specialization || 'N/A'}</td>
                        <td>
                          {instructor.courses_assigned ? (
                            JSON.parse(instructor.courses_assigned).length
                          ) : 0} course(s)
                        </td>
                        <td>
                          {instructor.approved === 1 ? (
                            <span className="badge bg-success">Approved</span>
                          ) : instructor.approved === 2 ? (
                            <span className="badge bg-danger">Rejected</span>
                          ) : (
                            <span className="badge bg-warning">Pending</span>
                          )}
                        </td>
                        <td>
                          <Link to={`/academy/instructors/view/${instructor.id}`} className="btn btn-sm btn-outline-info me-2">
                            <i className="bi bi-eye me-1"></i>View
                          </Link>
                          {userIsAcademyStaff && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditInstructor(instructor)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {userCanApprove && instructor.approved === 0 && (
                                <>
                                  <button 
                                    className="btn btn-sm btn-outline-success me-2" 
                                    onClick={() => handleApproveInstructor(instructor.id, true)}
                                  >
                                    <i className="bi bi-check-circle me-1"></i>Approve
                                  </button>
                                  <button 
                                    className="btn btn-sm btn-outline-danger me-2" 
                                    onClick={() => handleApproveInstructor(instructor.id, false)}
                                  >
                                    <i className="bi bi-x-circle me-1"></i>Reject
                                  </button>
                                </>
                              )}
                              <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteInstructor(instructor.id)}>
                                <i className="bi bi-trash me-1"></i>Delete
                              </button>
                            </>
                          )}
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

      {showStudentForm && (
        <StudentForm
          student={editingStudent}
          onClose={() => {
            setShowStudentForm(false);
            setEditingStudent(null);
            fetchStudents();
          }}
        />
      )}

      {showCourseForm && (
        <CourseForm
          course={editingCourse}
          onClose={() => {
            setShowCourseForm(false);
            setEditingCourse(null);
            fetchCourses();
          }}
        />
      )}

      {showInstructorForm && (
        <InstructorForm
          instructor={editingInstructor}
          courses={courses}
          onClose={() => {
            setShowInstructorForm(false);
            setEditingInstructor(null);
            fetchInstructors();
          }}
        />
      )}

      {activeTab === 'cohorts' && (
        <div className="card">
          <div className="card-body">
            {loading ? (
              <div className="text-center">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : cohorts.length === 0 ? (
              <div className="text-center text-muted">No cohorts found. Click "Add Cohort" to create one.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Period</th>
                      <th>Start Date</th>
                      <th>End Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((cohort) => (
                      <tr key={cohort.id}>
                        <td><strong>{cohort.code}</strong></td>
                        <td>{cohort.name}</td>
                        <td>{cohort.period || <span className="text-muted">-</span>}</td>
                        <td>{cohort.start_date ? new Date(cohort.start_date).toLocaleDateString() : <span className="text-muted">-</span>}</td>
                        <td>{cohort.end_date ? new Date(cohort.end_date).toLocaleDateString() : <span className="text-muted">-</span>}</td>
                        <td>
                          <span className={`badge bg-${
                            cohort.status === 'Active' ? 'success' :
                            cohort.status === 'Completed' ? 'info' : 'secondary'
                          }`}>
                            {cohort.status}
                          </span>
                        </td>
                        <td>
                          {userIsAcademyStaff && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditCohort(cohort)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteCohort(cohort.id)}>
                                <i className="bi bi-trash me-1"></i>Delete
                              </button>
                            </>
                          )}
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

      {activeTab === 'grades' && (
        <div className="row">
          {(userIsAcademyStaff || user?.role === 'Instructor') && (
            <div className="col-lg-5 mb-4">
              <div className="card">
                <div className="card-header fw-bold">Submit grade</div>
                <div className="card-body">
                  <form onSubmit={handleGradeSubmit}>
                    <div className="mb-3">
                      <label className="form-label">Student</label>
                      <select
                        className="form-select"
                        value={gradeForm.student_id}
                        onChange={(e) => handleGradeStudentChange(e.target.value)}
                        required
                      >
                        <option value="">Select student</option>
                        {students.filter(s => s.approved === 1 || s.approved === true).map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.student_id})</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Course</label>
                      <select
                        className="form-select"
                        value={gradeForm.course_id}
                        onChange={(e) => setGradeForm((f) => ({ ...f, course_id: e.target.value }))}
                        required
                        disabled={!gradeForm.student_id}
                      >
                        <option value="">Select course</option>
                        {gradeEnrolledCourses.map((c) => (
                          <option key={c.course_id} value={c.course_id}>{c.course_code} – {c.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Proposed grade</label>
                      <input
                        type="text"
                        className="form-control"
                        value={gradeForm.proposed_grade}
                        onChange={(e) => setGradeForm((f) => ({ ...f, proposed_grade: e.target.value }))}
                        placeholder="e.g. A, B+, 85"
                        required
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={gradeSubmitting}>
                      {gradeSubmitting ? 'Submitting…' : 'Submit for approval'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
          {userCanApprove && (
            <div className={userIsAcademyStaff || user?.role === 'Instructor' ? 'col-lg-7' : 'col-12'}>
              <div className="card">
                <div className="card-header fw-bold">Pending approval</div>
                <div className="card-body p-0">
                  {gradesPendingLoading ? (
                    <div className="text-center py-4"><div className="spinner-border text-primary" /></div>
                  ) : gradesPending.length === 0 ? (
                    <div className="p-4 text-center text-muted">No pending grade submissions.</div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover mb-0">
                        <thead>
                          <tr>
                            <th>Student</th>
                            <th>Course</th>
                            <th>Grade</th>
                            <th>Submitted by</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gradesPending.map((g) => (
                            <tr key={g.id}>
                              <td><strong>{g.student_name}</strong><br /><small className="text-muted">{g.student_email}</small></td>
                              <td>{g.course_title} ({g.course_code})</td>
                              <td><strong>{g.proposed_grade}</strong></td>
                              <td>{g.submitted_by_name || '—'}</td>
                              <td>
                                <button type="button" className="btn btn-sm btn-success me-1" onClick={() => { setGradeActionId(g.id); setGradeActionMode('approve'); setGradeNotes(''); }}>Approve</button>
                                <button type="button" className="btn btn-sm btn-danger" onClick={() => { setGradeActionId(g.id); setGradeActionMode('reject'); setGradeNotes(''); }}>Reject</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
              {gradeActionId && gradeActionMode && (
                <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
                  <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                      <div className="modal-header">
                        <h5 className="modal-title">{gradeActionMode === 'approve' ? 'Approve' : 'Reject'} grade</h5>
                        <button type="button" className="btn-close" onClick={() => { setGradeActionId(null); setGradeActionMode(null); setGradeNotes(''); }} aria-label="Close" />
                      </div>
                      <div className="modal-body">
                        <label className="form-label">Notes (optional)</label>
                        <textarea className="form-control" rows={3} value={gradeNotes} onChange={(e) => setGradeNotes(e.target.value)} placeholder={gradeActionMode === 'reject' ? 'Reason for rejection…' : ''} />
                      </div>
                      <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => { setGradeActionId(null); setGradeActionMode(null); setGradeNotes(''); }}>Cancel</button>
                        {gradeActionMode === 'approve' ? (
                          <button type="button" className="btn btn-success" onClick={() => handleGradeApprove(gradeActionId)}>Approve</button>
                        ) : (
                          <button type="button" className="btn btn-danger" onClick={() => handleGradeReject(gradeActionId)}>Reject</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCohortForm && (
        <CohortForm
          cohort={editingCohort}
          onClose={() => {
            setShowCohortForm(false);
            setEditingCohort(null);
            fetchCohorts();
          }}
        />
      )}
    </div>
  );
};

export default AcademyManagement;

