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

  // Skip processing if already analyzed
  if (snapshot.hasChild("results")) {
    console.log(`Results already exist for request id: ${id}`);
    return;
  }

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

  // Connect to database
  let connection = mysql.createConnection(conn);
  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to database:", err);
      return;
    }
    console.log("Connected to database");
  });

  // Query promises array
  let queryPromises = [];

  // Final result array containing drug names and descriptions
  const finalResult = [];

  // Query database to get names for each tag name
  for (let [tagName, probabilitySum] of sortedTagRank) {
    const values = [];
    let sql =
      "SELECT dl_name, img_key FROM pills.integrated_data WHERE drug_N LIKE ?";
    values.push(`%${tagName}%`);

    const queryPromise = new Promise((resolve, reject) => {
      connection.query(sql, values, (err, results) => {
        if (err) {
          console.log(err);
          reject(err);
        }
        // Skip this query if there is no data
        else if (!results || results.length <= 0) {
          resolve();
        } else {
          // Get name from result
          let name = results[0].dl_name;
          let subImg = results[0].img_key;

          // Split with space / comma / parentheses
          name = String(name).split(/[\s,()]+/)[0];

          // Query again for details
          const values = [];
          let sql =
            "SELECT 품목일련번호, 품목명, 큰제품이미지, 업체명, 성상, 의약품제형 " +
            "FROM pills.final_drug_full_info " +
            "WHERE 품목명 LIKE ?";
          values.push(`%${name}%`);

          console.log("Querying for pill " + name);

          connection.query(sql, values, function (err, results) {
            if (err) {
              console.log(err);
              reject(err); // Reject the promise in case of an error
            } // Skip this query if there is no data
            else if (!results || results.length <= 0) {
              resolve();
            } else {
              for (let row of results) {
                let resultObj = {
                  품목일련번호: row.품목일련번호,
                  품목명: row.품목명,
                  큰제품이미지: row.큰제품이미지 || subImg,
                  업체명: row.업체명,
                  성상: row.성상,
                  의약품제형: row.의약품제형,
                };
                finalResult.push(resultObj);
                // console.log(JSON.stringify(resultObj, null, 2));
              }

              // Resolve promise here, after the second query has completed
              resolve();
            }
          });
        }
      });
    });

    queryPromises.push(queryPromise);
  }

  // Run when all queries have finished
  Promise.all(queryPromises)
    .then(() => {
      // Release database connection after all queries complete
      connection.end();

      // Upload array to Firebase
      const resultRef = rtdbRef(db, `/requests/${id}/results`);
      set(resultRef, finalResult);

      console.log("Uploaded results");
      console.log(JSON.stringify(finalResult, null, 2));
    })
    .catch((error) => {
      console.error("Error in one or more queries:", error);
      connection.end();
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
});
