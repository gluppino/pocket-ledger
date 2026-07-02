// Copy this file to firebase-config.js and paste in the values from
// Firebase Console > Project settings > Your apps > SDK setup and config.
// These values are not secret -- they identify your project, not a user.

<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyClp-Rq89LFfFP7ePwUM9y3MHujMU3yahc",
    authDomain: "pocket-ledger-96c34.firebaseapp.com",
    projectId: "pocket-ledger-96c34",
    storageBucket: "pocket-ledger-96c34.firebasestorage.app",
    messagingSenderId: "814305738691",
    appId: "1:814305738691:web:8b0e048e59090dbdfa0776",
    measurementId: "G-XSJM911SSN"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
