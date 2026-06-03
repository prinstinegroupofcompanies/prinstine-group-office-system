import React, { useMemo } from 'react';
import {
  GRADE_COMPONENTS,
  TOTAL_POINTS,
  computeFromScores
} from '../../utils/gradeTemplate';

/**
 * Standard Prinstine grading template: component scores → average → letter grade.
 */
const GradeTemplateForm = ({
  scores,
  onChange,
  disabled = false,
  showStudentInfo = false,
  studentName = '',
  studentCode = ''
}) => {
  const { average, letterGrade } = useMemo(() => computeFromScores(scores), [scores]);

  const handleChange = (key, value) => {
    onChange({ ...scores, [key]: value });
  };

  return (
    <div className="grade-template-form">
      {showStudentInfo && (studentName || studentCode) && (
        <div className="row g-2 mb-3 small">
          <div className="col-md-6"><strong>Name:</strong> {studentName || '—'}</div>
          <div className="col-md-6"><strong>ID:</strong> {studentCode || '—'}</div>
        </div>
      )}
      <div className="table-responsive">
        <table className="table table-bordered table-sm align-middle mb-2">
          <thead className="table-light">
            <tr>
              {GRADE_COMPONENTS.map((c) => (
                <th key={c.key} className="text-center small">
                  {c.label}
                  <div className="text-muted fw-normal">({c.max})</div>
                </th>
              ))}
              <th className="text-center small">
                Average
                <div className="text-muted fw-normal">({TOTAL_POINTS})</div>
              </th>
              <th className="text-center small">Letter Grade</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {GRADE_COMPONENTS.map((c) => (
                <td key={c.key} className="p-1">
                  <input
                    type="number"
                    className="form-control form-control-sm text-center"
                    min={0}
                    max={c.max}
                    step="0.01"
                    value={scores[c.key]}
                    onChange={(e) => handleChange(c.key, e.target.value)}
                    disabled={disabled}
                    required
                    aria-label={c.label}
                  />
                </td>
              ))}
              <td className="text-center fw-bold">{average != null ? average : '—'}</td>
              <td className="text-center fw-bold text-primary">{letterGrade}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted small mb-0">
        Enter scores for each component. Average and letter grade are calculated automatically (A: 90–100, B: 80–89, C: 70–79, D: 60–69, F: below 60).
      </p>
    </div>
  );
};

export default GradeTemplateForm;
