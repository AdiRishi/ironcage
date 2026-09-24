-- Relationship proposals name what they propose: a movement between two accounts, or a
-- credit that returns a purchase.
UPDATE review_items SET question = question || '{"kind": "movement"}'
  WHERE kind = 'relationship' AND NOT question ? 'kind';
