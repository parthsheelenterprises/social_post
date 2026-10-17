-- Preserve already-posted dates as single-image records. New dates save the
-- ordered carousel so retries cannot change the front image or child order.
ALTER TABLE daily_posts ADD COLUMN image_urls_json TEXT;
UPDATE daily_posts SET image_urls_json=json_array(image_url) WHERE image_urls_json IS NULL;
