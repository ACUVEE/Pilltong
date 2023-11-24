// Require Express framework
const express = require("express");
// Required for downloading PDF file and extracting contents
const fs = require("fs").promises; // Use promises from 'fs' module
const PDFParser = require("pdf-parse");
// Required for requesting PDF files from other server
const axios = require("axios");
// Required for connecting mysql databases
const mysql = require("mysql2");
// Required for downloading PDFs without HTTPS auth
const https = require("https");

require("dotenv").config();

/*
 *  ===== Server setup =====
 */
// Host on local port 3001
const app = express();
const PORT = 3001;

// Check required environment variables
const requiredEnvVars = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASS"];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1); // Exit the process if a required variable is missing
  }
}

// Global error handling middleware
app.use(async (err, req, res, next) => {
  console.error(err);
  res
    .status(500)
    .json({ error: "Internal Server Error", details: err.message });
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Handle the error, log it, or throw an exception if necessary
});

// Database connection info
const conn = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

// Start the server
const server = app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});

/*
 *  =====Data processing=====
 */

// Download PDF file and extract contents
async function downloadPdfContent(pdfUrl) {
  if (!pdfUrl) return null;

  try {
    // Download PDF
    console.log("Downloading " + pdfUrl);
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    console.log("Successfully downloaded");

    // Extract PDF contents
    const pdfBuffer = Buffer.from(response.data, "binary");
    const data = await PDFParser(pdfBuffer);

    // Replace null with space
    return data.text.replace(/\u0000/g, " ");
  } catch (error) {
    console.error("Error extracting PDF content:", error);
    throw error;
  }
}

// Read local PDFfile's contents
async function readPdf(itemNumber, type) {
  const PDFpath = `../pdf_fetch/pdf/${itemNumber}-${type}.pdf`;
  try {
    const dataBuffer = await fs.readFile(PDFpath);
    const data = await PDFParser(dataBuffer);

    // Replace null with space
    return data.text.replace(/\u0000/g, " ");
  } catch (error) {
    console.log("Error reading PDF: " + error);
    return null;
  }
}

// EE,UD,NB data preprocessing
async function getPdfContents(obj) {
  if (!obj) {
    console.log(obj);
    return null;
  }
  try {
    const itemNumber = obj.품목일련번호;
    const urls = [obj.효능효과, obj.용법용량, obj.주의사항];

    // Read contents of a local PDF file
    const contents = await Promise.all([
      readPdf(itemNumber, "EE"),
      readPdf(itemNumber, "UD"),
      readPdf(itemNumber, "NB"),
    ]);

    // If there's no PDF file, download PDF and extract contents
    await Promise.all(contents).then(async (resolve, reject) => {
      if (contents[0] == null) {
        contents[0] = await downloadPdfContent(urls[0]);
      }
      if (contents[1] == null) {
        contents[1] = await downloadPdfContent(urls[1]);
      }
      if (contents[2] == null) {
        contents[2] = await downloadPdfContent(urls[2]);
      }
    });

    return Promise.all(contents);
  } catch (error) {
    //console.error("Error EE, UD, NB data preprocessing:", error);
    throw error;
  }
}

// Data preprocessing
async function preprocessData(obj) {
  try {
    // EE,UD,NB data preprocessing
    const pdfcontents = await getPdfContents(obj);
    obj.효능효과 = pdfcontents[0];
    obj.용법용량 = pdfcontents[1];
    obj.주의사항 = pdfcontents[2];

    return [obj];
  } catch (error) {
    console.console.log();
    "Error data preprocessing:", error;
    throw error;
  }
}

/*
 *  ===== GET requests =====
 */
// When the client searches for a drug using its name
app.get("/getItemList", async (req, res) => {
  try {
    // Store queryParams from client
    const queryParams = req.query;
    const values = [];

    // Throw error if itemName null or empty
    if (!queryParams.itemName || queryParams.itemName === "")
      throw new Error("품목명을 입력하세요.");

    const sql =
      "SELECT 품목일련번호, 품목명, 큰제품이미지, 업체명, 성상, 의약품제형 " +
      "FROM pills.final_drug_full_info " +
      "WHERE 품목명 LIKE ?";
    values.push(`%${queryParams.itemName}%`);

    // Connect to database
    const connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results) {
      if (err) {
        console.log(err);
        throw err;
      }
      const drugList = JSON.stringify(results);
      res.send(drugList);

      // Release database connection
      connection.end();
    });
  } catch (error) {
    next(error); // Pass the error to the error-handling middleware
  }
});

// When the client requests details of a specific drug
app.get("/getItemDetail", async (req, res) => {
  try {
    // Store queryParams from client
    const queryParams = req.query;
    const values = [];

    // Throw error if itemNumber null or empty
    if (!queryParams.itemNumber || queryParams.itemNumber === "")
      throw new Error("품목일련번호를 입력하세요.");

    const sql =
      "SELECT 품목일련번호, 품목명, 업체명, 전문일반, 성상, 원료성분, 효능효과, 용법용량, 주의사항, 저장방법, 유효기간,큰제품이미지, 표시앞, 표시뒤, 의약품제형, 색상앞, 색상뒤, 분할선앞, 분할선뒤, 크기장축, 크기단축, 크기두께, 제형코드명 " +
      "FROM pills.final_drug_full_info " +
      "WHERE 품목일련번호 LIKE ?";
    values.push(`%${queryParams.itemNumber}%`);

    // Connect to database
    const connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results) {
      if (err) {
        console.log(err);
        throw err;
      }
      if (!results[0]) {
        throw new Error("no results");
      }
      // Preprocess data
      const drugDetail = await preprocessData(results[0]);

      res.send(JSON.stringify(drugDetail));

      // Release database connection
      connection.end();
    });
  } catch (error) {
    next(error); // Pass the error to the error-handling middleware
  }
});
