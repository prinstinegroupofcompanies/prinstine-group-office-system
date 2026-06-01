-- Department head endorsement before admin final approval

ALTER TABLE grade_submissions ADD COLUMN endorsed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE grade_submissions ADD COLUMN endorsed_at DATETIME;
