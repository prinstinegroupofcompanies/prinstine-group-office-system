import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';

const AssetRegistry = () => {
  const { user } = useAuth();
  const [assets, setAssets] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isFinanceDeptHead, setIsFinanceDeptHead] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'monthly', 'depreciation'
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filters, setFilters] = useState({
    category: '',
    department: '',
    location: '',
    search: ''
  });
  const getInitialFormData = () => ({
    asset_description: '',
    asset_category: '',
    department: '',
    location: '',
    date_acquired: new Date().toISOString().split('T')[0],
    supplier: '',
    purchase_price_usd: '',
    purchase_price_lrd: '',
    asset_condition: 'Good',
    serial_number: '',
    warranty_expiry_date: '',
    expected_useful_life_years: 10,
    depreciation_rate_annual: 0.05,
    responsible_person_id: '',
    remarks: '',
    attachment: null
  });
  const [formData, setFormData] = useState(getInitialFormData());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [monthlyAssets, setMonthlyAssets] = useState([]);
  const [isEditingAsset, setIsEditingAsset] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState(null);

  const FINANCE_EMAILS = ['sean@prinstinegroup.org'];
  const canManageAssets =
    user?.role === 'Admin' ||
    FINANCE_EMAILS.includes((user?.email || '').toLowerCase().trim()) ||
    isFinanceDeptHead;

  const assetCategories = [
    'Furniture & Fixtures',
    'Office Equipment',
    'Computer Equipment',
    'Vehicles',
    'Machinery',
    'Building & Infrastructure',
    'Other'
  ];

  const departments = [
    'Prinstine Group',
    'Academy',
    'Microfinance',
    'Consultancy'
  ];

  const locations = [
    'HQ – Monrovia',
    'Branch Office',
    'Field Office',
    'Warehouse'
  ];

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  useEffect(() => {
    fetchAssets();
    fetchStaffMembers();
    checkFinanceDeptHead();
  }, [filters]);

  const checkFinanceDeptHead = async () => {
    if (user?.role === 'DepartmentHead') {
      try {
        const response = await api.get('/departments');
        const userEmailLower = user.email.toLowerCase().trim();
        const dept = response.data.departments.find(d => 
          (d.manager_id === user.id || 
           (d.head_email && d.head_email.toLowerCase().trim() === userEmailLower)) &&
          d.name && d.name.toLowerCase().includes('finance')
        );
        setIsFinanceDeptHead(!!dept);
      } catch (error) {
        console.error('Error checking finance department head:', error);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'monthly') {
      fetchMonthlyAcquisitions();
    }
  }, [activeTab, selectedMonth, selectedYear]);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.category) params.append('category', filters.category);
      if (filters.department) params.append('department', filters.department);
      if (filters.location) params.append('location', filters.location);
      if (filters.search) params.append('search', filters.search);

      const response = await api.get(`/finance/assets?${params.toString()}`);
      setAssets(response.data.assets || []);
    } catch (error) {
      console.error('Error fetching assets:', error);
      setError('Failed to load assets');
    } finally {
      setLoading(false);
    }
  };

  const fetchMonthlyAcquisitions = async () => {
    try {
      const response = await api.get(`/finance/assets/monthly/${selectedYear}/${selectedMonth}`);
      setMonthlyAssets(response.data.assets || []);
    } catch (error) {
      console.error('Error fetching monthly acquisitions:', error);
    }
  };

  const fetchStaffMembers = async () => {
    try {
      const response = await api.get('/finance/assets/staff');
      setStaffMembers(response.data.staff || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
      setStaffMembers([]);
    }
  };

  const fetchAssetDetails = async (assetId) => {
    try {
      const response = await api.get(`/finance/assets/${assetId}`);
      setSelectedAsset(response.data.asset);
    } catch (error) {
      console.error('Error fetching asset details:', error);
    }
  };

  const handleCreateAsset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const formDataObj = new FormData();
      Object.keys(formData).forEach(key => {
        if (key !== 'attachment' && formData[key]) {
          formDataObj.append(key, formData[key]);
        }
      });
      if (formData.attachment) {
        formDataObj.append('attachment', formData.attachment);
      }

      await api.post('/finance/assets', formDataObj, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setSuccess('Asset created successfully');
      setShowAssetForm(false);
      setIsEditingAsset(false);
      setEditingAssetId(null);
      setFormData(getInitialFormData());
      fetchAssets();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to create asset');
    }
  };

  const handleUpdateAsset = async (e) => {
    e.preventDefault();
    if (!editingAssetId) return;
    setError('');
    setSuccess('');

    try {
      const formDataObj = new FormData();
      const fields = {
        asset_description: formData.asset_description,
        asset_category: formData.asset_category,
        department: formData.department,
        location: formData.location,
        date_acquired: formData.date_acquired,
        supplier: formData.supplier,
        purchase_price_usd: formData.purchase_price_usd,
        purchase_price_lrd: formData.purchase_price_lrd,
        asset_condition: formData.asset_condition,
        serial_number: formData.serial_number,
        warranty_expiry_date: formData.warranty_expiry_date,
        expected_useful_life_years: formData.expected_useful_life_years,
        depreciation_rate_annual: formData.depreciation_rate_annual,
        responsible_person_id: formData.responsible_person_id,
        remarks: formData.remarks
      };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          formDataObj.append(key, value);
        }
      });
      if (formData.attachment) {
        formDataObj.append('attachment', formData.attachment);
      }

      await api.put(`/finance/assets/${editingAssetId}`, formDataObj, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setSuccess('Asset updated successfully');
      setShowAssetForm(false);
      setIsEditingAsset(false);
      setEditingAssetId(null);
      setFormData(getInitialFormData());
      fetchAssets();
      if (selectedAsset && selectedAsset.id === editingAssetId) {
        fetchAssetDetails(editingAssetId);
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to update asset');
    }
  };

  const handleEditAsset = (asset) => {
    setIsEditingAsset(true);
    setEditingAssetId(asset.id);
    setShowAssetForm(true);
    setFormData({
      asset_description: asset.asset_description || '',
      asset_category: asset.asset_category || '',
      department: asset.department || '',
      location: asset.location || '',
      date_acquired: asset.date_acquired ? new Date(asset.date_acquired).toISOString().split('T')[0] : '',
      supplier: asset.supplier || '',
      purchase_price_usd: asset.purchase_price_usd ?? '',
      purchase_price_lrd: asset.purchase_price_lrd ?? '',
      asset_condition: asset.asset_condition || 'Good',
      serial_number: asset.serial_number || '',
      warranty_expiry_date: asset.warranty_expiry_date ? new Date(asset.warranty_expiry_date).toISOString().split('T')[0] : '',
      expected_useful_life_years: asset.expected_useful_life_years || 10,
      depreciation_rate_annual: asset.depreciation_rate_annual ?? 0.05,
      responsible_person_id: asset.responsible_person_id || '',
      remarks: asset.remarks || '',
      attachment: null
    });
  };

  const handleDeleteAsset = async (assetId) => {
    if (!window.confirm('Are you sure you want to delete this asset? This cannot be undone.')) {
      return;
    }
    try {
      await api.delete(`/finance/assets/${assetId}`);
      setSuccess('Asset deleted successfully');
      fetchAssets();
      if (selectedAsset && selectedAsset.id === assetId) {
        setSelectedAsset(null);
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to delete asset');
    }
  };

  const closeAssetForm = () => {
    setShowAssetForm(false);
    setIsEditingAsset(false);
    setEditingAssetId(null);
    setFormData(getInitialFormData());
  };

  const handleApproveAsset = async (assetId, approved) => {
    if (!window.confirm(`Are you sure you want to ${approved ? 'approve' : 'reject'} this asset?`)) {
      return;
    }

    try {
      await api.put(`/finance/assets/${assetId}/approve`, { approved });
      setSuccess(`Asset ${approved ? 'approved' : 'rejected'} successfully`);
      fetchAssets();
      if (selectedAsset && selectedAsset.id === assetId) {
        fetchAssetDetails(assetId);
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to update approval status');
    }
  };

  const calculateDepreciation = (asset) => {
    if (!asset.purchase_price_usd || !asset.depreciation_expense_per_annum) return { accumulated: 0, bookValue: asset.purchase_price_usd };
    
    const today = new Date();
    const acquiredDate = new Date(asset.date_acquired);
    const yearsSinceAcquired = (today - acquiredDate) / (1000 * 60 * 60 * 24 * 365);
    
    if (yearsSinceAcquired <= 0) {
      return { accumulated: 0, bookValue: parseFloat(asset.purchase_price_usd) };
    }
    
    const accumulated = Math.min(
      yearsSinceAcquired * parseFloat(asset.depreciation_expense_per_annum),
      parseFloat(asset.purchase_price_usd)
    );
    const bookValue = parseFloat(asset.purchase_price_usd) - accumulated;
    
    return { accumulated, bookValue };
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center p-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      <div className="row mb-4">
        <div className="col-12 d-flex justify-content-between align-items-center">
          <h1 className="h3 mb-0">Asset Registry</h1>
          {canManageAssets && (
            <button className="btn btn-primary" onClick={() => { setIsEditingAsset(false); setEditingAssetId(null); setShowAssetForm(true); }}>
              <i className="bi bi-plus-circle me-2"></i>Add Asset
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Tabs */}
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
            All Assets
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'monthly' ? 'active' : ''}`} onClick={() => setActiveTab('monthly')}>
            Monthly Acquisitions
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'depreciation' ? 'active' : ''}`} onClick={() => setActiveTab('depreciation')}>
            Depreciation Report
          </button>
        </li>
      </ul>

      {/* Filters */}
      {activeTab === 'all' && (
        <div className="card mb-4">
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search assets..."
                  value={filters.search}
                  onChange={(e) => setFilters({...filters, search: e.target.value})}
                />
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={filters.category}
                  onChange={(e) => setFilters({...filters, category: e.target.value})}
                >
                  <option value="">All Categories</option>
                  {assetCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={filters.department}
                  onChange={(e) => setFilters({...filters, department: e.target.value})}
                >
                  <option value="">All Departments</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={filters.location}
                  onChange={(e) => setFilters({...filters, location: e.target.value})}
                >
                  <option value="">All Locations</option>
                  {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Acquisitions Tab */}
      {activeTab === 'monthly' && (
        <div className="card mb-4">
          <div className="card-body">
            <div className="row g-3 mb-3">
              <div className="col-md-3">
                <select
                  className="form-select"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                >
                  {months.map((month, index) => (
                    <option key={index + 1} value={index + 1}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <input
                  type="number"
                  className="form-control"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  min="2020"
                  max="2100"
                />
              </div>
            </div>
            <h5>Acquisitions for {months[selectedMonth - 1]} {selectedYear}</h5>
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Asset ID</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Purchase Price (USD)</th>
                    <th>Date Acquired</th>
                    <th>Responsible Person</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyAssets.length > 0 ? (
                    monthlyAssets.map((asset) => (
                      <tr key={asset.id}>
                        <td><strong>{asset.asset_id}</strong></td>
                        <td>{asset.asset_description}</td>
                        <td>{asset.asset_category}</td>
                        <td>${parseFloat(asset.purchase_price_usd || 0).toFixed(2)}</td>
                        <td>{new Date(asset.date_acquired).toLocaleDateString()}</td>
                        <td>{asset.responsible_person_name || 'N/A'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="text-center text-muted">No acquisitions for this month</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3"><strong>Total Acquisition Amount:</strong></td>
                    <td><strong>${monthlyAssets.reduce((sum, a) => sum + parseFloat(a.purchase_price_usd || 0), 0).toFixed(2)}</strong></td>
                    <td colSpan="2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Assets List */}
      {(activeTab === 'all' || activeTab === 'depreciation') && (
        <div className="card">
          <div className="card-body">
            {assets.length === 0 ? (
              <div className="text-center text-muted p-4">
                No assets found. Click "Add Asset" to register a new asset.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Asset ID</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Department</th>
                      <th>Purchase Price</th>
                      {activeTab === 'depreciation' && (
                        <>
                          <th>Accumulated Depreciation</th>
                          <th>Current Book Value</th>
                        </>
                      )}
                      <th>Responsible Person</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => {
                      const dep = calculateDepreciation(asset);
                      return (
                        <tr key={asset.id}>
                          <td><strong>{asset.asset_id}</strong></td>
                          <td>{asset.asset_description}</td>
                          <td>{asset.asset_category}</td>
                          <td>{asset.department}</td>
                          <td>${parseFloat(asset.purchase_price_usd || 0).toFixed(2)}</td>
                          {activeTab === 'depreciation' && (
                            <>
                              <td>${dep.accumulated.toFixed(2)}</td>
                              <td><strong>${dep.bookValue.toFixed(2)}</strong></td>
                            </>
                          )}
                          <td>{asset.responsible_person_name || 'N/A'}</td>
                          <td>
                            <span className={`badge bg-${
                              asset.approval_status === 'Approved' ? 'success' :
                              asset.approval_status === 'Pending_Admin' ? 'info' :
                              asset.approval_status === 'Pending_DeptHead' ? 'warning' :
                              asset.approval_status === 'Rejected' ? 'danger' : 'secondary'
                            }`}>
                              {asset.approval_status === 'Pending_DeptHead' ? 'Pending Dept Head' :
                               asset.approval_status === 'Pending_Admin' ? 'Pending Admin' :
                               asset.approval_status}
                            </span>
                            {asset.dept_head_status && (
                              <>
                                <br />
                                <small className="text-muted">
                                  Dept Head: {asset.dept_head_status === 'Approved' ? '✓ Approved' : 
                                             asset.dept_head_status === 'Rejected' ? '✗ Rejected' : 'Pending'}
                                </small>
                              </>
                            )}
                            {asset.admin_status && (
                              <>
                                <br />
                                <small className="text-muted">
                                  Admin: {asset.admin_status === 'Approved' ? '✓ Approved' : 
                                         asset.admin_status === 'Rejected' ? '✗ Rejected' : 'Pending'}
                                </small>
                              </>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-outline-info me-2"
                              onClick={() => fetchAssetDetails(asset.id)}
                            >
                              <i className="bi bi-eye me-1"></i>View
                            </button>
                            {!asset.locked && (
                              <>
                                {/* Finance Department Head can approve if status is Pending_DeptHead */}
                                {isFinanceDeptHead && asset.approval_status === 'Pending_DeptHead' && (
                                  <>
                                    <button
                                      className="btn btn-sm btn-outline-success me-2"
                                      onClick={() => handleApproveAsset(asset.id, true)}
                                    >
                                      <i className="bi bi-check-circle me-1"></i>Approve
                                    </button>
                                    <button
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleApproveAsset(asset.id, false)}
                                    >
                                      <i className="bi bi-x-circle me-1"></i>Reject
                                    </button>
                                  </>
                                )}
                                {/* Admin can approve if status is Pending_Admin */}
                                {user?.role === 'Admin' && asset.approval_status === 'Pending_Admin' && (
                                  <>
                                    <button
                                      className="btn btn-sm btn-outline-success me-2"
                                      onClick={() => handleApproveAsset(asset.id, true)}
                                    >
                                      <i className="bi bi-check-circle me-1"></i>Approve
                                    </button>
                                    <button
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleApproveAsset(asset.id, false)}
                                    >
                                      <i className="bi bi-x-circle me-1"></i>Reject
                                    </button>
                                  </>
                                )}
                                {canManageAssets && (
                                  <>
                                    <button
                                      className="btn btn-sm btn-outline-primary me-2"
                                      onClick={() => handleEditAsset(asset)}
                                    >
                                      <i className="bi bi-pencil-square me-1"></i>Edit
                                    </button>
                                    <button
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleDeleteAsset(asset.id)}
                                    >
                                      <i className="bi bi-trash me-1"></i>Delete
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Asset Form */}
      {showAssetForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{isEditingAsset ? 'Edit Asset' : 'Add Asset'}</h5>
                <button type="button" className="btn-close" onClick={closeAssetForm}></button>
              </div>
              <form onSubmit={isEditingAsset ? handleUpdateAsset : handleCreateAsset}>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-12 mb-3">
                      <label className="form-label">Asset Description *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.asset_description}
                        onChange={(e) => setFormData({...formData, asset_description: e.target.value})}
                        placeholder="e.g., Office Desk - CEO"
                        required
                      />
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Asset Category *</label>
                      <select
                        className="form-select"
                        value={formData.asset_category}
                        onChange={(e) => setFormData({...formData, asset_category: e.target.value})}
                        required
                      >
                        <option value="">Select category...</option>
                        {assetCategories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Department/Subsidiary *</label>
                      <select
                        className="form-select"
                        value={formData.department}
                        onChange={(e) => setFormData({...formData, department: e.target.value})}
                        required
                      >
                        <option value="">Select department...</option>
                        {departments.map(dept => (
                          <option key={dept} value={dept}>{dept}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Location *</label>
                      <select
                        className="form-select"
                        value={formData.location}
                        onChange={(e) => setFormData({...formData, location: e.target.value})}
                        required
                      >
                        <option value="">Select location...</option>
                        {locations.map(loc => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Date Acquired *</label>
                      <input
                        type="date"
                        className="form-control"
                        value={formData.date_acquired}
                        onChange={(e) => setFormData({...formData, date_acquired: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Purchase Price (USD) *</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.purchase_price_usd}
                        onChange={(e) => setFormData({...formData, purchase_price_usd: e.target.value})}
                        step="0.01"
                        min="0"
                        required
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Purchase Price (LRD)</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.purchase_price_lrd}
                        onChange={(e) => setFormData({...formData, purchase_price_lrd: e.target.value})}
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Expected Useful Life (Years) *</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.expected_useful_life_years}
                        onChange={(e) => setFormData({...formData, expected_useful_life_years: parseInt(e.target.value)})}
                        min="1"
                        max="100"
                        required
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Depreciation Rate (Annual) *</label>
                      <input
                        type="number"
                        className="form-control"
                        value={formData.depreciation_rate_annual}
                        onChange={(e) => setFormData({...formData, depreciation_rate_annual: parseFloat(e.target.value)})}
                        step="0.01"
                        min="0"
                        max="1"
                        required
                      />
                      <small className="form-text text-muted">Default: 0.05 (5% per annum)</small>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Responsible Person *</label>
                      <select
                        className="form-select"
                        value={formData.responsible_person_id}
                        onChange={(e) => setFormData({...formData, responsible_person_id: e.target.value})}
                        required
                      >
                        <option value="">Select staff...</option>
                        {staffMembers.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} - {staff.staff_id || staff.role_type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Asset Condition</label>
                      <select
                        className="form-select"
                        value={formData.asset_condition}
                        onChange={(e) => setFormData({...formData, asset_condition: e.target.value})}
                      >
                        <option value="Excellent">Excellent</option>
                        <option value="Good">Good</option>
                        <option value="Fair">Fair</option>
                        <option value="Poor">Poor</option>
                      </select>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Serial Number</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.serial_number}
                        onChange={(e) => setFormData({...formData, serial_number: e.target.value})}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Warranty Expiry Date</label>
                      <input
                        type="date"
                        className="form-control"
                        value={formData.warranty_expiry_date}
                        onChange={(e) => setFormData({...formData, warranty_expiry_date: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Supplier</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.supplier}
                      onChange={(e) => setFormData({...formData, supplier: e.target.value})}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Remarks</label>
                    <textarea
                      className="form-control"
                      value={formData.remarks}
                      onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                      rows="3"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Attachment (Invoice/Photo)</label>
                    <input
                      type="file"
                      className="form-control"
                      accept="image/*,.pdf"
                      onChange={(e) => setFormData({...formData, attachment: e.target.files[0]})}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeAssetForm}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{isEditingAsset ? 'Save Changes' : 'Add Asset'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Asset Details View */}
      {selectedAsset && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Asset Details - {selectedAsset.asset_id}</h5>
                <button type="button" className="btn-close" onClick={() => setSelectedAsset(null)}></button>
              </div>
              <div className="modal-body">
                <div className="row mb-3">
                  <div className="col-md-6">
                    <strong>Description:</strong> {selectedAsset.asset_description}
                  </div>
                  <div className="col-md-6">
                    <strong>Category:</strong> {selectedAsset.asset_category}
                  </div>
                </div>
                <div className="row mb-3">
                  <div className="col-md-4">
                    <strong>Department:</strong> {selectedAsset.department}
                  </div>
                  <div className="col-md-4">
                    <strong>Location:</strong> {selectedAsset.location}
                  </div>
                  <div className="col-md-4">
                    <strong>Date Acquired:</strong> {new Date(selectedAsset.date_acquired).toLocaleDateString()}
                  </div>
                </div>
                <div className="row mb-3">
                  <div className="col-md-4">
                    <strong>Purchase Price (USD):</strong> ${parseFloat(selectedAsset.purchase_price_usd || 0).toFixed(2)}
                  </div>
                  <div className="col-md-4">
                    <strong>Expected Useful Life:</strong> {selectedAsset.expected_useful_life_years} years
                  </div>
                  <div className="col-md-4">
                    <strong>Annual Depreciation:</strong> ${parseFloat(selectedAsset.depreciation_expense_per_annum || 0).toFixed(2)}
                  </div>
                </div>
                {selectedAsset.depreciations && selectedAsset.depreciations.length > 0 && (
                  <div className="mb-3">
                    <h6>Depreciation History</h6>
                    <div className="table-responsive">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Year</th>
                            <th>Depreciation Amount</th>
                            <th>Accumulated Depreciation</th>
                            <th>Book Value at Year End</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedAsset.depreciations.map((dep) => (
                            <tr key={dep.id}>
                              <td>Year {dep.depreciation_year}</td>
                              <td>${parseFloat(dep.depreciation_amount).toFixed(2)}</td>
                              <td>${parseFloat(dep.accumulated_depreciation).toFixed(2)}</td>
                              <td>${parseFloat(dep.book_value_at_year_end).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedAsset(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetRegistry;

