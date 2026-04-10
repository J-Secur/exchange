// ═══════════════════════════════════════════════════════════════════
//  app.js — J-Secur PWA  |  Full Logic
// ═══════════════════════════════════════════════════════════════════

// ── Firebase Config (remplacer avec vos valeurs) ─────────────────
const firebaseConfig = {
  apiKey: "votre-api-key",
  authDomain: "votre-project.firebaseapp.com",
  projectId: "votre-project-id",
  storageBucket: "votre-project.appspot.com",
  messagingSenderId: "votre-sender-id",
  appId: "votre-app-id"
};

// ── Firebase Init ─────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, Timestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── State ─────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let currentGroupId  = null;
let messagesUnsub   = null;
let mediaRecorder   = null;
let audioChunks     = [];
let recordedBlob    = null;
let isRecording     = false;
let emojiVisible    = false;

// ── DOM Refs ──────────────────────────────────────────────────────
const screens = {
  splash   : document.getElementById('screen-splash'),
  auth     : document.getElementById('screen-auth'),
  main     : document.getElementById('screen-main'),
  chat     : document.getElementById('screen-chat'),
  groupMgmt: document.getElementById('screen-group-mgmt'),
};

// ════════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════════
function showScreen(name) {
  Object.values(screens).forEach(s => s && s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove('show'), 3200);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

// ════════════════════════════════════════════════════════════════════
//  SPLASH SCREEN
// ════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  showScreen('splash');
  setTimeout(() => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        await loadUserData(user.uid);
        await loadGroups();
        showScreen('main');
      } else {
        showScreen('auth');
        showTab('tab-login');
      }
    });
  }, 2000);
});

// ════════════════════════════════════════════════════════════════════
//  AUTH TABS
// ════════════════════════════════════════════════════════════════════
window.showTab = function(tabId) {
  document.querySelectorAll('.auth-tab-content').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.remove('hidden');
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
};

// ════════════════════════════════════════════════════════════════════
//  INVITATION VALIDATION
// ════════════════════════════════════════════════════════════════════
async function validateInvitationToken(token) {
  if (!token) return null;
  const invRef = doc(db, 'invitations', token);
  const snap = await getDoc(invRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.used) return null;
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) return null;
  return data;
}

// ── Auto-fill depuis URL ?invite=TOKEN ───────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const inviteToken = urlParams.get('invite');
if (inviteToken) {
  document.querySelectorAll('.invite-token-input').forEach(el => {
    el.value = inviteToken;
  });
  showTab('tab-register');
}

// ── Vérif token en temps réel ────────────────────────────────────
document.querySelectorAll('.invite-token-input').forEach(input => {
  input.addEventListener('input', async () => {
    const token = input.value.trim();
    const statusEl = input.closest('.auth-tab-content').querySelector('.token-status');
    if (token.length < 10) { statusEl.textContent = ''; return; }
    const inv = await validateInvitationToken(token);
    if (inv) {
      statusEl.textContent = `✓ Invitation valide — Rôle : ${inv.role}`;
      statusEl.className = 'token-status text-green-400 text-sm';
      // Afficher le bon formulaire
      showRoleForm(input.closest('.auth-tab-content'), inv.role);
    } else {
      statusEl.textContent = '✗ Lien invalide ou expiré';
      statusEl.className = 'token-status text-red-400 text-sm';
    }
  });
});

function showRoleForm(container, role) {
  container.querySelectorAll('.role-form').forEach(f => f.classList.add('hidden'));
  const form = container.querySelector(`.role-form[data-role="${role}"]`);
  if (form) form.classList.remove('hidden');
}

