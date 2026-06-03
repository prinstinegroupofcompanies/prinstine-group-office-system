-- Remove academy permissions from users who are not Academy staff.
-- Marketing and other non-Academy department heads should only receive
-- academy access via explicit assignment by Admin / Academy department head.

DELETE FROM staff_academy_permissions
WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE LOWER(TRIM(u.email)) = 'jsieh@prinstinegroup.org'
);
