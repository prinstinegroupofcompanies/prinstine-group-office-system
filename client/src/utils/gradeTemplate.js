/** Client mirror of server/utils/gradeTemplate.js */

export const GRADE_COMPONENTS = [
  { key: 'assignment', label: 'Assignment', max: 10 },
  { key: 'attendance', label: 'Attendance', max: 10 },
  { key: 'presentation', label: 'Presentation', max: 10 },
  { key: 'assessment', label: 'Assessment', max: 20 },
  { key: 'project', label: 'Project', max: 20 },
  { key: 'final_exam', label: 'Final Exam', max: 30 }
];

export const TOTAL_POINTS = GRADE_COMPONENTS.reduce((s, c) => s + c.max, 0);

export const EMPTY_GRADE_SCORES = {
  assignment: '',
  attendance: '',
  presentation: '',
  assessment: '',
  project: '',
  final_exam: ''
};

export function parseScore(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** A: 90–100 | B: 80–89 | C: 70–79 | D: 60–69 | I: 50–59 and below 50 */
export function computeLetterGrade(average) {
  const a = Number(average);
  if (Number.isNaN(a)) return '—';
  if (a >= 90) return 'A';
  if (a >= 80) return 'B';
  if (a >= 70) return 'C';
  if (a >= 60) return 'D';
  return 'I';
}

export function computeFromScores(scores) {
  let total = 0;
  let complete = true;
  for (const c of GRADE_COMPONENTS) {
    const val = parseScore(scores[c.key]);
    if (val === null) {
      complete = false;
      continue;
    }
    total += val;
  }
  const average = complete ? Math.round(total * 100) / 100 : null;
  return {
    average,
    letterGrade: average != null ? computeLetterGrade(average) : '—'
  };
}

export function scoresFromGradeRow(row) {
  if (!row) return { ...EMPTY_GRADE_SCORES };
  return {
    assignment: row.score_assignment ?? row.components?.assignment ?? '',
    attendance: row.score_attendance ?? row.components?.attendance ?? '',
    presentation: row.score_presentation ?? row.components?.presentation ?? '',
    assessment: row.score_assessment ?? row.components?.assessment ?? '',
    project: row.score_project ?? row.components?.project ?? '',
    final_exam: row.score_final_exam ?? row.components?.final_exam ?? ''
  };
}

export function buildGradeSubmitPayload(studentId, courseId, scores) {
  return {
    student_id: parseInt(studentId, 10),
    course_id: parseInt(courseId, 10),
    score_assignment: parseScore(scores.assignment),
    score_attendance: parseScore(scores.attendance),
    score_presentation: parseScore(scores.presentation),
    score_assessment: parseScore(scores.assessment),
    score_project: parseScore(scores.project),
    score_final_exam: parseScore(scores.final_exam)
  };
}

export function validateScoresForSubmit(scores) {
  const errors = [];
  for (const c of GRADE_COMPONENTS) {
    const val = parseScore(scores[c.key]);
    if (val === null) {
      errors.push(`${c.label} is required (0–${c.max})`);
    } else if (val < 0 || val > c.max) {
      errors.push(`${c.label} must be 0–${c.max}`);
    }
  }
  return errors;
}