// ════════════════════════════════════════════════════════════════════
//  REGISTER
// ════════════════════════════════════════════════════════════════════
window.handleRegister = async function() {
  const container = document.getElementById('tab-register');
  const token     = container.querySelector('.invite-token-input').value.trim();
  const phone     = container.querySelector('#reg-phone').value.trim();
  const secret    = container.querySelector('#reg-secret').value.trim();
  const firstName = container.querySelector('#reg-firstname').value.trim();
  const lastName  = container.querySelector('#reg-lastname').value.trim();

  if (!token || !phone || !secret || !firstName || !lastName) {
    return showToast('Veuillez remplir tous les champs', 'error');
  }

  const inv = await validateInvitationToken(token);
  if (!inv) return showToast('Lien d\'invitation invalide', 'error');

  const role = inv.role;
  const extraData = {};

  if (role === 'collaborateur' || role === 'partenaire') {
    extraData.fonction = container.querySelector('#reg-fonction')?.value.trim() || '';
    extraData.company  = container.querySelector('#reg-company')?.value.trim() || '';
    if (!extraData.fonction || !extraData.company) {
      return showToast('Veuillez remplir Fonction et Société', 'error');
    }
  }

  try {
    // Créer un email fictif à partir du numéro
    const fakeEmail = `${phone.replace(/\D/g, '')}@securechat.internal`;
    const cred = await createUserWithEmailAndPassword(auth, fakeEmail, secret);
    const uid  = cred.user.uid;
    const displayName = `${firstName} ${lastName}`;

    await updateProfile(cred.user, { displayName });

    const userData = {
      uid, displayName, firstName, lastName, role,
      phone, createdAt: serverTimestamp(), isActive: true,
      avatarUrl: '', ...extraData
    };
    await setDoc(doc(db, 'users', uid), userData);

    // Marquer l'invitation comme utilisée
    await updateDoc(doc(db, 'invitations', token), {
      used: true, usedBy: uid, usedAt: serverTimestamp()
    });

    // Ajouter aux groupes permanents si Personnel
    if (role === 'personnel' || role === 'dg') {
      await addToAllPermanentGroups(uid);
    }

    currentUser     = cred.user;
    currentUserData = userData;
    await loadGroups();
    showScreen('main');
    showToast(`Bienvenue sur J-Secur, ${displayName} !`, 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Erreur lors de l\'inscription', 'error');
  }
};

async function addToAllPermanentGroups(uid) {
  const q = query(collection(db, 'groups'), where('type', '==', 'permanent'));
  const snap = await getDocs(q);
  for (const groupDoc of snap.docs) {
    await updateDoc(groupDoc.ref, {
      members: arrayUnion({ uid, addedBy: 'system', addedAt: serverTimestamp() }),
      memberIds: arrayUnion(uid)
    });
  }
}

// ════════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════════
window.handleLogin = async function() {
  const phone  = document.getElementById('login-phone').value.trim();
  const secret = document.getElementById('login-secret').value.trim();
  if (!phone || !secret) return showToast('Numéro et code secret requis', 'error');

  try {
    const fakeEmail = `${phone.replace(/\D/g, '')}@securechat.internal`;
    const cred = await signInWithEmailAndPassword(auth, fakeEmail, secret);
    currentUser = cred.user;
    await loadUserData(cred.user.uid);
    await loadGroups();
    showScreen('main');
    showToast('Connexion réussie !', 'success');
  } catch (err) {
    showToast('Numéro ou code secret incorrect', 'error');
  }
};

// ════════════════════════════════════════════════════════════════════
//  LOGOUT
// ════════════════════════════════════════════════════════════════════
window.handleLogout = async function() {
  if (messagesUnsub) messagesUnsub();
  await signOut(auth);
  currentUser = null; currentUserData = null; currentGroupId = null;
  showScreen('auth');
  showTab('tab-login');
};

// ════════════════════════════════════════════════════════════════════
//  LOAD USER DATA
// ════════════════════════════════════════════════════════════════════
async function loadUserData(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    currentUserData = snap.data();
    document.getElementById('user-display-name').textContent = currentUserData.displayName;
    document.getElementById('user-role-badge').textContent = currentUserData.role.toUpperCase();

    // Afficher panneau DG si applicable
    const dgPanel = document.getElementById('dg-panel');
    if (dgPanel) dgPanel.classList.toggle('hidden', currentUserData.role !== 'dg');
  }
}

// ════════════════════════════════════════════════════════════════════
//  GROUPS — LOAD & RENDER
// ════════════════════════════════════════════════════════════════════
async function loadGroups() {
  if (!currentUser) return;
  const q = query(
    collection(db, 'groups'),
    where('memberIds', 'array-contains', currentUser.uid)
  );
  onSnapshot(q, snap => {
    const list = document.getElementById('groups-list');
    if (!list) return;
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p class="no-groups-msg">Aucun groupe pour l\'instant</p>';
      return;
    }
    snap.docs.forEach(d => renderGroupItem(d.id, d.data()));
  });
}

