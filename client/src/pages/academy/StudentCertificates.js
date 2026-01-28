import React, { useEffect, useState } from 'react';
import api from '../../config/api';

const StudentCertificates = () => {
  const [certificates, setCertificates] = useState([]);

  useEffect(() => {
    api.get('/academy/students/certificates')
      .then(res => setCertificates(res.data.certificates));
  }, []);

  return (
    <div className="container-fluid">
      <h3>My Certificates</h3>

      {certificates.length === 0 ? (
        <p className="text-muted">No certificates available yet.</p>
      ) : (
        <ul className="list-group">
          {certificates.map(cert => (
            <li key={cert.id} className="list-group-item d-flex justify-content-between">
              {cert.course_title}
              <a href={cert.file_url} className="btn btn-sm btn-primary" download>
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default StudentCertificates;