import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../config/api';
import db from '../../database/db';

const StudentView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);

  useEffect(() => {
    db.get(`SELECT * FROM students WHERE id = ?`, [id])
      .then(res => setStudent(res))
      .catch(err => console.error('Error fetching student:', err));
  }, [id]);

  return (
    <div className="container-fluid">
      <button className="btn btn-outline-secondary mb-3" onClick={() => navigate('/academy')}>
        ← Back
      </button>

      <div className="card">
        <div className="card-body text-center">
          {student.profile_image && student.profile_image.trim() !== '' ? (
            <img
              src={student.profile_image.startsWith('http') ? student.profile_image : normalizeUrl(student.profile_image)}
              alt={student.name}
              className="img-fluid rounded-circle mb-3"
              style={{ width: '150px', height: '150px', objectFit: 'cover' }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          ) : (
            <div className="bg-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
                 style={{ width: '150px', height: '150px' }}>
              <i className="bi bi-person text-white" style={{ fontSize: '4rem' }}></i>
            </div>
          )}
          <h4>{student.name}</h4>
          <p className="text-muted">{student.email}</p>
          <span className={`badge bg-${student.status === 'Active' ? 'success' : 'secondary'} fs-6`}>
            {student.status || 'Active'}
          </span>
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <h5 className="card-title">Student Details</h5>
          <p className="card-text"><strong>Student ID:</strong> {student.student_id}</p>
          <p className="card-text"><strong>Email:</strong> {student.email}</p>
          <p className="card-text"><strong>Phone:</strong> {student.phone || 'N/A'}</p>
          <p className="card-text"><strong>Status:</strong> <span className={`badge bg-${student.status === 'Active' ? 'success' : 'secondary'} fs-6`}>{student.status || 'Active'}</span></p>
        </div>
      </div>
    </div>
  );
};

export default StudentView;
