"use strict"
import dotenv from "dotenv"
import express from "express"
import bodyParser from "body-parser";
import * as winston from "winston";
import 'winston-daily-rotate-file';
import { ChatGPTAPI } from 'chatgpt'
import ExpiryMap from 'expiry-map'

dotenv.config()
const app = express()
app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 1000000 }));
const transport = new winston.transports.DailyRotateFile({
    filename: './logs/application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxSize: '20m',
    maxFiles: '7d'
});
const logger = winston.createLogger({
    transports: [
        transport
    ]
})

app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
})

let clients = [];

const map = new ExpiryMap(6 * 60 * 1000)

app.get('/status', (request, response) => response.json({clients: clients.length}));

function eventsHandler(request, response) {
    const  clientId = request.query?.id
    if(!clientId){
        return res.json({ code: 1, msg: 'clientId error' })
    }
    const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };
    response.writeHead(200, headers);
  
    // response.write();
  
    const newClient = {
      id: clientId,
      response
    };
  
    clients.push(newClient);
  
    request.on('close', () => {
      console.log(`${clientId} Connection closed`);
      clients = clients.filter(client => client.id !== clientId);
    });
  }
  
app.get('/events', eventsHandler);

function sendEventsToAll(text, clientId) {
    clients.forEach((client)=>{
        if(client.id === clientId){
            client.response.write(`${text}`)
        }
    })
}

app.post("/chatgpt", async (req, res) => {
    try{
        const conversationId = req?.body?.conversation_id
        const parentMessageId = req?.body?.parent_message_id
        const clientId = req?.body?.client_id
        let subject = req?.body?.subject
        if(!subject){
            return res.json({ code: 1, msg: 'subject error' })
        }
        const api = new ChatGPTAPI({ 
            apiKey: process.env.OPENAI_API_KEY,
            // completionParams: {
            //     model: 'text-davinci-003'
            // },
            // messageStore: map
        })
        let params = {
            // promptPrefix: `You are ChatGPT, a large language model trained by OpenAI. For each answer, you should answer as comprehensively as possible. It is important to answer as comprehensively as possible, so keep this in mind.
            // Current date: ${new Date().toISOString()}\n\n`,
            // promptSuffix: `\n return the result in Chinese.\n ChatGPT:\n`,
            onProgress: (partialResponse) => {
                sendEventsToAll(partialResponse.text, clientId)
            }
        }

        let response
        if (conversationId && parentMessageId){
            response = await api.sendMessage(subject, {
                conversationId,
                parentMessageId,
                ...params
            })
        }else{
            response = await api.sendMessage(subject, params)
        }
        sendEventsToAll("[DONE]", clientId)
        return res.json({ code: 0, msg:'success' , data: {
            content : response.text,
            conversation_id: response.conversationId,
            parent_message_id : response.id,
            server: 1
        }})
    }catch(err){
        logger.error("ERROR_TIME:"+getCurrentTime())
        logger.error("ERROR:" + err.toString())
        logger.error("--------------------------------")
        console.log(err)
        return res.json({ code: 1, msg: "服务繁忙,请重试" })
    }
    
})



app.listen(process.env.APP_PORT, process.env.APP_HOST_NAME, function () {
    console.log(`服务器运行在http://${process.env.APP_HOST_NAME}:${process.env.APP_PORT}`);
})

function getCurrentTime() {
    var date = new Date();//当前时间
    var month = zeroFill(date.getMonth() + 1);//月
    var day = zeroFill(date.getDate());//日
    var hour = zeroFill(date.getHours());//时
    var minute = zeroFill(date.getMinutes());//分
    var second = zeroFill(date.getSeconds());//秒
    
    //当前时间
    var curTime = date.getFullYear() + "-" + month + "-" + day
            + " " + hour + ":" + minute + ":" + second;
    
    return curTime;
}

/**
 * 补零
 */
function zeroFill(i){
    if (i >= 0 && i <= 9) {
        return "0" + i;
    } else {
        return i;
    }
}