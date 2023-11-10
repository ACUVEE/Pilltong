//Require Express framework
const express = require("express");
//Required for downloading PDF file and extracting contents of it
const PDFParser = require("pdf-parse");
const uuid = require("uuid");
const axios = require("axios");
const fs = require("fs");
// Required for connecting mysql databases
const mysql = require("mysql2");
//not used yet
const multer = require("multer");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
const PORT = 3001;

//info of DB to connect
const conn = {
  host: process.env.DB_HOST,
  port: "3306",
  user: process.env.DB_USER,
  password: process.env.DB_PW,
};

// download PDF file and extract contents
async function extractPDFContent(pdfUrl) {
  try {
    // download PDF
    console.log("downloading");
    console.log(pdfUrl);
    const response = await axios.get(pdfUrl, { responseType: "arraybuffer" });
    console.log("successfully downloaded");
    const pdfBuffer = Buffer.from(response.data, "binary");
    // extaract PDF
    const data = await PDFParser(pdfBuffer);

    // Replace null with space
    let result = data.text.replace(/\u0000/g, " ");

    return result;
  } catch (error) {
    console.error("Error extracting PDF content:", error);
    throw error;
  }
}

// Preprocessing each element
async function regenerateData(obj) {
  obj.효능효과 = await extractPDFContent(obj.효능효과);
  obj.용법용량 = await extractPDFContent(obj.용법용량);
  obj.주의사항 = await extractPDFContent(obj.주의사항);

  return obj;
}

// //each preprocessing
// async function regenerateData(obj){

//     let efficacy = extractPDFContent(obj.효능효과);
//     let dosage = extractPDFContent(obj.용법용량);
//     let precautions = extractPDFContent(obj.주의사항);

//     await Promise.all([efficacy,dosage,precautions]).then(()=>{
//         obj.효능효과 = efficacy;
//         obj.용법용량 = dosage;
//         obj.주의사항 = precautions;

//         return obj;
//     })
// }

// start the server
const server = app.listen(PORT, () => {
  console.log("start Server");
});

// When the client searches for a drug using its name
app.get("/getItemList", async (req, res) => {
  try {
    //store queryParams from a client
    const queryParams = req.query;
    const values = [];

    let sql =
      "SELECT * " + "FROM pilltong_capstone.drug_brief_view " + "WHERE 1";
    //Add to query if key has value
    if (queryParams.itemName) {
      sql += " AND 품목명 like ?";
      values.push("%" + queryParams.itemName + "%");
    }

    //additional query
    /*
        if(){
            sql += 'AND 키 = ?';
            values.push(queryParams.쿼리키);
        }
    */

    // execute query and data preprocessing
    let connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results, fields) {
      if (err) {
        console.log(err);
        throw err;
      }

      //data preprocessing
      let drugList = await JSON.stringify(results);

      //send data
      res.send(drugList);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// When the client requests details of a specific drug
app.get("/getItemDetail", async (req, res) => {
  try {
    //store queryParams from a client
    const queryParams = req.query;
    const values = [];

    let sql =
      "SELECT * " + "FROM pilltong_capstone.drug_detail_view " + "WHERE 1";
    //Add to query if key has value
    if (queryParams.itemNumber) {
      sql += " AND 품목일련번호 = ?";
      values.push(queryParams.itemNumber);
    }

    // Connect to database
    let connection = mysql.createConnection(conn);
    connection.query(sql, values, async function (err, results) {
      if (err) {
        console.log(err);
        throw err;
      }

      // data preprocessing
      drugDetail = await regenerateData(results[0]);
      Promise.all([drugDetail]).then((value) => {
        res.send(JSON.stringify(drugDetail));
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
