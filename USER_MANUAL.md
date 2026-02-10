# Prinstine Management System User Manual

This manual describes the Prinstine Management System, user roles, module navigation, and approval workflows. It is written for end users and department administrators.

## 1. System Overview

The system centralizes staff operations, departmental reporting, attendance tracking, requisitions, meetings, academy management, and communications. Access to features is controlled by user role and (for some modules) additional access checks.

Key areas:
- Dashboards and role-specific workspaces
- Attendance tracking and approvals
- Department reports and staff client reports
- Requisitions and approvals
- Meetings and calendar
- Academy management and student portal
- Notifications and communications

## 2. Access and Login

- Users log in with their assigned credentials.
- Access is role-based; only features allowed for your role appear in the navigation menu.
- If a user tries to access a restricted page, the system redirects them to their appropriate dashboard.

## 3. Navigation Basics

The left sidebar organizes navigation into sections. The visible items change based on your role.

Common sections:
- Main: your dashboard entry point
- Work: clients, reports, academy, attendance, requisitions, targets
- Finance: petty cash, ledger, assets, archived documents (finance access only)
- Communication: communications, calendar, notifications
- Account: profile

Role-specific sections:
- Staff: client reports, my reports
- Department: department reports, meetings, call memos, proposals, archived documents
- Admin: users, departments, department reports, notification management, certificates, support tickets, archived documents, appraisals
- Management: staff management (Admin, HR Department Head, or HR Officer access)

## 4. User Roles and Core Functions

### Admin
- Full access to all modules
- Manage users, departments, staff, clients, partners
- Approve attendance exceptions, reports, and requisitions
- Manage notifications, certificates, appraisals, and support tickets
- Access finance modules when enabled

### Department Head
- Department dashboard and department reports
- Review and approve department reports from staff
- Review specific requisitions (especially finance-related requisitions if head of finance)
- Access meetings, call memos, proposals
- Sign in/out for attendance (subject to approval rules)

### Staff
- Staff dashboard
- Submit client reports and personal reports
- Submit requisitions and targets
- Sign in/out for attendance (subject to approval rules)

### Instructor
- Academy management and related resources

### Student
- Student portal, courses, grades, certificates, billing

### Client and Partner
- Roles exist for portal access where enabled (login access is controlled by the organization)

## 5. Core Modules (What Each Section Does)

### Dashboard
Shows a role-specific overview and quick access cards. Each role has a different dashboard page.

### Clients
Manage client records and view client details. Available to Admin, Staff, and Department Head.

### Reports
General reporting section for staff, departments, and management to review or create reports.

### Academy
Academy management, students, courses, and instructor resources.

### Attendance
Daily sign-in and sign-out records with late/early tracking and approvals.

### Requisitions
Requests for office supplies, leave, and work support. Includes a role-based approval workflow.

### Targets
Performance or task targets for staff and departments.

### Finance
Petty cash, petty cash ledger, asset registry, and archived documents (requires finance access).

### Communications and Notifications
Messages from admins and system alerts. Notifications show unread counts in the sidebar.

### Meetings
Create meetings, invite attendees, and record attendance.

### Profile
User account details and settings.

## 6. Approval Workflows

This section explains how approvals move through the system.

### 6.1 Attendance Approval

Status values: `Pending`, `Approved`, `Rejected`

Rules:
- **Sign-in**:
  - On-time sign-in is **auto-approved**.
  - Late sign-in is **Pending** and requires Admin approval.
- **Sign-out**:
  - On-time sign-out is **auto-approved** (unless the record is already rejected or the sign-in was late).
  - Early sign-out is **Pending** and requires Admin approval.

Admin actions:
- Approve or reject attendance records.
- Rejection requires notes.

### 6.2 Department Reports Approval

Status values:
- Draft
- Pending_DeptHead
- Pending
- Admin_Approved
- Admin_Rejected
- Final_Approved

Flow:
- Staff submits a department report → `Pending_DeptHead`
- Department Head approves → `Pending` (moves to Admin)
- Admin approves → `Admin_Approved` or `Final_Approved`
- Admin rejects → `Admin_Rejected`

If a Department Head submits a report directly, it skips the department head step and goes to `Pending` for Admin review.

### 6.3 Staff Client Reports Approval

Status values:
- Draft
- Submitted
- Approved / Rejected (Marketing Manager step)
- Final_Approved / Admin_Approved / Admin_Rejected

Flow:
- Staff submits client report → `Submitted`
- Marketing Manager reviews (for marketing and non-restricted departments)
- Admin final approval

Note: Finance, Audit, and IT reports skip Marketing Manager review and go directly to Admin.

### 6.4 Requisitions Approval

#### Office Supplies
1. Staff submits → `Pending_DeptHead`
2. Finance Department Head reviews → `Pending_Admin` or `DeptHead_Rejected`
3. Admin reviews → `Admin_Approved` or `Admin_Rejected`

#### Leave Requests (sick, temporary, annual)
1. Staff submits → `Pending_Admin`
2. Admin reviews → `Admin_Approved` or `Admin_Rejected`

#### Work Support
- Auto-approved upon submission

### 6.5 Meetings and Attendance Tracking

Meetings are scheduled by users with permission. Attendance is tracked as:
- `present`, `absent`, `late`, `excused`
There is no approval flow; meeting attendance is for record tracking.

## 7. Notifications

Notifications appear in the sidebar. Key behaviors:
- Admins can broadcast notifications.
- Department Heads may see a separate count for unread admin messages.
- Clicking a notification opens its linked page when available.

## 8. Common Tasks

### Sign in and sign out
1. Go to `Attendance`
2. Click `Sign In` at the start of the day
3. Click `Sign Out` at the end of the day
4. Late or early actions will be pending admin review

### Submit a report
1. Go to `Reports` or `Department Reports` (as applicable)
2. Fill in report details and upload attachments
3. Submit and monitor approval status

### Submit a requisition
1. Go to `Requisitions`
2. Choose requisition type
3. Provide details and attachments (if required)
4. Track status in your requisition list

### Approve pending items (Admin / Department Head)
1. Navigate to the relevant module (Attendance, Reports, Requisitions)
2. Filter by status `Pending`
3. Review details and approve or reject
4. Add notes when rejecting

## 9. Troubleshooting

If you cannot access a module:
- Check your role and department access
- Contact the Admin to confirm permissions

If you see an error:
- Refresh the page and try again
- Contact the Admin for account or data issues

## 10. Support

For assistance, contact the system administrator or the ICT support team.

