import React, { useState } from 'react';
import axios from 'axios';
import { getApiBaseUrl, getBaseUrl } from '../../utils/apiUrl';
import './PublicClaims.css';

const PublicClaims = () => {
  const [formData, setFormData] = useState({
    policy_number: '',
    company_id: '',
    note: '',
    insurance_type: '',
    attachment_url: ''
  });
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const API_URL = `${getApiBaseUrl()}/claims/public/submit`;
  const BASE_URL = getBaseUrl();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError('');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
      const allowedExtensions = ['.png', '.jpeg', '.jpg', '.pdf'];
      const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
      
      if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
        setError('Invalid file type. Please upload PNG, JPEG, or PDF files only.');
        e.target.value = ''; // Clear the input
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        setError('File size too large. Maximum size is 10MB.');
        e.target.value = ''; // Clear the input
        return;
      }
      
      setAttachmentFile(file);
      setError(''); // Clear any previous errors
      // Clear attachment_url when file is selected
      setFormData(prev => ({
        ...prev,
        attachment_url: ''
      }));
    }
  };

  const validateUrl = (url) => {
    if (!url) return true; // URL is optional
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const uploadFile = async (file) => {
    const uploadFormData = new FormData();
    uploadFormData.append('file', file);

    try {
      // Upload to file upload endpoint
      const uploadResponse = await axios.post(`${getApiBaseUrl()}/upload`, uploadFormData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (uploadResponse.data && uploadResponse.data.url) {
        // The API returns full URL
        let fileUrl = uploadResponse.data.url;
        
        // Validate URL format
        if (!fileUrl || typeof fileUrl !== 'string') {
          throw new Error('Invalid URL returned from server');
        }
        
        // Ensure it's a valid absolute URL
        try {
          new URL(fileUrl);
          return fileUrl;
        } catch {
          // If not a valid URL, construct absolute URL
          if (fileUrl.startsWith('/')) {
            fileUrl = `${BASE_URL}${fileUrl}`;
          } else {
            fileUrl = `${BASE_URL}/${fileUrl}`;
          }
          // Validate the constructed URL
          new URL(fileUrl);
          return fileUrl;
        }
      }
      throw new Error('Upload failed - no URL returned');
    } catch (error) {
      console.error('File upload error:', error);
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      }
      if (error.message) {
        throw error;
      }
      throw new Error('Failed to upload file. Please try again.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.policy_number || !formData.company_id || !formData.note || !formData.insurance_type) {
        throw new Error('Please fill in all required fields');
      }

      // Validate attachment URL if provided
      if (formData.attachment_url && !validateUrl(formData.attachment_url)) {
        throw new Error('Invalid attachment URL. Please provide a valid URL or upload a file.');
      }

      let finalAttachmentUrl = formData.attachment_url;

      // Upload file if provided
      if (attachmentFile) {
        try {
          finalAttachmentUrl = await uploadFile(attachmentFile);
          if (!finalAttachmentUrl) {
            throw new Error('File upload failed - no URL returned');
          }
          // Validate the returned URL
          if (!validateUrl(finalAttachmentUrl)) {
            throw new Error('Invalid URL returned from file upload');
          }
          console.log('File uploaded successfully, URL:', finalAttachmentUrl);
        } catch (uploadError) {
          console.error('Upload error details:', uploadError);
          throw new Error(`File upload failed: ${uploadError.message}`);
        }
      }

      // Prepare submission data
      const submissionData = {
        policy_number: formData.policy_number.trim(),
        company_id: formData.company_id.trim(),
        note: formData.note.trim(),
        insurance_type: formData.insurance_type.trim()
      };

      // Only include attachment_url if it's provided and valid
      if (finalAttachmentUrl) {
        if (!validateUrl(finalAttachmentUrl)) {
          throw new Error('Invalid attachment URL format. Please try uploading the file again.');
        }
        submissionData.attachment_url = finalAttachmentUrl;
        console.log('Submitting with attachment URL:', finalAttachmentUrl);
      } else {
        // If no attachment provided, don't include the field
        console.log('No attachment provided, submitting without attachment_url');
      }

      // Log submission data for debugging
      console.log('Submitting claim with data:', {
        ...submissionData,
        hasAttachment: !!submissionData.attachment_url
      });

      // Submit claim
      const response = await axios.post(API_URL, submissionData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data) {
        setSuccess(true);
        // Reset form
        setFormData({
          policy_number: '',
          company_id: '',
          note: '',
          insurance_type: '',
          attachment_url: ''
        });
        setAttachmentFile(null);
        // Clear file input
        const fileInput = document.getElementById('attachment_file');
        if (fileInput) {
          fileInput.value = '';
        }
      }
    } catch (err) {
      console.error('Claim submission error:', err);
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err.response?.data?.details && Array.isArray(err.response.data.details)) {
        const errorMessages = err.response.data.details.map(d => d.msg || d.message).join(', ');
        setError(errorMessages);
      } else if (err.message) {
        setError(err.message);
      } else {
        setError('Failed to submit claim. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="public-claims-container">
      <div className="public-claims-card">
        <h2 className="mb-4">Submit Insurance Claim</h2>

        {error && (
          <div className="alert alert-danger" role="alert">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        )}

        {success && (
          <div className="alert alert-success" role="alert">
            <i className="bi bi-check-circle me-2"></i>
            Claim submitted successfully!
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="policy_number" className="form-label">
              Policy Number <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="form-control"
              id="policy_number"
              name="policy_number"
              value={formData.policy_number}
              onChange={handleChange}
              required
              placeholder="Enter policy number"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="company_id" className="form-label">
              Company ID <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="form-control"
              id="company_id"
              name="company_id"
              value={formData.company_id}
              onChange={handleChange}
              required
              placeholder="Enter company ID"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="insurance_type" className="form-label">
              Insurance Type <span className="text-danger">*</span>
            </label>
            <select
              className="form-select"
              id="insurance_type"
              name="insurance_type"
              value={formData.insurance_type}
              onChange={handleChange}
              required
            >
              <option value="">Select insurance type</option>
              <option value="health">Health</option>
              <option value="life">Life</option>
              <option value="auto">Auto</option>
              <option value="property">Property</option>
              <option value="travel">Travel</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor="note" className="form-label">
              Claim Description/Note <span className="text-danger">*</span>
            </label>
            <textarea
              className="form-control"
              id="note"
              name="note"
              rows="4"
              value={formData.note}
              onChange={handleChange}
              required
              placeholder="Describe your claim..."
            />
          </div>

          <div className="mb-3">
            <label htmlFor="attachment_file" className="form-label">
              Upload Attachment (Optional)
            </label>
            <input
              type="file"
              className="form-control"
              id="attachment_file"
              onChange={handleFileChange}
              accept=".pdf,.jpg,.jpeg,.png,image/png,image/jpeg,application/pdf"
            />
            <small className="form-text text-muted">
              Supported formats: PNG, JPEG, PDF (Max size: 10MB)
            </small>
            {attachmentFile && (
              <div className="mt-2">
                <span className="badge bg-info">
                  <i className="bi bi-file-earmark me-1"></i>
                  {attachmentFile.name} ({(attachmentFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            )}
          </div>

          <div className="mb-3">
            <label htmlFor="attachment_url" className="form-label">
              Or Provide Attachment URL (Optional)
            </label>
            <input
              type="url"
              className="form-control"
              id="attachment_url"
              name="attachment_url"
              value={formData.attachment_url}
              onChange={handleChange}
              placeholder="https://example.com/document.pdf"
            />
            <small className="form-text text-muted">
              Provide a valid URL to an attachment file
            </small>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-100"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2"></span>
                Submitting...
              </>
            ) : (
              <>
                <i className="bi bi-send me-2"></i>
                Submit Claim
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicClaims;

