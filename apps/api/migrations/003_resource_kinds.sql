CREATE TABLE resource_kinds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100 AND name=btrim(name)), key text NOT NULL UNIQUE, sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0), archived boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX resource_kinds_name ON resource_kinds(lower(name));
ALTER TABLE resources ADD COLUMN kind_id uuid REFERENCES resource_kinds(id) ON DELETE RESTRICT;
CREATE INDEX resources_kind ON resources(kind_id);
INSERT INTO resource_kinds(name,key,sort_order) VALUES ('Tool','tool',10),('Article','article',20),('Tutorial','tutorial',30),('Course','course',40),('Book','book',50),('Video','video',60),('Documentation','documentation',70),('Curated List','curated-list',80),('Community','community',90) ON CONFLICT DO NOTHING;
