// ═══════════════════════════════════════════════════════════════════
//  app.js — J-Secur PWA
//  Firebase SDK 10 — Mode COMPAT (sans import/module)
//  Compatible GitHub Pages, hébergement statique
// ═══════════════════════════════════════════════════════════════════

// ── Configuration Firebase ────────────────────────────────────────
// Remplacez ces valeurs par celles de votre projet Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDydYcDnUeuHuIpIFYWOoJoxsDtgCthabg",
  authDomain: "j-secur-daa73.firebaseapp.com",
  projectId: "j-secur-daa73",
  storageBucket: "j-secur-daa73.firebasestorage.app",
  messagingSenderId: "51855816513",
  appId: "1:51855816513:web:05a1675b5d68fc88acd3c0"
};

// ── Init Firebase ─────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// Persistance de session — l'utilisateur reste connecté
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// ── État global ───────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let currentGroupId  = null;
let messagesUnsub   = null;
let mediaRecorder   = null;
let audioChunks     = [];
let recordedBlob    = null;
let isRecording     = false;
let emojiVisible    = false;
let currentInvRole  = null;

// ════════════════════════════════════════════════════════════════════
//  UTILITAIRES
// ════════════════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.remove('hidden');
}

function showToast(msg, type) {
  type = type || 'info';
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast toast-' + type + ' show';
  setTimeout(function() { t.classList.remove('show'); }, 3200);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function generateToken() {
  var arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b) { return b.toString(16).padStart(2,'0'); }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function val(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ════════════════════════════════════════════════════════════════════
//  SPLASH + AUTH STATE
// ════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', function() {
  showScreen('splash');

  // Vérifier le token d'invitation dans l'URL
  var urlParams = new URLSearchParams(window.location.search);
  var inviteToken = urlParams.get('invite');
  if (inviteToken) {
    var tokenInput = document.getElementById('reg-token');
    if (tokenInput) tokenInput.value = inviteToken;
  }

  setTimeout(function() {
    auth.onAuthStateChanged(async function(user) {
      if (user) {
        currentUser = user;
        await loadUserData(user.uid);
        await loadGroups();
        showScreen('main');
        if (inviteToken) {
          history.replaceState(null, '', window.location.pathname);
        }
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
function showTab(tabId) {
  document.querySelectorAll('.auth-tab-content').forEach(function(t) {
    t.classList.add('hidden');
  });
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  var target = document.getElementById(tabId);
  if (target) target.classList.remove('hidden');
  var btn = document.querySelector('[data-tab="' + tabId + '"]');
  if (btn) btn.classList.add('active');
}
window.showTab = showTab;

// ── Validation token en temps réel ───────────────────────────────
var tokenInput = document.getElementById('reg-token');
if (tokenInput) {
  tokenInput.addEventListener('input', async function() {
    var token = this.value.trim();
    var statusEl = document.getElementById('token-status-msg');
    if (token.length < 10) {
      statusEl.textContent = '';
      document.querySelectorAll('.role-form').forEach(function(f) { f.classList.add('hidden'); });
      return;
    }
    var inv = await validateInvitationToken(token);
    if (inv) {
      statusEl.textContent = '✓ Invitation valide — Rôle : ' + inv.role;
      statusEl.className = 'token-status text-green-400 text-sm';
      currentInvRole = inv.role;
      showRoleForm(inv.role);
    } else {
      statusEl.textContent = '✗ Lien invalide ou expiré';
      statusEl.className = 'token-status text-red-400 text-sm';
      currentInvRole = null;
      document.querySelectorAll('.role-form').forEach(function(f) { f.classList.add('hidden'); });
    }
  });
}

async function validateInvitationToken(token) {
  if (!token) return null;
  try {
    var snap = await db.collection('invitations').doc(token).get();
    if (!snap.exists) return null;
    var data = snap.data();
    if (data.used) return null;
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) return null;
    return data;
  } catch(e) {
    return null;
  }
}

function showRoleForm(role) {
  document.querySelectorAll('.role-form').forEach(function(f) { f.classList.add('hidden'); });
  var form = document.querySelector('.role-form[data-role="' + role + '"]');
  if (form) form.classList.remove('hidden');
}

// ════════════════════════════════════════════════════════════════════
//  REGISTER
// ════════════════════════════════════════════════════════════════════
async function handleRegister() {
  var token = val('reg-token');
  if (!token) return showToast('Lien d\'invitation requis', 'error');

  var inv = await validateInvitationToken(token);
  if (!inv) return showToast('Lien invalide ou expiré', 'error');

  var role = inv.role;
  var prefix = { personnel: 'p', collaborateur: 'c', partenaire: 'pa', dg: 'dg' }[role];

  var firstName = val(prefix + '-firstname');
  var lastName  = val(prefix + '-lastname');
  var phone     = val(prefix + '-phone');
  var secret    = val(prefix + '-secret');

  if (!firstName || !lastName || !phone || !secret) {
    return showToast('Veuillez remplir tous les champs', 'error');
  }

  var extraData = {};
  if (role === 'collaborateur' || role === 'partenaire') {
    extraData.fonction = val(prefix + '-fonction');
    extraData.company  = val(prefix + '-company');
    if (!extraData.fonction || !extraData.company) {
      return showToast('Fonction et Société requis', 'error');
    }
  }

  try {
    var fakeEmail = phone.replace(/\D/g,'') + '@jsecur.internal';
    var cred = await auth.createUserWithEmailAndPassword(fakeEmail, secret);
    var uid  = cred.user.uid;
    var displayName = firstName + ' ' + lastName;

    await cred.user.updateProfile({ displayName: displayName });

    var userData = Object.assign({
      uid        : uid,
      displayName: displayName,
      firstName  : firstName,
      lastName   : lastName,
      role       : role,
      phone      : phone,
      createdAt  : firebase.firestore.FieldValue.serverTimestamp(),
      isActive   : true,
      avatarUrl  : ''
    }, extraData);

    await db.collection('users').doc(uid).set(userData);

    // Invalider l'invitation
    await db.collection('invitations').doc(token).update({
      used  : true,
      usedBy: uid,
      usedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Groupes permanents pour personnel et DG
    if (role === 'personnel' || role === 'dg') {
      await addToAllPermanentGroups(uid);
    }

    currentUser     = cred.user;
    currentUserData = userData;
    await loadGroups();
    showScreen('main');
    showToast('Bienvenue sur J-Secur, ' + displayName + ' !', 'success');
  } catch(err) {
    console.error(err);
    showToast(err.message || 'Erreur inscription', 'error');
  }
}
window.handleRegister = handleRegister;

async function addToAllPermanentGroups(uid) {
  try {
    var snap = await db.collection('groups').where('type','==','permanent').get();
    var batch = db.batch();
    snap.docs.forEach(function(d) {
      batch.update(d.ref, {
        memberIds: firebase.firestore.FieldValue.arrayUnion(uid),
        members  : firebase.firestore.FieldValue.arrayUnion({
          uid    : uid,
          addedBy: 'system',
          addedAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      });
    });
    await batch.commit();
  } catch(e) { console.warn('addToAllPermanentGroups:', e); }
}

// ════════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════════
async function handleLogin() {
  var phone  = val('login-phone');
  var secret = val('login-secret');
  if (!phone || !secret) return showToast('Numéro et code secret requis', 'error');

  try {
    var fakeEmail = phone.replace(/\D/g,'') + '@jsecur.internal';
    var cred = await auth.signInWithEmailAndPassword(fakeEmail, secret);
    currentUser = cred.user;
    await loadUserData(cred.user.uid);
    await loadGroups();
    showScreen('main');
    showToast('Connexion réussie !', 'success');
  } catch(err) {
    showToast('Numéro ou code secret incorrect', 'error');
  }
}
window.handleLogin = handleLogin;

// ════════════════════════════════════════════════════════════════════
//  LOGOUT
// ════════════════════════════════════════════════════════════════════
async function handleLogout() {
  if (messagesUnsub) messagesUnsub();
  await auth.signOut();
  currentUser = null; currentUserData = null; currentGroupId = null;
  showScreen('auth');
  showTab('tab-login');
}
window.handleLogout = handleLogout;

// ════════════════════════════════════════════════════════════════════
//  CHARGER LES DONNÉES UTILISATEUR
// ════════════════════════════════════════════════════════════════════
async function loadUserData(uid) {
  var snap = await db.collection('users').doc(uid).get();
  if (snap.exists) {
    currentUserData = snap.data();
    var el = document.getElementById('user-display-name');
    if (el) el.textContent = currentUserData.displayName;
    var badge = document.getElementById('user-role-badge');
    if (badge) badge.textContent = currentUserData.role.toUpperCase();
    var avatar = document.getElementById('header-avatar');
    if (avatar) {
      var initials = (currentUserData.firstName[0] + currentUserData.lastName[0]).toUpperCase();
      avatar.textContent = initials;
    }
    // Afficher boutons DG
    var dgBtn = document.getElementById('dg-panel-btn');
    if (dgBtn) dgBtn.classList.toggle('hidden', currentUserData.role !== 'dg');
  }
}

// ════════════════════════════════════════════════════════════════════
//  GROUPES
// ════════════════════════════════════════════════════════════════════
async function loadGroups() {
  if (!currentUser) return;
  db.collection('groups')
    .where('memberIds', 'array-contains', currentUser.uid)
    .onSnapshot(function(snap) {
      var list = document.getElementById('groups-list');
      if (!list) return;
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<p class="no-groups-msg">Aucun groupe pour l\'instant</p>';
        return;
      }
      snap.docs.forEach(function(d) { renderGroupItem(d.id, d.data()); });
    });
}

function renderGroupItem(groupId, groupData) {
  var list = document.getElementById('groups-list');
  var el = document.createElement('div');
  el.className = 'group-item';
  var badge = groupData.type === 'permanent' ? '🏠' : '🤝';
  el.innerHTML =
    '<div class="group-avatar">' + badge + '</div>' +
    '<div class="group-info">' +
      '<span class="group-name">' + escapeHtml(groupData.name) + '</span>' +
      '<span class="group-type">' + escapeHtml(groupData.type) + '</span>' +
    '</div>';
  el.addEventListener('click', function() { openChat(groupId, groupData); });
  list.appendChild(el);
}

// ── Toggle panneau DG ─────────────────────────────────────────────
function toggleDGPanel() {
  var panel = document.getElementById('dg-panel-section');
  if (panel) panel.classList.toggle('hidden');
}
window.toggleDGPanel = toggleDGPanel;

// ════════════════════════════════════════════════════════════════════
//  CHAT
// ════════════════════════════════════════════════════════════════════
async function openChat(groupId, groupData) {
  if (messagesUnsub) messagesUnsub();
  currentGroupId = groupId;

  document.getElementById('chat-group-name').textContent = groupData.name;
  document.getElementById('chat-group-type').textContent = groupData.type;
  showScreen('chat');

  var msgList = document.getElementById('messages-list');
  msgList.innerHTML = '';

  messagesUnsub = db.collection('groups').doc(groupId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(function(snap) {
      snap.docChanges().forEach(function(change) {
        if (change.type === 'added') {
          renderMessage(change.doc.id, change.doc.data());
          markAsRead(groupId, change.doc.id, change.doc.data());
        }
        if (change.type === 'modified') {
          updateMessageEl(change.doc.id, change.doc.data());
        }
      });
      msgList.scrollTop = msgList.scrollHeight;
    });
}

function renderMessage(msgId, msg) {
  if (msg.deletedAt) { renderDeletedMessage(msgId); return; }
  var list = document.getElementById('messages-list');
  if (!list) return;
  var isMine = msg.senderId === (currentUser && currentUser.uid);
  var el = document.createElement('div');
  el.id = 'msg-' + msgId;
  el.className = 'message ' + (isMine ? 'mine' : 'theirs');

  var content = '';
  switch (msg.type) {
    case 'text':
      content = '<p class="msg-text">' + escapeHtml(msg.content) + '</p>'; break;
    case 'image':
      content = '<img src="' + msg.mediaUrl + '" class="msg-media" loading="lazy" onclick="openMedia(\'' + msg.mediaUrl + '\')"/>'; break;
    case 'video':
      content = '<video src="' + msg.mediaUrl + '" class="msg-media" controls></video>'; break;
    case 'audio':
      content = '<audio src="' + msg.mediaUrl + '" controls class="msg-audio"></audio>'; break;
    case 'file':
      content = '<a href="' + msg.mediaUrl + '" target="_blank" class="msg-file">📎 ' + escapeHtml(msg.fileName || 'Fichier') + '</a>'; break;
    default:
      content = '<p class="msg-text">' + escapeHtml(msg.content || '') + '</p>';
  }

  var readCount = msg.readBy ? msg.readBy.length : 0;
  var canDelete = isMine && canStillDelete(msg.createdAt);
  var canEdit   = isMine && msg.type === 'text';

  var actionsHtml = '';
  if (canEdit || canDelete) {
    actionsHtml = '<div class="msg-actions">';
    if (canEdit) actionsHtml += '<button onclick="editMessage(\'' + msgId + '\',\'' + escapeHtml(msg.content).replace(/'/g,"\\'") + '\')" class="btn-action">✏️</button>';
    if (canDelete) actionsHtml += '<button onclick="deleteMessage(\'' + msgId + '\')" class="btn-action btn-danger">🗑️</button>';
    actionsHtml += '</div>';
  }

  el.innerHTML =
    '<div class="msg-bubble">' +
      (!isMine ? '<span class="msg-sender">' + escapeHtml(msg.senderName) + '</span>' : '') +
      content +
      '<div class="msg-meta">' +
        '<span class="msg-time">' + formatTime(msg.createdAt) + '</span>' +
        (msg.editedAt ? '<span class="msg-edited">modifié</span>' : '') +
        (isMine ? '<span class="msg-read">👁 ' + readCount + '</span>' : '') +
      '</div>' +
      actionsHtml +
    '</div>';
  list.appendChild(el);
}

function renderDeletedMessage(msgId) {
  var existing = document.getElementById('msg-' + msgId);
  var html = '<div class="msg-bubble msg-deleted"><em>🚫 Message supprimé</em></div>';
  if (existing) { existing.innerHTML = html; return; }
  var list = document.getElementById('messages-list');
  var el = document.createElement('div');
  el.id = 'msg-' + msgId;
  el.className = 'message deleted';
  el.innerHTML = html;
  if (list) list.appendChild(el);
}

function updateMessageEl(msgId, msg) {
  var el = document.getElementById('msg-' + msgId);
  if (el) el.remove();
  renderMessage(msgId, msg);
}

function canStillDelete(createdAt) {
  if (!createdAt) return false;
  var created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  return (Date.now() - created.getTime()) < 5 * 60 * 1000;
}

async function markAsRead(groupId, msgId, data) {
  if (!currentUser || !data || data.deletedAt) return;
  var alreadyRead = (data.readBy || []).some(function(r) { return r.uid === currentUser.uid; });
  if (alreadyRead || data.senderId === currentUser.uid) return;
  try {
    await db.collection('groups').doc(groupId).collection('messages').doc(msgId).update({
      readBy: firebase.firestore.FieldValue.arrayUnion({
        uid   : currentUser.uid,
        readAt: firebase.firestore.FieldValue.serverTimestamp()
      })
    });
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════════
//  ENVOYER UN MESSAGE
// ════════════════════════════════════════════════════════════════════
async function sendMessage() {
  var input = document.getElementById('msg-input');
  var text  = input ? input.value.trim() : '';
  if (!text || !currentGroupId) return;

  try {
    await db.collection('groups').doc(currentGroupId).collection('messages').add({
      senderId  : currentUser.uid,
      senderName: currentUserData.displayName,
      content   : text,
      type      : 'text',
      createdAt : firebase.firestore.FieldValue.serverTimestamp(),
      editedAt  : null,
      deletedAt : null,
      readBy    : []
    });
    input.value = '';
  } catch(err) {
    showToast('Erreur lors de l\'envoi', 'error');
  }
}
window.sendMessage = sendMessage;

// Touche Entrée
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey && document.activeElement.id === 'msg-input') {
    e.preventDefault();
    sendMessage();
  }
});

// ════════════════════════════════════════════════════════════════════
//  MODIFIER / SUPPRIMER UN MESSAGE
// ════════════════════════════════════════════════════════════════════
function editMessage(msgId, currentContent) {
  var newContent = prompt('Modifier le message :', currentContent);
  if (!newContent || newContent === currentContent) return;
  db.collection('groups').doc(currentGroupId).collection('messages').doc(msgId).update({
    content : newContent,
    editedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function() { showToast('Modification non autorisée', 'error'); });
}
window.editMessage = editMessage;

function deleteMessage(msgId) {
  if (!confirm('Supprimer ce message ?')) return;
  db.collection('groups').doc(currentGroupId).collection('messages').doc(msgId).update({
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: currentUser.uid
  }).catch(function() { showToast('Délai de 5 min dépassé', 'error'); });
}
window.deleteMessage = deleteMessage;

// ════════════════════════════════════════════════════════════════════
//  UPLOAD FICHIERS / MÉDIAS
// ════════════════════════════════════════════════════════════════════
async function handleFileInput(e) {
  var file = e.target.files[0];
  if (!file || !currentGroupId) return;
  await uploadAndSendMedia(file);
  e.target.value = '';
}
window.handleFileInput = handleFileInput;

async function uploadAndSendMedia(file) {
  var MAX = 50 * 1024 * 1024;
  if (file.size > MAX) return showToast('Fichier trop volumineux (max 50 Mo)', 'error');

  showToast('Envoi en cours…', 'info');
  try {
    var ext      = file.name.split('.').pop();
    var fileName = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;
    var storageRef = storage.ref('groups/' + currentGroupId + '/' + fileName);
    await storageRef.put(file);
    var url = await storageRef.getDownloadURL();

    var type = 'file';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('video/')) type = 'video';
    else if (file.type.startsWith('audio/')) type = 'audio';

    await db.collection('groups').doc(currentGroupId).collection('messages').add({
      senderId  : currentUser.uid,
      senderName: currentUserData.displayName,
      content   : '',
      type      : type,
      mediaUrl  : url,
      fileName  : file.name,
      fileSize  : file.size,
      createdAt : firebase.firestore.FieldValue.serverTimestamp(),
      editedAt  : null,
      deletedAt : null,
      readBy    : []
    });
  } catch(err) {
    showToast('Erreur upload : ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════════
//  MESSAGES VOCAUX
// ════════════════════════════════════════════════════════════════════
async function toggleRecording() {
  if (isRecording) { stopRecording(); } else { await startRecording(); }
}
window.toggleRecording = toggleRecording;

async function startRecording() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recordedBlob = null;

    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    mediaRecorder.ondataavailable = function(e) {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = function() {
      recordedBlob = new Blob(audioChunks, { type: mimeType });
      stream.getTracks().forEach(function(t) { t.stop(); });
      showVoicePreview(recordedBlob);
    };
    mediaRecorder.start(100);
    isRecording = true;
    updateRecordBtn(true);
    startRecordingTimer();
  } catch(err) {
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
  var btn = document.getElementById('btn-voice');
  if (!btn) return;
  btn.classList.toggle('recording', recording);
  btn.textContent = recording ? '⏹' : '🎤';
}

function startRecordingTimer() {
  var secs = 0;
  var el = document.getElementById('record-timer');
  window._recordTimer = setInterval(function() {
    secs++;
    if (el) {
      var m = Math.floor(secs/60).toString().padStart(2,'0');
      var s = (secs%60).toString().padStart(2,'0');
      el.textContent = m + ':' + s;
    }
    if (secs >= 120) stopRecording();
  }, 1000);
}

function showVoicePreview(blob) {
  var panel  = document.getElementById('voice-preview');
  var player = document.getElementById('voice-preview-player');
  if (!panel || !player) return;
  player.src = URL.createObjectURL(blob);
  panel.classList.remove('hidden');
}

function cancelVoice() {
  recordedBlob = null;
  var panel = document.getElementById('voice-preview');
  if (panel) panel.classList.add('hidden');
  var player = document.getElementById('voice-preview-player');
  if (player) player.src = '';
}
window.cancelVoice = cancelVoice;

async function sendVoice() {
  if (!recordedBlob || !currentGroupId) return;
  document.getElementById('voice-preview').classList.add('hidden');
  var file = new File([recordedBlob], 'vocal-' + Date.now() + '.webm', { type: 'audio/webm' });
  await uploadAndSendMedia(file);
  recordedBlob = null;
}
window.sendVoice = sendVoice;

// ════════════════════════════════════════════════════════════════════
//  ÉMOJIS
// ════════════════════════════════════════════════════════════════════
var EMOJIS = ['😀','😂','😍','🥰','😎','🤔','👍','👏','🙏','❤️','🔥',
              '✅','⚡','🎉','💪','🤝','👋','😊','😢','😡','💬','📎','🎤'];

function toggleEmoji() {
  var picker = document.getElementById('emoji-picker');
  if (!picker) return;
  if (emojiVisible) {
    picker.classList.add('hidden');
    emojiVisible = false;
  } else {
    picker.innerHTML = EMOJIS.map(function(e) {
      return '<span class="emoji-item" onclick="insertEmoji(\'' + e + '\')">' + e + '</span>';
    }).join('');
    picker.classList.remove('hidden');
    emojiVisible = true;
  }
}
window.toggleEmoji = toggleEmoji;

function insertEmoji(emoji) {
  var input = document.getElementById('msg-input');
  if (input) { input.value += emoji; input.focus(); }
  var picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.add('hidden');
  emojiVisible = false;
}
window.insertEmoji = insertEmoji;

// ════════════════════════════════════════════════════════════════════
//  MÉDIAS — Visionneuse
// ════════════════════════════════════════════════════════════════════
function openMedia(url) {
  var overlay = document.getElementById('media-overlay');
  var img     = document.getElementById('media-overlay-img');
  if (!overlay || !img) return;
  img.src = url;
  overlay.classList.remove('hidden');
}
window.openMedia = openMedia;

function closeMedia() {
  var overlay = document.getElementById('media-overlay');
  if (overlay) overlay.classList.add('hidden');
}
window.closeMedia = closeMedia;

// ════════════════════════════════════════════════════════════════════
//  GESTION GROUPES (DG)
// ════════════════════════════════════════════════════════════════════
function showGroupMgmt() {
  if (!currentUserData) return;
  if (currentUserData.role !== 'dg') return showToast('Réservé au DG', 'error');
  showScreen('group-mgmt');
  loadAllGroupsAdmin();
}
window.showGroupMgmt = showGroupMgmt;

async function loadAllGroupsAdmin() {
  var snap = await db.collection('groups').get();
  var list = document.getElementById('admin-groups-list');
  if (!list) return;
  list.innerHTML = '';
  snap.docs.forEach(function(d) {
    var g = d.data();
    var el = document.createElement('div');
    el.className = 'admin-group-item';
    el.innerHTML =
      '<div>' +
        '<strong>' + escapeHtml(g.name) + '</strong>' +
        '<span class="badge-type">' + escapeHtml(g.type) + '</span>' +
        '<span class="member-count">' + (g.memberIds || []).length + ' membre(s)</span>' +
      '</div>' +
      '<div class="admin-group-actions">' +
        '<button onclick="manageGroupMembers(\'' + d.id + '\')" class="btn-sm">👥 Membres</button>' +
        '<button onclick="deleteGroup(\'' + d.id + '\')" class="btn-sm btn-danger">🗑️</button>' +
      '</div>';
    list.appendChild(el);
  });
}

async function createGroup() {
  var name = val('new-group-name');
  var type = val('new-group-type') || document.getElementById('new-group-type').value;
  if (!name) return showToast('Nom du groupe requis', 'error');

  try {
    var memberIds = [];
    if (type === 'permanent') memberIds = await getAllPersonnelIds();

    await db.collection('groups').add({
      name     : name,
      type     : type,
      createdBy: currentUser.uid,
      members  : [],
      memberIds: memberIds,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('new-group-name').value = '';
    showToast('Groupe créé !', 'success');
    loadAllGroupsAdmin();
  } catch(err) {
    showToast('Erreur création groupe : ' + err.message, 'error');
  }
}
window.createGroup = createGroup;

async function getAllPersonnelIds() {
  var snap = await db.collection('users').where('role','in',['personnel','dg']).get();
  return snap.docs.map(function(d) { return d.id; });
}

async function deleteGroup(groupId) {
  if (!confirm('Supprimer ce groupe ?')) return;
  try {
    await db.collection('groups').doc(groupId).delete();
    showToast('Groupe supprimé', 'success');
    loadAllGroupsAdmin();
  } catch(err) {
    showToast('Erreur suppression', 'error');
  }
}
window.deleteGroup = deleteGroup;

async function manageGroupMembers(groupId) {
  var groupSnap    = await db.collection('groups').doc(groupId).get();
  var groupData    = groupSnap.data();
  var allUsersSnap = await db.collection('users').get();

  var modal = document.getElementById('members-modal');
  var body  = document.getElementById('members-modal-body');
  modal.dataset.groupId = groupId;
  body.innerHTML = '';

  allUsersSnap.docs.forEach(function(d) {
    var u = d.data();
    var isMember = (groupData.memberIds || []).includes(d.id);
    var el = document.createElement('div');
    el.className = 'member-toggle-item';
    el.innerHTML =
      '<label>' +
        '<input type="checkbox" value="' + d.id + '" ' + (isMember ? 'checked' : '') +
        ' onchange="toggleMember(\'' + groupId + '\',\'' + d.id + '\',this.checked,\'' + escapeHtml(u.displayName) + '\')">' +
        escapeHtml(u.displayName) + ' <em>(' + u.role + ')</em>' +
      '</label>';
    body.appendChild(el);
  });
  modal.classList.remove('hidden');
}
window.manageGroupMembers = manageGroupMembers;

async function toggleMember(groupId, uid, add, name) {
  var groupRef  = db.collection('groups').doc(groupId);
  var groupSnap = await groupRef.get();
  var data      = groupSnap.data();
  var members   = (data.members || []).filter(function(m) { return m.uid !== uid; });
  var memberIds = (data.memberIds || []).filter(function(id) { return id !== uid; });

  if (add) {
    memberIds.push(uid);
    members.push({ uid: uid, addedBy: currentUser.uid, addedAt: new Date() });
  }
  await groupRef.update({ members: members, memberIds: memberIds });
  showToast(name + (add ? ' ajouté(e)' : ' retiré(e)'), 'success');
}
window.toggleMember = toggleMember;

function closeMembersModal() {
  var modal = document.getElementById('members-modal');
  if (modal) modal.classList.add('hidden');
}
window.closeMembersModal = closeMembersModal;

// ════════════════════════════════════════════════════════════════════
//  INVITATION (DG)
// ════════════════════════════════════════════════════════════════════
async function generateInvitation() {
  if (!currentUserData || currentUserData.role !== 'dg') {
    return showToast('Réservé au DG', 'error');
  }
  var role  = document.getElementById('invite-role').value;
  var token = generateToken();

  // Construire l'URL avec le bon chemin GitHub Pages
  var base  = window.location.href.split('?')[0].replace(/\/?$/, '/');
  var link  = base + '?invite=' + token;

  var expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.collection('invitations').doc(token).set({
    createdBy: currentUser.uid,
    role     : role,
    used     : false,
    usedBy   : null,
    usedAt   : null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: firebase.firestore.Timestamp.fromDate(expiry)
  });

  var el   = document.getElementById('invite-link-output');
  var btn  = document.getElementById('btn-copy-invite');
  if (el) { el.textContent = link; el.classList.remove('hidden'); }
  if (btn) btn.classList.remove('hidden');
  showToast('Lien généré — valable 7 jours', 'success');
}
window.generateInvitation = generateInvitation;

function copyInviteLink() {
  var el = document.getElementById('invite-link-output');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(function() { showToast('Lien copié !', 'success'); });
}
window.copyInviteLink = copyInviteLink;

// ════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════════
function goBack() {
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  currentGroupId = null;
  showScreen('main');
}
window.goBack = goBack;

function goBackFromAdmin() { showScreen('main'); }
window.goBackFromAdmin = goBackFromAdmin;

// ════════════════════════════════════════════════════════════════════
//  SERVICE WORKER
// ════════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js')
      .then(function(reg) { console.log('[SW] Enregistré', reg.scope); })
      .catch(function(err) { console.warn('[SW] Échec', err); });
  });
}
