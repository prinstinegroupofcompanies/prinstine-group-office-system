import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import GradeTemplateForm from '../../components/academy/GradeTemplateForm';
import {
  EMPTY_GRADE_SCORES,
  buildGradeSubmitPayload,
  validateScoresForSubmit
} from '../../utils/gradeTemplate';
import './InstructorDashboard.css';

const PLATFORMS = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Other'];
const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

const gradeStatusBadge = (row) => {
  if (row.status === 'Approved') return <span className="badge bg-success">Published</span>;
  if (row.status === 'Rejected') return <span className="badge bg-danger">Rejected</span>;
  if (row.endorsed_by) return <span className="badge bg-info text-dark">Awaiting CEO approval</span>;
  return <span className="badge bg-warning text-dark">Pending coordinator review</span>;
};

const InstructorDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({});
  const [courses, setCourses] = useState([]);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [classLinks, setClassLinks] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [gradeForm, setGradeForm] = useState({ student_id: '', course_id: '', scores: { ...EMPTY_GRADE_SCORES } });
  const [gradeSubmitting, setGradeSubmitting] = useState(false);

  const [linkForm, setLinkForm] = useState({ course_id: '', title: '', link_url: '', platform: 'Zoom' });
  const [linkSaving, setLinkSaving] = useState(false);

  const [assignForm, setAssignForm] = useState({ course_id: '', title: '', description: '', due_date: '', link_url: '' });
  const [assignSaving, setAssignSaving] = useState(false);

  const [attendanceCourseId, setAttendanceCourseId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [attendanceRoster, setAttendanceRoster] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);

  const isPending = profile && Number(profile.approved) !== 1;

  const studentsForCourse = useMemo(() => {
    if (!gradeForm.course_id) return [];
    return students.filter((s) => String(s.course_id) === String(gradeForm.course_id));
  }, [students, gradeForm.course_id]);

  const loadCore = useCallback(async () => {
    setError('');
    const [meRes, coursesRes, studentsRes, subsRes] = await Promise.all([
      api.get('/academy/instructor-portal/me'),
      api.get('/academy/instructor-portal/me/courses'),
      api.get('/academy/instructor-portal/me/students'),
      api.get('/academy/instructor-portal/me/grade-submissions')
    ]);
    setProfile(meRes.data.instructor);
    setStats(meRes.data.stats || {});
    setCourses(coursesRes.data.courses || []);
    setStudents(studentsRes.data.students || []);
    setSubmissions(subsRes.data.submissions || []);
  }, []);

  const loadLinks = useCallback(async () => {
    const res = await api.get('/academy/instructor-portal/me/class-links');
    setClassLinks(res.data.links || []);
  }, []);

  const loadAssignments = useCallback(async () => {
    const res = await api.get('/academy/instructor-portal/me/assignments');
    setAssignments(res.data.assignments || []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadCore();
        await Promise.all([loadLinks(), loadAssignments()]);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load instructor portal');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCore, loadLinks, loadAssignments]);

  const loadAttendance = async () => {
    if (!attendanceCourseId) return;
    setAttendanceLoading(true);
    try {
      const res = await api.get(`/academy/instructor-portal/me/courses/${attendanceCourseId}/attendance`, {
        params: { date: attendanceDate }
      });
      setAttendanceRoster(
        (res.data.roster || []).map((r) => ({
          ...r,
          status: r.attendance_status || 'Present'
        }))
      );
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to load attendance');
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'attendance' && attendanceCourseId) {
      loadAttendance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, attendanceCourseId, attendanceDate]);

  const selectedStudent = useMemo(
    () => studentsForCourse.find((s) => String(s.id) === String(gradeForm.student_id)),
    [studentsForCourse, gradeForm.student_id]
  );

  const handleGradeSubmit = async (e) => {
    e.preventDefault();
    if (!gradeForm.student_id || !gradeForm.course_id) return;
    const validationErrors = validateScoresForSubmit(gradeForm.scores);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      return;
    }
    setGradeSubmitting(true);
    setMessage('');
    try {
      await api.post(
        '/academy/instructor-portal/me/grades/submit',
        buildGradeSubmitPayload(gradeForm.student_id, gradeForm.course_id, gradeForm.scores)
      );
      setMessage('Grade submitted for coordinator review.');
      setGradeForm({ student_id: '', course_id: '', scores: { ...EMPTY_GRADE_SCORES } });
      await loadCore();
      setActiveTab('grades');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit grade');
    } finally {
      setGradeSubmitting(false);
    }
  };

  const handleAddLink = async (e) => {
    e.preventDefault();
    if (!linkForm.course_id || !linkForm.link_url) return;
    setLinkSaving(true);
    try {
      await api.post(`/academy/instructor-portal/me/courses/${linkForm.course_id}/class-links`, linkForm);
      setMessage('Class link posted. Enrolled students have been notified.');
      setLinkForm({ course_id: '', title: '', link_url: '', platform: 'Zoom' });
      await loadLinks();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add class link');
    } finally {
      setLinkSaving(false);
    }
  };

  const handleDeleteLink = async (id) => {
    if (!window.confirm('Remove this class link?')) return;
    try {
      await api.delete(`/academy/instructor-portal/me/class-links/${id}`);
      await loadLinks();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete link');
    }
  };

  const handleAddAssignment = async (e) => {
    e.preventDefault();
    if (!assignForm.course_id || !assignForm.title) return;
    setAssignSaving(true);
    try {
      await api.post(`/academy/instructor-portal/me/courses/${assignForm.course_id}/assignments`, assignForm);
      setMessage('Material / assignment posted. Students have been notified.');
      setAssignForm({ course_id: '', title: '', description: '', due_date: '', link_url: '' });
      await loadAssignments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to post assignment');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleDeleteAssignment = async (id) => {
    if (!window.confirm('Remove this assignment?')) return;
    try {
      await api.delete(`/academy/instructor-portal/me/assignments/${id}`);
      await loadAssignments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete assignment');
    }
  };

  const handleSaveAttendance = async () => {
    if (!attendanceCourseId || attendanceRoster.length === 0) return;
    setAttendanceSaving(true);
    try {
      await api.post(`/academy/instructor-portal/me/courses/${attendanceCourseId}/attendance`, {
        session_date: attendanceDate,
        records: attendanceRoster.map((r) => ({
          student_id: r.id,
          status: r.status,
          notes: r.attendance_notes || null
        }))
      });
      setMessage('Attendance saved.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save attendance');
    } finally {
      setAttendanceSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="instructor-dashboard container-fluid py-5 text-center">
        <div className="spinner-border text-primary" role="status" />
        <p className="text-muted mt-2">Loading your portal…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="instructor-dashboard container-fluid py-4">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'bi-house' },
    { key: 'courses', label: 'My Courses', icon: 'bi-journal-bookmark' },
    { key: 'students', label: 'My Students', icon: 'bi-people' },
    { key: 'grades', label: 'Grades', icon: 'bi-award' },
    { key: 'class-links', label: 'Class Links', icon: 'bi-camera-video' },
    { key: 'materials', label: 'Materials', icon: 'bi-file-earmark-text' },
    { key: 'attendance', label: 'Attendance', icon: 'bi-calendar-check' }
  ];

  return (
    <div className="instructor-dashboard container-fluid py-3">
      <div className="instructor-dashboard__hero card border-0 shadow-sm mb-3">
        <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div>
            <h1 className="h4 mb-1">Lecturer Portal</h1>
            <p className="text-muted mb-0 small">
              Welcome, {profile?.name || user?.name}. Manage grades, class links, materials, and attendance.
            </p>
          </div>
          <Link to="/communications" className="btn btn-outline-primary btn-sm">
            <i className="bi bi-chat-dots me-1" /> Message students
          </Link>
        </div>
      </div>

      {isPending && (
        <div className="alert alert-warning">
          <i className="bi bi-hourglass-split me-2" />
          Your instructor account is <strong>pending approval</strong>. You can view your portal; grade submission and other actions unlock after the academy coordinator approves your account.
        </div>
      )}

      {message && (
        <div className="alert alert-success alert-dismissible">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage('')} aria-label="Close" />
        </div>
      )}

      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        {tabs.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              className={`nav-link ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <i className={`bi ${t.icon} me-1`} />{t.label}
            </button>
          </li>
        ))}
      </ul>

      {activeTab === 'overview' && (
        <div className="row g-3">
          <div className="col-6 col-md-3">
            <div className="card text-center h-100"><div className="card-body">
              <div className="fs-3 fw-bold text-primary">{stats.coursesCount || 0}</div>
              <div className="small text-muted">Courses</div>
            </div></div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100"><div className="card-body">
              <div className="fs-3 fw-bold">{stats.studentsCount || 0}</div>
              <div className="small text-muted">Students</div>
            </div></div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100"><div className="card-body">
              <div className="fs-3 fw-bold text-warning">{stats.pendingGrades || 0}</div>
              <div className="small text-muted">Grades pending review</div>
            </div></div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100"><div className="card-body">
              <div className="fs-3 fw-bold text-success">{stats.approvedGrades || 0}</div>
              <div className="small text-muted">Grades published</div>
            </div></div>
          </div>
          <div className="col-12">
            <div className="card"><div className="card-header fw-bold">Grade workflow</div><div className="card-body small">
              <ol className="mb-0">
                <li>You submit grades → <strong>Pending coordinator review</strong></li>
                <li>Academy coordinator approves or rejects → <strong>Awaiting CEO approval</strong></li>
                <li>CEO (Admin) final approval → <strong>Published</strong> on student portal</li>
              </ol>
            </div></div>
          </div>
        </div>
      )}

      {activeTab === 'courses' && (
        <div className="card"><div className="card-body table-responsive">
          <table className="table table-hover mb-0">
            <thead><tr><th>Code</th><th>Title</th><th>Mode</th><th>Status</th></tr></thead>
            <tbody>
              {courses.length === 0 ? (
                <tr><td colSpan={4} className="text-muted">No courses assigned yet.</td></tr>
              ) : courses.map((c) => (
                <tr key={c.id}><td><strong>{c.course_code}</strong></td><td>{c.title}</td><td>{c.mode}</td><td>{c.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {activeTab === 'students' && (
        <div className="card"><div className="card-body table-responsive">
          <table className="table table-hover mb-0">
            <thead><tr><th>Student</th><th>ID</th><th>Course</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>
              {students.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">No students in your courses.</td></tr>
              ) : students.map((s, idx) => (
                <tr key={`${s.id}-${s.course_id}-${idx}`}>
                  <td>{s.name}</td><td>{s.student_code}</td>
                  <td>{s.course_code} — {s.course_title}</td><td>{s.email}</td>
                  <td>{s.enrollment_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {activeTab === 'grades' && (
        <div className="row g-3">
          <div className="col-12">
            <div className="card"><div className="card-header fw-bold">Submit grade (standard template)</div><div className="card-body">
              <form onSubmit={handleGradeSubmit}>
                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <label className="form-label">Course</label>
                    <select className="form-select" required value={gradeForm.course_id}
                      onChange={(e) => setGradeForm((f) => ({ ...f, course_id: e.target.value, student_id: '' }))}
                      disabled={isPending}>
                      <option value="">Select course</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.course_code} — {c.title}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Student</label>
                    <select className="form-select" required value={gradeForm.student_id}
                      onChange={(e) => setGradeForm((f) => ({ ...f, student_id: e.target.value }))}
                      disabled={!gradeForm.course_id || isPending}>
                      <option value="">Select student</option>
                      {studentsForCourse.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.student_code})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <GradeTemplateForm
                  scores={gradeForm.scores}
                  onChange={(scores) => setGradeForm((f) => ({ ...f, scores }))}
                  disabled={isPending || !gradeForm.student_id}
                  showStudentInfo
                  studentName={selectedStudent?.name}
                  studentCode={selectedStudent?.student_code}
                />
                <button type="submit" className="btn btn-primary mt-3" disabled={gradeSubmitting || isPending || !gradeForm.student_id}>
                  {gradeSubmitting ? 'Submitting…' : 'Submit for coordinator review'}
                </button>
              </form>
            </div></div>
          </div>
          <div className="col-12">
            <div className="card"><div className="card-header fw-bold">Your submissions</div><div className="card-body table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th>Student</th><th>Course</th>
                    <th>Asgn</th><th>Att</th><th>Pres</th><th>Assess</th><th>Proj</th><th>Exam</th>
                    <th>Avg</th><th>Letter</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.length === 0 ? (
                    <tr><td colSpan={11} className="text-muted">No submissions yet.</td></tr>
                  ) : submissions.map((g) => (
                    <tr key={g.id}>
                      <td>{g.student_name}</td><td>{g.course_code}</td>
                      <td>{g.score_assignment ?? '—'}</td><td>{g.score_attendance ?? '—'}</td>
                      <td>{g.score_presentation ?? '—'}</td><td>{g.score_assessment ?? '—'}</td>
                      <td>{g.score_project ?? '—'}</td><td>{g.score_final_exam ?? '—'}</td>
                      <td>{g.score_average ?? '—'}</td><td><strong>{g.proposed_grade}</strong></td>
                      <td>{gradeStatusBadge(g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </div>
        </div>
      )}

      {activeTab === 'class-links' && (
        <div className="row g-3">
          <div className="col-lg-4">
            <div className="card"><div className="card-header fw-bold">Post class link</div><div className="card-body">
              <form onSubmit={handleAddLink}>
                <div className="mb-2">
                  <label className="form-label">Course</label>
                  <select className="form-select" required value={linkForm.course_id}
                    onChange={(e) => setLinkForm((f) => ({ ...f, course_id: e.target.value }))} disabled={isPending}>
                    <option value="">Select course</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.course_code}</option>)}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label">Title</label>
                  <input className="form-control" value={linkForm.title} placeholder="Week 3 lecture"
                    onChange={(e) => setLinkForm((f) => ({ ...f, title: e.target.value }))} disabled={isPending} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Platform</label>
                  <select className="form-select" value={linkForm.platform}
                    onChange={(e) => setLinkForm((f) => ({ ...f, platform: e.target.value }))} disabled={isPending}>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label">Link URL</label>
                  <input className="form-control" type="url" required value={linkForm.link_url}
                    onChange={(e) => setLinkForm((f) => ({ ...f, link_url: e.target.value }))} disabled={isPending} />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={linkSaving || isPending}>
                  {linkSaving ? 'Posting…' : 'Post link & notify students'}
                </button>
              </form>
            </div></div>
          </div>
          <div className="col-lg-8">
            <div className="card"><div className="card-header fw-bold">Posted links</div><div className="card-body table-responsive">
              <table className="table table-sm mb-0">
                <thead><tr><th>Course</th><th>Title</th><th>Platform</th><th>Link</th><th></th></tr></thead>
                <tbody>
                  {classLinks.length === 0 ? (
                    <tr><td colSpan={5} className="text-muted">No class links yet.</td></tr>
                  ) : classLinks.map((l) => (
                    <tr key={l.id}>
                      <td>{l.course_code}</td><td>{l.title}</td><td>{l.platform}</td>
                      <td><a href={l.link_url} target="_blank" rel="noreferrer">Open</a></td>
                      <td><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteLink(l.id)} disabled={isPending}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </div>
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="row g-3">
          <div className="col-lg-4">
            <div className="card"><div className="card-header fw-bold">Upload material / assignment</div><div className="card-body">
              <form onSubmit={handleAddAssignment}>
                <div className="mb-2">
                  <label className="form-label">Course</label>
                  <select className="form-select" required value={assignForm.course_id}
                    onChange={(e) => setAssignForm((f) => ({ ...f, course_id: e.target.value }))} disabled={isPending}>
                    <option value="">Select course</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.course_code}</option>)}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label">Title</label>
                  <input className="form-control" required value={assignForm.title}
                    onChange={(e) => setAssignForm((f) => ({ ...f, title: e.target.value }))} disabled={isPending} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Description</label>
                  <textarea className="form-control" rows={2} value={assignForm.description}
                    onChange={(e) => setAssignForm((f) => ({ ...f, description: e.target.value }))} disabled={isPending} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Due date</label>
                  <input type="date" className="form-control" value={assignForm.due_date}
                    onChange={(e) => setAssignForm((f) => ({ ...f, due_date: e.target.value }))} disabled={isPending} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Link (Drive, PDF, etc.)</label>
                  <input className="form-control" type="url" value={assignForm.link_url}
                    onChange={(e) => setAssignForm((f) => ({ ...f, link_url: e.target.value }))} disabled={isPending} />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={assignSaving || isPending}>
                  {assignSaving ? 'Posting…' : 'Post & notify students'}
                </button>
              </form>
            </div></div>
          </div>
          <div className="col-lg-8">
            <div className="card"><div className="card-header fw-bold">Posted materials</div><div className="card-body table-responsive">
              <table className="table table-sm mb-0">
                <thead><tr><th>Course</th><th>Title</th><th>Due</th><th>Link</th><th></th></tr></thead>
                <tbody>
                  {assignments.length === 0 ? (
                    <tr><td colSpan={5} className="text-muted">No materials yet.</td></tr>
                  ) : assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.course_code}</td><td>{a.title}</td>
                      <td>{a.due_date ? new Date(a.due_date).toLocaleDateString() : '—'}</td>
                      <td>{a.link_url ? <a href={a.link_url} target="_blank" rel="noreferrer">Open</a> : '—'}</td>
                      <td><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteAssignment(a.id)} disabled={isPending}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </div>
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="card"><div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-4">
              <label className="form-label">Course</label>
              <select className="form-select" value={attendanceCourseId}
                onChange={(e) => setAttendanceCourseId(e.target.value)}>
                <option value="">Select course</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.course_code} — {c.title}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Session date</label>
              <input type="date" className="form-control" value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)} />
            </div>
            <div className="col-md-3 d-flex align-items-end">
              <button type="button" className="btn btn-outline-primary" onClick={loadAttendance} disabled={!attendanceCourseId || attendanceLoading}>
                {attendanceLoading ? 'Loading…' : 'Load roster'}
              </button>
            </div>
          </div>
          {attendanceRoster.length > 0 && (
            <>
              <div className="table-responsive">
                <table className="table table-sm">
                  <thead><tr><th>Student</th><th>ID</th><th>Status</th></tr></thead>
                  <tbody>
                    {attendanceRoster.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td><td>{r.student_code}</td>
                        <td>
                          <select className="form-select form-select-sm" value={r.status}
                            onChange={(e) => setAttendanceRoster((prev) => prev.map((x) => x.id === r.id ? { ...x, status: e.target.value } : x))}
                            disabled={isPending}>
                            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleSaveAttendance} disabled={attendanceSaving || isPending}>
                {attendanceSaving ? 'Saving…' : 'Save attendance'}
              </button>
            </>
          )}
        </div></div>
      )}
    </div>
  );
};

export default InstructorDashboard;
