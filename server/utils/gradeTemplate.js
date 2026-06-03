/**
 * Prinstine Academy standard grading template (100-point scale).
 * Assignment 10 | Attendance 10 | Presentation 10 | Assessment 20 | Project 20 | Final Exam 30
 */

const GRADE_COMPONENTS = [
  { key: 'assignment', label: 'Assignment', max: 10, column: 'score_assignment' },
  { key: 'attendance', label: 'Attendance', max: 10, column: 'score_attendance' },
  { key: 'presentation', label: 'Presentation', max: 10, column: 'score_presentation' },
  { key: 'assessment', label: 'Assessment', max: 20, column: 'score_assessment' },
  { key: 'project', label: 'Project', max: 20, column: 'score_project' },
  { key: 'final_exam', label: 'Final Exam', max: 30, column: 'score_final_exam' }
];

const TOTAL_POINTS = GRADE_COMPONENTS.reduce((s, c) => s + c.max, 0);

function parseScore(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

/** A: 90–100 | B: 80–89 | C: 70–79 | D: 60–69 | I: 50–59 and below 50 */
function computeLetterGrade(average) {
  const a = Number(average);
  if (Number.isNaN(a)) return '';
  if (a >= 90) return 'A';
  if (a >= 80) return 'B';
  if (a >= 70) return 'C';
  if (a >= 60) return 'D';
  return 'I';
}

function extractScoresFromBody(body) {
  const scores = {};
  if (body.scores && typeof body.scores === 'object') {
    for (const c of GRADE_COMPONENTS) {
      scores[c.key] = body.scores[c.key];
    }
  } else {
    for (const c of GRADE_COMPONENTS) {
      scores[c.key] = body[c.column] ?? body[c.key];
    }
  }
  return scores;
}

function hasComponentScores(body) {
  const scores = extractScoresFromBody(body);
  return GRADE_COMPONENTS.some((c) => scores[c.key] !== undefined && scores[c.key] !== '');
}

function validateAndComputeGrade(rawScores) {
  const errors = [];
  const scores = {};
  let total = 0;

  for (const c of GRADE_COMPONENTS) {
    const val = parseScore(rawScores[c.key]);
    if (val === null) {
      errors.push(`${c.label} is required (0–${c.max})`);
      continue;
    }
    if (val < 0 || val > c.max) {
      errors.push(`${c.label} must be between 0 and ${c.max}`);
      continue;
    }
    scores[c.key] = val;
    total += val;
  }

  if (errors.length) {
    return { valid: false, errors };
  }

  const average = Math.round(total * 100) / 100;
  const letterGrade = computeLetterGrade(average);

  return {
    valid: true,
    scores,
    average,
    letterGrade,
    dbFields: {
      score_assignment: scores.assignment,
      score_attendance: scores.attendance,
      score_presentation: scores.presentation,
      score_assessment: scores.assessment,
      score_project: scores.project,
      score_final_exam: scores.final_exam,
      score_average: average,
      proposed_grade: letterGrade
    }
  };
}

function parseGradeSubmissionInput(body) {
  if (hasComponentScores(body)) {
    const result = validateAndComputeGrade(extractScoresFromBody(body));
    if (!result.valid) {
      const err = new Error(result.errors.join('; '));
      err.statusCode = 400;
      throw err;
    }
    return result.dbFields;
  }
  const proposed = String(body.proposed_grade || '').trim();
  if (!proposed) {
    const err = new Error('Grade components or letter grade is required');
    err.statusCode = 400;
    throw err;
  }
  return { proposed_grade: proposed };
}

function gradeRowToBreakdown(row) {
  if (!row) return null;
  const hasBreakdown = GRADE_COMPONENTS.some((c) => row[c.column] != null);
  if (!hasBreakdown) {
    return {
      letter_grade: row.proposed_grade || row.grade || row.letter_grade || '',
      average: row.score_average ?? null,
      components: null
    };
  }
  const components = {};
  for (const c of GRADE_COMPONENTS) {
    components[c.key] = row[c.column] != null ? Number(row[c.column]) : null;
  }
  return {
    letter_grade: row.proposed_grade || row.grade || row.letter_grade || computeLetterGrade(row.score_average),
    average: row.score_average != null ? Number(row.score_average) : null,
    components
  };
}

const GRADE_SELECT_COLUMNS = `
  g.score_assignment, g.score_attendance, g.score_presentation,
  g.score_assessment, g.score_project, g.score_final_exam, g.score_average
`;

module.exports = {
  GRADE_COMPONENTS,
  TOTAL_POINTS,
  computeLetterGrade,
  extractScoresFromBody,
  hasComponentScores,
  validateAndComputeGrade,
  parseGradeSubmissionInput,
  gradeRowToBreakdown,
  GRADE_SELECT_COLUMNS
};
