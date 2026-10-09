-- Run with the app stopped. The runner executes this entire migration in a
-- transaction and records it in schema_migrations only after success.
-- New UUID columns temporarily provide an integer-to-UUID mapping; every existing
-- row and association is retained. No CASCADE, table reset, or content rewrite.
LOCK TABLE categories, tags, resources, resource_tags IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER categories_depth ON categories';
END
$$;

ALTER TABLE categories
  ADD COLUMN id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE tags
  ADD COLUMN id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE resources
  ADD COLUMN id_uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE categories
  ADD COLUMN parent_id_uuid uuid;

ALTER TABLE resources
  ADD COLUMN category_id_uuid uuid;

ALTER TABLE resource_tags
  ADD COLUMN resource_id_uuid uuid;

ALTER TABLE resource_tags
  ADD COLUMN tag_id_uuid uuid;

UPDATE categories child
SET parent_id_uuid = parent.id_uuid
FROM categories parent
WHERE child.parent_id = parent.id;

UPDATE resources r
SET category_id_uuid = c.id_uuid
FROM categories c
WHERE r.category_id = c.id;

UPDATE resource_tags rt
SET resource_id_uuid = r.id_uuid, tag_id_uuid = t.id_uuid
FROM resources r, tags t
WHERE rt.resource_id = r.id AND rt.tag_id = t.id;

-- Fail and roll back before removing the old keys if any mapping is incomplete.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM categories
    WHERE parent_id IS NOT NULL AND parent_id_uuid IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM resources
    WHERE category_id IS NOT NULL AND category_id_uuid IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM resource_tags
    WHERE resource_id_uuid IS NULL OR tag_id_uuid IS NULL
  ) THEN
    RAISE EXCEPTION 'UUID migration could not map every relationship';
  END IF;
END
$$;

ALTER TABLE categories
  DROP CONSTRAINT categories_parent_id_fkey;

ALTER TABLE resources
  DROP CONSTRAINT resources_category_id_fkey;

ALTER TABLE resource_tags
  DROP CONSTRAINT resource_tags_resource_id_fkey;

ALTER TABLE resource_tags
  DROP CONSTRAINT resource_tags_tag_id_fkey;

ALTER TABLE categories
  DROP CONSTRAINT categories_check;

ALTER TABLE categories
  DROP CONSTRAINT categories_pkey;

ALTER TABLE tags
  DROP CONSTRAINT tags_pkey;

ALTER TABLE resources
  DROP CONSTRAINT resources_pkey;

ALTER TABLE resource_tags
  DROP CONSTRAINT resource_tags_pkey;

-- PostgreSQL drops indexes depending on these old columns, including category
-- name indexes and relationship indexes. Recreate them on the new columns below.
ALTER TABLE categories
  DROP COLUMN parent_id,
  DROP COLUMN id;

ALTER TABLE tags
  DROP COLUMN id;

ALTER TABLE resources
  DROP COLUMN category_id,
  DROP COLUMN id;

ALTER TABLE resource_tags
  DROP COLUMN resource_id,
  DROP COLUMN tag_id;

ALTER TABLE categories
  RENAME COLUMN id_uuid TO id;

ALTER TABLE categories
  RENAME COLUMN parent_id_uuid TO parent_id;

ALTER TABLE tags
  RENAME COLUMN id_uuid TO id;

ALTER TABLE resources
  RENAME COLUMN id_uuid TO id;

ALTER TABLE resources
  RENAME COLUMN category_id_uuid TO category_id;

ALTER TABLE resource_tags
  RENAME COLUMN resource_id_uuid TO resource_id;

ALTER TABLE resource_tags
  RENAME COLUMN tag_id_uuid TO tag_id;

ALTER TABLE categories
  ADD PRIMARY KEY (id);

ALTER TABLE tags
  ADD PRIMARY KEY (id);

ALTER TABLE resources
  ADD PRIMARY KEY (id);

ALTER TABLE resource_tags
  ALTER COLUMN resource_id SET NOT NULL,
  ALTER COLUMN tag_id SET NOT NULL;

ALTER TABLE resource_tags
  ADD PRIMARY KEY (resource_id, tag_id);

ALTER TABLE categories
  ADD CONSTRAINT categories_parent_id_fkey
  FOREIGN KEY (parent_id)
  REFERENCES categories (id) ON DELETE RESTRICT;

ALTER TABLE categories
  ADD CONSTRAINT categories_check
  CHECK (parent_id IS DISTINCT FROM id);

ALTER TABLE resources
  ADD CONSTRAINT resources_category_id_fkey
  FOREIGN KEY (category_id)
  REFERENCES categories (id) ON DELETE RESTRICT;

ALTER TABLE resource_tags
  ADD CONSTRAINT resource_tags_resource_id_fkey
  FOREIGN KEY (resource_id)
  REFERENCES resources (id) ON DELETE CASCADE;

ALTER TABLE resource_tags
  ADD CONSTRAINT resource_tags_tag_id_fkey
  FOREIGN KEY (tag_id)
  REFERENCES tags (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX categories_root_name
  ON categories (lower(name))
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX categories_child_name
  ON categories (parent_id, lower(name))
  WHERE parent_id IS NOT NULL;

CREATE INDEX resources_category
  ON resources (category_id);

CREATE INDEX resource_tags_tag
  ON resource_tags (tag_id, resource_id);

CREATE TRIGGER categories_depth
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION category_depth_guard();
