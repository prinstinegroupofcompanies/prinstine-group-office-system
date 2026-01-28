/* Sidebar.js - Complete Fixed Version */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../config/api';
import { getSocket } from '../../config/socket';
import './Sidebar.css';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadFromAdmin, setUnreadFromAdmin] = useState(0);
  const [hasFinanceAccess, setHasFinanceAccess] = useState(false);
  const [hasAcademyAccess, setHasAcademyAccess] = useState(false);
  const [hasStaffManagementAccess, setHasStaffManagementAccess] = useState(false);
  const [hasStudentPaymentAccess, setHasStudentPaymentAccess] = useState(false);

  /* =========================
     ROLE HELPERS
  ========================= */

  const normalizeRole = (role) => role?.trim().toLowerCase();

  const hasRole = (roles = []) => {
    if (!user) return false;
    if (roles.includes('*')) return true;
    const userRole = normalizeRole(user.role);
    return roles.some(r => normalizeRole(r) === userRole);
  };

  /* =========================
     ACADEMY ACCESS CHECK
  ========================= */

  const checkAcademyAccess = useCallback(async () => {
    if (!user) return false;

    if (normalizeRole(user.role) === 'admin') return setHasAcademyAccess(true);

    if (['cvulue@prinstinegroup.org'].includes(user.email?.toLowerCase().trim())) {
      return setHasAcademyAccess(true);
    }

    try {
      if (normalizeRole(user.role) === 'departmenthead') {
        const res = await api.get('/departments');
        const dept = res.data.departments.find(d =>
          (d.manager_id === user.id ||
            (d.head_email && d.head_email.toLowerCase().trim() === user.email.toLowerCase().trim())) &&
          d.name?.toLowerCase().match(/academy|elearning|e-learning|marketing/)
        );
        if (dept) return setHasAcademyAccess(true);
      }

      if (normalizeRole(user.role) === 'staff') {
        const res = await api.get('/staff');
        const me = res.data.staff.find(s => s.user_id === user.id);
        if (
          me?.department?.toLowerCase().match(/academy|elearning|e-learning/) ||
          me?.position?.toLowerCase().includes('academy')
        ) {
          return setHasAcademyAccess(true);
        }
      }
    } catch (err) {
      console.error('Academy access check failed:', err);
    }

    setHasAcademyAccess(false);
  }, [user]);

  /* =========================
     FINANCE ACCESS CHECK
  ========================= */

  const checkFinanceAccess = useCallback(async () => {
    if (!user) return setHasFinanceAccess(false);

    const userRole = normalizeRole(user.role);
    const userEmail = ((user.email ?? '') + '').toLowerCase().trim();
    const financeEmails = ['sean@prinstinegroup.org'];

    if (userRole === 'admin' || financeEmails.includes(userEmail)) {
      return setHasFinanceAccess(true);
    }

    try {
      if (['departmenthead', 'assistant finance officer'].includes(userRole)) {
        const res = await api.get('/departments');
        const finance = res.data.departments?.find(d =>
          (d.manager_id === user.id ||
            (d.head_email ?? '').toLowerCase().trim() === userEmail) &&
          (d.name ?? '').toLowerCase().includes('finance')
        );
        return setHasFinanceAccess(!!finance);
      }

      if (userRole === 'staff') {
        if (financeEmails.includes(userEmail)) return setHasFinanceAccess(true);
        const res = await api.get('/staff');
        const me = (res.data.staff || []).find(s => s.user_id === user.id);
        return setHasFinanceAccess(!!me?.department?.toLowerCase().includes('finance'));
      }
    } catch (err) {
      console.error('Finance access check failed:', err);
    }

    setHasFinanceAccess(false);
  }, [user]);

  /* =========================
     STAFF MANAGEMENT ACCESS
  ========================= */
  const HR_OFFICER_EMAILS = ['samantha@prinstinegroup.org'];
  const checkStaffManagementAccess = useCallback(() => {
    if (!user) return setHasStaffManagementAccess(false);
    const email = ((user.email ?? '') + '').toLowerCase().trim();
    const role = normalizeRole(user.role);
    const ok =
      role === 'admin' ||
      role === 'humanresourcesdepartmenthead' ||
      user.role === 'HumanResourcesDepartmentHead' ||
      HR_OFFICER_EMAILS.includes(email);
    setHasStaffManagementAccess(!!ok);
  }, [user]);

  /* =========================
     STUDENT PAYMENT ACCESS
  ========================= */
  const STUDENT_PAYMENT_EMAILS = ['sean@prinstinegroup.org', 'cvulue@prinstinegroup.org'];
  const checkStudentPaymentAccess = useCallback(async () => {
    if (!user) return setHasStudentPaymentAccess(false);
    const email = ((user.email ?? '') + '').toLowerCase().trim();
    const role = normalizeRole(user.role);
    if (role === 'admin' || STUDENT_PAYMENT_EMAILS.includes(email)) {
      return setHasStudentPaymentAccess(true);
    }
    try {
      if (role === 'departmenthead') {
        const res = await api.get('/departments');
        const dept = (res.data.departments || []).find(
          (d) =>
            (d.manager_id === user.id || (d.head_email ?? '').toLowerCase().trim() === email) &&
            (d.name ?? '').toLowerCase().match(/finance|academy|elearning/)
        );
        return setHasStudentPaymentAccess(!!dept);
      }
    } catch (err) {
      console.error('Student payment access check failed:', err);
    }
    setHasStudentPaymentAccess(false);
  }, [user]);

  /* =========================
     NOTIFICATIONS
  ========================= */

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      setUnreadCount(res.data.count || 0);
    } catch {}
  }, []);

  const fetchUnreadFromAdmin = useCallback(async () => {
    try {
      const res = await api.get('/notifications?limit=100');
      const unread = res.data.notifications.filter(
        n => !n.is_read && n.sender_role === 'Admin'
      );
      setUnreadFromAdmin(unread.length);
    } catch {}
  }, []);

  /* =========================
     EFFECTS
  ========================= */

  useEffect(() => {
    if (!user) return;

    fetchUnreadCount();
    checkFinanceAccess();
    checkAcademyAccess();
    checkStaffManagementAccess();
    checkStudentPaymentAccess();

    if (normalizeRole(user.role) === 'departmenthead') {
      fetchUnreadFromAdmin();
    }

    const socket = getSocket();
    if (!socket) return;

    const handler = () => {
      fetchUnreadCount();
      if (normalizeRole(user.role) === 'departmenthead') fetchUnreadFromAdmin();
    };

    socket.on('notification', handler);

    return () => socket.off('notification', handler);
  }, [user, fetchUnreadCount, checkFinanceAccess, checkAcademyAccess, checkStaffManagementAccess, checkStudentPaymentAccess, fetchUnreadFromAdmin]);

  /* =========================
     MENU CONFIG
  ========================= */

  const menuItems = useMemo(() => {
    if (!user) return [];
    
    const userRole = normalizeRole(user.role);
    const items = [];

    const pushSection = (label) => items.push({ type: 'section', label });

    // Dashboard - Show appropriate dashboard based on role
    pushSection('Main');
    if (userRole === 'student') {
      items.push({ path: '/student', label: 'Student Portal', icon: 'bi-mortarboard', roles: ['Student'], studentPortal: true });
    } else if (userRole === 'instructor') {
      items.push({ path: '/academy', label: 'Dashboard', icon: 'bi-house', roles: ['Instructor'], instructorMain: true });
    } else if (userRole === 'staff') {
      items.push({ path: '/staff-dashboard', label: 'Staff Dashboard', icon: 'bi-house', roles: ['Staff'] });
    } else if (userRole === 'departmenthead') {
      items.push({ path: '/department-dashboard', label: 'Department Dashboard', icon: 'bi-building', roles: ['DepartmentHead'] });
    } else {
      items.push({ path: '/dashboard', label: 'Dashboard', icon: 'bi-house', roles: ['Admin'] });
    }

    pushSection('Work');
    // Common work modules
    items.push(
      { path: '/clients', label: 'Clients', icon: 'bi-person-badge', roles: ['Admin', 'Staff', 'DepartmentHead'] },
      { path: '/reports', label: 'Reports', icon: 'bi-file-text', roles: ['Admin', 'Staff', 'DepartmentHead'] },
      { path: '/academy', label: 'Academy', icon: 'bi-mortarboard', roles: ['Admin', 'DepartmentHead', 'Staff', 'Instructor'], academy: true, instructorAcademy: true },
      { path: '/attendance', label: 'Attendance', icon: 'bi-clock', roles: ['Admin', 'Staff', 'DepartmentHead'] },
      { path: '/requisitions', label: 'Requisitions', icon: 'bi-clipboard-check', roles: ['Admin', 'Staff', 'DepartmentHead'] },
      { path: '/targets', label: 'Targets', icon: 'bi-bullseye', roles: ['Admin', 'Staff', 'DepartmentHead'] }
    );

    // Finance menus
    pushSection('Finance');
    items.push(
      { path: '/finance/petty-cash', label: 'Petty Cash', icon: 'bi-cash', roles: ['Admin', 'DepartmentHead'], finance: true },
      { path: '/finance/petty-cash-ledger', label: 'Petty Cash Ledger', icon: 'bi-journal-text', roles: ['Admin', 'DepartmentHead'], finance: true },
      { path: '/finance/assets', label: 'Asset Registry', icon: 'bi-box', roles: ['Admin', 'DepartmentHead'], finance: true }
    );

    // Common menus for all roles
    pushSection('Communication');
    items.push(
      { path: '/communications', label: 'Communications', icon: 'bi-chat', roles: ['*'] },
      { path: '/calendar', label: 'Calendar', icon: 'bi-calendar3', roles: ['*'] },
      { path: '/notifications-view', label: 'Notifications', icon: 'bi-bell', roles: ['*'], badge: userRole === 'departmenthead' ? unreadFromAdmin : unreadCount }
    );

    // Staff specific menus
    if (userRole === 'staff') {
      pushSection('Staff');
      items.push(
        { path: '/staff-client-reports', label: 'Client Reports', icon: 'bi-file-earmark-text', roles: ['Staff'] },
        { path: '/my-reports-history', label: 'My Reports', icon: 'bi-file-text', roles: ['Staff'] }
      );
    }

    // Department Head specific menus
    if (userRole === 'departmenthead') {
      pushSection('Department');
      items.push(
        { path: '/department-report-history', label: 'Department Reports', icon: 'bi-file-earmark-text', roles: ['DepartmentHead'] },
        { path: '/meetings', label: 'Meetings', icon: 'bi-calendar-event', roles: ['DepartmentHead'] },
        { path: '/call-memos', label: 'Call Memos', icon: 'bi-telephone', roles: ['DepartmentHead'] },
        { path: '/proposals', label: 'Proposals', icon: 'bi-file-earmark-check', roles: ['DepartmentHead'] },
        { path: '/archived-documents', label: 'Archived Documents', icon: 'bi-archive', roles: ['DepartmentHead'] }
      );
    }

    // Student Payments
    items.push({ path: '/student-payments', label: 'Student Payments', icon: 'bi-credit-card', roles: ['Admin'], studentPayment: true });

    // Admin-only menus
    if (userRole === 'admin') {
      pushSection('Admin');
      items.push(
        { path: '/users', label: 'Users', icon: 'bi-people', roles: ['Admin'] },
        { path: '/departments', label: 'Departments', icon: 'bi-diagram-3', roles: ['Admin'] },
        { path: '/department-reports', label: 'Department Reports', icon: 'bi-file-earmark-text', roles: ['Admin'] },
        { path: '/notifications', label: 'Notification Management', icon: 'bi-bell-fill', roles: ['Admin'] },
        { path: '/certificates', label: 'Certificates', icon: 'bi-award', roles: ['Admin'] },
        { path: '/support-tickets', label: 'Support Tickets', icon: 'bi-ticket-perforated', roles: ['Admin'] },
        { path: '/archived-documents', label: 'Archived Documents', icon: 'bi-archive', roles: ['Admin'] },
        { path: '/appraisals', label: 'Appraisals', icon: 'bi-star', roles: ['Admin'] }
      );
    }

    // Staff Management (Admin, HR Dept Head, HR Officer)
    // Note: only add staff management link if it exists for your role checks
    pushSection('Management');
    items.push({ path: '/staff', label: 'Staff Management', icon: 'bi-person-badge', roles: ['Admin', 'HumanResourcesDepartmentHead'], staffManagement: true });

    // Profile for all
    pushSection('Account');
    items.push({ path: '/profile', label: 'Profile', icon: 'bi-person', roles: ['*'] });

    return items;
  }, [user, unreadCount, unreadFromAdmin]);

  /* =========================
     RENDER
  ========================= */

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand" title="Prinstine Management System">
          <i className="bi bi-building sidebar-logo-fallback" />
          <span className="sidebar-brand-text">Prinstine</span>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`bi ${collapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} />
        </button>
      </div>

      <div className="sidebar-nav">
        <div className="sidebar-footer" style={{ borderTop: 'none' }}>
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              <i className="bi bi-person-circle" />
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || user?.email || 'User'}</div>
              <div className="sidebar-user-role">{(user?.role || '').toString()}</div>
              {(user?.department || user?.position) && (
                <div className="sidebar-user-dept small text-muted">
                  {[user.position, user.department].filter(Boolean).join(' • ')}
                </div>
              )}
            </div>
          </div>
        </div>

        <ul className="sidebar-menu">
          {menuItems
            .filter(item => {
              if (item.type === 'section') return true;
              // Check role access
              let roleOk = false;
              if (item.staffManagement) {
                roleOk = hasStaffManagementAccess;
              } else if (item.studentPayment) {
                roleOk = hasStudentPaymentAccess;
              } else if (item.finance) {
                roleOk = hasFinanceAccess;
              } else {
                roleOk = hasRole(item.roles);
              }
              
              // Check additional access requirements
              const academyOk = !item.academy || hasAcademyAccess || item.instructorAcademy === true;
              const financeOk = !item.finance || hasFinanceAccess;
              const studentPortalOk = !item.studentPortal || normalizeRole(user?.role) === 'student';
              
              return roleOk && academyOk && financeOk && studentPortalOk;
            })
            .map(item => {
              if (item.type === 'section') {
                return (
                  <li key={`section-${item.label}`} className="sidebar-section-header">
                    <span className="sidebar-section-label">{item.label}</span>
                  </li>
                );
              }
              // Determine if this menu item is active
              const isActive = location.pathname === item.path ||
                (item.path === '/staff-dashboard' && location.pathname === '/dashboard' && normalizeRole(user?.role) === 'staff') ||
                (item.path === '/department-dashboard' && location.pathname === '/dashboard' && normalizeRole(user?.role) === 'departmenthead') ||
                (item.path === '/student' && location.pathname.startsWith('/student')) ||
                (item.path === '/academy' && location.pathname.startsWith('/academy'));
              
              return (
                <li key={`${item.path}-${item.label}`}>
                  <Link to={item.path} className={`sidebar-menu-item ${isActive ? 'active' : ''}`}>
                    <i className={`bi ${item.icon}`}></i>
                    <span>{item.label}</span>
                    {item.badge > 0 && (
                      <span className="badge bg-danger ms-auto">{item.badge}</span>
                    )}
                  </Link>
                </li>
              );
            })}
        </ul>
      </div>

      <div className="sidebar-footer">
        <button onClick={logout} className="sidebar-logout">
          <i className="bi bi-box-arrow-right"></i>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
