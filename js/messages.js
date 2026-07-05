/* ============================================================
   IAOP — messages.js  |  Global Direct Messaging System
   ============================================================ */

let currentUser = null;
let currentChatUnsubscribe = null;
let recentChatsUnsubscribe = null;
let activeChatId = null;
let activeRecipientId = null;
let globalUsersCache = {}; // UID -> User Profile
let selectedFile = null;

// WebRTC Globals
const ringtone = new Audio('https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg');
ringtone.loop = true;

let localStream = null;
let peerConnection = null;
let currentCallUnsubscribe = null;
let activeCallChatId = null;
const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};
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

                let contentHtml = data.text || '';
                
                if (data.type === 'image' && data.fileUrl) {
                    contentHtml += `${data.text ? '<br>' : ''}<img src="${data.fileUrl}" class="chat-media-preview" onclick="window.open('${data.fileUrl}', '_blank')">`;
                } else if (data.type === 'file' && data.fileUrl) {
                    contentHtml += `${data.text ? '<br>' : ''}<a href="${data.fileUrl}" target="_blank" class="chat-file-link">
                        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${data.fileName || 'Download File'}</div>
                    </a>`;
                }

                html += `
                    <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
                        ${contentHtml}
                        <div style="font-size:0.65rem;opacity:0.7;text-align:${isSent?'right':'left'};margin-top:0.25rem;">${timeStr}</div>
                    </div>
                `;
            });
            
            messagesDiv.innerHTML = html;
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
}

/* ── SEND MESSAGE & FILE ─── */
document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChatId || !currentUser) return;

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && !selectedFile) return;

    document.getElementById('btn-send-msg').disabled = true;

    try {
        let fileUrl = null;
        let fileName = null;
        let msgType = 'text';

        if (selectedFile) {
            msgType = selectedFile.type.startsWith('image/') ? 'image' : 'file';
            fileName = selectedFile.name;
            const fileRef = window.storage.ref(`chat_attachments/${activeChatId}/${Date.now()}_${fileName}`);
            const snapshot = await fileRef.put(selectedFile);
            fileUrl = await snapshot.ref.getDownloadURL();
        }

        await window.db.collection('chats').doc(activeChatId).collection('messages').add({
            text: text,
            type: msgType,
            fileUrl: fileUrl,
            fileName: fileName,
            senderId: currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await window.db.collection('chats').doc(activeChatId).set({
            lastMessage: msgType === 'text' ? text : `Sent a ${msgType}`,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            users: [currentUser.uid, activeRecipientId]
        }, { merge: true });

        // Reset
        input.value = '';
        selectedFile = null;
        document.getElementById('chat-file-input').value = '';
        document.getElementById('file-upload-preview').style.display = 'none';

    } catch (error) {
        console.error("Error sending message:", error);
        showToast("Failed to send message", "error");
    } finally {
        document.getElementById('btn-send-msg').disabled = false;
    }
});

/* ── FILE INPUT HANDLERS ─── */
document.getElementById('btn-attach-file')?.addEventListener('click', () => {
    document.getElementById('chat-file-input').click();
});
document.getElementById('chat-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        document.getElementById('file-upload-name').textContent = file.name;
        document.getElementById('file-upload-preview').style.display = 'block';
        document.getElementById('btn-send-msg').disabled = false;
    }
});
document.getElementById('btn-clear-file')?.addEventListener('click', () => {
    selectedFile = null;
    document.getElementById('chat-file-input').value = '';
    document.getElementById('file-upload-preview').style.display = 'none';
    if (!document.getElementById('chat-input').value.trim()) {
        document.getElementById('btn-send-msg').disabled = true;
    }
});
document.getElementById('chat-input')?.addEventListener('input', (e) => {
    const hasText = e.target.value.trim().length > 0;
    document.getElementById('btn-send-msg').disabled = !(hasText || selectedFile);
});

/* ── WEBRTC CALLING LOGIC ─── */
const callModal = document.getElementById('call-modal');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

document.getElementById('btn-start-video-call')?.addEventListener('click', () => startCall(true));
document.getElementById('btn-start-voice-call')?.addEventListener('click', () => startCall(false));
document.getElementById('btn-end-call')?.addEventListener('click', endCall);
document.getElementById('btn-reject-call')?.addEventListener('click', endCall);

document.getElementById('btn-toggle-audio')?.addEventListener('click', () => {
    if(!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if(track) {
        track.enabled = !track.enabled;
        document.getElementById('btn-toggle-audio').style.background = track.enabled ? 'rgba(255,255,255,0.2)' : 'var(--danger)';
    }
});
document.getElementById('btn-toggle-video')?.addEventListener('click', () => {
    if(!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if(track) {
        track.enabled = !track.enabled;
        document.getElementById('btn-toggle-video').style.background = track.enabled ? 'rgba(255,255,255,0.2)' : 'var(--danger)';
    }
});

async function setupMediaSources(videoEnabled = true) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
        localVideo.srcObject = localStream;
        return true;
    } catch (e) {
        console.error("Media access denied", e);
        showToast("Camera/Microphone access required", "error");
        return false;
    }
}

