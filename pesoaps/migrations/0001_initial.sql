CREATE TABLE products (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  purchase_url TEXT NOT NULL,
  name TEXT,
  image_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

INSERT INTO products (id, position, purchase_url) VALUES
  ('pesoaps-1', 0, 'https://dl.flipkart.com/s/lHa0cAuuuN'),
  ('pesoaps-2', 1, 'https://dl.flipkart.com/s/ljdU0EuuuN'),
  ('pesoaps-3', 2, 'https://dl.flipkart.com/s/lH6Q7iuuuN'),
  ('pesoaps-4', 3, 'https://dl.flipkart.com/s/Wra3TgNNNN'),
  ('pesoaps-5', 4, 'https://dl.flipkart.com/s/lHOpNEuuuN');

CREATE TABLE daily_posts (
  day TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  purchase_url TEXT NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT NOT NULL
);

CREATE TABLE deliveries (
  day TEXT NOT NULL REFERENCES daily_posts(day),
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'container_ready', 'publishing', 'published', 'needs_review')),
  container_id TEXT,
  remote_id TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, platform)
);

CREATE TABLE runs (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
