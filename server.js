// server.js - backend with share token support
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db, migrate, nowSeconds } = require('./db');
const path = require('path');

migrate(); // ensure DB schema exists

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const SALT_ROUNDS = 10;
const DEFAULT_EXPIRE_YEARS = 5;
const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;

// helpers
function getFolder(id) {
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
}
function folderExpired(folder) {
  return !folder || nowSeconds() > folder.expires_at;
}

function getTokenRow(token) {
  return db.prepare('SELECT * FROM share_tokens WHERE token = ?').get(token);
}
function tokenExpired(row) {
  return !row || nowSeconds() > row.expires_at;
}

// --- API endpoints ---

// create a folder
app.post('/api/folders', async (req, res) => {
  try {
    const { name, password, years } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const id = uuidv4();
    const created_at = nowSeconds();
    const useYears = (years && Number(years)) || DEFAULT_EXPIRE_YEARS;
    const expires_at = created_at + useYears * SECONDS_IN_YEAR;
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    db.prepare('INSERT INTO folders (id, name, password_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name || '', password_hash, created_at, expires_at);

    res.json({ folderId: id, expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// verify password (frontend uses this to open folder)
app.post('/api/folders/:id/verify', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });
    const { password } = req.body;
    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });
    res.json({ ok: true, expires_at: folder.expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// add message
app.post('/api/folders/:id/messages', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });

    const { password, content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    const id = uuidv4();
    const now = nowSeconds();
    db.prepare('INSERT INTO messages (id, folder_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, folder.id, content, now, now);

    res.json({ id, created_at: now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// list messages (GET uses query param ?password=yourpass)
app.get('/api/folders/:id/messages', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });

    const password = req.query.password || '';
    const ok = await bcrypt.compare(password, folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    const rows = db.prepare('SELECT id, content, created_at, updated_at FROM messages WHERE folder_id = ? ORDER BY created_at DESC')
      .all(folder.id);

    res.json({ messages: rows, expires_at: folder.expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// edit message
app.put('/api/folders/:id/messages/:msgid', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });

    const { password, content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    const now = nowSeconds();
    const info = db.prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ? AND folder_id = ?')
      .run(content, now, req.params.msgid, folder.id);

    if (info.changes === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ updated_at: now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// delete message
app.delete('/api/folders/:id/messages/:msgid', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });

    const password = (req.body && req.body.password) || req.query.password || '';
    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    const info = db.prepare('DELETE FROM messages WHERE id = ? AND folder_id = ?').run(req.params.msgid, folder.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Message not found' });

    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// create a share token for a folder (requires folder password)
app.post('/api/folders/:id/share', async (req, res) => {
  try {
    const folder = getFolder(req.params.id);
    if (folderExpired(folder)) return res.status(404).json({ error: 'Folder not found or expired' });

    const { password, years } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    // token and expiry
    const token = uuidv4();
    const now = nowSeconds();
    const expireYears = (years && Number(years)) || DEFAULT_EXPIRE_YEARS;
    const expires_at = now + expireYears * SECONDS_IN_YEAR;

    db.prepare('INSERT INTO share_tokens (token, folder_id, expires_at) VALUES (?, ?, ?)')
      .run(token, folder.id, expires_at);

    res.json({ token, expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// read messages by share token (no password)
app.get('/api/share/:token/messages', (req, res) => {
  try {
    const tokenRow = getTokenRow(req.params.token);
    if (tokenExpired(tokenRow)) return res.status(404).json({ error: 'Share token not found or expired' });

    const rows = db.prepare(
      'SELECT id, content, created_at, updated_at FROM messages WHERE folder_id = ? ORDER BY created_at DESC'
    ).all(tokenRow.folder_id);

    res.json({ messages: rows, expires_at: tokenRow.expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// revoke/delete a share token (requires folder password)
app.delete('/api/share/:token', async (req, res) => {
  try {
    const tokenRow = getTokenRow(req.params.token);
    if (!tokenRow) return res.status(404).json({ error: 'Token not found' });

    const { password } = req.body;
    const folder = getFolder(tokenRow.folder_id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const ok = await bcrypt.compare(password || '', folder.password_hash);
    if (!ok) return res.status(401).json({ error: 'Bad password' });

    const info = db.prepare('DELETE FROM share_tokens WHERE token = ?').run(req.params.token);
    res.json({ deleted: info.changes === 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// serve a public share page (static)
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// manual cleanup endpoint (remove expired folders/messages)
app.post('/api/cleanup', (req, res) => {
  try {
    const now = nowSeconds();
    const delMsgs = db.prepare('DELETE FROM messages WHERE folder_id IN (SELECT id FROM folders WHERE expires_at <= ?)').run(now);
    const delFolders = db.prepare('DELETE FROM folders WHERE expires_at <= ?').run(now);
    res.json({ deletedMessages: delMsgs.changes, deletedFolders: delFolders.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
