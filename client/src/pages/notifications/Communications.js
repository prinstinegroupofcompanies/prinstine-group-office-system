import React, { useState, useEffect } from 'react';
import api from '../../config/api';
import { useAuth } from '../../hooks/useAuth';
import { initSocket, getSocket } from '../../config/socket';
import { handleAttachmentAction } from '../../utils/documentUtils';
import RecipientSelector from '../../components/RecipientSelector';

const Communications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSendForm, setShowSendForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFormData, setSendFormData] = useState({
    subject: '',
    message: '',
    type: 'info'
  });
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [sendAttachments, setSendAttachments] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);

  useEffect(() => {
    fetchNotifications();
    if (user) {
      fetchAvailableUsers();
    }
    
    // Set up real-time socket connection
    if (user?.id) {
      const socket = initSocket(user.id);
      
      socket.on('notification', (notification) => {
        setNotifications(prev => [notification, ...prev]);
        if (selectedNotification && notification.parentId === selectedNotification.id) {
          fetchThread(selectedNotification.id);
        }
      });

      socket.on('notification_acknowledged', (data) => {
        setNotifications(prev => prev.map(n => 
          n.id === data.notificationId 
            ? { ...n, is_acknowledged: 1, acknowledged_at: data.acknowledgedAt }
            : n
        ));
      });

      return () => {
        socket.off('notification');
        socket.off('notification_acknowledged');
      };
    }
  }, [user, selectedNotification]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await api.get('/notifications?limit=100');
      setNotifications(response.data.notifications || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setError('Failed to load communications');
    } finally {
      setLoading(false);
    }
  };

  const fetchThread = async (notificationId) => {
    try {
      const response = await api.get(`/notifications/${notificationId}/thread`);
      setThread(response.data.thread);
    } catch (error) {
      console.error('Error fetching thread:', error);
      setError('Failed to load thread');
    }
  };

  const fetchAvailableUsers = async () => {
    try {
      const response = await api.get('/notifications/users');
      const usersData = response.data?.users || response.data || [];
      const filteredUsers = Array.isArray(usersData) ? usersData.filter(u => u.id !== user?.id) : [];
      setAvailableUsers(filteredUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleSendFileUpload = (files) => {
    if (!files || files.length === 0) return;
    
    const newFiles = Array.from(files).map(file => ({
      file: file,
      filename: file.name,
      size: file.size
    }));
    
    setSendAttachments(prev => [...prev, ...newFiles]);
  };

  const removeSendAttachment = (index) => {
    setSendAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendSubmit = async (e) => {
    e.preventDefault();
    if (!sendFormData.subject.trim() || !sendFormData.message.trim()) {
      setError('Please fill in subject and message');
      return;
    }

    if (selectedRecipients.length === 0) {
      setError('Please select at least one recipient');
      return;
    }

    setSending(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('title', sendFormData.subject);
      formData.append('message', sendFormData.message);
      formData.append('type', sendFormData.type);
      
      const userIds = selectedRecipients.map(r => r.id);
      formData.append('userIds', JSON.stringify(userIds));

      // Add attachments
      sendAttachments.forEach(att => {
        formData.append('attachments', att.file);
      });

      const response = await api.post('/notifications/send', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setSendFormData({
        subject: '',
        message: '',
        type: 'info'
      });
      setSelectedRecipients([]);
      setSendAttachments([]);
      setShowSendForm(false);
      setSuccess(response.data?.message || 'Communication sent successfully');
      setTimeout(() => setSuccess(''), 3000);
      fetchNotifications();
    } catch (error) {
      console.error('[Communications] Error sending communication:', error);
      const errorMessage = error.response?.data?.error 
        || error.response?.data?.message 
        || (error.response?.data?.errors && error.response.data.errors.map(e => e.msg).join(', '))
        || 'Failed to send communication';
      setError(errorMessage);
    } finally {
      setSending(false);
    }
  };

  const handleNotificationClick = async (notification) => {
    setSelectedNotification(notification);
    await fetchThread(notification.id);
    
    if (!notification.is_read) {
      try {
        await api.put(`/notifications/${notification.id}/read`);
        setNotifications(prev => prev.map(n => 
          n.id === notification.id ? { ...n, is_read: 1 } : n
        ));
      } catch (error) {
        console.error('Error marking as read:', error);
      }
    }
  };

  const handleAcknowledge = async (notificationId) => {
    try {
      await api.put(`/notifications/${notificationId}/acknowledge`);
      setNotifications(prev => prev.map(n => 
        n.id === notificationId 
          ? { ...n, is_acknowledged: 1, acknowledged_at: new Date().toISOString() }
          : n
      ));
      if (thread && thread.id === notificationId) {
        setThread(prev => ({ ...prev, is_acknowledged: 1, acknowledged_at: new Date().toISOString() }));
      }
      setSuccess('Communication acknowledged');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error acknowledging:', error);
      setError('Failed to acknowledge communication');
    }
  };

  const handleReplyFileUpload = (files) => {
    if (!files || files.length === 0) return;
    
    const newFiles = Array.from(files).map(file => ({
      file: file,
      filename: file.name,
      size: file.size
    }));
    
    setReplyAttachments(prev => [...prev, ...newFiles]);
  };

  const removeReplyAttachment = (index) => {
    setReplyAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyMessage.trim()) {
      setError('Please enter a message');
      return;
    }

    setReplying(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('message', replyMessage);
      formData.append('type', 'info');
      
      replyAttachments.forEach(att => {
        formData.append('attachments', att.file);
      });

      await api.post(`/notifications/${selectedNotification.id}/reply`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setReplyMessage('');
      setReplyAttachments([]);
      setSuccess('Reply sent successfully');
      setTimeout(() => setSuccess(''), 3000);
      
      await fetchThread(selectedNotification.id);
      await fetchNotifications();
    } catch (error) {
      console.error('Error sending reply:', error);
      setError(error.response?.data?.error || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getTypeBadgeClass = (type) => {
    switch (type) {
      case 'success': return 'bg-success';
      case 'warning': return 'bg-warning';
      case 'error': return 'bg-danger';
      default: return 'bg-info';
    }
  };

  return (
    <div className="container-fluid" style={{ height: 'calc(100vh - 120px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="row mb-3">
        <div className="col-12 d-flex justify-content-between align-items-center">
          <div>
            <h1 className="h3 mb-0">Communications</h1>
            <p className="text-muted">View and reply to your communications</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowSendForm(!showSendForm)}
          >
            <i className="bi bi-plus-circle me-2"></i>
            {showSendForm ? 'Cancel' : 'Compose'}
          </button>
        </div>
      </div>

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

      {/* Gmail-like Compose Form */}
      {showSendForm && (
        <div className="card mb-3 shadow-lg" style={{ zIndex: 1000 }}>
          <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
            <h5 className="mb-0">New Message</h5>
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={() => {
                setShowSendForm(false);
                setSendFormData({ subject: '', message: '', type: 'info' });
                setSelectedRecipients([]);
                setSendAttachments([]);
              }}
            ></button>
          </div>
          <div className="card-body">
            <form onSubmit={handleSendSubmit}>
              <div className="mb-3">
                <RecipientSelector
                  users={availableUsers}
                  selectedRecipients={selectedRecipients}
                  onRecipientsChange={setSelectedRecipients}
                  placeholder="To: Type name or email..."
                />
              </div>

              <div className="mb-3">
                <label className="form-label fw-bold">Subject</label>
                <input
                  type="text"
                  className="form-control"
                  value={sendFormData.subject}
                  onChange={(e) => setSendFormData(prev => ({ ...prev, subject: e.target.value }))}
                  placeholder="Subject"
                  required
                />
              </div>

              <div className="mb-3">
                <label className="form-label fw-bold">Message</label>
                <textarea
                  className="form-control"
                  rows="8"
                  value={sendFormData.message}
                  onChange={(e) => setSendFormData(prev => ({ ...prev, message: e.target.value }))}
                  placeholder="Compose your message..."
                  required
                />
              </div>

              <div className="mb-3">
                <label className="form-label">
                  <i className="bi bi-paperclip me-2"></i>
                  Attachments (Optional)
                </label>
                <input
                  type="file"
                  className="form-control"
                  multiple
                  onChange={(e) => handleSendFileUpload(e.target.files)}
                  disabled={sending}
                  accept="*/*"
                />
                <small className="text-muted">
                  All file types accepted. Max 50MB per file.
                </small>
                {sendAttachments.length > 0 && (
                  <div className="mt-2">
                    {sendAttachments.map((att, idx) => (
                      <div key={idx} className="badge bg-secondary me-2 mb-2 p-2">
                        <i className="bi bi-paperclip me-1"></i>
                        {att.filename} ({formatFileSize(att.size)})
                        <button
                          type="button"
                          className="btn-close btn-close-white ms-2"
                          onClick={() => removeSendAttachment(idx)}
                          style={{ fontSize: '0.7rem' }}
                        ></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="d-flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sending}
                >
                  {sending ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Sending...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-send me-2"></i>
                      Send
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowSendForm(false);
                    setSendFormData({ subject: '', message: '', type: 'info' });
                    setSelectedRecipients([]);
                    setSendAttachments([]);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="row flex-grow-1" style={{ overflow: 'hidden' }}>
        {/* Notifications List */}
        <div className="col-md-4 d-flex flex-column" style={{ overflow: 'hidden' }}>
          <div className="card flex-grow-1 d-flex flex-column">
            <div className="card-header">
              <h5 className="mb-0">Inbox</h5>
            </div>
            <div className="card-body p-0 flex-grow-1" style={{ overflowY: 'auto' }}>
              {loading ? (
                <div className="text-center p-4">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center p-4 text-muted">
                  <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                  No communications
                </div>
              ) : (
                <div className="list-group list-group-flush">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className={`list-group-item list-group-item-action ${
                        selectedNotification?.id === notification.id ? 'active' : ''
                      } ${!notification.is_read ? 'fw-bold' : ''}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div className="d-flex align-items-center mb-1">
                            <span className={`badge ${getTypeBadgeClass(notification.type)} me-2`}>
                              {notification.type}
                            </span>
                            {notification.sender_name && (
                              <small className="text-muted">From: {notification.sender_name}</small>
                            )}
                          </div>
                          <h6 className="mb-1">{notification.title}</h6>
                          <p className="mb-1 text-truncate" style={{ maxWidth: '200px' }}>
                            {notification.message}
                          </p>
                          <small className="text-muted">{formatDate(notification.created_at)}</small>
                          {notification.attachments && notification.attachments.length > 0 && (
                            <div className="mt-1">
                              <i className="bi bi-paperclip me-1"></i>
                              <small>{notification.attachments.length} attachment(s)</small>
                            </div>
                          )}
                        </div>
                        {!notification.is_read && (
                          <span className="badge bg-primary rounded-pill">New</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Thread View */}
        <div className="col-md-8 d-flex flex-column" style={{ overflow: 'hidden' }}>
          {selectedNotification && thread ? (
            <div className="card flex-grow-1 d-flex flex-column">
              <div className="card-header d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="mb-0">{thread.title}</h5>
                  {thread.sender_name && (
                    <small className="text-muted">From: {thread.sender_name} ({thread.sender_email})</small>
                  )}
                </div>
                <div>
                  {!thread.is_acknowledged && (
                    <button
                      className="btn btn-sm btn-outline-primary me-2"
                      onClick={() => handleAcknowledge(thread.id)}
                    >
                      <i className="bi bi-check-circle me-1"></i>
                      Acknowledge
                    </button>
                  )}
                  {thread.is_acknowledged && (
                    <span className="badge bg-success">
                      <i className="bi bi-check-circle me-1"></i>
                      Acknowledged {formatDate(thread.acknowledged_at)}
                    </span>
                  )}
                </div>
              </div>
              <div className="card-body flex-grow-1" style={{ overflowY: 'auto' }}>
                {/* Original Message */}
                <div className="mb-4 pb-3 border-bottom">
                  <div className="d-flex justify-content-between mb-2">
                    <span className={`badge ${getTypeBadgeClass(thread.type)}`}>
                      {thread.type}
                    </span>
                    <small className="text-muted">{formatDate(thread.created_at)}</small>
                  </div>
                  <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>{thread.message}</p>
                  
                  {/* Attachments */}
                  {thread.attachments && thread.attachments.length > 0 && (
                    <div className="mt-3">
                      <strong>Attachments:</strong>
                      <div className="list-group mt-2">
                        {thread.attachments.map((att, idx) => (
                          <div key={idx} className="list-group-item d-flex justify-content-between align-items-center">
                            <span
                              className="text-decoration-none flex-grow-1"
                              style={{ cursor: 'pointer' }}
                              onClick={() => handleAttachmentAction(att, 'view')}
                            >
                              <i className="bi bi-paperclip me-2"></i>
                              {att.filename || att.url} {att.size && `(${formatFileSize(att.size)})`}
                            </span>
                            <div className="btn-group btn-group-sm">
                              <button
                                className="btn btn-outline-info btn-sm"
                                onClick={() => handleAttachmentAction(att, 'view')}
                                title="View"
                              >
                                <i className="bi bi-eye"></i>
                              </button>
                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => handleAttachmentAction(att, 'download')}
                                title="Download"
                              >
                                <i className="bi bi-download"></i>
                              </button>
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => handleAttachmentAction(att, 'print')}
                                title="Print"
                              >
                                <i className="bi bi-printer"></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Replies */}
                {thread.replies && thread.replies.length > 0 && (
                  <div className="mb-4">
                    <h6 className="mb-3">Replies ({thread.replies.length})</h6>
                    {thread.replies.map((reply) => (
                      <div key={reply.id} className="mb-3 pb-3 border-bottom">
                        <div className="d-flex justify-content-between mb-2">
                          <div>
                            <strong>{reply.sender_name || 'Unknown'}</strong>
                            <small className="text-muted ms-2">({reply.sender_email})</small>
                          </div>
                          <small className="text-muted">{formatDate(reply.created_at)}</small>
                        </div>
                        <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>{reply.message}</p>
                        
                        {/* Reply Attachments */}
                        {reply.attachments && reply.attachments.length > 0 && (
                          <div className="mt-2">
                            <strong>Attachments:</strong>
                            <div className="list-group mt-2">
                              {reply.attachments.map((att, idx) => (
                                <div key={idx} className="list-group-item d-flex justify-content-between align-items-center">
                                  <span
                                    className="text-decoration-none flex-grow-1"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => handleAttachmentAction(att, 'view')}
                                  >
                                    <i className="bi bi-paperclip me-2"></i>
                                    {att.filename || att.url} {att.size && `(${formatFileSize(att.size)})`}
                                  </span>
                                  <div className="btn-group btn-group-sm">
                                    <button
                                      className="btn btn-outline-info btn-sm"
                                      onClick={() => handleAttachmentAction(att, 'view')}
                                      title="View"
                                    >
                                      <i className="bi bi-eye"></i>
                                    </button>
                                    <button
                                      className="btn btn-outline-primary btn-sm"
                                      onClick={() => handleAttachmentAction(att, 'download')}
                                      title="Download"
                                    >
                                      <i className="bi bi-download"></i>
                                    </button>
                                    <button
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => handleAttachmentAction(att, 'print')}
                                      title="Print"
                                    >
                                      <i className="bi bi-printer"></i>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply Form */}
                <div className="mt-4 pt-3 border-top">
                  <h6 className="mb-3">Reply</h6>
                  <form onSubmit={handleReplySubmit}>
                    <div className="mb-3">
                      <textarea
                        className="form-control"
                        rows="4"
                        value={replyMessage}
                        onChange={(e) => setReplyMessage(e.target.value)}
                        placeholder="Type your reply..."
                        required
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label className="form-label">Attachments (Optional)</label>
                      <input
                        type="file"
                        className="form-control"
                        multiple
                        onChange={(e) => handleReplyFileUpload(e.target.files)}
                        disabled={uploading}
                        accept="*/*"
                      />
                      <small className="text-muted">
                        All file types accepted. Max 50MB per file.
                      </small>
                      {replyAttachments.length > 0 && (
                        <div className="mt-2">
                          {replyAttachments.map((att, idx) => (
                            <div key={idx} className="badge bg-secondary me-2 mb-2 p-2">
                              <i className="bi bi-paperclip me-1"></i>
                              {att.filename}
                              <button
                                type="button"
                                className="btn-close btn-close-white ms-2"
                                onClick={() => removeReplyAttachment(idx)}
                                style={{ fontSize: '0.7rem' }}
                              ></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={replying || !replyMessage.trim()}
                    >
                      {replying ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2"></span>
                          Sending...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-send me-2"></i>
                          Send Reply
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ) : (
            <div className="card flex-grow-1 d-flex align-items-center justify-content-center">
              <div className="text-center text-muted p-5">
                <i className="bi bi-chat-left-text fs-1 d-block mb-3"></i>
                <p>Select a communication to view details and reply</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Communications;
