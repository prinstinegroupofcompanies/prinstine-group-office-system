import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import {
  isAcademyStaff,
  hasAnyAcademyPermission,
  canViewAcademyTab,
  canManageAcademySection,
  canManageAcademyPermissions,
  canApproveStudents,
  canApproveInstructors,
  canApproveCourseFees,
  canEndorseGrades,
  canFinalApproveGrades
} from '../../utils/academyPermissions';
import AcademyStaffPermissions from './AcademyStaffPermissions';
import AcademyBulkBar from '../../components/academy/AcademyBulkBar';
import GradeTemplateForm from '../../components/academy/GradeTemplateForm';
import {
  EMPTY_GRADE_SCORES,
  buildGradeSubmitPayload,
  validateScoresForSubmit,
  scoresFromGradeRow
} from '../../utils/gradeTemplate';
import { getSocket } from '../../config/socket';
import {
  exportCoursesExcel,
  exportCoursesPdf,
  exportStudentsExcel,
  exportStudentsPdf,
  exportInstructorsExcel,
  exportInstructorsPdf
} from '../../utils/academyListExports';
import StudentForm from './StudentForm';
import CourseForm from './CourseForm';
import InstructorForm from './InstructorForm';
import CohortForm from './CohortForm';
import StudentAcademyGradesTab from './StudentAcademyGradesTab';
import CertificateManagement from '../certificates/CertificateManagement';

