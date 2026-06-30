/* ============================================================
   IAOP — chat.js  |  Personal Chat Feature
   ============================================================ */

let currentChatUnsubscribe = null;
let currentChatId = null;
let chatRecipientId = null;

function openChatDrawer(recipientId, recipientName, recipientPhoto) {
    if (!currentUser) return;
    
    // Set UI
    document.getElementById('chat-drawer').classList.add('open');
    document.getElementById('chat-header-name').textContent = recipientName;
    
    const avatarEl = document.getElementById('chat-header-avatar');
    if (recipientPhoto) {
        avatarEl.innerHTML = `<img src="${recipientPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${recipientName}">`;
        avatarEl.style.background = 'transparent';
        avatarEl.style.padding = '0';
    } else {
        avatarEl.innerHTML = (recipientName[0] || '?').toUpperCase();
        avatarEl.style.background = '';
        avatarEl.style.padding = '';
    }

    // Determine Chat ID (alphabetical combination of UIDs)
    chatRecipientId = recipientId;
    const uids = [currentUser.uid, recipientId].sort();
    currentChatId = `${uids[0]}_${uids[1]}`;

    // Clear messages
    document.getElementById('chat-messages').innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.875rem;padding:2rem;">Loading messages...</div>';

    listenForMessages();
}

function closeChatDrawer() {
    document.getElementById('chat-drawer').classList.remove('open');
    if (currentChatUnsubscribe) {
        currentChatUnsubscribe();
        currentChatUnsubscribe = null;
    }
    currentChatId = null;
    chatRecipientId = null;
}

function listenForMessages() {
    if (currentChatUnsubscribe) currentChatUnsubscribe();
    
    const messagesRef = window.db.collection('chats').doc(currentChatId).collection('messages').orderBy('timestamp', 'asc');
    
    currentChatUnsubscribe = messagesRef.onSnapshot(snapshot => {
        const messagesDiv = document.getElementById('chat-messages');
        
        if (snapshot.empty) {
            messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.875rem;padding:2rem;">No messages yet. Send a message to start!</div>';
            return;
        }

        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const isSent = data.senderId === currentUser.uid;
            
            // Format time
            let timeStr = '';
            if (data.timestamp) {
                const d = data.timestamp.toDate();
                timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }

            html += `
                <div class="chat-bubble ${isSent ? 'sent' : 'received'}">
                    ${data.text}
                    <div style="font-size:0.65rem;opacity:0.7;text-align:right;margin-top:0.25rem;">${timeStr}</div>
                </div>
            `;
        });
        
        messagesDiv.innerHTML = html;
        // Scroll to bottom
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, error => {
        console.error("Error loading messages:", error);
        document.getElementById('chat-messages').innerHTML = '<div style="text-align:center;color:var(--danger);font-size:0.875rem;padding:2rem;">Error loading messages. Check permissions.</div>';
    });
}

// Handle sending message
document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentChatId || !currentUser) return;

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    try {
        await window.db.collection('chats').doc(currentChatId).collection('messages').add({
            text: text,
            senderId: currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Optionally update the main chat doc with last message info
        await window.db.collection('chats').doc(currentChatId).set({
            lastMessage: text,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            users: [currentUser.uid, chatRecipientId]
        }, { merge: true });

    } catch (error) {
        console.error("Error sending message:", error);
        showToast("Failed to send message", "error");
    }
});
