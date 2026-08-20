ALTER TABLE team_applications
  MODIFY COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';