const AcademyManagement = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('courses');
  const [courses, setCourses] = useState([]);
  const [students, setStudents] = useState([]);
  /** Full student list for grade dropdowns & Student Grade tab (not affected by Students tab filters) */
  const [studentsForSelect, setStudentsForSelect] = useState([]);
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
  const [gradeForm, setGradeForm] = useState({ student_id: '', course_id: '', scores: { ...EMPTY_GRADE_SCORES } });
  const [gradeEnrolledCourses, setGradeEnrolledCourses] = useState([]);
  const [gradeSubmitting, setGradeSubmitting] = useState(false);
  const [gradeActionId, setGradeActionId] = useState(null);
  const [gradeActionMode, setGradeActionMode] = useState(null);
  const [gradeNotes, setGradeNotes] = useState('');
  const [pendingEditRow, setPendingEditRow] = useState(null);
  const [pendingEditForm, setPendingEditForm] = useState({ student_id: '', course_id: '', scores: { ...EMPTY_GRADE_SCORES } });
  const [pendingEditCourses, setPendingEditCourses] = useState([]);
  const [pendingEditSaving, setPendingEditSaving] = useState(false);
  
  // Filter states for students
  const [studentFilters, setStudentFilters] = useState({
    cohort_id: '',
    course_id: '',
    period: '',
    start_date: '',
    end_date: '',
    status: '',
    search: ''
  });
  /** Client-side sort for student table (API returns alphabetical by name by default) */
  const [studentSort, setStudentSort] = useState('name_asc');
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [selectedInstructorIds, setSelectedInstructorIds] = useState([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [selectedGradeIds, setSelectedGradeIds] = useState([]);

  const userIsAcademyStaff = isAcademyStaff(user);
  const canAccessAcademyMgmt =
    user && (user.role === 'Admin' || user.role === 'Instructor' || hasAnyAcademyPermission(user));
  const canSeeGradeQueue = user && canViewAcademyTab(user, 'grades');
  const canExportLists = user && (user.role === 'Admin' || userIsAcademyStaff);
  const canManagePerms = user && canManageAcademyPermissions(user);
  const canFinalApprove = user && canFinalApproveGrades(user);
  const canEndorse = user && canEndorseGrades(user);
  const canApproveStudentRecords = user && canApproveStudents(user);
  const canApproveInstructorRecords = user && canApproveInstructors(user);
  const canApproveFees = user && canApproveCourseFees(user);
  const canManageGrades = user && canManageAcademySection(user, 'grades');

  const displayStudents = useMemo(() => {
    const list = [...(students || [])];
    const cmpName = (a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    const cmpId = (a, b) =>
      String(a.student_id || '').localeCompare(String(b.student_id || ''), undefined, { numeric: true });
    const cmpCohort = (a, b) =>
      String(a.cohort_name || '').localeCompare(String(b.cohort_name || ''), undefined, { sensitivity: 'base' });
    switch (studentSort) {
      case 'name_desc':
        list.sort((a, b) => -cmpName(a, b));
        break;
      case 'id':
        list.sort(cmpId);
        break;
      case 'cohort':
        list.sort((a, b) => cmpCohort(a, b) || cmpName(a, b));
        break;
      default:
        list.sort(cmpName);
    }
    return list;
  }, [students, studentSort]);

  const fetchCourses = useCallback(async () => {
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
  }, []);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (studentFilters.cohort_id) params.append('cohort_id', studentFilters.cohort_id);
      if (studentFilters.course_id) params.append('course_id', studentFilters.course_id);
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
  }, [studentFilters]);

  const fetchStudentsRef = useRef(fetchStudents);
  fetchStudentsRef.current = fetchStudents;

  const fetchStudentsUnfiltered = useCallback(async () => {
    try {
      const response = await api.get('/academy/students');
      setStudentsForSelect(response.data.students || []);
    } catch (error) {
      console.error('Error fetching students for selects:', error);
      setStudentsForSelect([]);
    }
  }, []);

  const fetchCohorts = useCallback(async () => {
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
  }, []);

  const fetchInstructors = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/academy/instructors');
      setInstructors(response.data.instructors || []);
    } catch (error) {
      console.error('Error fetching instructors:', error);
      setInstructors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGradesPending = useCallback(async () => {
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
  }, []);

  // Load tab data when user becomes available or tab changes (fixes Admin not loading lists on first paint)
  useEffect(() => {
    if (!canAccessAcademyMgmt) return;
    if (activeTab === 'courses') fetchCourses();
    else if (activeTab === 'students') {
      fetchCohorts();
      fetchCourses();
    } else if (activeTab === 'instructors') fetchInstructors();
    else if (activeTab === 'cohorts') fetchCohorts();
    else if (activeTab === 'grades') {
      fetchCourses();
      fetchStudentsRef.current();
      fetchCohorts();
      fetchStudentsUnfiltered();
      if (canSeeGradeQueue) fetchGradesPending();
    } else if (activeTab === 'student-grades') {
      fetchCourses();
      fetchCohorts();
      fetchStudentsUnfiltered();
    } else if (activeTab === 'certificates') {
      fetchCohorts();
    }
  }, [
    activeTab,
    user?.id,
    user?.role,
    user?.department,
    user?.position,
    user?.email,
    canAccessAcademyMgmt,
    canSeeGradeQueue,
    fetchCourses,
    fetchCohorts,
    fetchInstructors,
    fetchStudentsUnfiltered,
    fetchGradesPending
  ]);

  // Students tab: load / refetch when tab is active and filters change (fetchStudents identity tracks studentFilters)
  useEffect(() => {
    if (activeTab !== 'students') return;
    fetchStudents();
  }, [activeTab, fetchStudents]);

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
    if (activeTab !== 'grades' || !canSeeGradeQueue) return;
    const socket = getSocket();
    if (!socket) return;
    const onNotification = (n) => {
      const link = n && typeof n === 'object' && n.link ? n.link : null;
      if (link && String(link).includes('academy')) fetchGradesPending();
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [activeTab, canSeeGradeQueue, fetchGradesPending]);

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
      course_id: '',
      period: '',
      start_date: '',
      end_date: '',
      status: '',
      search: ''
    });
    setStudentSort('name_asc');
  };

  const handleGradeStudentChange = (studentId) => {
    setGradeForm((f) => ({ ...f, student_id: studentId, course_id: '', scores: { ...EMPTY_GRADE_SCORES } }));
    fetchGradeEnrolledCourses(studentId);
  };

  const handleGradeSubmit = async (e) => {
    e.preventDefault();
    const { student_id, course_id, scores } = gradeForm;
    if (!student_id || !course_id) return;
    const validationErrors = validateScoresForSubmit(scores);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      return;
    }
    setGradeSubmitting(true);
    try {
      await api.post('/academy/grades/submit', buildGradeSubmitPayload(student_id, course_id, scores));
      setGradeForm({ student_id: '', course_id: '', scores: { ...EMPTY_GRADE_SCORES } });
      setGradeEnrolledCourses([]);
      alert('Grade submitted for coordinator review.');
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit grade');
    } finally {
      setGradeSubmitting(false);
    }
  };

  const handleGradeEndorse = async (id) => {
    try {
      await api.put(`/academy/grades/${id}/endorse`, { notes: gradeNotes || undefined });
      setGradeActionId(null);
      setGradeActionMode(null);
      setGradeNotes('');
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to endorse');
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

  const openPendingGradeEdit = (g) => {
    setPendingEditRow(g);
    setPendingEditForm({
      student_id: String(g.student_id),
      course_id: String(g.course_id),
      scores: scoresFromGradeRow(g)
    });
    api.get(`/academy/students/${g.student_id}/enrolled-courses`)
      .then((r) => setPendingEditCourses(r.data.courses || []))
      .catch(() => setPendingEditCourses([]));
  };

  const handlePendingEditStudentChange = (sid) => {
    setPendingEditForm((f) => ({ ...f, student_id: sid, course_id: '' }));
    if (!sid) {
      setPendingEditCourses([]);
      return;
    }
    api.get(`/academy/students/${sid}/enrolled-courses`)
      .then((r) => setPendingEditCourses(r.data.courses || []))
      .catch(() => setPendingEditCourses([]));
  };

  const savePendingGradeEdit = async () => {
    if (!pendingEditRow) return;
    const { student_id, course_id, scores } = pendingEditForm;
    if (!student_id || !course_id) {
      alert('Student and course are required');
      return;
    }
    const validationErrors = validateScoresForSubmit(scores);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      return;
    }
    setPendingEditSaving(true);
    try {
      await api.put(`/academy/grades/${pendingEditRow.id}`, {
        ...buildGradeSubmitPayload(student_id, course_id, scores)
      });
      setPendingEditRow(null);
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to update');
    } finally {
      setPendingEditSaving(false);
    }
  };

  const deletePendingGrade = async (g) => {
    if (!window.confirm('Delete this pending grade submission? This cannot be undone.')) return;
    try {
      await api.delete(`/academy/grades/${g.id}`);
      fetchGradesPending();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
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

  const toggleIdInList = (id, list, setList) => {
    const n = parseInt(id, 10);
    setList((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  };

  const runBulkApproval = async (path, ids, approved, onDone) => {
    if (!ids.length) return;
    try {
      const res = await api.post(`/academy/bulk/${path}`, { ids, approved });
      const { succeeded, failed, message } = res.data || {};
      const failMsg = failed?.length ? `\n${failed.length} failed.` : '';
      alert(`${message || 'Done'}${failMsg}`);
      if (onDone) onDone();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk action failed');
    }
  };

  const pendingStudentsForBulk = useMemo(
    () => displayStudents.filter((s) => s.approved === 0 || s.approved === false),
    [displayStudents]
  );
  const pendingInstructorsForBulk = useMemo(
    () => (instructors || []).filter((i) => i.approved === 0 || i.approved === false),
    [instructors]
  );
  const pendingCoursesForBulk = useMemo(
    () => (courses || []).filter((c) => c.fee_approved === 0 || c.fee_approved === null || c.fee_approved === undefined),
    [courses]
  );

  useEffect(() => {
    if (!user || !canAccessAcademyMgmt) return;
    const tabs = ['courses', 'students', 'instructors', 'cohorts', 'grades', 'student-grades', 'certificates', 'permissions'];
    if (canViewAcademyTab(user, activeTab) || (activeTab === 'permissions' && canManagePerms)) return;
    const first = tabs.find((t) => (t === 'permissions' ? canManagePerms : canViewAcademyTab(user, t)));
    if (first) setActiveTab(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canAccessAcademyMgmt]);

  if (!canAccessAcademyMgmt) {
    return (
      <div className="container-fluid py-4">
        <div className="alert alert-warning">You do not have access to Academy management.</div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      <div className="row mb-4">
        <div className="col-12 d-flex justify-content-between align-items-center">
          <h1 className="h3 mb-0">Academy Management</h1>
          {(canAccessAcademyMgmt && (userIsAcademyStaff || user?.role === 'Admin')) && (
            <div>
              {activeTab === 'courses' && canManageAcademySection(user, 'courses') && (
                <button className="btn btn-primary me-2" onClick={handleAddCourse}>
                  <i className="bi bi-plus-circle me-2"></i>Add Course
                </button>
              )}
              {activeTab === 'students' && canManageAcademySection(user, 'students') && (
                <button className="btn btn-primary me-2" onClick={handleAddStudent}>
                  <i className="bi bi-plus-circle me-2"></i>Add Student
                </button>
              )}
              {activeTab === 'instructors' && canManageAcademySection(user, 'instructors') && (
                <button className="btn btn-primary me-2" onClick={handleAddInstructor}>
                  <i className="bi bi-plus-circle me-2"></i>Add Instructor
                </button>
              )}
              {activeTab === 'cohorts' && canManageAcademySection(user, 'cohorts') && (
                <button className="btn btn-primary" onClick={handleAddCohort}>
                  <i className="bi bi-plus-circle me-2"></i>Add Cohort
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ul className="nav nav-tabs mb-4">
        {canViewAcademyTab(user, 'courses') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'courses' ? 'active' : ''}`}
              onClick={() => setActiveTab('courses')}
            >
              Courses
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'students') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'students' ? 'active' : ''}`}
              onClick={() => setActiveTab('students')}
            >
              Students
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'instructors') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'instructors' ? 'active' : ''}`}
              onClick={() => setActiveTab('instructors')}
            >
              Instructors
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'cohorts') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'cohorts' ? 'active' : ''}`}
              onClick={() => setActiveTab('cohorts')}
            >
              Cohorts
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'grades') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'grades' ? 'active' : ''}`}
              onClick={() => setActiveTab('grades')}
            >
              Grades {canSeeGradeQueue && gradesPending.length > 0 && <span className="badge bg-warning text-dark">{gradesPending.length}</span>}
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'student-grades') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'student-grades' ? 'active' : ''}`}
              onClick={() => setActiveTab('student-grades')}
            >
              Student Grade
            </button>
          </li>
        )}
        {canViewAcademyTab(user, 'certificates') && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'certificates' ? 'active' : ''}`}
              onClick={() => setActiveTab('certificates')}
            >
              Certificates
            </button>
          </li>
        )}
        {canManagePerms && (
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === 'permissions' ? 'active' : ''}`}
              onClick={() => setActiveTab('permissions')}
            >
              Permissions
            </button>
          </li>
        )}
        {user?.role === 'Instructor' && !userIsAcademyStaff && (
          <>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'grades' ? 'active' : ''}`}
                onClick={() => setActiveTab('grades')}
              >
                Grades
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'student-grades' ? 'active' : ''}`}
                onClick={() => setActiveTab('student-grades')}
              >
                Student Grade
              </button>
            </li>
          </>
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
              <>
              {canExportLists && (
                <div className="d-flex flex-wrap justify-content-end align-items-center gap-2 mb-3">
                  <span className="text-muted small me-auto">Export courses list:</span>
                  <button type="button" className="btn btn-sm btn-success" onClick={() => exportCoursesExcel(courses)}>
                    <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden />
                    Excel
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => exportCoursesPdf(courses)}>
                    <i className="bi bi-file-earmark-pdf me-1" aria-hidden />
                    PDF
                  </button>
                </div>
              )}
              {canApproveFees && (
                <AcademyBulkBar
                  selectedCount={selectedCourseIds.length}
                  onClear={() => setSelectedCourseIds([])}
                  approveLabel="Approve fees"
                  rejectLabel="Reject fees"
                  onBulkApprove={() =>
                    runBulkApproval('course-fees', selectedCourseIds, true, () => {
                      setSelectedCourseIds([]);
                      fetchCourses();
                    })
                  }
                  onBulkReject={() =>
                    runBulkApproval('course-fees', selectedCourseIds, false, () => {
                      setSelectedCourseIds([]);
                      fetchCourses();
                    })
                  }
                />
              )}
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      {canApproveFees && <th style={{ width: 40 }} />}
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
                        {canApproveFees && (
                          <td>
                            {(course.fee_approved === 0 || course.fee_approved == null) ? (
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedCourseIds.includes(course.id)}
                                onChange={() => toggleIdInList(course.id, selectedCourseIds, setSelectedCourseIds)}
                              />
                            ) : null}
                          </td>
                        )}
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
                          {canManageAcademySection(user, 'courses') && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditCourse(course)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {canApproveFees && course.fee_approved === 0 && (
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
              </>
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
            {/* Filters — cohort, course, dates, status, search; sort & export */}
            <div className="row g-2 mb-2">
              <div className="col-6 col-md-2">
                <label className="form-label small mb-0">Cohort</label>
                <select
                  className="form-select form-select-sm"
                  value={studentFilters.cohort_id}
                  onChange={(e) => handleFilterChange('cohort_id', e.target.value)}
                >
                  <option value="">All cohorts</option>
                  {cohorts.filter(c => c.status === 'Active').map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-6 col-md-2">
                <label className="form-label small mb-0">Course</label>
                <select
                  className="form-select form-select-sm"
                  value={studentFilters.course_id}
                  onChange={(e) => handleFilterChange('course_id', e.target.value)}
                >
                  <option value="">All courses</option>
                  {courses.map((co) => (
                    <option key={co.id} value={co.id}>
                      {co.course_code} — {co.title}
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
                <label className="form-label small mb-0">Search</label>
                <input
                  type="search"
                  className="form-control form-control-sm"
                  placeholder="Name, email, or student ID"
                  value={studentFilters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="row g-2 align-items-end mb-2">
              <div className="col-12 col-md-4 col-lg-3">
                <label className="form-label small mb-0">Sort</label>
                <select
                  className="form-select form-select-sm"
                  value={studentSort}
                  onChange={(e) => setStudentSort(e.target.value)}
                >
                  <option value="name_asc">Name (A–Z)</option>
                  <option value="name_desc">Name (Z–A)</option>
                  <option value="id">Student ID</option>
                  <option value="cohort">Cohort (A–Z)</option>
                </select>
              </div>
              {canExportLists && (
                <div className="col-12 col-md-8 col-lg-9 d-flex flex-wrap align-items-center gap-2 justify-content-lg-end">
                  <span className="text-muted small">Export filtered list:</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-success"
                    disabled={displayStudents.length === 0}
                    onClick={() => exportStudentsExcel(displayStudents)}
                  >
                    <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden />
                    Excel
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={displayStudents.length === 0}
                    onClick={() => exportStudentsPdf(displayStudents)}
                  >
                    <i className="bi bi-file-earmark-pdf me-1" aria-hidden />
                    PDF
                  </button>
                </div>
              )}
            </div>
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
              <p className="text-muted small mb-0">
                Showing <strong>{displayStudents.length}</strong> student{displayStudents.length === 1 ? '' : 's'}.
                Filter by cohort, course, status, or search by name / ID. Use <strong>Sort</strong> to reorder the list (default: A–Z by name).
              </p>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearFilters}>
                <i className="bi bi-x-circle me-1" aria-hidden />
                Clear filters
              </button>
            </div>

            {canApproveStudentRecords && (
              <AcademyBulkBar
                selectedCount={selectedStudentIds.length}
                onClear={() => setSelectedStudentIds([])}
                onBulkApprove={() =>
                  runBulkApproval('students', selectedStudentIds, true, () => {
                    setSelectedStudentIds([]);
                    fetchStudents();
                  })
                }
                onBulkReject={() =>
                  runBulkApproval('students', selectedStudentIds, false, () => {
                    setSelectedStudentIds([]);
                    fetchStudents();
                  })
                }
              />
            )}
            
            <div className="table-responsive">
              <table className="table table-hover table-sm align-middle">
                  <thead className="table-light">
                  <tr>
                    {canApproveStudentRecords && (
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          title="Select all pending"
                          checked={
                            pendingStudentsForBulk.length > 0 &&
                            pendingStudentsForBulk.every((s) => selectedStudentIds.includes(s.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedStudentIds(pendingStudentsForBulk.map((s) => s.id));
                            } else {
                              setSelectedStudentIds([]);
                            }
                          }}
                        />
                      </th>
                    )}
                    <th scope="col">Student ID</th>
                    <th scope="col">Name</th>
                    <th>Email</th>
                    <th>Cohort</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Approval Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayStudents.length === 0 ? (
                    <tr>
                      <td colSpan={canApproveStudentRecords ? 9 : 8} className="text-center text-muted">
                        No students match the current filters. Try clearing filters or add a student.
                      </td>
                    </tr>
                  ) : (
                    displayStudents.map((student) => (
                      <tr key={student.id}>
                        {canApproveStudentRecords && (
                          <td>
                            {(student.approved === 0 || student.approved === false) ? (
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedStudentIds.includes(student.id)}
                                onChange={() => toggleIdInList(student.id, selectedStudentIds, setSelectedStudentIds)}
                              />
                            ) : null}
                          </td>
                        )}
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
                          {canManageAcademySection(user, 'students') && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditStudent(student)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {canApproveStudentRecords && student.approved === 0 && (
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
              <>
              {canExportLists && (
                <div className="d-flex flex-wrap justify-content-end align-items-center gap-2 mb-3">
                  <span className="text-muted small me-auto">Export instructors (teachers):</span>
                  <button type="button" className="btn btn-sm btn-success" onClick={() => exportInstructorsExcel(instructors)}>
                    <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden />
                    Excel
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => exportInstructorsPdf(instructors)}>
                    <i className="bi bi-file-earmark-pdf me-1" aria-hidden />
                    PDF
                  </button>
                </div>
              )}
              {canApproveInstructorRecords && (
                <AcademyBulkBar
                  selectedCount={selectedInstructorIds.length}
                  onClear={() => setSelectedInstructorIds([])}
                  onBulkApprove={() =>
                    runBulkApproval('instructors', selectedInstructorIds, true, () => {
                      setSelectedInstructorIds([]);
                      fetchInstructors();
                    })
                  }
                  onBulkReject={() =>
                    runBulkApproval('instructors', selectedInstructorIds, false, () => {
                      setSelectedInstructorIds([]);
                      fetchInstructors();
                    })
                  }
                />
              )}
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      {canApproveInstructorRecords && (
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            title="Select all pending instructors"
                            checked={
                              pendingInstructorsForBulk.length > 0 &&
                              pendingInstructorsForBulk.every((i) => selectedInstructorIds.includes(i.id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedInstructorIds(pendingInstructorsForBulk.map((i) => i.id));
                              } else {
                                setSelectedInstructorIds([]);
                              }
                            }}
                          />
                        </th>
                      )}
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
                        {canApproveInstructorRecords && (
                          <td>
                            {(instructor.approved === 0 || instructor.approved === false) ? (
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedInstructorIds.includes(instructor.id)}
                                onChange={() => toggleIdInList(instructor.id, selectedInstructorIds, setSelectedInstructorIds)}
                              />
                            ) : null}
                          </td>
                        )}
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
                          {canManageAcademySection(user, 'instructors') && (
                            <>
                              <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handleEditInstructor(instructor)}>
                                <i className="bi bi-pencil me-1"></i>Edit
                              </button>
                              {canApproveInstructorRecords && instructor.approved === 0 && (
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
              </>
            )}
          </div>
        </div>
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
                      <th>Certificate Access</th>
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
                          {Number(cohort.cert_access_enabled || 0) === 1 ? (
                            <div>
                              <span className="badge bg-success">Open</span>
                              <div className="small text-muted mt-1">
                                {cohort.cert_access_start ? new Date(cohort.cert_access_start).toLocaleDateString() : 'Now'} - {cohort.cert_access_end ? new Date(cohort.cert_access_end).toLocaleDateString() : 'Until closed'}
                              </div>
                            </div>
                          ) : (
                            <span className="badge bg-secondary">Closed</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge bg-${
                            cohort.status === 'Active' ? 'success' :
                            cohort.status === 'Completed' ? 'info' : 'secondary'
                          }`}>
                            {cohort.status}
                          </span>
                        </td>
                        <td>
                          {canManageAcademySection(user, 'cohorts') && (
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
          {(canManageAcademySection(user, 'grades') || user?.role === 'Instructor') && (
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
                        {studentsForSelect.filter(s => s.approved === 1 || s.approved === true).map((s) => (
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
                    <GradeTemplateForm
                      scores={gradeForm.scores}
                      onChange={(scores) => setGradeForm((f) => ({ ...f, scores }))}
                      disabled={!gradeForm.student_id || !gradeForm.course_id}
                      showStudentInfo
                      studentName={studentsForSelect.find((s) => String(s.id) === String(gradeForm.student_id))?.name}
                      studentCode={studentsForSelect.find((s) => String(s.id) === String(gradeForm.student_id))?.student_id}
                    />
                    <button type="submit" className="btn btn-primary mt-3" disabled={gradeSubmitting || !gradeForm.student_id || !gradeForm.course_id}>
                      {gradeSubmitting ? 'Submitting…' : 'Submit for coordinator review'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
          {canSeeGradeQueue && (
            <div className={userIsAcademyStaff || user?.role === 'Instructor' ? 'col-lg-7' : 'col-12'}>
              <div className="card">
                <div className="card-header fw-bold">
                  Pending grades
                  {canFinalApprove ? ' — CEO final approval publishes grades to students' : canEndorse ? ' — Coordinator review, then CEO final approval' : ''}
                </div>
                {(canEndorse || canFinalApprove) && (
                  <div className="card-body border-bottom py-2">
                    <AcademyBulkBar
                      selectedCount={selectedGradeIds.length}
                      onClear={() => setSelectedGradeIds([])}
                      showApprove={false}
                      showReject={false}
                      showEndorse={canEndorse}
                      showFinalApprove={canFinalApprove}
                      onBulkEndorse={() =>
                        api.post('/academy/bulk/grades/endorse', { ids: selectedGradeIds }).then(() => {
                          setSelectedGradeIds([]);
                          fetchGradesPending();
                          alert('Bulk endorse completed');
                        }).catch((err) => alert(err.response?.data?.error || 'Bulk endorse failed'))
                      }
                      onBulkFinalApprove={() =>
                        api.post('/academy/bulk/grades/final-approve', { ids: selectedGradeIds }).then(() => {
                          setSelectedGradeIds([]);
                          fetchGradesPending();
                          alert('Bulk final approval completed');
                        }).catch((err) => alert(err.response?.data?.error || 'Bulk approve failed'))
                      }
                    />
                  </div>
                )}
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
                            {(canEndorse || canFinalApprove) && <th style={{ width: 40 }} />}
                            <th>Student</th>
                            <th>Course</th>
                            <th>Average</th>
                            <th>Letter</th>
                            <th>Submitted by</th>
                            <th>Coordinator</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {gradesPending.map((g) => (
                            <tr key={g.id}>
                              {(canEndorse || canFinalApprove) && (
                                <td>
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={selectedGradeIds.includes(g.id)}
                                    onChange={() => toggleIdInList(g.id, selectedGradeIds, setSelectedGradeIds)}
                                  />
                                </td>
                              )}
                              <td><strong>{g.student_name}</strong><br /><small className="text-muted">{g.student_email}</small></td>
                              <td>{g.course_title} ({g.course_code})</td>
                              <td>{g.score_average ?? '—'}</td>
                              <td><strong>{g.proposed_grade}</strong></td>
                              <td>{g.submitted_by_name || '—'}</td>
                              <td>
                                {g.endorsed_by ? (
                                  <span className="badge bg-info text-dark">{g.endorsed_by_name || 'Yes'}</span>
                                ) : (
                                  <span className="text-muted small">—</span>
                                )}
                              </td>
                              <td>
                                <div className="d-flex flex-wrap gap-1">
                                  {canManageGrades && (
                                    <>
                                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openPendingGradeEdit(g)}>Edit</button>
                                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => deletePendingGrade(g)}>Delete</button>
                                    </>
                                  )}
                                  {canFinalApprove && (
                                    <button type="button" className="btn btn-sm btn-success" onClick={() => { setGradeActionId(g.id); setGradeActionMode('approve'); setGradeNotes(''); }}>CEO approve</button>
                                  )}
                                  {canEndorse && !g.endorsed_by && (
                                    <button type="button" className="btn btn-sm btn-outline-info" onClick={() => { setGradeActionId(g.id); setGradeActionMode('endorse'); setGradeNotes(''); }}>Coordinator approve</button>
                                  )}
                                  {(canFinalApprove || canEndorse) && (
                                    <button type="button" className="btn btn-sm btn-danger" onClick={() => { setGradeActionId(g.id); setGradeActionMode('reject'); setGradeNotes(''); }}>Reject</button>
                                  )}
                                  {!canFinalApprove && !canEndorse && (
                                    <span className="text-muted small">View only</span>
                                  )}
                                </div>
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
                        <h5 className="modal-title">
                          {gradeActionMode === 'approve' ? 'CEO final approval' : gradeActionMode === 'endorse' ? 'Coordinator approval' : 'Reject grade'}
                        </h5>
                        <button type="button" className="btn-close" onClick={() => { setGradeActionId(null); setGradeActionMode(null); setGradeNotes(''); }} aria-label="Close" />
                      </div>
                      <div className="modal-body">
                        <label className="form-label">Notes (optional)</label>
                        <textarea className="form-control" rows={3} value={gradeNotes} onChange={(e) => setGradeNotes(e.target.value)} placeholder={gradeActionMode === 'reject' ? 'Reason for rejection…' : ''} />
                      </div>
                      <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => { setGradeActionId(null); setGradeActionMode(null); setGradeNotes(''); }}>Cancel</button>
                        {gradeActionMode === 'approve' ? (
                          <button type="button" className="btn btn-success" onClick={() => handleGradeApprove(gradeActionId)}>CEO approve & publish</button>
                        ) : gradeActionMode === 'endorse' ? (
                          <button type="button" className="btn btn-info" onClick={() => handleGradeEndorse(gradeActionId)}>Coordinator approve</button>
                        ) : (
                          <button type="button" className="btn btn-danger" onClick={() => handleGradeReject(gradeActionId)}>Reject</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {pendingEditRow && canManageGrades && (
                <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
                  <div className="modal-dialog modal-dialog-centered modal-lg">
                    <div className="modal-content">
                      <div className="modal-header">
                        <h5 className="modal-title">Edit pending grade</h5>
                        <button type="button" className="btn-close" onClick={() => setPendingEditRow(null)} aria-label="Close" />
                      </div>
                      <div className="modal-body">
                        <div className="row">
                          <div className="col-md-6 mb-3">
                            <label className="form-label">Student</label>
                            <select
                              className="form-select"
                              value={pendingEditForm.student_id}
                              onChange={(e) => handlePendingEditStudentChange(e.target.value)}
                            >
                              <option value="">Select student</option>
                              {studentsForSelect.filter((s) => s.approved === 1 || s.approved === true).map((s) => (
                                <option key={s.id} value={s.id}>{s.name} ({s.student_id})</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-md-6 mb-3">
                            <label className="form-label">Course</label>
                            <select
                              className="form-select"
                              value={pendingEditForm.course_id}
                              onChange={(e) => setPendingEditForm((f) => ({ ...f, course_id: e.target.value }))}
                              disabled={!pendingEditForm.student_id}
                            >
                              <option value="">Select course</option>
                              {pendingEditCourses.map((c) => (
                                <option key={c.course_id} value={c.course_id}>{c.course_code} — {c.title}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-12 mb-3">
                            <GradeTemplateForm
                              scores={pendingEditForm.scores}
                              onChange={(scores) => setPendingEditForm((f) => ({ ...f, scores }))}
                              showStudentInfo
                              studentName={studentsForSelect.find((s) => String(s.id) === String(pendingEditForm.student_id))?.name}
                              studentCode={studentsForSelect.find((s) => String(s.id) === String(pendingEditForm.student_id))?.student_id}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setPendingEditRow(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary" disabled={pendingEditSaving} onClick={savePendingGradeEdit}>
                          {pendingEditSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'student-grades' && (
        <StudentAcademyGradesTab
          cohorts={cohorts}
          courses={courses}
          students={studentsForSelect}
          canManageGrades={canManageGrades}
        />
      )}

      {activeTab === 'certificates' && canViewAcademyTab(user, 'certificates') && (
        <CertificateManagement embedded />
      )}

      {activeTab === 'permissions' && canManagePerms && (
        <AcademyStaffPermissions />
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

