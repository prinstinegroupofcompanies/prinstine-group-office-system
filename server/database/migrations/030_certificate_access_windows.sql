-- Cohort-based certificate access controls
ALTER TABLE cohorts ADD COLUMN cert_access_enabled INTEGER DEFAULT 0;
ALTER TABLE cohorts ADD COLUMN cert_access_start DATETIME;
ALTER TABLE cohorts ADD COLUMN cert_access_end DATETIME;

CREATE INDEX IF NOT EXISTS idx_cohorts_cert_access_enabled ON cohorts(cert_access_enabled);
CREATE INDEX IF NOT EXISTS idx_cohorts_cert_access_window ON cohorts(cert_access_start, cert_access_end);
