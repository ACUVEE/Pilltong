// Require Firebase tools
const { initializeApp } = require("firebase/app");
const {
  getDatabase,
  ref: rtdbRef,
  onChildAdded,
} = require("firebase/database");

// Require axios to request Azure Custom Vision analysis
const axios = require("axios");

require("dotenv").config();

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
onChildAdded(ref, async (snapshot) => {
  // ID of added node
  const id = snapshot.key;

  // Initialize a map to store cumulative probabilities for each tag name
  const tagRankMap = new Map();

  // Get images array
  const images = snapshot.val().images;

  // Analyze each image
  for (let image of images) {
    // Call Azure Custom Vision API
    try {
      let analysis = await getAnalysis(image);
      const predictions = analysis.data.predictions.slice(0, 10);

      // Output predictions
      console.log("Predictions:");
      for (let prediction of predictions) {
        const tagName = prediction.tagName;
        const probability = prediction.probability;

        /*
            console.log(`    Tag Name: ${tagName}`);
            console.log(`    Probability: ${probability}`);
            console.log("----");
        */

        // Accumulate probabilities in map
        if (tagRankMap.has(tagName))
          tagRankMap.set(tagName, tagRankMap.get(tagName) + probability);
        // Initialize with current probability if not in map
        else tagRankMap.set(tagName, probability);
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }

  // Sort the map by total probabilities in descending order
  const sortedTagRank = Array.from(tagRankMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Output the sorted tag ranks
  console.log("Tag Ranks:");
  for (let [tagName, probabilitySum] of sortedTagRank) {
    console.log(`    Tag Name: ${tagName}`);
    console.log(`    Total Probability: ${probabilitySum}`);
    console.log("----");
  }
});

// Send POST request to Azure Custom Vision
async function getAnalysis(imageUrl) {
  // Send Axios request (url, body, options)
  const result = await axios.post(
    process.env.AZURE_API_URL,
    { Url: `${imageUrl}` },
    {
      headers: {
        "Prediction-Key": process.env.AZURE_PREDICTION_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  return result;
}
