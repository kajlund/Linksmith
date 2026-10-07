CREATE TABLE categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name)),
  parent_id bigint REFERENCES categories (id) ON DELETE RESTRICT,
  CHECK (parent_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX categories_root_name
  ON categories (lower(name))
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX categories_child_name
  ON categories (parent_id, lower(name))
  WHERE parent_id IS NOT NULL;

-- Serialize hierarchy changes even for direct SQL writers. The API also locks this table
-- before reading it, so move validation sees a consistent tree.
CREATE FUNCTION category_depth_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(73519201);
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A category cannot parent itself'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM categories
      WHERE id = NEW.parent_id AND parent_id IS NOT NULL
    ) OR EXISTS (
      SELECT 1
      FROM categories
      WHERE parent_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Categories support only root and child levels'
        USING ERRCODE = '23514';
    END IF;
  END IF;


  RETURN NEW;
END
$$;

CREATE TRIGGER categories_depth
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION category_depth_guard();

CREATE TABLE tags (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name))
);

CREATE UNIQUE INDEX tags_name
  ON tags (lower(name));

CREATE TABLE resources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL CHECK (length(url) BETWEEN 1 AND 4096),
  normalized_url text NOT NULL,
  domain text NOT NULL,
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 300),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 50000),
  keywords text NOT NULL DEFAULT '' CHECK (length(keywords) <= 2000),
  rating integer CHECK (rating BETWEEN 1 AND 5),
  favorite boolean NOT NULL DEFAULT false,
  pricing text NOT NULL DEFAULT 'Unknown' CHECK (pricing IN ('Unknown', 'Free', 'Freemium', 'Paid')),
  category_id bigint REFERENCES categories (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resources_normalized_url
  ON resources (normalized_url);

CREATE INDEX resources_category
  ON resources (category_id);

CREATE TABLE resource_tags (
  resource_id bigint NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
  tag_id bigint NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);

CREATE INDEX resource_tags_tag
  ON resource_tags (tag_id, resource_id);