function renderGroupItem(groupId, groupData) {
  const list = document.getElementById('groups-list');
  const el = document.createElement('div');
  el.className = 'group-item';
  el.dataset.id = groupId;
  const badge = groupData.type === 'permanent' ? '🏠' : '🤝';
  el.innerHTML = `
    <div class="group-avatar">${badge}</div>
    <div class="group-info">
      <span class="group-name">${groupData.name}</span>
      <span class="group-type">${groupData.type}</span>
    </div>
    <div class="group-unread" id="unread-${groupId}"></div>
  `;
  el.addEventListener('click', () => openChat(groupId, groupData));
  list.appendChild(el);
}

// ════════════════════════════════════════════════════════════════════
//  OPEN CHAT
// ════════════════════════════════════════════════════════════════════
async function openChat(groupId, groupData) {
  if (messagesUnsub) messagesUnsub();
  currentGroupId = groupId;

  document.getElementById('chat-group-name').textContent = groupData.name;
  document.getElementById('chat-group-type').textContent = groupData.type;

  showScreen('chat');
  const msgList = document.getElementById('messages-list');
  msgList.innerHTML = '';

  const q = query(
    collection(db, 'groups', groupId, 'messages'),
    orderBy('createdAt', 'asc')
  );

  messagesUnsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        renderMessage(change.doc.id, change.doc.data());
        markAsRead(groupId, change.doc.id);
      }
      if (change.type === 'modified') {
        updateMessageEl(change.doc.id, change.doc.data());
      }
    });
    msgList.scrollTop = msgList.scrollHeight;
  });
}

function renderMessage(msgId, msg) {
  if (msg.deletedAt) return renderDeletedMessage(msgId);
  const list = document.getElementById('messages-list');
  const isMine = msg.senderId === currentUser?.uid;
  const el = document.createElement('div');
  el.id = `msg-${msgId}`;
  el.className = `message ${isMine ? 'mine' : 'theirs'}`;

  let content = '';
  switch (msg.type) {
    case 'text':
      content = `<p class="msg-text">${escapeHtml(msg.content)}</p>`;
      break;
    case 'image':
      content = `<img src="${msg.mediaUrl}" class="msg-media" loading="lazy" onclick="openMedia('${msg.mediaUrl}')"/>`;
      break;
    case 'video':
      content = `<video src="${msg.mediaUrl}" class="msg-media" controls></video>`;
      break;
    case 'audio':
      content = `<audio src="${msg.mediaUrl}" controls class="msg-audio"></audio>`;
      break;
    case 'file':
      content = `<a href="${msg.mediaUrl}" target="_blank" class="msg-file">📎 ${escapeHtml(msg.fileName || 'Fichier')}</a>`;
      break;
  }

  const canDelete = isMine && canStillDelete(msg.createdAt);
  const canEdit   = isMine && msg.type === 'text';
  const readCount = msg.readBy ? msg.readBy.length : 0;

  el.innerHTML = `
    <div class="msg-bubble">
      ${!isMine ? `<span class="msg-sender">${escapeHtml(msg.senderName)}</span>` : ''}
      ${content}
      <div class="msg-meta">
        <span class="msg-time">${formatTime(msg.createdAt)}</span>
        ${msg.editedAt ? '<span class="msg-edited">modifié</span>' : ''}
        ${isMine ? `<span class="msg-read" title="Lu par ${readCount} membre(s)">👁 ${readCount}</span>` : ''}
      </div>
      ${(canEdit || canDelete) ? `
        <div class="msg-actions">
          ${canEdit ? `<button onclick="editMessage('${msgId}','${escapeAttr(msg.content)}')" class="btn-action">✏️</button>` : ''}
          ${canDelete ? `<button onclick="deleteMessage('${msgId}')" class="btn-action btn-danger">🗑️</button>` : ''}
        </div>` : ''}
    </div>
  `;
  list.appendChild(el);
}

function renderDeletedMessage(msgId) {
  const existing = document.getElementById(`msg-${msgId}`);
  if (existing) {
    existing.innerHTML = `<div class="msg-bubble msg-deleted"><em>🚫 Message supprimé</em></div>`;
    return;
  }
  const list = document.getElementById('messages-list');
  const el = document.createElement('div');
  el.id = `msg-${msgId}`;
  el.className = 'message deleted';
  el.innerHTML = `<div class="msg-bubble msg-deleted"><em>🚫 Message supprimé</em></div>`;
  list.appendChild(el);
}

