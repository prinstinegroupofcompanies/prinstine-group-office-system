import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../config/api';
import { getSocket } from '../../config/socket';
import './Sidebar.css';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadFromAdmin, setUnreadFromAdmin] = useState(0);
  const [hasFinanceAccess, setHasFinanceAccess] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      checkFinanceAccess();
      if (user.role === 'DepartmentHead') {
        fetchUnreadFromAdmin();
      }

      const socket = getSocket();
      if (socket) {
        const handleNotification = (notification) => {
          fetchUnreadCount();
          if (user.role === 'DepartmentHead' && notification.senderRole === 'Admin') {
            fetchUnreadFromAdmin();
          }
        };

        socket.on('notification', handleNotification);

        const interval = setInterval(() => {
          fetchUnreadCount();
          if (user.role === 'DepartmentHead') {
            fetchUnreadFromAdmin();
          }
        }, 30000);

        return () => {
          socket.off('notification', handleNotification);
          clearInterval(interval);
        };
      }
    }
  }, [user]);

  const fetchUnreadCount = async () => {
    try {
      const response = await api.get('/notifications/unread-count');
      setUnreadCount(response.data.count || 0);
    } catch (error) {
      if (error.code !== 'ERR_NETWORK' && error.code !== 'ERR_INTERNET_DISCONNECTED' && error.message !== 'Network Error') {
        console.error('Error fetching unread count:', error);
      }
    }
  };

  const fetchUnreadFromAdmin = async () => {
    try {
      const response = await api.get('/notifications?limit=100');
      const notifications = response.data.notifications || [];
      const fromAdmin = notifications.filter(n => !n.is_read && n.sender_role === 'Admin');
      setUnreadFromAdmin(fromAdmin.length);
    } catch (error) {
      console.error('Error fetching unread from admin:', error);
    }
  };

  const checkFinanceAccess = async () => {
    try {
      if (user?.role === 'Admin') {
        setHasFinanceAccess(true);
        return;
      }

      if (user?.role === 'DepartmentHead') {
        const response = await api.get('/departments');
        const userEmailLower = user.email.toLowerCase().trim();
        const financeDept = response.data.departments.find(d =>
          (d.manager_id === user.id || (d.head_email && d.head_email.toLowerCase().trim() === userEmailLower)) &&
          d.name && d.name.toLowerCase().includes('finance')
        );
        if (financeDept) {
          setHasFinanceAccess(true);
          return;
        }
      }

      if (user?.role === 'Staff') {
        const response = await api.get('/staff');
        const staffList = response.data.staff || [];
        const myStaff = staffList.find(s => s.user_id === user.id);
        if (myStaff && myStaff.department && myStaff.department.toLowerCase().includes('finance')) {
          setHasFinanceAccess(true);
          return;
        }
      }

      setHasFinanceAccess(false);
    } catch (error) {
      console.error('Error checking finance access:', error);
      setHasFinanceAccess(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const isActive = (path) => location.pathname === path;

  const menuItems = [
    // Dashboards Section
    { path: '/dashboard', label: 'Dashboard', icon: 'bi-house-door', roles: ['Admin'], section: 'dashboards' },
    { path: '/staff-dashboard', label: 'Staff Dashboard', icon: 'bi-house-door', roles: ['Staff'], section: 'dashboards' },
    { path: '/department-dashboard', label: 'Department Dashboard', icon: 'bi-building', roles: ['DepartmentHead'], section: 'dashboards' },

    // Reports Section
    { path: '/department-report-history', label: 'Report History', icon: 'bi-clock-history', roles: ['DepartmentHead'], section: 'reports' },
    { path: '/my-reports-history', label: 'My Reports History', icon: 'bi-journal-text', roles: ['*'], section: 'reports' },
    { path: '/staff-client-reports', label: 'Client Reports', icon: 'bi-file-earmark-text', roles: ['Staff'], section: 'reports' },
    { path: '/department-reports', label: 'Department Reports', icon: 'bi-file-earmark-text', roles: ['Admin'], section: 'reports' },
    { path: '/reports', label: 'Reports', icon: 'bi-file-text', roles: ['Admin', 'Staff'], section: 'reports' },
    { path: '/call-memos', label: 'Call Memos', icon: 'bi-telephone', roles: ['*'], section: 'reports' },
    { path: '/proposals', label: 'Proposals', icon: 'bi-file-earmark-check', roles: ['*'], section: 'reports' },

    // Communications Section
    { path: '/notifications-view', label: 'Notifications', icon: 'bi-bell-fill', roles: ['DepartmentHead', 'Admin', 'Staff'], section: 'communications' },
    { path: '/communications', label: 'Communications', icon: 'bi-chat-left-text', roles: ['*'], section: 'communications' },
    { path: '/support-tickets', label: 'Support Tickets', icon: 'bi-ticket-perforated', roles: ['DepartmentHead', 'Admin'], section: 'communications' },
    { path: '/meetings', label: 'Meetings', icon: 'bi-calendar-event', roles: ['*'], section: 'communications' },
    { path: '/calendar', label: 'Calendar', icon: 'bi-calendar3', roles: ['*'], section: 'communications' },
    { path: '/archived-documents', label: 'Archived Documents', icon: 'bi-archive', roles: ['*'], section: 'communications' },
    { path: '/attendance', label: 'Attendance', icon: 'bi-clock-history', roles: ['*'], section: 'communications' },
    { path: '/requisitions', label: 'Requisitions', icon: 'bi-file-earmark-text', roles: ['*'], section: 'communications' },
    { path: '/targets', label: 'Targets', icon: 'bi-bullseye', roles: ['*'], section: 'communications' },
    { path: '/appraisals', label: 'Appraisals', icon: 'bi-star-fill', roles: ['*'], section: 'communications' },

    // Management Section
    { path: '/notifications', label: 'Send Notifications', icon: 'bi-bell', roles: ['Admin'], section: 'management' },
    { path: '/users', label: 'Users', icon: 'bi-people-fill', roles: ['Admin'], section: 'management' },
    { path: '/departments', label: 'Departments', icon: 'bi-building', roles: ['Admin'], section: 'management' },
    { path: '/staff', label: 'Staff', icon: 'bi-people', roles: ['Admin'], emails: ['samantha@prinstinegroup.org'], section: 'management' },
    { path: '/clients', label: 'Clients', icon: 'bi-person-badge', roles: ['Admin', 'Staff', 'DepartmentHead'], section: 'management' },
    { path: '/partners', label: 'Partners', icon: 'bi-handshake', roles: ['Admin'], section: 'management' },

    // Finance Section
    { path: '/finance/petty-cash', label: 'Petty Cash Ledger', icon: 'bi-cash-coin', roles: ['Admin', 'DepartmentHead', 'Staff'], requiresFinanceAccess: true, section: 'finance' },
    { path: '/finance/assets', label: 'Asset Registry', icon: 'bi-box-seam', roles: ['Admin', 'DepartmentHead', 'Staff'], requiresFinanceAccess: true, section: 'finance' },

    // Academy Section
    { path: '/academy', label: 'Academy', icon: 'bi-book', roles: ['Admin', 'Instructor', 'Student', 'DepartmentHead', 'Staff'], section: 'academy' },
    { path: '/certificates', label: 'Certificates', icon: 'bi-award', roles: ['Admin'], section: 'academy' },
    // Student Payment Management
    { path: '/student-payments', label: 'Student Payments', icon: 'bi-cash-coin', roles: ['Admin', 'DepartmentHead', 'Staff'], section: 'student-payments' },
    // Profile Section
    { path: '/profile', label: 'Profile', icon: 'bi-person-circle', roles: ['Admin', 'Staff', 'Instructor', 'Student', 'Client', 'Partner', 'DepartmentHead'], section: 'profile' }
  ];

  // Filter menu items based on role, email, and special conditions
  const filteredMenuItems = menuItems.filter(item => {
    const userEmail = user?.email?.toLowerCase();

    // Role OR email match OR wildcard '*'
    const allowed =
      item.roles.includes('*') ||
      item.roles.includes(user?.role) ||
      (item.emails && item.emails.map(e => e.toLowerCase()).includes(userEmail));

    if (!allowed) return false;

    // Finance routes
    if (item.requiresFinanceAccess) {
      if (user?.role === 'Admin') return true;
      return hasFinanceAccess;
    }

    // Academy rules
    if (item.path === '/academy' && user?.role === 'DepartmentHead') {
      const excludedEmails = ['jtokpa@prinstinegroup.org', 'cmoore@prinstinegroup.org', 'wbuku@prinstinegroup.org', 'eksackie@prinstinegroup.org'];
      if (excludedEmails.includes(userEmail)) return false;
    }

    if (item.path === '/academy' && user?.role === 'Staff') {
      const academyStaffEmails = ['cvulue@prinstinegroup.org', 'samsonbryant89@gmail.com'];
      if (!academyStaffEmails.includes(userEmail)) return false;
    }

    return true;
  });

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img 
            src="/prinstine-logo.png" 
            alt="Prinstine Group" 
            className="sidebar-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              const fallback = e.target.nextSibling;
              if (fallback) fallback.style.display = 'block';
            }}
          />
          <i className="bi bi-building sidebar-logo-fallback"></i>
          {!collapsed && <span className="sidebar-brand-text">Prinstine Group</span>}
        </div>
        <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
          <i className={`bi bi-chevron-${collapsed ? 'right' : 'left'}`}></i>
        </button>
      </div>

      <nav className="sidebar-nav">
        <ul className="sidebar-menu">
          {(() => {
            const sections = {
              dashboards: { label: 'Dashboards', items: [] },
              reports: { label: 'Reports', items: [] },
              communications: { label: 'Communications', items: [] },
              management: { label: 'Management', items: [] },
              finance: { label: 'Finance', items: [] },
              academy: { label: 'Academy', items: [] },
              studentPayments: { label: 'Student Payments', items: [] },
              profile: { label: 'Profile', items: [] },
              other: { label: '', items: [] }
            };

            filteredMenuItems.forEach(item => {
              const section = item.section || 'other';
              if (sections[section]) sections[section].items.push(item);
              else sections.other.items.push(item);
            });

            const shouldShowSections = user?.role === 'DepartmentHead' || user?.role === 'Admin';

            return Object.entries(sections).map(([sectionKey, section]) => {
              if (section.items.length === 0) return null;

              return (
                <React.Fragment key={sectionKey}>
                  {shouldShowSections && section.label && !collapsed && (
                    <li className="sidebar-section-header">
                      <span className="sidebar-section-label">{section.label}</span>
                    </li>
                  )}
                  {section.items.map(item => {
                    const showBadge = item.path === '/notifications-view' &&
                      ((user?.role === 'DepartmentHead' && unreadFromAdmin > 0) ||
                      (user?.role !== 'DepartmentHead' && unreadCount > 0));
                    const badgeCount = item.path === '/notifications-view' && user?.role === 'DepartmentHead'
                      ? unreadFromAdmin
                      : unreadCount;

                    return (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          className={`sidebar-menu-item ${isActive(item.path) ? 'active' : ''}`}
                          title={collapsed ? item.label : ''}
                        >
                          <i className={`bi ${item.icon}`}></i>
                          {!collapsed && (
                            <>
                              <span>{item.label}</span>
                              {showBadge && <span className="badge bg-danger rounded-pill ms-auto">{badgeCount}</span>}
                            </>
                          )}
                          {collapsed && showBadge && <span className="badge bg-danger rounded-pill position-absolute top-0 start-100 translate-middle">{badgeCount}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </React.Fragment>
              );
            });
          })()}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            <i className="bi bi-person-circle"></i>
          </div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || 'User'}</div>
              <div className="sidebar-user-role">{user?.role}</div>
            </div>
          )}
        </div>
        <button className="sidebar-logout" onClick={handleLogout} title={collapsed ? 'Logout' : ''}>
          <i className="bi bi-box-arrow-right"></i>
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
