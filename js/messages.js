/* ============================================================
   IAOP — messages.js  |  Global Direct Messaging System
   ============================================================ */

let currentUser = null;
let currentChatUnsubscribe = null;
let recentChatsUnsubscribe = null;
let activeChatId = null;
let activeRecipientId = null;
let globalUsersCache = {}; // UID -> User Profile

window.auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    
    // Sync global user profile just in case (e.g. legacy user without a username)
    await window.syncGlobalUser(user);

    currentUser = user;
    
    // Setup Profile Dropdown
    const userDoc = await window.db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
        const d = userDoc.data();
        document.getElementById('user-name').textContent = d.displayName;
        document.getElementById('user-email').textContent = d.email;
        document.getElementById('user-username').textContent = `@${d.username}`;
        
        const avatarEl = document.getElementById('btn-profile-menu');
        if (d.photoURL) {
            avatarEl.innerHTML = `<img src="${d.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Profile">`;
            avatarEl.style.background = 'transparent';
        } else {
            avatarEl.textContent = (d.displayName[0] || '?').toUpperCase();
        }
    }

    // Load recent chats
    loadRecentChats();
});

// Settings dropdown
document.getElementById('btn-profile-menu')?.addEventListener('click', e => {
    document.getElementById('profile-dropdown').classList.toggle('open');
    e.stopPropagation();
});
document.addEventListener('click', () => {
    document.getElementById('profile-dropdown')?.classList.remove('open');
});

// Logout
document.getElementById('btn-logout-trigger')?.addEventListener('click', () => {
    document.getElementById('modal-logout-confirm').classList.add('open');
});
document.getElementById('btn-confirm-logout')?.addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = 'index.html';
});
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', function() {
        this.closest('.modal-overlay').classList.remove('open');
    });
});

/* ── RECENT CHATS ─── */
function loadRecentChats() {
    if (recentChatsUnsubscribe) recentChatsUnsubscribe();

    recentChatsUnsubscribe = window.db.collection('chats')
        .where('users', 'array-contains', currentUser.uid)
        .orderBy('lastMessageTime', 'desc')
        .onSnapshot(async (snapshot) => {
            const list = document.getElementById('recent-chats-list');
            if (snapshot.empty) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.875rem;">No recent chats. Search for a username to start messaging!</div>`;
                return;
            }

            let html = '';
            for (let docSnap of snapshot.docs) {
                const data = docSnap.data();
                const otherUid = data.users.find(u => u !== currentUser.uid);
                if (!otherUid) continue;

                // Fetch other user's info
                let otherUser = globalUsersCache[otherUid];
                if (!otherUser) {
                    try {
                        const uDoc = await window.db.collection('users').doc(otherUid).get();
                        if (uDoc.exists) {
                            otherUser = uDoc.data();
                            globalUsersCache[otherUid] = otherUser;
                        }
                    } catch(e) {}
                }

                if (!otherUser) continue;

                const name = otherUser.displayName || 'Unknown';
                const avatar = otherUser.photoURL ? `<img src="${otherUser.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">` : (name[0] || '?').toUpperCase();
                const lastMsg = data.lastMessage || 'Sent an attachment';
                
                // Format time
                let timeStr = '';
                if (data.lastMessageTime) {
                    const d = data.lastMessageTime.toDate();
                    timeStr = d.toLocaleDateString([], {month:'short', day:'numeric'});
                }

                const isActive = (docSnap.id === activeChatId) ? 'active' : '';

                html += `
                    <div class="msg-item ${isActive}" onclick="openChat('${docSnap.id}', '${otherUid}', '${name.replace(/'/g,"\\'")}', '${otherUser.username||''}', '${otherUser.photoURL||''}')">
                        <div class="msg-avatar" style="${otherUser.photoURL ? 'background:transparent' : ''}">${avatar}</div>
                        <div class="msg-info">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <div class="msg-name">${name}</div>
                                <div style="font-size:0.7rem;color:var(--text-muted);">${timeStr}</div>
                            </div>
                            <div class="msg-preview">${lastMsg}</div>
                        </div>
                    </div>
                `;
            }
            
            list.innerHTML = html;
        });
}

