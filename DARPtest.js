//for downloading PDF file and extracting contents of it
const PDFParser = require('pdf-parse');
const uuid = require('uuid');
const axios = require('axios')
const fs = require('fs');
const { doesNotThrow } = require('assert');

function delayedLoop(iterations, delay) {
    let count = 0;
    let errcount = 0;

    function loop() {
        console.log(`Iteration ${count + 1}`);
        count++;
        try{
            setTimeout(() => {
                indivisual_test(drugList[0].효능효과)
                }, 0);
            setTimeout(() => {
                indivisual_test(drugList[0].용법용량)
                }, 4000);
            setTimeout(() => {
                indivisual_test(drugList[0].주의사항)
                }, 8000);
        }
        catch(err){
            if(err){
                errcount++;
                console.log("에러발생:"+err);
            }
        }

        if (count < iterations) {
            setTimeout(loop, delay); // 다음 반복을 delay 시간 후에 실행
            console.log(errcount);
        }
    }

    loop();
    
}

// PDF 파일 다운로드 및 내용 추출 함수
async function extractPDFContent(pdfUrl) {
    try {
        // PDF 파일 다운로드
        console.log('downloading')
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        console.log("successfully downloaded");
        const pdfBuffer = Buffer.from(response.data, 'binary');
        // PDF 파일 내용 추출
        const data = await PDFParser(pdfBuffer);

        let result = data.text.replace(/\u0000/g, ' ')

        return result;
    } 
    catch (error) {
        console.error('Error extracting PDF content:', error);
        throw error;
    }
}

//개별 pdf링크 다운로드 테스트
async function indivisual_test(url){

    result = await extractPDFContent(url);
    
    console.log(result);
}

//pdf링크 다운로드 병렬처리 테스트
async function pipeline_test(drug){

    let precautions,efficacy,dosage;
    
    efficacy = extractPDFContent(drug.효능효과);
    dosage = extractPDFContent(drug.용법용량);
    precautions = extractPDFContent(drug.주의사항);

    Promise.all([efficacy, dosage, precautions]).then((values) => {
        drug.효능효과 = values[0];
        drug.용법용량 = values[1];
        drug.주의사항 = values[2];
        console.log(values[0] + values[1] + values[2]);
    })
}

//each preprocessing
async function regenerateData(obj){

    let efficacy = await extractPDFContent(obj.효능효과);
    let dosage = await extractPDFContent(obj.용법용량);
    let precautions = await extractPDFContent(obj.주의사항);

    Promise.all([efficacy,dosage,precautions]).then(()=>{
        obj.효능효과 = efficacy;
        obj.용법용량 = dosage;
        obj.주의사항 = precautions;
        console.log(obj)
        return obj;
    })
}


let drugList = [
    {id :1, 효능효과:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500005/EE',
    용법용량:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500005/UD',
    주의사항:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500005/NB'},
    {id :2, 효능효과:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500006/EE',
    용법용량:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500006/UD',
    주의사항:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195500006/NB'},
    {id :3, 효능효과:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195600004/EE',
    용법용량:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195600004/UD',
    주의사항:'https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/195600004/NB'}
]

async function test1(drug){
    console.log(await regenerateData(drug));
}

//test1(drugList[1]);



//indivisual_test(drugList[0].효능효과)
//indivisual_test(drugList[0].용법용량)
//indivisual_test(drugList[0].주의사항)


pipeline_test(drugList[0])


// setTimeout(() => {
//     indivisual_test(drugList[0].효능효과)
//     }, 0);
// setTimeout(() => {
//     indivisual_test(drugList[0].용법용량)
//     }, 5000);
// setTimeout(() => {
//     indivisual_test(drugList[0].주의사항)
//     }, 10000);


//delayedLoop(5, 16000);