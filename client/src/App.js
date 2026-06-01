import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import NavigateToAppHome from './components/NavigateToAppHome';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';
import DepartmentManagement from './pages/departments/DepartmentManagement';
import DepartmentView from './pages/departments/DepartmentView';
import StaffManagement from './pages/staff/StaffManagement';
import StaffView from './pages/staff/StaffView';
import ClientManagement from './pages/clients/ClientManagement';
import ClientView from './pages/clients/ClientView';
import PartnerManagement from './pages/partners/PartnerManagement';
import PartnerView from './pages/partners/PartnerView';
import AcademyManagement from './pages/academy/AcademyManagement';
import StudentView from './pages/academy/StudentView';
import InstructorView from './pages/academy/InstructorView';
import CourseView from './pages/academy/CourseView';
import ReportsManagement from './pages/reports/ReportsManagement';
import CertificateVerification from './pages/certificates/CertificateVerification';
import CertificateManagement from './pages/certificates/CertificateManagement';
import PublicVerification from './pages/certificates/PublicVerification';
import PublicClaims from './pages/claims/PublicClaims';
import Profile from './pages/Profile';
import UserManagement from './pages/users/UserManagement';
import DepartmentHeadDashboard from './pages/departments/DepartmentHeadDashboard';
import DepartmentReportsManagement from './pages/departments/DepartmentReportsManagement';
import DepartmentReportHistory from './pages/departments/DepartmentReportHistory';
import SupportTicketTracker from './pages/ict/SupportTicketTracker';
import SystemAuditTrail from './pages/ict/SystemAuditTrail';
import NotificationManagement from './pages/notifications/NotificationManagement';
import Communications from './pages/notifications/Communications';
import Notifications from './pages/notifications/Notifications';
import StaffDashboard from './pages/staff/StaffDashboard';
import StaffClientReports from './pages/staff/StaffClientReports';
import PettyCashLedger from './pages/finance/PettyCashLedger';
import AssetRegistry from './pages/finance/AssetRegistry';
import MyReportsHistory from './pages/reports/MyReportsHistory';
import FinanceRoute from './components/FinanceRoute';
import StaffRoute from './components/StaffRoute';
import StudentPaymentRoute from './components/StudentPaymentRoute';
import CallMemoHistory from './pages/callMemos/CallMemoHistory';
import ProposalHistory from './pages/proposals/ProposalHistory';
import MeetingHistory from './pages/meetings/MeetingHistory';
import Calendar from './pages/calendar/Calendar';
import ArchivedDocuments from './pages/archivedDocuments/ArchivedDocuments';
import AttendanceHistory from './pages/attendance/AttendanceHistory';
import RequisitionHistory from './pages/requisitions/RequisitionHistory';
import Targets from './pages/targets/Targets';
import PettyCash from './pages/finance/PettyCash';
import Appraisals from './pages/appraisals/Appraisals';
import StudentPaymentManagement from './pages/departments/StudentPaymentManagement';
import StudentPortal from './pages/academy/StudentPortal';
import InstructorDashboard from './pages/academy/InstructorDashboard';
import './pages/academy/StudentPortal.css';
import StudentCertificates from './pages/academy/StudentCertificates';
import StudentCourses from './pages/academy/StudentCourses';
import StudentBilling from './pages/academy/StudentBilling';
import StudentGrades from './pages/academy/StudentGrades';
import NotFound from './pages/NotFound';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <div className="App">
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/certificates/verify/:code" element={<CertificateVerification />} />
            <Route path="/verify-certificate" element={<PublicVerification />} />
            <Route path="/submit-claim" element={<PublicClaims />} />
              <Route
                path="/*"
                element={
                  <PrivateRoute>
                    <div className="app-layout">
                      <Sidebar />
                      <div className="main-content-wrapper">
                        <TopBar />
                        <Routes>
                          <Route path="/" element={<NavigateToAppHome />} />
                          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
                          <Route path="/staff-dashboard" element={<PrivateRoute requiredRole="Staff"><StaffDashboard /></PrivateRoute>} />
                          <Route path="/staff-client-reports" element={<PrivateRoute requiredRole="Staff"><StaffClientReports /></PrivateRoute>} />
                          <Route path="/users" element={<PrivateRoute requiredRole="Admin"><UserManagement /></PrivateRoute>} />
                          <Route path="/departments" element={<PrivateRoute requiredRole="Admin"><DepartmentManagement /></PrivateRoute>} />
                          <Route path="/departments/view/:id" element={<PrivateRoute requiredRole="Admin"><DepartmentView /></PrivateRoute>} />
                          <Route path="/staff" element={<StaffRoute><StaffManagement /></StaffRoute>} />
                          <Route path="/staff/view/:id" element={<StaffRoute><StaffView /></StaffRoute>} />
                          <Route path="/clients" element={<PrivateRoute><ClientManagement /></PrivateRoute>} />
                          <Route path="/clients/view/:id" element={<PrivateRoute><ClientView /></PrivateRoute>} />
                          <Route path="/partners" element={<PartnerManagement />} />
                          <Route path="/partners/view/:id" element={<PartnerView />} />
                          <Route path="/academy" element={<AcademyManagement />} />
                          <Route path="/academy/students/view/:id" element={<StudentView />} />
                          <Route path="/academy/instructors/view/:id" element={<InstructorView />} />
                          <Route path="/academy/courses/view/:id" element={<CourseView />} />
                          <Route path="/certificates" element={<PrivateRoute requiredRole="Admin"><CertificateManagement /></PrivateRoute>} />
                          <Route path="/finance/petty-cash" element={<FinanceRoute><PettyCash /></FinanceRoute>} />
                          <Route path="/finance/petty-cash-ledger" element={<FinanceRoute><PettyCashLedger /></FinanceRoute>} />
                          <Route path="/finance/assets" element={<FinanceRoute><AssetRegistry /></FinanceRoute>} />
                          <Route path="/appraisals" element={<Appraisals />} />
                          <Route path="/reports" element={<ReportsManagement />} />
                          <Route path="/my-reports-history" element={<MyReportsHistory />} />
                <Route path="/department-dashboard" element={<PrivateRoute requiredRole="DepartmentHead"><DepartmentHeadDashboard /></PrivateRoute>} />
                <Route path="/ict/audit-trail" element={<PrivateRoute><SystemAuditTrail /></PrivateRoute>} />
                <Route path="/department-report-history" element={<PrivateRoute requiredRole="DepartmentHead"><DepartmentReportHistory /></PrivateRoute>} />
                <Route path="/support-tickets" element={<PrivateRoute><SupportTicketTracker /></PrivateRoute>} />
                          <Route path="/notifications" element={<PrivateRoute requiredRole="Admin"><NotificationManagement /></PrivateRoute>} />
                          <Route path="/notifications-view" element={<PrivateRoute><Notifications /></PrivateRoute>} />
                          <Route path="/communications" element={<PrivateRoute><Communications /></PrivateRoute>} />
                          <Route path="/department-reports" element={<PrivateRoute requiredRole="Admin"><DepartmentReportsManagement /></PrivateRoute>} />
                          <Route path="/call-memos" element={<PrivateRoute><CallMemoHistory /></PrivateRoute>} />
                          <Route path="/proposals" element={<PrivateRoute><ProposalHistory /></PrivateRoute>} />
                          <Route path="/meetings" element={<PrivateRoute><MeetingHistory /></PrivateRoute>} />
                          <Route path="/calendar" element={<PrivateRoute><Calendar /></PrivateRoute>} />
                          <Route path="/archived-documents" element={<PrivateRoute><ArchivedDocuments /></PrivateRoute>} />
                          <Route path="/attendance" element={<PrivateRoute requiredRoles={['Admin', 'Staff', 'DepartmentHead']}><AttendanceHistory /></PrivateRoute>} />
                          <Route path="/requisitions" element={<PrivateRoute><RequisitionHistory /></PrivateRoute>} />
                          <Route path="/targets" element={<PrivateRoute><Targets /></PrivateRoute>} />
                          <Route path="/profile" element={<Profile />} />
                          <Route path="/instructor-dashboard" element={<PrivateRoute requiredRole="Instructor"><InstructorDashboard /></PrivateRoute>} />
                          <Route path="/student" element={<PrivateRoute requiredRole="Student"><StudentPortal /></PrivateRoute>} />
                          <Route path="/student/courses" element={<PrivateRoute requiredRole="Student"><StudentCourses /></PrivateRoute>} />
                          <Route path="/student/grades" element={<PrivateRoute requiredRole="Student"><StudentGrades /></PrivateRoute>} />
                          <Route path="/student/certificates" element={<PrivateRoute requiredRole="Student"><StudentCertificates /></PrivateRoute>} />
                          <Route path="/student/billing" element={<PrivateRoute requiredRole="Student"><StudentBilling /></PrivateRoute>} />
                          <Route path="/student-payments" element={<StudentPaymentRoute><StudentPaymentManagement /></StudentPaymentRoute>} />
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </div>
                    </div>
                  </PrivateRoute>
                }
              />
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

