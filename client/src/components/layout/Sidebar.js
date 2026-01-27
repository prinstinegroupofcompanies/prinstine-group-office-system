/* Sidebar.js - Fixed version */

import React, { useState, useEffect, useMemo } from 'react';
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
  const [hasAcademyAccess, setHasAcademyAccess] = useState(false);

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

  const checkAcademyAccess = async () => {
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
  };

  /* =========================
     FINANCE ACCESS CHECK
  ========================= */

  const checkFinanceAccess = async () => {
    if (!user) return setHasFinanceAccess(false);

    const userRole = normalizeRole(user.role);

    if (userRole === 'admin') return setHasFinanceAccess(true);

    try {
      if (['departmenthead', 'assistant finance officer'].includes(userRole)) {
        const res = await api.get('/departments');
        const finance = res.data.departments.find(d =>
          (d.manager_id === user.id ||
            d.head_email?.toLowerCase().trim() === user.email.toLowerCase().trim()) &&
          d.name?.toLowerCase().includes('finance')
        );
        return setHasFinanceAccess(!!finance);
      }

      if (userRole === 'staff') {
        const res = await api.get('/staff');
        const me = res.data.staff.find(s => s.user_id === user.id);
        return setHasFinanceAccess(!!me?.department?.toLowerCase().includes('finance'));
      }
    } catch (err) {
      console.error('Finance access check failed:', err);
    }

    setHasFinanceAccess(false);
  };

  /* =========================
     NOTIFICATIONS
  ========================= */

  const fetchUnreadCount = async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      setUnreadCount(res.data.count || 0);
    } catch {}
  };

  const fetchUnreadFromAdmin = async () => {
    try {
      const res = await api.get('/notifications?limit=100');
      const unread = res.data.notifications.filter(
        n => !n.is_read && n.sender_role === 'Admin'
      );
      setUnreadFromAdmin(unread.length);
    } catch {}
  };

  /* =========================
     EFFECTS
  ========================= */

  useEffect(() => {
    if (!user) return;

    fetchUnreadCount();
    checkFinanceAccess();
    checkAcademyAccess();

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
  }, [user]);

  /* =========================
     MENU CONFIG
  ========================= */

  const menuItems = useMemo(() => [
    { path: '/dashboard', label: 'Dashboard', icon: 'bi-house', roles: ['Admin', 'DepartmentHead', 'Staff', 'Assistant Finance Officer'] },
    { path: '/staff-dashboard', label: 'Staff Dashboard', icon: 'bi-house', roles: ['Staff'] },
    { path: '/department-dashboard', label: 'Department Dashboard', icon: 'bi-building', roles: ['DepartmentHead'] },

    { path: '/academy', label: 'Academy Management', icon: 'bi-mortarboard', roles: ['Admin', 'DepartmentHead', 'Staff'], academy: true },

    // Finance menus for Admin, Finance Head, Assistant Finance Officer
    { path: '/petty-cash', label: 'Petty Cash', icon: 'bi-cash', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true },
    { path: '/asset-registry', label: 'Asset Registry', icon: 'bi-box', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true },
    { path: '/finance-reports', label: 'Finance', icon: 'bi-cash-stack', roles: ['Admin', 'DepartmentHead', 'Assistant Finance Officer'], finance: true },

    { path: '/communications', label: 'Communications', icon: 'bi-chat', roles: ['*'] },
    { path: '/calendar', label: 'Calendar', icon: 'bi-calendar3', roles: ['*'] },
    { path: '/attendance', label: 'Attendance', icon: 'bi-clock', roles: ['*'] },

    { path: '/users', label: 'Users', icon: 'bi-people', roles: ['Admin'] },
    { path: '/departments', label: 'Departments', icon: 'bi-diagram-3', roles: ['Admin'] },
  ], []);

  /* =========================
     RENDER
  ========================= */

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <ul>
        {menuItems
          .filter(item =>
            hasRole(item.roles) &&
            (!item.academy || hasAcademyAccess) &&
            (!item.finance || hasFinanceAccess)
          )
          .map(item => (
            <li key={item.path} className={location.pathname === item.path ? 'active' : ''}>
              <Link to={item.path}>
                <i className={`bi ${item.icon}`} />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
      </ul>

      <button onClick={logout} className="logout-btn">
        <i className="bi bi-box-arrow-right" /> Logout
      </button>
    </aside>
  );
};

export default Sidebar;