/* ── SEARCH USER ─── */
document.getElementById('user-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('user-search-input');
    const query = input.value.trim().toLowerCase().replace('@', '');
    if (!query) return;

    // Search by username
    try {
        const snap = await window.db.collection('users').where('username', '==', query).get();
        if (snap.empty) {
            showToast(`User @${query} not found.`, 'error');
            return;
        }

        const userDoc = snap.docs[0];
        const userData = userDoc.data();

        if (userData.uid === currentUser.uid) {
            showToast("You can't message yourself!", "warning");
            return;
        }

        // Determine chat ID
        const uids = [currentUser.uid, userData.uid].sort();
        const chatId = `${uids[0]}_${uids[1]}`;

        input.value = '';
        openChat(chatId, userData.uid, userData.displayName, userData.username, userData.photoURL);

    } catch (error) {
        console.error("Search error", error);
        showToast("Search failed.", "error");
    }
});

/* ── OPEN CHAT ─── */
function openChat(chatId, recipientUid, name, username, photoURL) {
    activeChatId = chatId;
    activeRecipientId = recipientUid;

    // UI Update
    document.getElementById('empty-chat-state').style.display = 'none';
    document.getElementById('active-chat-view').style.display = 'flex';
    document.getElementById('active-chat-name').textContent = name;
    document.getElementById('active-chat-username').textContent = `@${username}`;
    
    const avatarEl = document.getElementById('active-chat-avatar');
    if (photoURL && photoURL !== 'null' && photoURL !== 'undefined') {
        avatarEl.innerHTML = `<img src="${photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        avatarEl.style.background = 'transparent';
    } else {
        avatarEl.innerHTML = (name[0] || '?').toUpperCase();
        avatarEl.style.background = 'var(--gradient-brand)';
    }

    // Highlight sidebar
    document.querySelectorAll('.msg-item').forEach(el => el.classList.remove('active'));
    // Mobile toggle
    if (window.innerWidth <= 768) {
        document.getElementById('msg-main-area').classList.add('active');
        document.getElementById('btn-back-to-list').style.display = 'block';
    }

    loadMessages();
}

function closeMobileChat() {
    document.getElementById('msg-main-area').classList.remove('active');
    activeChatId = null;
    activeRecipientId = null;
    if (currentChatUnsubscribe) currentChatUnsubscribe();
}

/* ── MESSAGES SYNC ─── */
function loadMessages() {
    if (currentChatUnsubscribe) currentChatUnsubscribe();
    const messagesDiv = document.getElementById('chat-messages');
    messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.875rem;padding:2rem;">Loading messages...</div>';

    currentChatUnsubscribe = window.db.collection('chats').doc(activeChatId).collection('messages')
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            if (snapshot.empty) {
                messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.875rem;padding:2rem;">Say hi!</div>';
                return;
            }

            let html = '';
            snapshot.forEach(doc => {
                const data = doc.data();
                const isSent = data.senderId === currentUser.uid;
                
                let timeStr = '';
                if (data.timestamp) {
                    const d = data.timestamp.toDate();
                    timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                }

                html += `
                    <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
                        ${data.text}
                        <div style="font-size:0.65rem;opacity:0.7;text-align:${isSent?'right':'left'};margin-top:0.25rem;">${timeStr}</div>
                    </div>
                `;
            });
            
            messagesDiv.innerHTML = html;
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
}

/* ── SEND MESSAGE ─── */
document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChatId || !currentUser) return;

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    try {
        await window.db.collection('chats').doc(activeChatId).collection('messages').add({
            text: text,
            senderId: currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await window.db.collection('chats').doc(activeChatId).set({
            lastMessage: text,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            users: [currentUser.uid, activeRecipientId]
        }, { merge: true });

    } catch (error) {
        console.error("Error sending message:", error);
        showToast("Failed to send message", "error");
    }
});
