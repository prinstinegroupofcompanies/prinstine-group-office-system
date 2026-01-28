// src/pages/StudentGrades.js
import React, { useState, useEffect } from 'react';
import api from '../config/api'; // Make sure your API config is correct
import { useAuth } from '../../hooks/useAuth';
import { isAcademyStaff as isAcademyStaffUtils } from '../../utils/academyUtils';
import { useNavigate } from 'react-router-dom';

const StudentGrades = () => {
  const navigate = useNavigate();
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const isAcademyStaff = isAcademyStaffUtils(user);

  useEffect(() => {
    if (!isAcademyStaff) {
      navigate('/academy');
      return;
    }
    const fetchGrades = async () => {
      try {
        const res = await api.get('/academy/grades'); // Replace with your real endpoint
        setGrades(res.data.grades || []);
      } catch (err) {
        console.error('Failed to fetch student grades:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGrades();
  }, []);

  return (
    <div className="academy-page">
      <h1>Student Grades</h1>
      {loading ? (
        <p>Loading grades...</p>
      ) : grades.length === 0 ? (
        <p>No grades found.</p>
      ) : (
        <table className="grades-table">
          <thead>
            <tr>
              <th>Student Name</th>
              <th>Course</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.id}>
                <td>{g.student_name}</td>
                <td>{g.course_name}</td>
                <td>{g.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default StudentGrades;
