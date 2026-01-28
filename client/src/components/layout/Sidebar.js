/* Sidebar.js - Fixed version */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import api from '../../config/api';
import { getSocket } from '../../config/socket';
import './Sidebar.css';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

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
     FINANCE ACCESS CHECK - Updated
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
     STAFF MANAGEMENT ACCESS (Admin, HR Dept Head, HR Officer by email)
  ========================= */
  const HR_OFFICER_EMAILS = ['samantha@prinstinegroup.org'];
  const checkStaffManagementAccess = useCallback(() => {
    if (!user) return setHasStaffManagementAccess(false);
    const email = ((user.email ?? '') + '').toLowerCase().trim();
    const role = normalizeRole(user.role);
    const ok =
      role === 'admin' ||
      role === 'humanresourcesdepartmenthead' ||
      HR_OFFICER_EMAILS.includes(email);
    setHasStaffManagementAccess(!!ok);
  }, [user]);

  /* =========================
     STUDENT PAYMENT ACCESS (Finance head, Sean, Academy head, cvulue)
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

    // Dashboard - Show appropriate dashboard based on role
    if (userRole === 'staff') {
      items.push({ path: '/staff-dashboard', label: 'Staff Dashboard', icon: 'bi-house', roles: ['Staff'] });
    } else if (userRole === 'departmenthead') {
      items.push({ path: '/department-dashboard', label: 'Department Dashboard', icon: 'bi-building', roles: ['DepartmentHead'] });
    } else {
      // Admin and other roles see main dashboard
      items.push({ path: '/dashboard', label: 'Dashboard', icon: 'bi-house', roles: ['Admin', 'Assistant Finance Officer'] });
    }

    // Academy Management
    items.push({ path: '/academy', label: 'Academy Management', icon: 'bi-mortarboard', roles: ['Admin', 'DepartmentHead', 'Staff'], academy: true });

    // Finance menus for Admin, Finance Head, Assistant Finance Officer
    items.push(
      { path: '/finance/petty-cash', label: 'Petty Cash', icon: 'bi-cash', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true },
      { path: '/finance/assets', label: 'Asset Registry', icon: 'bi-box', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true },
      { path: '/finance-reports', label: 'Finance', icon: 'bi-cash-stack', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true }
    );

    // Common menus for all roles
    items.push(
      { path: '/communications', label: 'Communications', icon: 'bi-chat', roles: ['*'] },
      { path: '/calendar', label: 'Calendar', icon: 'bi-calendar3', roles: ['*'] },
      { path: '/attendance', label: 'Attendance', icon: 'bi-clock', roles: ['*'] }
    );

    // Student Payments
    items.push({ path: '/student-payments', label: 'Student Payments', icon: 'bi-credit-card', roles: ['Admin'], studentPayment: true });

    // Admin-only menus
    if (userRole === 'admin') {
      items.push(
        { path: '/users', label: 'Users', icon: 'bi-people', roles: ['Admin'] },
        { path: '/departments', label: 'Departments', icon: 'bi-diagram-3', roles: ['Admin'] }
      );
    }

    // Staff Management (Admin, HR Dept Head, HR Officer)
    items.push({ path: '/staff', label: 'Staff', icon: 'bi-person-badge', roles: ['Admin', 'HumanResourcesDepartmentHead'], staffManagement: true });

    return items;
  }, [user]);

  /* =========================
     RENDER
  ========================= */

  return (
    <aside className="sidebar">
      <ul>
        {menuItems
          .filter(item => {
            // Check role access
            let roleOk = false;
            if (item.staffManagement) {
              roleOk = hasStaffManagementAccess;
            } else if (item.studentPayment) {
              roleOk = hasStudentPaymentAccess;
            } else {
              roleOk = hasRole(item.roles);
            }
            
            // Check additional access requirements
            const academyOk = !item.academy || hasAcademyAccess;
            const financeOk = !item.finance || hasFinanceAccess;
            
            return roleOk && academyOk && financeOk;
          })
          .map(item => {
            // Determine if this menu item is active
            const isActive = location.pathname === item.path ||
              (item.path === '/staff-dashboard' && location.pathname === '/dashboard' && normalizeRole(user?.role) === 'staff') ||
              (item.path === '/department-dashboard' && location.pathname === '/dashboard' && normalizeRole(user?.role) === 'departmenthead');
            
            return (
              <li key={item.path} className={isActive ? 'active' : ''}>
                <Link to={item.path}>
                  <i className={`bi ${item.icon}`} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
      </ul>

      <button onClick={logout} className="logout-btn">
        <i className="bi bi-box-arrow-right" /> Logout
      </button>
    </aside>
  );
};

export default Sidebar;
