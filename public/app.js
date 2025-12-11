// public/app.js
// Frontend script for Secret Folders app (create/open folder, add/edit/delete messages, create share links)

const el = id => document.getElementById(id);

// ------------------ Create folder ------------------
el('createBtn').onclick = async () => {
  const name = el('createName').value;
  const password = el('createPassword').value;
  const years = Number(el('createYears').value) || 5;

  if (!password) return alert('Password required');

  try {
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, password, years })
    });
    const data = await res.json();
    if (!res.ok) {
      el('createResult').textContent = 'Error: ' + (data.error || 'unknown');
      return;
    }
    el('createResult').textContent = `Folder created. ID: ${data.folderId}. Expires at: ${new Date(data.expires_at*1000).toLocaleString()}`;
    // Optionally show the ID in the open field so you can test quickly
    el('folderId').value = data.folderId;
  } catch (err) {
    alert('Network error');
    console.error(err);
  }
};

// ------------------ Open folder (verify password) ------------------
el('openBtn').onclick = async () => {
  const folderId = el('folderId').value.trim();
  const password = el('folderPassword').value;

  if (!folderId || !password) return alert('Folder ID and password required');

  try {
    const v = await fetch(`/api/folders/${folderId}/verify`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ password })
    });
    const vd = await v.json();
    if (!v.ok) return alert('Cannot open: ' + (vd.error || 'unknown'));

    el('folderInfo').textContent = 'Folder opened.';
    el('folderArea').style.display = 'block';
    el('shareSection') && (el('shareSection').style.display = 'block'); // show share UI if present
    // Save folder context in DOM dataset
    el('folderArea').dataset.folderId = folderId;
    el('folderArea').dataset.password = password;

    // load messages
    await loadMessages();
  } catch (err) {
    alert('Network error');
    console.error(err);
  }
};

// ------------------ Load messages ------------------
async function loadMessages() {
  const folderArea = el('folderArea');
  const folderId = folderArea.dataset.folderId;
  const password = folderArea.dataset.password;

  if (!folderId || !password) return;

  try {
    const res = await fetch(`/api/folders/${folderId}/messages?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) {
      alert('Error loading messages: ' + (data.error || 'unknown'));
      return;
    }

    const list = el('messagesList');
    list.innerHTML = '';

    data.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'message';
      div.innerHTML = `
        <div class="small">Created: ${new Date(m.created_at*1000).toLocaleString()} | Updated: ${new Date(m.updated_at*1000).toLocaleString()}</div>
        <textarea data-id="${m.id}">${escapeHtmlForTextarea(m.content)}</textarea>
        <div style="margin-top:6px;">
          <button data-action="save" data-id="${m.id}">Save</button>
          <button data-action="delete" data-id="${m.id}">Delete</button>
        </div>
      `;
      list.appendChild(div);
    });

    attachMessageButtons();
  } catch (err) {
    alert('Network error');
    console.error(err);
  }
}

// Helper to prevent HTML injection inside <textarea> value (preserve text)
function escapeHtmlForTextarea(s) {
  if (s == null) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ------------------ Attach Save/Delete handlers ------------------
function attachMessageButtons() {
  const list = el('messagesList');
  list.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const folderId = el('folderArea').dataset.folderId;
      const password = el('folderArea').dataset.password;

      if (!folderId || !password) return alert('Folder not open');

      if (action === 'save') {
        const textarea = list.querySelector(`textarea[data-id="${id}"]`);
        const content = textarea.value;
        if (!content) return alert('Message empty');

        try {
          const res = await fetch(`/api/folders/${folderId}/messages/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password, content })
          });
          const d = await res.json();
          if (!res.ok) return alert('Save error: ' + (d.error || 'unknown'));
          alert('Saved!');
          await loadMessages();
        } catch (err) {
          alert('Network error');
          console.error(err);
        }
      }

      if (action === 'delete') {
        if (!confirm('Delete message?')) return;
        try {
          const res = await fetch(`/api/folders/${folderId}/messages/${id}`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password })
          });
          const d = await res.json();
          if (!res.ok) return alert('Delete error: ' + (d.error || 'unknown'));
          alert('Deleted');
          await loadMessages();
        } catch (err) {
          alert('Network error');
          console.error(err);
        }
      }
    };
  });
}

// ------------------ Add new message ------------------
el('addMsgBtn').onclick = async () => {
  const folderId = el('folderArea').dataset.folderId;
  const password = el('folderArea').dataset.password;
  const content = el('newMessage').value;

  if (!folderId || !password) return alert('Folder not open');
  if (!content) return alert('Message empty');

  try {
    const res = await fetch(`/api/folders/${folderId}/messages`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ password, content })
    });
    const d = await res.json();
    if (!res.ok) return alert('Error adding: ' + (d.error || 'unknown'));
    el('newMessage').value = '';
    await loadMessages();
  } catch (err) {
    alert('Network error');
    console.error(err);
  }
};

// ------------------ Create share link ------------------
if (el('createShareBtn')) {
  el('createShareBtn').onclick = async () => {
    const folderId = el('folderArea').dataset.folderId;
    const password = el('folderArea').dataset.password;
    const years = Number(el('shareYears').value) || 5;

    if (!folderId || !password) return alert('Folder not open');

    try {
      const res = await fetch(`/api/folders/${folderId}/share`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ password, years })
      });
      const d = await res.json();
      if (!res.ok) return alert('Share error: ' + (d.error || 'unknown'));
      const origin = location.origin;
      const shareLink = `${origin}/share/${d.token}`;
      el('shareResult').innerHTML = `Share link: <a href="${shareLink}" target="_blank">${shareLink}</a>`;
    } catch (err) {
      alert('Network error');
      console.error(err);
    }
  };
}

