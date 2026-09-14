ALTER TABLE imports DROP CONSTRAINT imports_format_check;
ALTER TABLE imports ADD CONSTRAINT imports_format_check CHECK (format IN ('csv', 'ofx', 'pdf'));
