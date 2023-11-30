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
// Required for downloading images
const fs = require("fs");
const path = require("path");
const stream = require("stream");
const sharp = require("sharp");

require("dotenv").config();

// Check environment vars
const requiredEnvVars = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASS",
  "FIREBASE_API",
  "AZURE_BOUNDINGBOX_API_URL",
  "AZURE_ANALYSIS_API_URL",
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

  // Store images under 'requests/${id}/original' in current directory
  const localFolderPath = path.join(__dirname, "requests", id, "original");

  // Create the local folder if it doesn't exist
  if (!fs.existsSync(localFolderPath)) {
    fs.mkdirSync(localFolderPath, { recursive: true });
  }

  try {
    // Download all images in parallel
    const downloadedImagePaths = await downloadAllImages(
      images,
      localFolderPath
    );

    // Process each downloaded image concurrently
    await Promise.all(
      downloadedImagePaths.map(async (imagePath) => {
        // Get bounding box for each image
        const boundingBox = await getBoundingBox(fs.readFileSync(imagePath));

        // Crop each image based on the bounding box
        await cropImage(
          imagePath,
          boundingBox,
          0.1,
          path.join(__dirname, "requests", id, "cropped")
        );
      })
    );
  } catch (error) {
    console.error("Error processing images:", error);
  }

  // Analyze each cropped image
  const croppedImagesDir = path.join(__dirname, "requests", id, "cropped");
  const croppedImagePaths = fs
    .readdirSync(croppedImagesDir)
    .map((fileName) => path.join(croppedImagesDir, fileName));

  // Run getAnalysis for each cropped image in parallel
  const analysisPromises = croppedImagePaths.map(async (imagePath) => {
    try {
      const analysis = await getAnalysis(fs.readFileSync(imagePath));
      return analysis;
    } catch (error) {
      console.error(`Error analyzing image ${imagePath}:`, error);
      return null;
    }
  });

  // Wait for all analysis promises to finish
  const analyses = await Promise.all(analysisPromises);

  // Process the results
  for (const result of analyses) {
    if (result) {
      console.log("Analysis Result");
      console.log(JSON.stringify(result, null, 2));

      // Get top 10 predictions
      const predictions = result.predictions.slice(0, 10);

      // Output predictions
      for (let p of predictions) {
        const tagName = p.tagName;
        const probability = p.probability;

        console.log(`    Tag Name: ${tagName}`);
        console.log(`    Probability: ${probability}`);
        console.log("----");

        // Accumulate probabilities in map
        if (tagRankMap.has(tagName)) {
          tagRankMap.set(tagName, tagRankMap.get(tagName) + probability);
        } else {
          tagRankMap.set(tagName, probability);
        }
      }
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
  let finalResult = [];

  // Query database to get names for each tag name
  for (let [tagName, probabilitySum] of sortedTagRank) {
    let values = [];
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
});

/**
 * Downloads and saves multiple images from an array of URLs asynchronously.
 * @param {Array<string>} imageUrls - Array of image URLs.
 * @param {string} localFolderPath - Path of folder to save images to.
 * @returns {Promise<string[]>} - A promise that resolves with an array of downloaded image paths.
 */
async function downloadAllImages(imageUrls, localFolderPath) {
  const downloadedImagePaths = [];

  // Use Promise all to download images concurrently
  await Promise.all(
    imageUrls.map(async (imageUrl, index) => {
      const fileName = `image_${index + 1}.jpg`;

      try {
        const downloadedImagePath = await downloadImage(
          imageUrl,
          localFolderPath,
          fileName
        );
        downloadedImagePaths.push(downloadedImagePath);
        console.log(
          `Image ${index + 1} downloaded and saved at: ${downloadedImagePath}`
        );
      } catch (error) {
        console.error(`Error downloading image ${index + 1}:`, error);
      }
    })
  );

  return downloadedImagePaths;
}

/**
 *
 * @param {string} imageUrl - Image URL to download from.
 * @param {string} localFolderPath - Path to save the image to.
 * @param {string} fileName - Name of the saved file.
 * @returns {Promise<string>} - A promise that resolves with the path to the downloaded image.
 */
async function downloadImage(imageUrl, localFolderPath, fileName) {
  const response = await axios({
    url: imageUrl,
    method: "GET",
    responseType: "stream",
  });

  const imagePath = path.join(localFolderPath, fileName);

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      stream.finished(writer, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(imagePath);
        }
      });
    });

    writer.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Crop an image based on the provided bounding box and margin.
 * @param {string} imagePath - Path to the original image.
 * @param {object} boundingBox - An object with bounding box coordinates and dimensions.
 * @param {number} margin - Margin to expand the bounding box.
 * @param {string} outputDir - Directory to save the cropped image.
 * @returns {Promise<void>} - A promise that resolves once the cropping is complete.
 */
async function cropImage(imagePath, boundingBox, margin, outputDir) {
  // Get the dimensions (width and height) of the original image
  const { width: originalWidth, height: originalHeight } = await sharp(
    imagePath
  ).metadata();

  // Calculate percentages with margin
  const left = boundingBox.left - margin;
  const top = boundingBox.top - margin;
  const width = boundingBox.width + 2 * margin;
  const height = boundingBox.height + 2 * margin;

  // Calculate pixel values based on percentages
  const leftPx = Math.floor(left * originalWidth);
  const topPx = Math.floor(top * originalHeight);
  const widthPx = Math.floor(width * originalWidth);
  const heightPx = Math.floor(height * originalHeight);

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Construct the output path for the cropped image
  const outputImagePath = path.join(
    outputDir,
    path.basename(imagePath).replace(".jpg", "_cropped.jpg")
  );

  // Perform the crop using sharp
  await sharp(imagePath)
    .extract({
      left: leftPx,
      top: topPx,
      width: widthPx,
      height: heightPx,
    })
    .toFile(outputImagePath);

  console.log(`Image cropped and saved to ${outputImagePath}`);
}

// Header for POST request to Azure Custom Vision
const headers = {
  "Prediction-Key": process.env.AZURE_PREDICTION_KEY,
  "Content-Type": "application/octet-stream",
};

/**
 * Finds a bounding box for each pill
 * @param {string} imageData - Image to find a bounding box.
 * @returns - A boundingBox object, with the properties "left" "right" "width" "height"
 */
async function getBoundingBox(imageData) {
  // Send Axios request (url, body, options)
  const response = await axios.post(
    process.env.AZURE_BOUNDINGBOX_API_URL,
    imageData,
    { headers: headers }
  );

  console.log(JSON.stringify(response.data.predictions[0], null, 2));

  return response.data.predictions[0].boundingBox;
}

/**
 * Analyzes each pill to identify it.
 * @param {string} imageData - Image to analyze which pill it is.
 * @returns - An object with pill K-codes and corresponding probability (highest to lowest).
 */
async function getAnalysis(imageData) {
  // Send Axios request (url, body, options)
  const response = await axios.post(
    process.env.AZURE_ANALYSIS_API_URL,
    imageData,
    { headers: headers }
  );

  return response.data;
}
