ALTER TABLE resource_kinds ADD COLUMN description text NOT NULL DEFAULT ''
  CHECK (length(description) <= 2000);
