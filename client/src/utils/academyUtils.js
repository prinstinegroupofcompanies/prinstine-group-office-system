/**
 * Utility functions for Academy module permissions
 */

/**
 * Check if a user is Academy staff (can add/edit/view courses, students, instructors)
 * This mirrors the backend isAcademyStaff logic
 * @param {Object} user - User object from auth context
 * @returns {boolean} - True if user is Academy staff
 */
export const isAcademyStaff = (user) => {
  if (!user) return false;
  
  // Admin always has access
  if (user.role === 'Admin') {
    return true;
  }

  if (user.role === 'Instructor') {
    return true;
  }
  
  // Explicit email allowlist: Academy coordinators and Academy Head
  const userEmail = (user.email || '').toLowerCase().trim();
  const academyCoordinatorEmails = [
    'samsonbryant89@gmail.com',
    'cvulu@prinstinegroup.org',
    'cvulue@prinstinegroup.org',
    'marjorie@prinstinegroup.org'
  ];
  const academyHeadEmails = ['fwallace@prinstinegroup.org'];
  if (academyCoordinatorEmails.includes(userEmail) || academyHeadEmails.includes(userEmail)) {
    return true;
  }
  
  // Check if DepartmentHead manages Academy or Marketing department
  if (user.role === 'DepartmentHead') {
    if (user.academyAccess === true) return true;
    const department = (user.department || '').toLowerCase();
    if (department.includes('academy') || department.includes('elearning') || department.includes('e-learning') || department.includes('marketing')) {
      return true;
    }
  }
  
  // Check if Staff belongs to Academy department or is Assistant Academy Coordinator
  if (user.role === 'Staff') {
    const department = (user.department || '').toLowerCase();
    const position = (user.position || '').toLowerCase();
    
    // Check if staff is in Academy department
    if (department.includes('academy') || department.includes('elearning') || department.includes('e-learning')) {
      return true;
    }
    
    // Also check if position title indicates Academy Coordinator
    if (position.includes('academy') && position.includes('coordinator')) {
      return true;
    }
  }
  
  return false;
};

/**
 * Check if user can approve academy entries (Admin only)
 * @param {Object} user - User object from auth context
 * @returns {boolean} - True if user can approve
 */
export const canApproveAcademy = (user) => {
  return user?.role === 'Admin';
};

