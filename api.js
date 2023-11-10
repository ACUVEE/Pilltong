// Require Express framework
const express = require("express");
// Required for downloading PDF file and extracting contents
const PDFParser = require("pdf-parse");
// Required for requesting PDF files from other server
const axios = require("axios");
// Required for connecting mysql databases
const mysql = require("mysql2");

require("dotenv").config();

// Host on local port 3001
const app = express();
const PORT = 3001;

// Database connection info
const conn = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

// Download PDF file and extract contents
async function extractPDFContent(pdfUrl) {
  if (pdfUrl == null) return null;

  try {
    // Download PDF
    console.log("Downloading " + pdfUrl);

    const response = await axios.get(pdfUrl, { responseType: "arraybuffer" });
    console.log("Successfully downloaded");
    const pdfBuffer = Buffer.from(response.data, "binary");

    // Extract PDF
    const data = await PDFParser(pdfBuffer);

    // Replace null with space
    let result = data.text.replace(/\u0000/g, " ");

    return result;
  } catch (error) {
    console.error("Error extracting PDF content:", error);
  }
}

// Preprocess each element
async function regenerateData(obj) {
  obj.효능효과 = await extractPDFContent(obj.효능효과);
  obj.용법용량 = await extractPDFContent(obj.용법용량);
  obj.주의사항 = await extractPDFContent(obj.주의사항);

  return obj;
}

// Start the server
const server = app.listen(PORT, () => {
  console.log("start Server");
});

// When the client searches for a drug using its name
app.get("/getItemList", async (req, res) => {
  try {
    // Store queryParams from client
    const queryParams = req.query;
    const values = [];

    // Throw error if itemName null or empty
    if (!queryParams.itemName || queryParams.itemName == "")
      throw new Error("품목명을 입력하세요.");

    let sql =
      "SELECT 품목일련번호, 품목명, 큰제품이미지, 업체명, 성상, 의약품제형 " +
      "FROM pills.final_drug_full_info " +
      "WHERE 품목명 LIKE ?";
    values.push(`%${queryParams.itemName}%`);

    // Connect to database
    let connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results) {
      if (err) {
        console.log(err);
        throw err;
      }
      let drugList = await JSON.stringify(results);
      res.send(drugList);
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// When the client requests details of a specific drug
app.get("/getItemDetail", async (req, res) => {
  try {
    // Store queryParams from client
    const queryParams = req.query;
    const values = [];

    // Throw error if itemNumber null or empty
    if (!queryParams.itemNumber || queryParams.itemNumber == "")
      throw new Error("품목명을 입력하세요.");

    let sql =
      "SELECT 품목일련번호, 품목명, 업체명, 전문일반, 성상, 원료성분, 효능효과, 용법용량, 주의사항, 저장방법, 유효기간,큰제품이미지, 표시앞, 표시뒤, 의약품제형, 색상앞, 색상뒤, 분할선앞, 분할선뒤, 크기장축, 크기단축, 크기두께, 제형코드명 " +
      "FROM pills.final_drug_full_info " +
      "WHERE 품목일련번호 LIKE ?";
    values.push(`%${queryParams.itemNumber}%`);

    // Connect to database
    let connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results) {
      if (err) {
        console.log(err);
        throw err;
      }

      // Preprocess data
      drugDetail = await regenerateData(results[0]);
      Promise.all([drugDetail]).then((value) => {
        res.send(JSON.stringify(drugDetail));
      });
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});
