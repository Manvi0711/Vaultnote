-- share tokens table
CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY,
  folder_id TEXT,
  expires_at INTEGER,
  read_only INTEGER DEFAULT 1,
  FOREIGN KEY(folder_id) REFERENCES folders(id)
);
