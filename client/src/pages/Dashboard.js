import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../config/api';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import ProgressReport from './departments/ProgressReport';
import { getSocket } from '../config/socket';
import { normalizeUrl } from '../utils/apiUrl';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showProgressReport, setShowProgressReport] = useState(false);
  const [progressStats, setProgressStats] = useState({
    total: 0,
    byCategory: {},
    byStatus: {}
  });

  const fetchStats = async () => {
    try {
      const response = await api.get('/dashboard/stats');
      // Ensure we have the stats object
      if (response.data && response.data.stats) {
        setStats(response.data.stats);
      } else if (response.data) {
        // If stats is directly in data
        setStats(response.data);
      } else {
        console.warn('Unexpected stats response format:', response.data);
        setStats(null);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchProgressStats = async () => {
    try {
      const response = await api.get('/progress-reports');
      // Handle different response formats
      const reports = response.data?.reports || response.data || [];
      
      if (!Array.isArray(reports)) {
        console.warn('Progress reports is not an array:', reports);
        return;
      }
      
      const byCategory = {};
      const byStatus = {};
      
      reports.forEach(report => {
        if (report.category) {
          byCategory[report.category] = (byCategory[report.category] || 0) + 1;
        }
        if (report.status) {
          byStatus[report.status] = (byStatus[report.status] || 0) + 1;
        }
      });
      
      setProgressStats({
        total: reports.length,
        byCategory,
        byStatus
      });
    } catch (error) {
      console.error('Error fetching progress stats:', error);
      setProgressStats({
        total: 0,
        byCategory: {},
        byStatus: {}
      });
    }
  };

  useEffect(() => {
    fetchStats();
    fetchProgressStats();
    
    // Set up real-time socket connection for new clients
    const socket = getSocket();
    if (socket) {
      const handleClientCreated = () => {
        // Refresh stats when a new client is created
        fetchStats();
        fetchProgressStats();
      };

      socket.on('client_created', handleClientCreated);

      return () => {
        socket.off('client_created', handleClientCreated);
      };
    }
  }, []);

  const role = (user?.role ?? '').toString().trim().toLowerCase();
  if (role === 'departmenthead') return <Navigate to="/department-dashboard" replace />;
  if (role === 'staff') return <Navigate to="/staff-dashboard" replace />;
  if (role === 'student') return <Navigate to="/student" replace />;
  if (role === 'instructor') return <Navigate to="/academy" replace />;

  const handleSearch = async (e) => {
    e.preventDefault();
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await api.get(`/dashboard/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(response.data.results);
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '50vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  const getStaffChartData = () => {
    if (!stats?.staff) return null;
    return {
      labels: ['Full-time', 'Part-time', 'Internship'],
      datasets: [{
        label: 'Staff Distribution',
        data: [stats.staff.fullTime, stats.staff.partTime, stats.staff.internship],
        backgroundColor: ['#007BFF', '#FFC107', '#28a745']
      }]
    };
  };

  const getReportsChartData = () => {
    if (!stats?.reports) return null;
    return {
      labels: ['Pending', 'Approved', 'Rejected'],
      datasets: [{
        label: 'Reports Status',
        data: [
          stats.reports.pending,
          stats.reports.total - stats.reports.pending,
          0
        ],
        backgroundColor: ['#FFC107', '#28a745', '#dc3545']
      }]
    };
  };

  return (
    <div className="container-fluid">
      <div className="row mb-4">
        <div className="col-12 d-flex align-items-center gap-3">
          <img 
            src="/prinstine-logo.png" 
            alt="Prinstine Group" 
            style={{ maxHeight: '50px', width: 'auto' }}
            className="d-none d-md-block"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <div>
            <h3 className="mb-0">Welcome back, {user?.name}!</h3>
            <p className="text-muted mb-0">Here's what's happening in your dashboard</p>
          </div>
        </div>
      </div>

      {/* Global Search */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <form onSubmit={handleSearch}>
                <div className="input-group">
                  <span className="input-group-text">
                    <i className="bi bi-search"></i>
                  </span>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search users, staff, clients, students..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.length >= 2) {
                        handleSearch(e);
                      } else {
                        setSearchResults([]);
                      }
                    }}
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="mt-2">
                    <div className="list-group">
                      {searchResults.map((result, idx) => {
                        const getRoutePath = () => {
                          switch (result.type) {
                            case 'staff':
                              return `/staff/view/${result.id}`;
                            case 'client':
                              return `/clients/view/${result.id}`;
                            case 'student':
                              return `/academy/students/view/${result.id}`;
                            case 'user':
                              return `/users`; // Users management page
                            default:
                              return `/${result.type}/${result.id}`;
                          }
                        };

                        const getBadgeColor = () => {
                          switch (result.type) {
                            case 'staff':
                              return 'primary';
                            case 'client':
                              return 'info';
                            case 'student':
                              return 'success';
                            case 'user':
                              return 'secondary';
                            default:
                              return 'primary';
                          }
                        };

                        return (
                          <Link
                            key={idx}
                            to={getRoutePath()}
                            className="list-group-item list-group-item-action"
                          >
                            <div className="d-flex align-items-center">
                              {result.profile_image && result.profile_image.trim() !== '' ? (
                                <img
                                  src={result.profile_image.startsWith('http') ? result.profile_image : normalizeUrl(result.profile_image)}
                                  alt={result.name}
                                  className="rounded-circle me-3"
                                  style={{ width: '40px', height: '40px', objectFit: 'cover' }}
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="bg-secondary rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '40px', height: '40px' }}>
                                  <i className="bi bi-person text-white"></i>
                                </div>
                              )}
                              <div className="flex-grow-1">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <strong>{result.name}</strong>
                                    <br />
                                    <small className="text-muted">{result.email}</small>
                                    {result.phone && (
                                      <>
                                        <br />
                                        <small className="text-muted">
                                          <i className="bi bi-telephone me-1"></i>{result.phone}
                                        </small>
                                      </>
                                    )}
                                    {result.role && (
                                      <>
                                        <br />
                                        <span className={`badge bg-${
                                          result.role === 'Admin' ? 'danger' :
                                          result.role === 'Staff' ? 'primary' :
                                          result.role === 'Instructor' ? 'info' :
                                          result.role === 'Student' ? 'success' :
                                          result.role === 'Client' ? 'warning' : 'secondary'
                                        } me-1`}>
                                          {result.role}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <span className={`badge bg-${getBadgeColor()}`}>
                                    {result.type.charAt(0).toUpperCase() + result.type.slice(1)}
                                  </span>
                                </div>
                                {result.identifier && (
                                  <small className="text-muted">
                                    ID: {result.identifier}
                                  </small>
                                )}
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {user?.role === 'Admin' && stats && (
        <>
          {/* Main Statistics Row */}
          <div className="row mb-4">
            {/* Academy Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-primary h-100">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-book me-2"></i>Academy
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row text-center">
                    <div className="col-4">
                      <div className="mb-2">
                        <i className="bi bi-mortarboard" style={{ fontSize: '2rem', color: '#007BFF' }}></i>
                      </div>
                      <h3 className="mb-0">{stats.academy?.students || 0}</h3>
                      <small className="text-muted">Students</small>
                    </div>
                    <div className="col-4">
                      <div className="mb-2">
                        <i className="bi bi-person-badge" style={{ fontSize: '2rem', color: '#28a745' }}></i>
                      </div>
                      <h3 className="mb-0">{stats.academy?.instructors || 0}</h3>
                      <small className="text-muted">Instructors</small>
                    </div>
                    <div className="col-4">
                      <div className="mb-2">
                        <i className="bi bi-journal-bookmark" style={{ fontSize: '2rem', color: '#FFC107' }}></i>
                      </div>
                      <h3 className="mb-0">{stats.academy?.courses || 0}</h3>
                      <small className="text-muted">Courses</small>
                    </div>
                    <div className="col-4">
                      <div className="mb-2">
                        <i className="bi bi-journal-bookmark" style={{ fontSize: '2rem', color: '#FFC107' }}></i>
                      </div>
                      <h3 className="mb-0">{stats.academy?.studentGrades || 0}</h3>
                      <small className="text-muted">Student Grades</small>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Link to="/academy" className="btn btn-outline-primary w-100">
                      <i className="bi bi-arrow-right me-2"></i>View Academy
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Partners Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-success h-100">
                <div className="card-header bg-success text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-handshake me-2"></i>Partners
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-handshake" style={{ fontSize: '4rem', color: '#28a745', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-1">{stats.partners?.total || 0}</h2>
                  <p className="text-muted mb-3">
                    <span className="badge bg-success">{stats.partners?.active || 0} Active</span>
                  </p>
                  <Link to="/partners" className="btn btn-outline-success w-100">
                    <i className="bi bi-arrow-right me-2"></i>View Partners
                  </Link>
                </div>
              </div>
            </div>

            {/* Clients Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-info h-100">
                <div className="card-header bg-info text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-person-badge me-2"></i>Clients
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-person-badge" style={{ fontSize: '4rem', color: '#17a2b8', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-1">{stats.clients?.total || 0}</h2>
                  <p className="text-muted mb-3">
                    <span className="badge bg-success">{stats.clients?.active || 0} Active</span>
                    {stats.clients?.withLoans > 0 && (
                      <span className="badge bg-warning ms-2">{stats.clients?.withLoans} With Loans</span>
                    )}
                  </p>
                  <Link to="/clients" className="btn btn-outline-info w-100">
                    <i className="bi bi-arrow-right me-2"></i>View Clients
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Second Row */}
          <div className="row mb-4">
            {/* Certificates Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-warning h-100">
                <div className="card-header bg-warning text-dark">
                  <h5 className="mb-0">
                    <i className="bi bi-award me-2"></i>Certificates
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-award" style={{ fontSize: '4rem', color: '#FFC107', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-3">{stats.certificates?.total || 0}</h2>
                  <Link to="/certificates" className="btn btn-outline-warning w-100">
                    <i className="bi bi-arrow-right me-2"></i>Manage Certificates
                  </Link>
                </div>
              </div>
            </div>

            {/* Departments Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-secondary h-100">
                <div className="card-header bg-secondary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-building me-2"></i>Departments
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-building" style={{ fontSize: '4rem', color: '#6c757d', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-3">{stats.departments?.total || 0}</h2>
                  <Link to="/departments" className="btn btn-outline-secondary w-100">
                    <i className="bi bi-arrow-right me-2"></i>View Departments
                  </Link>
                </div>
              </div>
            </div>

            {/* Users Section */}
            <div className="col-md-4 mb-3">
              <div className="card border-danger h-100">
                <div className="card-header bg-danger text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-people-fill me-2"></i>Users
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-people-fill" style={{ fontSize: '4rem', color: '#dc3545', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-3">{stats.users?.total || 0}</h2>
                  <Link to="/users" className="btn btn-outline-danger w-100">
                    <i className="bi bi-arrow-right me-2"></i>Manage Users
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Third Row - Staff and Reports */}
          <div className="row mb-4">
            {/* Staff Section */}
            <div className="col-md-6 mb-3">
              <div className="card border-primary h-100">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-people me-2"></i>Staff
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row text-center mb-3">
                    <div className="col-12 mb-3">
                      <h2 className="mb-0">{stats.staff?.total || 0}</h2>
                      <small className="text-muted">Total Staff Members</small>
                    </div>
                  </div>
                  <div className="row text-center">
                    <div className="col-4">
                      <div className="badge bg-primary">{stats.staff?.fullTime || 0} Full-time</div>
                    </div>
                    <div className="col-4">
                      <div className="badge bg-warning text-dark">{stats.staff?.partTime || 0} Part-time</div>
                    </div>
                    <div className="col-4">
                      <div className="badge bg-success">{stats.staff?.internship || 0} Internship</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Link to="/staff" className="btn btn-outline-primary w-100">
                      <i className="bi bi-arrow-right me-2"></i>Manage Staff
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Reports Section */}
            <div className="col-md-6 mb-3">
              <div className="card border-danger h-100">
                <div className="card-header bg-danger text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-file-text me-2"></i>Reports
                  </h5>
                </div>
                <div className="card-body text-center">
                  <div className="mb-3">
                    <i className="bi bi-file-text" style={{ fontSize: '4rem', color: '#dc3545', opacity: 0.5 }}></i>
                  </div>
                  <h2 className="mb-1">{stats.reports?.total || 0}</h2>
                  <p className="text-muted mb-3">
                    <span className="badge bg-warning text-dark">{stats.reports?.pending || 0} Pending</span>
                  </p>
                  <Link to="/reports" className="btn btn-outline-danger w-100">
                    <i className="bi bi-arrow-right me-2"></i>View Reports
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Report Section */}
          <div className="row mb-4">
            <div className="col-12">
              <div className="card border-success">
                <div className="card-header bg-success text-white d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">
                    <i className="bi bi-graph-up me-2"></i>Progress Report
                  </h5>
                  <button 
                    className="btn btn-light btn-sm"
                    onClick={() => setShowProgressReport(true)}
                  >
                    <i className="bi bi-eye me-1"></i>View Full Report
                  </button>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-3 text-center mb-3">
                      <h3 className="text-success">{progressStats.total}</h3>
                      <p className="text-muted mb-0">Total Entries</p>
                    </div>
                    <div className="col-md-9">
                      <div className="row">
                        <div className="col-md-6">
                          <h6 className="mb-3">By Category</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {Object.entries(progressStats.byCategory).map(([category, count]) => (
                              <span key={category} className="badge bg-info">
                                {category}: {count}
                              </span>
                            ))}
                            {Object.keys(progressStats.byCategory).length === 0 && (
                              <span className="text-muted">No categories yet</span>
                            )}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <h6 className="mb-3">By Status</h6>
                          <div className="d-flex flex-wrap gap-2">
                            {Object.entries(progressStats.byStatus).map(([status, count]) => (
                              <span 
                                key={status} 
                                className={`badge bg-${
                                  status === 'signed contract' ? 'success' :
                                  status === 'pipeline client' ? 'warning' : 'info'
                                }`}
                              >
                                {status}: {count}
                              </span>
                            ))}
                            {Object.keys(progressStats.byStatus).length === 0 && (
                              <span className="text-muted">No status data yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Link to="/clients" className="btn btn-outline-success me-2">
                      <i className="bi bi-people me-2"></i>View All Clients
                    </Link>
                    <button 
                      className="btn btn-success"
                      onClick={() => setShowProgressReport(true)}
                    >
                      <i className="bi bi-graph-up me-2"></i>View Progress Report
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions - Call Memos, Proposals, Meetings, Calendar, Archived Documents */}
          <div className="row mb-4">
            <div className="col-md-4 mb-3">
              <div className="card border-info h-100">
                <div className="card-header bg-info text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-telephone me-2"></i>Call Memos
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">Create and manage client call memos</p>
                  <button 
                    className="btn btn-outline-info w-100"
                    onClick={() => navigate('/call-memos')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Call Memos
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-primary h-100">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-file-earmark-check me-2"></i>Proposals
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">Create and manage business proposals</p>
                  <button 
                    className="btn btn-outline-primary w-100"
                    onClick={() => navigate('/proposals')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Proposals
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-success h-100">
                <div className="card-header bg-success text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-calendar-event me-2"></i>Meetings
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">Schedule and manage meetings</p>
                  <button 
                    className="btn btn-outline-success w-100"
                    onClick={() => navigate('/meetings')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Meetings
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-warning h-100">
                <div className="card-header bg-warning text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-calendar3 me-2"></i>Calendar
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">View your calendar and events</p>
                  <button 
                    className="btn btn-outline-warning w-100"
                    onClick={() => navigate('/calendar')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Calendar
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-secondary h-100">
                <div className="card-header bg-secondary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-archive me-2"></i>Archived Documents
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">Access your archived documents</p>
                  <button 
                    className="btn btn-outline-secondary w-100"
                    onClick={() => navigate('/archived-documents')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Documents
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-primary h-100">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-clock-history me-2"></i>{user?.role === 'Admin' ? 'Attendance' : 'My Attendance'} {user?.role === 'Admin' ? '' : 'View My Attendance'}
                    <i className="bi bi-arrow-right me-2"></i>
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">{user?.role === 'Admin' ? 'Sign in/out and view attendance' : 'View your attendance'}</p>
                  <button 
                    className="btn btn-outline-primary w-100"
                    onClick={() => navigate('/attendance')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>{user?.role === 'Admin' ? 'View Attendance' : 'View My Attendance'}
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-info h-100">
                <div className="card-header bg-info text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-file-earmark-text me-2"></i>Requisitions
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">Create and manage requisitions</p>
                  <button 
                    className="btn btn-outline-info w-100"
                    onClick={() => navigate('/requisitions')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Requisitions
                  </button>
                </div>
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="card border-success h-100">
                <div className="card-header bg-success text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-bullseye me-2"></i>Targets
                  </h5>
                </div>
                <div className="card-body">
                  <p className="card-text">View and manage targets</p>
                  <button 
                    className="btn btn-outline-success w-100"
                    onClick={() => navigate('/targets')}
                  >
                    <i className="bi bi-arrow-right me-2"></i>View Targets
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="row mb-4">
            <div className="col-md-6 mb-3">
              <div className="card">
                <div className="card-header">
                  <h5 className="mb-0">Staff Distribution</h5>
                </div>
                <div className="card-body">
                  {getStaffChartData() && <Pie data={getStaffChartData()} />}
                </div>
              </div>
            </div>
            <div className="col-md-6 mb-3">
              <div className="card">
                <div className="card-header">
                  <h5 className="mb-0">Reports Status</h5>
                </div>
                <div className="card-body">
                  {getReportsChartData() && <Pie data={getReportsChartData()} />}
                </div>
              </div>
            </div>
          </div>

        </>
      )}

      {/* Staff Dashboard */}
      {user?.role === 'Staff' && stats && (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Reports</h5>
                <p className="card-text">
                  <strong>Pending:</strong> {stats.myReports?.pending || 0}<br />
                  <strong>Total:</strong> {stats.myReports?.total || 0}
                </p>
                <Link to="/reports" className="btn btn-primary">
                  View Reports
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">Clients</h5>
                <p className="card-text">
                  <strong>Total Clients:</strong> {stats.clients?.total || 0}
                </p>
                <Link to="/clients" className="btn btn-primary">
                  Manage Clients
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card border-info">
              <div className="card-body">
                <h5 className="card-title">
                  <i className="bi bi-telephone me-2"></i>Call Memos
                </h5>
                <p className="card-text">Create and manage call memos</p>
                <button 
                  className="btn btn-outline-info w-100"
                  onClick={() => navigate('/call-memos')}
                >
                  View Call Memos
                </button>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card border-primary">
              <div className="card-body">
                <h5 className="card-title">
                  <i className="bi bi-file-earmark-check me-2"></i>Proposals
                </h5>
                <p className="card-text">Create and manage proposals</p>
                <button 
                  className="btn btn-outline-primary w-100"
                  onClick={() => navigate('/proposals')}
                >
                  View Proposals
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/*remove Human Resources Department Head Dashboard*/}
      {user?.role === 'Admin' && stats && (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Attendance</h5>
                <p className="card-text">
                  <strong>Pending:</strong> {stats.myAttendance?.pending || 0}<br />
                  <strong>Approved:</strong> {stats.myAttendance?.approved || 0}<br />
                  <strong>Not Signed In:</strong> {stats.myAttendance?.notSignedIn || 0}
                </p>
                <Link to="/attendance" className="btn btn-primary">
                  View Staff Attendance
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Requisitions</h5>
                <p className="card-text">
                  <strong>Pending:</strong> {stats.myRequisitions?.pending || 0}<br />
                  <strong>Approved:</strong> {stats.myRequisitions?.approved || 0}<br />
                  <strong>Rejected:</strong> {stats.myRequisitions?.rejected || 0}
                </p>
                <Link to="/requisitions" className="btn btn-primary">
                  View Requisitions
                </Link>  
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Targets</h5>
                <p className="card-text">
                  <strong>Total Targets:</strong> {stats.myTargets?.total || 0}<br />
                  <strong>Pending:</strong> {stats.myTargets?.pending || 0}<br />
                  <strong>Approved:</strong> {stats.myTargets?.approved || 0}<br />
                  <strong>Rejected:</strong> {stats.myTargets?.rejected || 0}
                </p>
                <Link to="/targets" className="btn btn-primary">
                  View Targets
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Reports</h5>
                <p className="card-text">
                  <strong>Pending:</strong> {stats.myReports?.pending || 0}<br />
                  <strong>Total:</strong> {stats.myReports?.total || 0}
                </p>
                <Link to="/reports" className="btn btn-primary">
                  View Reports
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Clients</h5>
                <p className="card-text">
                  <strong>Total Clients:</strong> {stats.myClients?.total || 0}
                </p>
                <Link to="/clients" className="btn btn-primary">
                  View Clients
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Call Memos</h5>
                <p className="card-text">
                  <strong>Total Call Memos:</strong> {stats.myCallMemos?.total || 0}
                </p>
                <Link to="/call-memos" className="btn btn-primary">
                  View Call Memos
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}  
      {/* Student Dashboard */}
      {user?.role === 'Student' && stats && (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">My Enrollments</h5>
                <p className="card-text">
                  <strong>Courses:</strong> {stats.enrollments || 0}
                </p>
                <Link to="/academy" className="btn btn-primary">
                  View Courses
                </Link>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">Certificates</h5>
                <p className="card-text">
                  <strong>Earned:</strong> {stats.certificates || 0}
                </p>
                <Link to="/academy" className="btn btn-primary">
                  View Certificates
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Report Modal */}
      {showProgressReport && (
        <ProgressReport
          onClose={() => {
            setShowProgressReport(false);
            fetchProgressStats();
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;

