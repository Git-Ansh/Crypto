// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBll_aSAVxUI8zTgAYnJNKBdakbsmLL5Tw",
  authDomain: "crypto-pilot-b2376.firebaseapp.com",
  projectId: "crypto-pilot-b2376",
  storageBucket: "crypto-pilot-b2376.firebasestorage.app",
  messagingSenderId: "848560759066",
  appId: "1:848560759066:web:090ad2af07851554774ca3",
  measurementId: "G-TBS831CTKJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);