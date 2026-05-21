import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import { format } from 'date-fns';
import { exportToPDF, exportToExcel, printContent } from '../../utils/exportUtils';
import { getSocket } from '../../config/socket';

const TAB_STUDENTS = 'students';
const TAB_PENDING = 'pending';
const TAB_TRANSACTIONS = 'transactions';
const SEARCH_DEBOUNCE_MS = 300;

const StudentPaymentManagement = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(TAB_STUDENTS);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [payments, setPayments] = useState([]);
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ cohorts: [], courses: [] });
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [studentTotal, setStudentTotal] = useState(0);
  const searchDebounceRef = useRef(null);
  const studentsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showEditPaymentForm, setShowEditPaymentForm] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [transactionFormMode, setTransactionFormMode] = useState('create');
  const [paymentFormData, setPaymentFormData] = useState({
    student_id: '',
    course_id: '',
    amount: '',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: 'Cash',
    payment_reference: '',
    notes: ''
  });
  const [transactionFormData, setTransactionFormData] = useState({
    id: '',
    student_id: '',
    course_id: '',
    amount: '',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: 'Cash',
    payment_reference: '',
    notes: '',
    status: 'Approved'
  });
  const [editPaymentData, setEditPaymentData] = useState({
    id: '',
    course_fee: '',
    amount_paid: '',
    balance: '',
    payment_date: '',
    payment_method: '',
    payment_reference: '',
    notes: ''
  });

  const applyPaymentSummaryToList = useCallback((studentId, paymentSummary) => {
    if (!paymentSummary || !studentId) return;
    setStudents((prev) =>
      prev.map((s) =>
        s.id === studentId ? { ...s, paymentSummary } : s
      )
    );
    setSelectedStudent((prev) =>
      prev?.id === studentId ? { ...prev, paymentSummary } : prev
    );
  }, []);

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await api.get('/student-payments/pending');
      setPending(res.data.pending || []);
    } catch (err) {
      console.error('Fetch pending error:', err);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await api.get('/student-payments/filters');
      setFilterOptions({
        cohorts: res.data.cohorts || [],
        courses: res.data.courses || []
      });
    } catch (err) {
      console.error('Fetch filter options error:', err);
    }
  }, []);

  const fetchStudents = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    const requestId = ++studentsRequestIdRef.current;

    if (!silent) setListLoading(true);
    try {
      const params = {};
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (cohortFilter) params.cohort_id = cohortFilter;
      if (courseFilter) params.course_id = courseFilter;
      if (sortBy) params.sort = sortBy;
      if (sortDir) params.sort_dir = sortDir;

      const response = await api.get('/student-payments/students', { params });
      if (requestId !== studentsRequestIdRef.current) return;

      const list = response.data.students || [];
      setStudents(list);
      setStudentTotal(response.data.total ?? list.length);
    } catch (err) {
      if (requestId !== studentsRequestIdRef.current) return;
      console.error('Error fetching students:', err);
      setError('Failed to fetch students: ' + (err.response?.data?.error || err.message));
    } finally {
      if (requestId === studentsRequestIdRef.current) setListLoading(false);
    }
  }, [searchQuery, cohortFilter, courseFilter, sortBy, sortDir]);

  const refreshStudentDetail = useCallback(async (studentId, { silent = false } = {}) => {
    if (!studentId) return;
    const requestId = ++detailRequestIdRef.current;

    if (!silent) setDetailLoading(true);
    try {
      let paymentsData = [];
      let coursesData = [];
      let transactionsData = [];
      let summary = null;

      try {
        const res = await api.get(`/student-payments/student/${studentId}/detail`);
        if (requestId !== detailRequestIdRef.current) return;
        paymentsData = res.data.payments || [];
        coursesData = res.data.courses || [];
        transactionsData = res.data.transactions || [];
        summary = res.data.summary || null;
      } catch (detailErr) {
        if (requestId !== detailRequestIdRef.current) return;
        const [payRes, coursesRes, txRes] = await Promise.all([
          api.get(`/student-payments/student/${studentId}`),
          api.get(`/student-payments/student/${studentId}/enrolled-courses`).catch(() => ({ data: { courses: [] } })),
          api.get(`/student-payments/student/${studentId}/transactions`).catch(() => ({ data: { transactions: [] } }))
        ]);
        if (requestId !== detailRequestIdRef.current) return;
        paymentsData = payRes.data.payments || [];
        coursesData = coursesRes.data?.courses || [];
        transactionsData = txRes.data?.transactions || [];
        summary = payRes.data.summary || null;
      }

      setPayments(paymentsData);
      setEnrolledCourses(coursesData);
      setTransactions(transactionsData);
      if (summary) {
        applyPaymentSummaryToList(studentId, {
          totalFees: summary.totalFees,
          totalPaid: summary.totalPaid,
          totalBalance: summary.totalBalance,
          paymentCount: paymentsData.length
        });
      }
    } catch (err) {
      if (requestId !== detailRequestIdRef.current) return;
      setError(err.response?.data?.error || 'Failed to load student details');
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false);
    }
  }, [applyPaymentSummaryToList]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    if (activeTab === TAB_PENDING) fetchPending();
  }, [activeTab, fetchPending]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNotification = (n) => {
      const link = n && typeof n === 'object' && n.link ? n.link : null;
      if (link && String(link).includes('student-payments')) {
        fetchPending();
        if (selectedStudent?.id) refreshStudentDetail(selectedStudent.id, { silent: true });
      }
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [fetchPending, refreshStudentDetail, selectedStudent?.id]);

  useEffect(() => {
    if (!selectedStudent?.id) return;
    refreshStudentDetail(selectedStudent.id);
    return () => {
      if (detailAbortRef.current) detailAbortRef.current.abort();
    };
  }, [selectedStudent?.id, refreshStudentDetail]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  const handleTransactionsTab = () => {
    setActiveTab(TAB_TRANSACTIONS);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    setCohortFilter('');
    setCourseFilter('');
    setSortBy('name');
    setSortDir('asc');
  };

  const handleStudentSelect = (student) => {
    setShowPaymentForm(false);
    setShowTransactionForm(false);
    setShowEditPaymentForm(false);
    setPayments([]);
    setEnrolledCourses([]);
    setTransactions([]);
    setSelectedStudent(student);
  };

  const handlePaymentFormChange = (e) => {
    const { name, value } = e.target;
    setPaymentFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTransactionFormChange = (e) => {
    const { name, value } = e.target;
    setTransactionFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleEditPaymentChange = (e) => {
    const { name, value } = e.target;
    setEditPaymentData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddPayment = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!paymentFormData.amount || parseFloat(paymentFormData.amount) <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }

    setProcessing(true);
    try {
      const res = await api.post('/student-payments/add-payment', paymentFormData);
      setSuccess('Payment added successfully');
      setShowPaymentForm(false);
      setPaymentFormData({
        student_id: selectedStudent.id,
        course_id: '',
        amount: '',
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        payment_method: 'Cash',
        payment_reference: '',
        notes: ''
      });
      if (res.data.paymentSummary) {
        applyPaymentSummaryToList(selectedStudent.id, res.data.paymentSummary);
      }
      await refreshStudentDetail(selectedStudent.id, { silent: true });
    } catch (err) {
      console.error('Error adding payment:', err);
      setError('Failed to add payment: ' + (err.response?.data?.error || err.message));
    } finally {
      setProcessing(false);
    }
  };

  const openAddTransaction = () => {
    setTransactionFormMode('create');
    setTransactionFormData({
      id: '',
      student_id: selectedStudent?.id || '',
      course_id: '',
      amount: '',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      payment_method: 'Cash',
      payment_reference: '',
      notes: '',
      status: 'Approved'
    });
    setShowTransactionForm(true);
  };

  const openEditTransaction = (tx) => {
    setTransactionFormMode('edit');
    setTransactionFormData({
      id: tx.id,
      student_id: tx.student_id,
      course_id: tx.course_id,
      amount: tx.amount,
      payment_date: tx.payment_date ? format(new Date(tx.payment_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
      payment_method: tx.payment_method || 'Cash',
      payment_reference: tx.payment_reference || '',
      notes: tx.notes || '',
      status: tx.status || 'Pending'
    });
    setShowTransactionForm(true);
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setProcessing(true);
    try {
      let res;
      if (transactionFormMode === 'create') {
        res = await api.post('/student-payments/transactions', {
          student_id: transactionFormData.student_id,
          course_id: transactionFormData.course_id,
          amount: transactionFormData.amount,
          payment_date: transactionFormData.payment_date,
          payment_method: transactionFormData.payment_method,
          payment_reference: transactionFormData.payment_reference,
          notes: transactionFormData.notes,
          status: transactionFormData.status
        });
        setSuccess('Transaction created successfully');
      } else {
        res = await api.put(`/student-payments/transactions/${transactionFormData.id}`, {
          amount: transactionFormData.amount,
          payment_date: transactionFormData.payment_date,
          payment_method: transactionFormData.payment_method,
          payment_reference: transactionFormData.payment_reference,
          notes: transactionFormData.notes,
          status: transactionFormData.status
        });
        setSuccess('Transaction updated successfully');
      }
      setShowTransactionForm(false);
      const sid = selectedStudent?.id || transactionFormData.student_id;
      if (res?.data?.paymentSummary && sid) {
        applyPaymentSummaryToList(sid, res.data.paymentSummary);
      }
      if (sid) await refreshStudentDetail(sid, { silent: true });
      fetchPending();
    } catch (err) {
      console.error('Transaction submit error:', err);
      setError(err.response?.data?.error || 'Failed to save transaction');
    } finally {
      setProcessing(false);
    }
  };

  const openEditPayment = (payment) => {
    setEditPaymentData({
      id: payment.id,
      course_fee: payment.course_fee ?? '',
      amount_paid: payment.amount_paid ?? '',
      balance: payment.balance ?? '',
      payment_date: payment.payment_date ? format(new Date(payment.payment_date), 'yyyy-MM-dd') : '',
      payment_method: payment.payment_method || '',
      payment_reference: payment.payment_reference || '',
      notes: payment.notes || ''
    });
    setShowEditPaymentForm(true);
  };

  const handlePaymentUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setProcessing(true);
    try {
      const res = await api.put(`/student-payments/${editPaymentData.id}`, {
        course_fee: editPaymentData.course_fee,
        amount_paid: editPaymentData.amount_paid,
        balance: editPaymentData.balance,
        payment_date: editPaymentData.payment_date,
        payment_method: editPaymentData.payment_method,
        payment_reference: editPaymentData.payment_reference,
        notes: editPaymentData.notes
      });
      setSuccess('Payment updated successfully');
      setShowEditPaymentForm(false);
      if (selectedStudent) {
        if (res.data.paymentSummary) {
          applyPaymentSummaryToList(selectedStudent.id, res.data.paymentSummary);
        }
        await refreshStudentDetail(selectedStudent.id, { silent: true });
      }
    } catch (err) {
      console.error('Update payment error:', err);
      setError(err.response?.data?.error || 'Failed to update payment');
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = async (id) => {
    setError('');
    setSuccess('');
    setProcessing(true);
    const pendingRow = pending.find((p) => p.id === id);
    const studentId = pendingRow?.student_id || selectedStudent?.id;
    try {
      const res = await api.put(`/student-payments/transactions/${id}/approve`, { admin_notes: adminNotes || undefined });
      setSuccess('Payment approved.');
      setActionId(null);
      setAdminNotes('');
      setPending((prev) => prev.filter((p) => p.id !== id));
      if (res.data.paymentSummary && studentId) {
        applyPaymentSummaryToList(studentId, res.data.paymentSummary);
      }
      if (studentId && selectedStudent?.id === studentId) {
        await refreshStudentDetail(studentId, { silent: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to approve');
      fetchPending();
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (id) => {
    setError('');
    setSuccess('');
    setProcessing(true);
    const pendingRow = pending.find((p) => p.id === id);
    const studentId = pendingRow?.student_id || selectedStudent?.id;
    try {
      await api.put(`/student-payments/transactions/${id}/reject`, { admin_notes: adminNotes || undefined });
      setSuccess('Payment rejected.');
      setActionId(null);
      setAdminNotes('');
      setPending((prev) => prev.filter((p) => p.id !== id));
      if (studentId && selectedStudent?.id === studentId) {
        await refreshStudentDetail(studentId, { silent: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reject');
      fetchPending();
    } finally {
      setProcessing(false);
    }
  };

  const handlePrint = (student, payments) => {
    const content = `
      <h2>Student Payment Details</h2>
      <h3>Student Information</h3>
      <p><strong>Student ID:</strong> ${student.student_id}</p>
      <p><strong>Name:</strong> ${student.name}</p>
      <p><strong>Email:</strong> ${student.email}</p>
      <p><strong>Phone:</strong> ${student.phone || 'N/A'}</p>
      <p><strong>Status:</strong> ${student.status}</p>
      
      <h3>Payment Summary</h3>
      <p><strong>Total Course Fees:</strong> $${payments.reduce((sum, p) => sum + (parseFloat(p.course_fee) || 0), 0).toFixed(2)}</p>
      <p><strong>Total Paid:</strong> $${payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0).toFixed(2)}</p>
      <p><strong>Total Balance:</strong> $${payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0).toFixed(2)}</p>
      
      <h3>Payment Details</h3>
      <table border="1" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th>Course</th>
            <th>Course Fee</th>
            <th>Amount Paid</th>
            <th>Balance</th>
            <th>Payment Date</th>
            <th>Payment Method</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map(p => `
            <tr>
              <td>${p.course_code} - ${p.course_title}</td>
              <td>$${parseFloat(p.course_fee || 0).toFixed(2)}</td>
              <td>$${parseFloat(p.amount_paid || 0).toFixed(2)}</td>
              <td>$${parseFloat(p.balance || 0).toFixed(2)}</td>
              <td>${p.payment_date ? format(new Date(p.payment_date), 'PPP') : 'N/A'}</td>
              <td>${p.payment_method || 'N/A'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    printContent('Student Payment Details', content);
  };

  const handleExportPDF = (student, payments) => {
    const content = [
      `Student Payment Details`,
      `Student ID: ${student.student_id}`,
      `Name: ${student.name}`,
      `Email: ${student.email}`,
      `Phone: ${student.phone || 'N/A'}`,
      `Status: ${student.status}`,
      ``,
      `Payment Summary`,
      `Total Course Fees: $${payments.reduce((sum, p) => sum + (parseFloat(p.course_fee) || 0), 0).toFixed(2)}`,
      `Total Paid: $${payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0).toFixed(2)}`,
      `Total Balance: $${payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0).toFixed(2)}`,
      ``,
      `Payment Details`,
      ...payments.map(p => [
        `Course: ${p.course_code} - ${p.course_title}`,
        `Course Fee: $${parseFloat(p.course_fee || 0).toFixed(2)}`,
        `Amount Paid: $${parseFloat(p.amount_paid || 0).toFixed(2)}`,
        `Balance: $${parseFloat(p.balance || 0).toFixed(2)}`,
        `Payment Date: ${p.payment_date ? format(new Date(p.payment_date), 'PPP') : 'N/A'}`,
        `Payment Method: ${p.payment_method || 'N/A'}`,
        `---`
      ]).flat()
    ];
    exportToPDF(`Student Payment - ${student.name}`, content, `student_payment_${student.student_id}.pdf`);
  };

  const handleExportExcel = () => {
    const allData = students.flatMap(student => {
      const studentPayments = payments.filter(p => p.student_id === student.id);
      return studentPayments.map(payment => ({
        'Student ID': student.student_id,
        'Student Name': student.name,
        'Email': student.email,
        'Phone': student.phone || 'N/A',
        'Course Code': payment.course_code,
        'Course Title': payment.course_title,
        'Course Fee': parseFloat(payment.course_fee || 0),
        'Amount Paid': parseFloat(payment.amount_paid || 0),
        'Balance': parseFloat(payment.balance || 0),
        'Payment Date': payment.payment_date ? format(new Date(payment.payment_date), 'yyyy-MM-dd') : 'N/A',
        'Payment Method': payment.payment_method || 'N/A'
      }));
    });

    if (allData.length === 0) {
      setError('No payment data to export');
      return;
    }

    const headers = [
      'Student ID', 'Student Name', 'Email', 'Phone', 'Course Code', 'Course Title',
      'Course Fee', 'Amount Paid', 'Balance', 'Payment Date', 'Payment Method'
    ];
    const data = allData.map(row => [
      row['Student ID'], row['Student Name'], row['Email'], row['Phone'],
      row['Course Code'], row['Course Title'], row['Course Fee'], row['Amount Paid'],
      row['Balance'], row['Payment Date'], row['Payment Method']
    ]);

    exportToExcel('Student Payments', headers, data, 'student_payments.xlsx');
  };

  const openApprove = (id) => { setActionId(id); setActionMode('approve'); setAdminNotes(''); };
  const openReject = (id) => { setActionId(id); setActionMode('reject'); setAdminNotes(''); };
  const closeModal = () => { setActionId(null); setActionMode(null); setAdminNotes(''); };

  return (
    <div className="container-fluid">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Student Payment Management</h1>
        <div>
          <button className="btn btn-outline-secondary btn-sm me-2" onClick={handleExportExcel}>
            <i className="bi bi-file-earmark-excel me-1"></i>Export All Excel
          </button>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === TAB_STUDENTS ? 'active' : ''}`}
            onClick={() => setActiveTab(TAB_STUDENTS)}
          >
            Students
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === TAB_PENDING ? 'active' : ''}`}
            onClick={() => setActiveTab(TAB_PENDING)}
          >
            Pending Requests {pending.length > 0 && <span className="badge bg-warning text-dark">{pending.length}</span>}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === TAB_TRANSACTIONS ? 'active' : ''}`}
            onClick={handleTransactionsTab}
          >
            Transactions
          </button>
        </li>
      </ul>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {error}
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}
      {success && (
        <div className="alert alert-success alert-dismissible fade show" role="alert">
          {success}
          <button type="button" className="btn-close" onClick={() => setSuccess('')}></button>
        </div>
      )}

      {activeTab === TAB_PENDING && (
        <>
          {pendingLoading ? (
            <div className="d-flex justify-content-center py-5"><div className="spinner-border text-primary" /></div>
          ) : (
            <div className="card">
              <div className="card-header fw-bold">Pending payment requests</div>
              <div className="card-body p-0">
                {pending.length === 0 ? (
                  <div className="p-4 text-center text-muted">No pending requests.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Course</th>
                          <th className="text-end">Amount</th>
                          <th>Date</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((p) => (
                          <tr key={p.id}>
                            <td><strong>{p.student_name}</strong><br /><small className="text-muted">{p.student_email}</small></td>
                            <td>{p.course_title} ({p.course_code})</td>
                            <td className="text-end">{(parseFloat(p.amount) || 0).toFixed(2)}</td>
                            <td>{p.payment_date ? format(new Date(p.payment_date), 'PP') : '—'}</td>
                            <td>{p.payment_method || '—'}</td>
                            <td>{p.payment_reference || '—'}</td>
                            <td>
                              <button type="button" className="btn btn-sm btn-success me-1" onClick={() => openApprove(p.id)}>Approve</button>
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => openReject(p.id)}>Reject</button>
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
          {actionId && actionMode && (
            <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title">{actionMode === 'approve' ? 'Approve' : 'Reject'} payment request</h5>
                    <button type="button" className="btn-close" onClick={closeModal} aria-label="Close" />
                  </div>
                  <div className="modal-body">
                    <label className="form-label">Notes (optional)</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder={actionMode === 'reject' ? 'Reason for rejection…' : 'Add any notes…'}
                    />
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                    {actionMode === 'approve' ? (
                      <button type="button" className="btn btn-success" onClick={() => handleApprove(actionId)} disabled={processing}>
                        {processing ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                        Approve
                      </button>
                    ) : (
                      <button type="button" className="btn btn-danger" onClick={() => handleReject(actionId)} disabled={processing}>
                        {processing ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === TAB_STUDENTS && <div className="row">
        <div className="col-md-4">
          <div className="card">
            <div className="card-header">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Students</h5>
                <small className="text-muted">{studentTotal} found</small>
              </div>
              <div className="mb-2">
                <div className="input-group input-group-sm">
                  <span className="input-group-text"><i className="bi bi-search" /></span>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search name, ID, email, course..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                  {searchInput && (
                    <button type="button" className="btn btn-outline-secondary" onClick={() => { setSearchInput(''); setSearchQuery(''); }} aria-label="Clear search">
                      <i className="bi bi-x" />
                    </button>
                  )}
                </div>
              </div>
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <select
                    className="form-select form-select-sm"
                    value={cohortFilter}
                    onChange={(e) => setCohortFilter(e.target.value)}
                  >
                    <option value="">All cohorts</option>
                    {filterOptions.cohorts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="col-6">
                  <select
                    className="form-select form-select-sm"
                    value={courseFilter}
                    onChange={(e) => setCourseFilter(e.target.value)}
                  >
                    <option value="">All courses</option>
                    {filterOptions.courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.course_code} - {c.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row g-2">
                <div className="col-7">
                  <select
                    className="form-select form-select-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="name">Sort: Name</option>
                    <option value="student_id">Sort: Student ID</option>
                    <option value="balance">Sort: Balance</option>
                    <option value="fees">Sort: Total Fees</option>
                    <option value="paid">Sort: Amount Paid</option>
                    <option value="cohort">Sort: Cohort</option>
                    <option value="created">Sort: Date Added</option>
                  </select>
                </div>
                <div className="col-5 d-flex gap-1">
                  <button
                    type="button"
                    className={`btn btn-sm flex-grow-1 ${sortDir === 'asc' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setSortDir('asc')}
                    title="Ascending"
                  >
                    <i className="bi bi-sort-alpha-down" />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm flex-grow-1 ${sortDir === 'desc' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setSortDir('desc')}
                    title="Descending"
                  >
                    <i className="bi bi-sort-alpha-up" />
                  </button>
                  {(searchInput || cohortFilter || courseFilter || sortBy !== 'name' || sortDir !== 'asc') && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearFilters} title="Clear filters">
                      <i className="bi bi-funnel" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="card-body position-relative" style={{ maxHeight: '520px', overflowY: 'auto', minHeight: '120px' }}>
              {listLoading && (
                <div className="position-absolute top-0 start-0 end-0 d-flex justify-content-center py-2" style={{ zIndex: 2, background: 'rgba(255,255,255,0.85)' }}>
                  <div className="spinner-border spinner-border-sm text-primary" role="status" />
                </div>
              )}
              {!listLoading && students.length === 0 ? (
                <div className="text-center p-4 text-muted">
                  <i className="bi bi-person-x fs-1 d-block mb-2"></i>
                  No students match your filters.
                </div>
              ) : (
                <div className="list-group">
                  {students.map(student => (
                    <button
                      key={student.id}
                      type="button"
                      className={`list-group-item list-group-item-action ${selectedStudent?.id === student.id ? 'active' : ''}`}
                      onClick={() => handleStudentSelect(student)}
                    >
                      <div className="d-flex w-100 justify-content-between">
                        <h6 className="mb-1">{student.name}</h6>
                        <small>{student.student_id}</small>
                      </div>
                      <p className="mb-1 text-muted small">{student.email}</p>
                      {(student.cohort_name || student.cohort_code) && (
                        <small className="d-block text-muted mb-1">
                          <i className="bi bi-people me-1" />
                          {student.cohort_name || student.cohort_code}
                        </small>
                      )}
                      <div className="d-flex justify-content-between">
                        <small>Total Fees: ${student.paymentSummary?.totalFees?.toFixed(2) || '0.00'}</small>
                        <small className={student.paymentSummary?.totalBalance > 0 ? 'text-danger' : 'text-success'}>
                          Balance: ${student.paymentSummary?.totalBalance?.toFixed(2) || '0.00'}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-8">
          {selectedStudent ? (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Payment Details - {selectedStudent.name}</h5>
                {detailLoading && (
                  <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                )}
                <div>
                  <button className="btn btn-sm btn-outline-primary me-2" onClick={() => handlePrint(selectedStudent, payments)}>
                    <i className="bi bi-printer me-1"></i>Print
                  </button>
                  <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => handleExportPDF(selectedStudent, payments)}>
                    <i className="bi bi-file-earmark-pdf me-1"></i>Export PDF
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => {
                    setPaymentFormData({
                      student_id: selectedStudent.id,
                      course_id: '',
                      amount: '',
                      payment_date: format(new Date(), 'yyyy-MM-dd'),
                      payment_method: 'Cash',
                      payment_reference: '',
                      notes: ''
                    });
                    setShowPaymentForm(true);
                  }}>
                    <i className="bi bi-plus-circle me-1"></i>Add Payment
                  </button>
                  <button className="btn btn-sm btn-outline-success ms-2" onClick={openAddTransaction}>
                    <i className="bi bi-receipt me-1"></i>Add Transaction
                  </button>
                </div>
              </div>
              <div className="card-body">
                {detailLoading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="mt-2 mb-0 text-muted">Loading payment details...</p>
                  </div>
                ) : (
                <>
                <div className="row mb-3">
                  <div className="col-md-2">
                    <strong>Student ID:</strong><br />
                    {selectedStudent.student_id}
                  </div>
                  <div className="col-md-3">
                    <strong>Email:</strong><br />
                    {selectedStudent.email}
                  </div>
                  <div className="col-md-2">
                    <strong>Phone:</strong><br />
                    {selectedStudent.phone || 'N/A'}
                  </div>
                  <div className="col-md-2">
                    <strong>Cohort:</strong><br />
                    {selectedStudent.cohort_name || 'N/A'}
                  </div>
                  <div className="col-md-3">
                    <strong>Status:</strong><br />
                    <span className={`badge bg-${selectedStudent.status === 'Active' ? 'success' : 'secondary'}`}>
                      {selectedStudent.status}
                    </span>
                  </div>
                </div>

                <div className="row mb-4">
                  <div className="col-md-4">
                    <div className="card bg-light">
                      <div className="card-body text-center">
                        <h6 className="text-muted">Total Fees</h6>
                        <h4 className="mb-0">${payments.reduce((sum, p) => sum + (parseFloat(p.course_fee) || 0), 0).toFixed(2)}</h4>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="card bg-light">
                      <div className="card-body text-center">
                        <h6 className="text-muted">Total Paid</h6>
                        <h4 className="mb-0 text-success">${payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0).toFixed(2)}</h4>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="card bg-light">
                      <div className="card-body text-center">
                        <h6 className="text-muted">Balance</h6>
                        <h4 className={`mb-0 ${payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0) > 0 ? 'text-danger' : 'text-success'}`}>
                          ${payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0).toFixed(2)}
                        </h4>
                      </div>
                    </div>
                  </div>
                </div>

                {showPaymentForm && (
                  <div className="card mb-4 border-primary">
                    <div className="card-header bg-primary text-white">
                      <h6 className="mb-0">Add Payment</h6>
                    </div>
                    <div className="card-body">
                      <form onSubmit={handleAddPayment}>
                        <div className="row">
                          <div className="col-md-6 mb-3">
                            <label className="form-label">Course *</label>
                            <select
                              className="form-select"
                              name="course_id"
                              value={paymentFormData.course_id}
                              onChange={handlePaymentFormChange}
                              required
                            >
                              <option value="">Select Course</option>
                              {enrolledCourses.length > 0 ? (
                                enrolledCourses.map(course => {
                                  const balance = parseFloat(course.balance || course.course_fee || 0);
                                  const amountPaid = parseFloat(course.amount_paid || 0);
                                  return (
                                    <option key={course.course_id} value={course.course_id}>
                                      {course.course_code} - {course.title} 
                                      {course.payment_id ? (
                                        ` (Paid: $${amountPaid.toFixed(2)}, Balance: $${balance.toFixed(2)})`
                                      ) : (
                                        ` (Fee: $${parseFloat(course.course_fee || 0).toFixed(2)})`
                                      )}
                                    </option>
                                  );
                                })
                              ) : payments.length > 0 ? (
                                payments.map(payment => (
                                  <option key={payment.course_id} value={payment.course_id}>
                                    {payment.course_code} - {payment.course_title} (Balance: ${parseFloat(payment.balance || 0).toFixed(2)})
                                  </option>
                                ))
                              ) : (
                                <option value="" disabled>No courses available</option>
                              )}
                            </select>
                            {enrolledCourses.length === 0 && payments.length === 0 && (
                              <small className="form-text text-danger">
                                No enrolled courses found for this student. Please enroll the student in courses first.
                              </small>
                            )}
                            {enrolledCourses.length === 0 && payments.length > 0 && (
                              <small className="form-text text-muted">
                                Showing courses from existing payment records.
                              </small>
                            )}
                          </div>
                          <div className="col-md-6 mb-3">
                            <label className="form-label">Payment Amount *</label>
                            <div className="input-group">
                              <span className="input-group-text">$</span>
                              <input
                                type="number"
                                step="0.01"
                                className="form-control"
                                name="amount"
                                value={paymentFormData.amount}
                                onChange={handlePaymentFormChange}
                                required
                                min="0.01"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="row">
                          <div className="col-md-4 mb-3">
                            <label className="form-label">Payment Date *</label>
                            <input
                              type="date"
                              className="form-control"
                              name="payment_date"
                              value={paymentFormData.payment_date}
                              onChange={handlePaymentFormChange}
                              required
                            />
                          </div>
                          <div className="col-md-4 mb-3">
                            <label className="form-label">Payment Method</label>
                            <select
                              className="form-select"
                              name="payment_method"
                              value={paymentFormData.payment_method}
                              onChange={handlePaymentFormChange}
                            >
                              <option value="Cash">Cash</option>
                              <option value="Bank Transfer">Bank Transfer</option>
                              <option value="Check">Check</option>
                              <option value="Credit Card">Credit Card</option>
                              <option value="Mobile Money">Mobile Money</option>
                            </select>
                          </div>
                          <div className="col-md-4 mb-3">
                            <label className="form-label">Reference Number</label>
                            <input
                              type="text"
                              className="form-control"
                              name="payment_reference"
                              value={paymentFormData.payment_reference}
                              onChange={handlePaymentFormChange}
                              placeholder="Optional"
                            />
                          </div>
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Notes</label>
                          <textarea
                            className="form-control"
                            name="notes"
                            rows="2"
                            value={paymentFormData.notes}
                            onChange={handlePaymentFormChange}
                            placeholder="Optional notes about this payment"
                          ></textarea>
                        </div>
                        <div className="d-flex gap-2">
                          <button type="submit" className="btn btn-primary" disabled={processing}>
                            {processing ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-circle me-1" />}
                            Add Payment
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentForm(false)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                <div className="table-responsive">
                  <table className="table table-hover table-striped">
                    <thead>
                      <tr>
                        <th>Course</th>
                        <th>Course Fee</th>
                        <th>Amount Paid</th>
                        <th>Balance</th>
                        <th>Payment Date</th>
                        <th>Payment Method</th>
                        <th>Reference</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr>
                          <td colSpan="8" className="text-center text-muted">
                            No payment records found for this student.
                          </td>
                        </tr>
                      ) : (
                        payments.map(payment => (
                          <tr key={payment.id}>
                            <td>
                              <strong>{payment.course_code}</strong><br />
                              <small className="text-muted">{payment.course_title}</small>
                            </td>
                            <td>${parseFloat(payment.course_fee || 0).toFixed(2)}</td>
                            <td className="text-success">${parseFloat(payment.amount_paid || 0).toFixed(2)}</td>
                            <td className={parseFloat(payment.balance || 0) > 0 ? 'text-danger' : 'text-success'}>
                              ${parseFloat(payment.balance || 0).toFixed(2)}
                            </td>
                            <td>{payment.payment_date ? format(new Date(payment.payment_date), 'PPP') : 'N/A'}</td>
                            <td>{payment.payment_method || 'N/A'}</td>
                            <td>{payment.payment_reference || 'N/A'}</td>
                            <td className="text-end">
                              <button className="btn btn-sm btn-outline-primary" onClick={() => openEditPayment(payment)}>
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="d-flex justify-content-between align-items-center mt-4">
                  <h6 className="mb-0">Transactions</h6>
                  {detailLoading && (
                    <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  )}
                </div>
                <div className="table-responsive mt-2">
                  <table className="table table-hover table-striped">
                    <thead>
                      <tr>
                        <th>Course</th>
                        <th className="text-end">Amount</th>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Reference</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center text-muted">
                            No transactions found for this student.
                          </td>
                        </tr>
                      ) : (
                        transactions.map((tx) => (
                          <tr key={tx.id}>
                            <td>
                              <strong>{tx.course_code}</strong><br />
                              <small className="text-muted">{tx.course_title}</small>
                            </td>
                            <td className="text-end">{(parseFloat(tx.amount) || 0).toFixed(2)}</td>
                            <td>{tx.payment_date ? format(new Date(tx.payment_date), 'PP') : '—'}</td>
                            <td>{tx.payment_method || '—'}</td>
                            <td>{tx.payment_reference || '—'}</td>
                            <td>
                              <span className={`badge bg-${
                                tx.status === 'Approved' ? 'success' :
                                tx.status === 'Rejected' ? 'danger' : 'warning'
                              }`}>{tx.status}</span>
                            </td>
                            <td className="text-end">
                              <button className="btn btn-sm btn-outline-primary" onClick={() => openEditTransaction(tx)}>
                                Edit
                              </button>
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
          ) : (
            <div className="card">
              <div className="card-body text-center p-5 text-muted">
                <i className="bi bi-arrow-left-circle fs-1 d-block mb-3"></i>
                <p>Select a student from the list to view their payment details</p>
              </div>
            </div>
          )}
        </div>
      </div>}

      {activeTab === TAB_TRANSACTIONS && (
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Transactions</h5>
            <button className="btn btn-sm btn-outline-success" onClick={openAddTransaction} disabled={!selectedStudent}>
              <i className="bi bi-receipt me-1"></i>Add Transaction
            </button>
          </div>
          <div className="card-body">
            {!selectedStudent ? (
              <div className="text-center text-muted p-4">
                Select a student from the Students tab to view transactions.
              </div>
            ) : detailLoading ? (
              <div className="d-flex justify-content-center py-4">
                <div className="spinner-border text-primary" />
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table-striped">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th className="text-end">Amount</th>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center text-muted">
                          No transactions found for this student.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>
                            <strong>{tx.course_code}</strong><br />
                            <small className="text-muted">{tx.course_title}</small>
                          </td>
                          <td className="text-end">{(parseFloat(tx.amount) || 0).toFixed(2)}</td>
                          <td>{tx.payment_date ? format(new Date(tx.payment_date), 'PP') : '—'}</td>
                          <td>{tx.payment_method || '—'}</td>
                          <td>{tx.payment_reference || '—'}</td>
                          <td>
                            <span className={`badge bg-${
                              tx.status === 'Approved' ? 'success' :
                              tx.status === 'Rejected' ? 'danger' : 'warning'
                            }`}>{tx.status}</span>
                          </td>
                          <td className="text-end">
                            <button className="btn btn-sm btn-outline-primary" onClick={() => openEditTransaction(tx)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showTransactionForm && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{transactionFormMode === 'create' ? 'Add Transaction' : 'Edit Transaction'}</h5>
                <button type="button" className="btn-close" onClick={() => setShowTransactionForm(false)} aria-label="Close" />
              </div>
              <form onSubmit={handleTransactionSubmit}>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Course *</label>
                      <select
                        className="form-select"
                        name="course_id"
                        value={transactionFormData.course_id}
                        onChange={handleTransactionFormChange}
                        required
                        disabled={transactionFormMode === 'edit'}
                      >
                        <option value="">Select Course</option>
                        {enrolledCourses.length > 0 ? (
                          enrolledCourses.map(course => (
                            <option key={course.course_id} value={course.course_id}>
                              {course.course_code} - {course.title}
                            </option>
                          ))
                        ) : payments.length > 0 ? (
                          payments.map(payment => (
                            <option key={payment.course_id} value={payment.course_id}>
                              {payment.course_code} - {payment.course_title}
                            </option>
                          ))
                        ) : (
                          <option value="" disabled>No courses available</option>
                        )}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Amount *</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          name="amount"
                          value={transactionFormData.amount}
                          onChange={handleTransactionFormChange}
                          required
                          min="0.01"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Payment Date *</label>
                      <input
                        type="date"
                        className="form-control"
                        name="payment_date"
                        value={transactionFormData.payment_date}
                        onChange={handleTransactionFormChange}
                        required
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Payment Method</label>
                      <select
                        className="form-select"
                        name="payment_method"
                        value={transactionFormData.payment_method}
                        onChange={handleTransactionFormChange}
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Check">Check</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Mobile Money">Mobile Money</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Status</label>
                      <select
                        className="form-select"
                        name="status"
                        value={transactionFormData.status}
                        onChange={handleTransactionFormChange}
                      >
                        <option value="Approved">Approved</option>
                        <option value="Pending">Pending</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Reference Number</label>
                    <input
                      type="text"
                      className="form-control"
                      name="payment_reference"
                      value={transactionFormData.payment_reference}
                      onChange={handleTransactionFormChange}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notes</label>
                    <textarea
                      className="form-control"
                      name="notes"
                      rows="2"
                      value={transactionFormData.notes}
                      onChange={handleTransactionFormChange}
                      placeholder="Optional notes about this transaction"
                    ></textarea>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowTransactionForm(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={processing}>
                    {processing ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    {transactionFormMode === 'create' ? 'Create Transaction' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showEditPaymentForm && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Payment</h5>
                <button type="button" className="btn-close" onClick={() => setShowEditPaymentForm(false)} aria-label="Close" />
              </div>
              <form onSubmit={handlePaymentUpdate}>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Course Fee</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        name="course_fee"
                        value={editPaymentData.course_fee}
                        onChange={handleEditPaymentChange}
                        min="0"
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Amount Paid</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        name="amount_paid"
                        value={editPaymentData.amount_paid}
                        onChange={handleEditPaymentChange}
                        min="0"
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Balance</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        name="balance"
                        value={editPaymentData.balance}
                        onChange={handleEditPaymentChange}
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Payment Date</label>
                      <input
                        type="date"
                        className="form-control"
                        name="payment_date"
                        value={editPaymentData.payment_date}
                        onChange={handleEditPaymentChange}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Payment Method</label>
                      <input
                        type="text"
                        className="form-control"
                        name="payment_method"
                        value={editPaymentData.payment_method}
                        onChange={handleEditPaymentChange}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Reference</label>
                      <input
                        type="text"
                        className="form-control"
                        name="payment_reference"
                        value={editPaymentData.payment_reference}
                        onChange={handleEditPaymentChange}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notes</label>
                    <textarea
                      className="form-control"
                      name="notes"
                      rows="2"
                      value={editPaymentData.notes}
                      onChange={handleEditPaymentChange}
                    ></textarea>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowEditPaymentForm(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={processing}>
                    {processing ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentPaymentManagement;