function updateMessageEl(msgId, msg) {
  const el = document.getElementById(`msg-${msgId}`);
  if (!el) return;
  el.remove();
  renderMessage(msgId, msg);
}

function canStillDelete(createdAt) {
  if (!createdAt) return false;
  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  return (Date.now() - created.getTime()) < 5 * 60 * 1000;
}

// ── Accusé de lecture ─────────────────────────────────────────────
async function markAsRead(groupId, msgId) {
  if (!currentUser) return;
  const msgRef = doc(db, 'groups', groupId, 'messages', msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.deletedAt) return;
  const alreadyRead = (data.readBy || []).some(r => r.uid === currentUser.uid);
  if (alreadyRead) return;
  await updateDoc(msgRef, {
    readBy: arrayUnion({ uid: currentUser.uid, readAt: serverTimestamp() })
  });
}

// ════════════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════════════════════
window.sendMessage = async function() {
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text || !currentGroupId) return;

  try {
    await addDoc(collection(db, 'groups', currentGroupId, 'messages'), {
      senderId  : currentUser.uid,
      senderName: currentUserData.displayName,
      content   : text,
      type      : 'text',
      createdAt : serverTimestamp(),
      editedAt  : null,
      deletedAt : null,
      readBy    : []
    });
    input.value = '';
  } catch (err) {
    showToast('Erreur lors de l\'envoi', 'error');
  }
};

