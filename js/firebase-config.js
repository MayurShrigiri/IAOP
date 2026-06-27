const firebaseConfig = {
  apiKey: "AIzaSyCGIkXaT3jj0AqNzZbbx19wI4fwxLx1Gjo",
  authDomain: "iaop-355f5.firebaseapp.com",
  projectId: "iaop-355f5",
  storageBucket: "iaop-355f5.firebasestorage.app",
  messagingSenderId: "608846288661",
  appId: "1:608846288661:web:a281231aea1d4a940b7b1c",
  measurementId: "G-940BSR4YT8"
};

// Initialize Firebase (Compat)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Set up global references
window.auth = firebase.auth();
window.db = firebase.firestore();
