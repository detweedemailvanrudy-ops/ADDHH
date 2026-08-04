import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDmlaR-Bylvk-TtEma0h3iyvt3YLwhL7Vs",
  authDomain: "sollhelper.firebaseapp.com",
  projectId: "sollhelper",
  storageBucket: "sollhelper.firebasestorage.app",
  messagingSenderId: "788682019261",
  appId: "1:788682019261:web:402702ab5247826ea502d4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);