async function startCall(videoEnabled) {
    if (!activeChatId) return;
    activeCallChatId = activeChatId;
    const mediaReady = await setupMediaSources(videoEnabled);
    if (!mediaReady) return;

    callModal.classList.add('active');
    document.getElementById('call-controls-incoming').style.display = 'none';
    document.getElementById('call-controls-active').style.display = 'flex';
    document.getElementById('call-status-text').textContent = "Calling...";

    const callDoc = window.db.collection('chats').doc(activeCallChatId).collection('call').doc('current');
    
    // Clear old data if any
    await callDoc.delete().catch(()=> {});

    peerConnection = new RTCPeerConnection(servers);
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
        document.getElementById('call-status-text').textContent = "In Call";
    };

    const callerCandidates = callDoc.collection('callerCandidates');
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            callerCandidates.add(event.candidate.toJSON());
        }
    };

    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };

    await callDoc.set({ offer, callerId: currentUser.uid });

    currentCallUnsubscribe = callDoc.onSnapshot(snapshot => {
        const data = snapshot.data();
        if (!peerConnection?.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            peerConnection.setRemoteDescription(answerDescription);
        }
    });

    callDoc.collection('calleeCandidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                let data = change.doc.data();
                if(peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data));
            }
        });
    });
}

// Global listener for incoming calls
const activeCallListeners = {};
window.auth.onAuthStateChanged(user => {
    if (user) {
        window.db.collection('chats').where('users', 'array-contains', user.uid).onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                const chatId = change.doc.id;
                listenForIncomingCall(chatId);
            });
        });
    }
});

function listenForIncomingCall(chatId) {
    if (activeCallListeners[chatId]) return;
    
    activeCallListeners[chatId] = window.db.collection('chats').doc(chatId).collection('call').doc('current').onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        if (!data) {
            // Call ended
            if (callModal?.classList.contains('active') && activeCallChatId === chatId) {
                endCallUI();
            }
            return;
        }

        if (data.offer && data.callerId !== currentUser.uid && !peerConnection) {
            activeCallChatId = chatId;
            callModal.classList.add('active');
            document.getElementById('call-controls-active').style.display = 'none';
            document.getElementById('call-controls-incoming').style.display = 'flex';
            document.getElementById('call-status-text').textContent = "Incoming Call...";
            
            try { ringtone.play().catch(()=>{}); } catch(e){}
            
            const acceptBtn = document.getElementById('btn-accept-call');
            acceptBtn.onclick = async () => {
                ringtone.pause();
                ringtone.currentTime = 0;
                await answerCall(chatId, data.offer);
            };
        }
    });
}

async function answerCall(chatId, offerData) {
    const mediaReady = await setupMediaSources(true);
    if (!mediaReady) return;

    document.getElementById('call-controls-incoming').style.display = 'none';
    document.getElementById('call-controls-active').style.display = 'flex';
    document.getElementById('call-status-text').textContent = "Connecting...";

    peerConnection = new RTCPeerConnection(servers);
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
        document.getElementById('call-status-text').textContent = "In Call";
    };

    const callDoc = window.db.collection('chats').doc(chatId).collection('call').doc('current');
    const calleeCandidates = callDoc.collection('calleeCandidates');

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            calleeCandidates.add(event.candidate.toJSON());
        }
    };

    const offerDescription = new RTCSessionDescription(offerData);
    await peerConnection.setRemoteDescription(offerDescription);

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    const answer = {
        sdp: answerDescription.sdp,
        type: answerDescription.type,
    };

    await callDoc.update({ answer });

    callDoc.collection('callerCandidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                let data = change.doc.data();
                if(peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data));
            }
        });
    });
}

function endCall() {
    if (activeCallChatId) {
        window.db.collection('chats').doc(activeCallChatId).collection('call').doc('current').delete().catch(()=>{});
    }
    endCallUI();
}

function endCallUI() {
    try {
        ringtone.pause();
        ringtone.currentTime = 0;
    } catch(e){}
    
    if(callModal) callModal.classList.remove('active');
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (currentCallUnsubscribe) {
        currentCallUnsubscribe();
        currentCallUnsubscribe = null;
    }
    if(localVideo) localVideo.srcObject = null;
    if(remoteVideo) remoteVideo.srcObject = null;
    const statusText = document.getElementById('call-status-text');
    if(statusText) statusText.textContent = "";
    activeCallChatId = null;
}