// Enter key
document.getElementById('msg-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ════════════════════════════════════════════════════════════════════
//  EDIT / DELETE MESSAGE
// ════════════════════════════════════════════════════════════════════
window.editMessage = function(msgId, currentContent) {
  const newContent = prompt('Modifier le message :', currentContent);
  if (!newContent || newContent === currentContent) return;
  updateDoc(doc(db, 'groups', currentGroupId, 'messages', msgId), {
    content: newContent,
    editedAt: serverTimestamp()
  }).catch(() => showToast('Modification non autorisée', 'error'));
};

window.deleteMessage = function(msgId) {
  if (!confirm('Supprimer ce message ?')) return;
  updateDoc(doc(db, 'groups', currentGroupId, 'messages', msgId), {
    deletedAt: serverTimestamp(),
    deletedBy: currentUser.uid
  }).catch(() => showToast('Suppression non autorisée (délai de 5 min dépassé)', 'error'));
};

// ════════════════════════════════════════════════════════════════════
//  MEDIA UPLOAD
// ════════════════════════════════════════════════════════════════════
window.handleFileInput = async function(e) {
  const file = e.target.files[0];
  if (!file || !currentGroupId) return;
  await uploadAndSendMedia(file);
  e.target.value = '';
};

async function uploadAndSendMedia(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  if (file.size > MAX_SIZE) return showToast('Fichier trop volumineux (max 50 Mo)', 'error');

  showToast('Envoi en cours…', 'info');
  try {
    const ext      = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const storageRef = ref(storage, `groups/${currentGroupId}/${fileName}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    let type = 'file';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('video/')) type = 'video';
    else if (file.type.startsWith('audio/')) type = 'audio';

    await addDoc(collection(db, 'groups', currentGroupId, 'messages'), {
      senderId  : currentUser.uid,
      senderName: currentUserData.displayName,
      content   : '',
      type,
      mediaUrl  : url,
      fileName  : file.name,
      fileSize  : file.size,
      createdAt : serverTimestamp(),
      editedAt  : null,
      deletedAt : null,
      readBy    : []
    });
  } catch (err) {
    showToast('Erreur upload : ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════════
//  VOICE RECORDING
// ════════════════════════════════════════════════════════════════════
window.toggleRecording = async function() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
};

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recordedBlob = null;
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      showVoicePreview(recordedBlob);
    };

    mediaRecorder.start(100);
    isRecording = true;
    updateRecordBtn(true);
    startRecordingTimer();
  } catch (err) {
    showToast('Accès micro refusé', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
  updateRecordBtn(false);
  clearInterval(window._recordTimer);
}

function updateRecordBtn(recording) {
  const btn = document.getElementById('btn-voice');
  if (!btn) return;
  btn.classList.toggle('recording', recording);
  btn.textContent = recording ? '⏹' : '🎤';
}

function startRecordingTimer() {
  let secs = 0;
  const el = document.getElementById('record-timer');
  window._recordTimer = setInterval(() => {
    secs++;
    if (el) el.textContent = `${Math.floor(secs/60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}`;
    if (secs >= 120) stopRecording(); // max 2 min
  }, 1000);
}

function showVoicePreview(blob) {
  const panel = document.getElementById('voice-preview');
  const player = document.getElementById('voice-preview-player');
  if (!panel || !player) return;
  player.src = URL.createObjectURL(blob);
  panel.classList.remove('hidden');
}

window.cancelVoice = function() {
  recordedBlob = null;
  document.getElementById('voice-preview')?.classList.add('hidden');
  const player = document.getElementById('voice-preview-player');
  if (player) player.src = '';
};

window.sendVoice = async function() {
  if (!recordedBlob || !currentGroupId) return;
  document.getElementById('voice-preview')?.classList.add('hidden');
  const file = new File([recordedBlob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
  await uploadAndSendMedia(file);
  recordedBlob = null;
};

// ════════════════════════════════════════════════════════════════════
//  EMOJI PICKER (simple)
// ════════════════════════════════════════════════════════════════════
const EMOJIS = ['😀','😂','😍','🥰','😎','🤔','👍','👏','🙏','❤️','🔥','✅','⚡','🎉','💪','🤝','👋','😊','😢','😡','🙈','💬','📎','📸','🎤'];

window.toggleEmoji = function() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  if (emojiVisible) {
    picker.classList.add('hidden');
    emojiVisible = false;
  } else {
    picker.innerHTML = EMOJIS.map(e =>
      `<span class="emoji-item" onclick="insertEmoji('${e}')">${e}</span>`
    ).join('');
    picker.classList.remove('hidden');
    emojiVisible = true;
  }
};

window.insertEmoji = function(emoji) {
  const input = document.getElementById('msg-input');
  if (input) { input.value += emoji; input.focus(); }
  document.getElementById('emoji-picker')?.classList.add('hidden');
  emojiVisible = false;
};

// ════════════════════════════════════════════════════════════════════
//  GROUP MANAGEMENT (DG)
// ════════════════════════════════════════════════════════════════════
window.showGroupMgmt = function() {
  if (!currentUserData) return;
  if (currentUserData.role !== 'dg' && !hasDelegationLocal()) {
    return showToast('Accès réservé au DG ou délégué', 'error');
  }
  showScreen('groupMgmt');
  loadAllGroupsAdmin();
};

function hasDelegationLocal() {
  // Vérification côté client (complément des Firestore Rules)
  return false; // sera mis à jour via snapshot delegation
}

async function loadAllGroupsAdmin() {
  const snap = await getDocs(collection(db, 'groups'));
  const list = document.getElementById('admin-groups-list');
  if (!list) return;
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const g = d.data();
    const el = document.createElement('div');
    el.className = 'admin-group-item';
    el.innerHTML = `
      <div>
        <strong>${escapeHtml(g.name)}</strong>
        <span class="badge-type">${g.type}</span>
        <span class="member-count">${(g.memberIds || []).length} membre(s)</span>
      </div>
      <div class="admin-group-actions">
        <button onclick="manageGroupMembers('${d.id}')" class="btn-sm">👥 Membres</button>
        ${currentUserData.role === 'dg' ? `<button onclick="deleteGroup('${d.id}')" class="btn-sm btn-danger">🗑️</button>` : ''}
      </div>
    `;
    list.appendChild(el);
  });
}

window.createGroup = async function() {
  const name = document.getElementById('new-group-name').value.trim();
  const type = document.getElementById('new-group-type').value;
  if (!name) return showToast('Nom du groupe requis', 'error');

  try {
    await addDoc(collection(db, 'groups'), {
      name, type,
      createdBy : currentUser.uid,
      members   : [],
      memberIds : type === 'permanent' ? await getAllPersonnelIds() : [],
      createdAt : serverTimestamp()
    });
    document.getElementById('new-group-name').value = '';
    showToast('Groupe créé !', 'success');
    loadAllGroupsAdmin();
  } catch (err) {
    showToast('Erreur création groupe', 'error');
  }
};

async function getAllPersonnelIds() {
  const q = query(collection(db, 'users'), where('role', 'in', ['personnel', 'dg']));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.id);
}

window.deleteGroup = async function(groupId) {
  if (!confirm('Supprimer ce groupe et tous ses messages ?')) return;
  try {
    await deleteDoc(doc(db, 'groups', groupId));
    showToast('Groupe supprimé', 'success');
    loadAllGroupsAdmin();
  } catch (err) {
    showToast('Erreur suppression', 'error');
  }
};

window.manageGroupMembers = async function(groupId) {
  const groupSnap = await getDoc(doc(db, 'groups', groupId));
  const groupData = groupSnap.data();
  const allUsersSnap = await getDocs(collection(db, 'users'));

  const modal = document.getElementById('members-modal');
  const body  = document.getElementById('members-modal-body');
  modal.dataset.groupId = groupId;
  body.innerHTML = '';

  allUsersSnap.docs.forEach(d => {
    const u = d.data();
    const isMember = (groupData.memberIds || []).includes(d.id);
    const el = document.createElement('div');
    el.className = 'member-toggle-item';
    el.innerHTML = `
      <label>
        <input type="checkbox" value="${d.id}" ${isMember ? 'checked' : ''}
          onchange="toggleMember('${groupId}','${d.id}',this.checked,'${escapeAttr(u.displayName)}')">
        ${escapeHtml(u.displayName)} <em>(${u.role})</em>
      </label>
    `;
    body.appendChild(el);
  });
  modal.classList.remove('hidden');
};

window.toggleMember = async function(groupId, uid, add, name) {
  const groupRef = doc(db, 'groups', groupId);
  const groupSnap = await getDoc(groupRef);
  const data = groupSnap.data();
  let members   = data.members || [];
  let memberIds = data.memberIds || [];

  if (add) {
    if (!memberIds.includes(uid)) {
      memberIds.push(uid);
      members.push({ uid, addedBy: currentUser.uid, addedAt: serverTimestamp() });
    }
  } else {
    memberIds = memberIds.filter(id => id !== uid);
    members   = members.filter(m => m.uid !== uid);
  }
  await updateDoc(groupRef, { members, memberIds });
  showToast(`${name} ${add ? 'ajouté(e)' : 'retiré(e)'}`, 'success');
};

window.closeMembersModal = function() {
  document.getElementById('members-modal')?.classList.add('hidden');
};

// ════════════════════════════════════════════════════════════════════
//  INVITATION GENERATION (DG)
// ════════════════════════════════════════════════════════════════════
window.generateInvitation = async function() {
  if (currentUserData?.role !== 'dg') return showToast('Réservé au DG', 'error');
  const role = document.getElementById('invite-role').value;
  const token = generateToken();
  const link  = `${window.location.origin}${window.location.pathname}?invite=${token}`;

  await setDoc(doc(db, 'invitations', token), {
    createdBy: currentUser.uid,
    role,
    used     : false,
    usedBy   : null,
    usedAt   : null,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 3600 * 1000)) // 7j
  });

  const el = document.getElementById('invite-link-output');
  if (el) {
    el.textContent = link;
    el.classList.remove('hidden');
  }
  showToast('Lien généré — valable 7 jours', 'success');
};

window.copyInviteLink = function() {
  const el = document.getElementById('invite-link-output');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => showToast('Lien copié !', 'success'));
};

// ════════════════════════════════════════════════════════════════════
//  MEDIA VIEWER
// ════════════════════════════════════════════════════════════════════
window.openMedia = function(url) {
  const overlay = document.getElementById('media-overlay');
  const img     = document.getElementById('media-overlay-img');
  if (!overlay || !img) return;
  img.src = url;
  overlay.classList.remove('hidden');
};

window.closeMedia = function() {
  document.getElementById('media-overlay')?.classList.add('hidden');
};

// ════════════════════════════════════════════════════════════════════
//  NAVIGATION HELPERS
// ════════════════════════════════════════════════════════════════════
window.goBack = function() {
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  currentGroupId = null;
  showScreen('main');
};

window.goBackFromAdmin = function() { showScreen('main'); };

// ════════════════════════════════════════════════════════════════════
//  SECURITY HELPERS
// ════════════════════════════════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/\n/g, ' ');
}

// ════════════════════════════════════════════════════════════════════
//  SERVICE WORKER REGISTRATION
// ════════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] Registered', reg.scope))
      .catch(err => console.warn('[SW] Registration failed', err));
  });
}
