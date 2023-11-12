// Require Firebase tools
const { initializeApp } = require("firebase/app");
const {
  getDatabase,
  ref: rtdbRef,
  onChildAdded,
} = require("firebase/database");

// Configure Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API,
  authDomain: "pilltong-9b8cd.firebaseapp.com",
  databaseURL: "https://pilltong-9b8cd-default-rtdb.firebaseio.com",
  projectId: "pilltong-9b8cd",
  storageBucket: "pilltong-9b8cd.appspot.com",
  messagingSenderId: "171734103287",
  appId: "1:171734103287:web:fa99fd6de894ca9bc2cff2",
  measurementId: "G-5EQEEPFRPY",
};

const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
const db = getDatabase(app);

// Create RTDB reference
const ref = rtdbRef(db, "requests/");

// Run when new node is added under requests node
onChildAdded(ref, (snapshot) => {
  // Get images array
  const images = snapshot.val().images;

  // Analyze each image
  for (let i of images) {
    console.log(i);
    // TODO call Azure Custom Vision API
  }
});
