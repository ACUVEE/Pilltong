// Require Firebase tools
const { initializeApp } = require("firebase/app");
const {
  getDatabase,
  ref: rtdbRef,
  onChildAdded,
  set,
} = require("firebase/database");
// Require axios to request Azure Custom Vision analysis
const axios = require("axios");
// Required for connecting mysql databases
const mysql = require("mysql2");

require("dotenv").config();

// Check environment vars
const requiredEnvVars = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASS",
  "FIREBASE_API",
  "AZURE_API_URL",
  "AZURE_PREDICTION_KEY",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1); // Exit the process if a required variable is missing
  }
}

// Database connection info
const conn = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

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
  console.log("Request id: " + id);

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

  // Get names for each tag name
  // Connect to database
  let connection = mysql.createConnection(conn);
  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to database:", err);
      return;
    }
    console.log("Connected to database");
  });

  // Final result array
  let resultObjects = [];
  // Query promises array
  let queryPromises = [];

  for (let [tagName, probabilitySum] of sortedTagRank) {
    const values = [];
    let sql =
      "SELECT dl_name, img_key, dl_material, di_class_no, chart " +
      "FROM pills.integrated_data " +
      "WHERE drug_N LIKE ?";
    values.push(`%${tagName}%`);

    const queryPromise = new Promise((resolve, reject) => {
      connection.query(sql, values, (err, results) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          // Assuming the query returns an array of rows
          for (let row of results) {
            // Create an object for each row and add it to the resultObjects array
            let resultObject = {
              dl_name: row.dl_name,
              img_key: row.img_key,
              dl_material: row.dl_material,
              di_class_no: row.di_class_no,
              chart: row.chart,
            };
            resultObjects.push(resultObject);
          }
          resolve();
        }
      });
    });

    queryPromises.push(queryPromise);
  }

  // Release database connection after all queries complete
  Promise.all(queryPromises)
    .then(() => {
      connection.end();

      // Upload array to Firebase
      const resultRef = rtdbRef(db, `/requests/${id}/results`);
      set(resultRef, resultObjects);
      console.log("Uploaded results");
      console.log(JSON.stringify(resultObjects, null, 2));
    })
    .catch((error) => {
      console.error("Error in one or more queries:", error);
      connection.end();
    });
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
