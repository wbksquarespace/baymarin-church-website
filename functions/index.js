"use strict";
/**
 * BayMarin website forms.
 * Deploy: firebase deploy --only functions:submitForm --project bay-marin-church-website
 * Prerequisites: Firebase Blaze plan, verified sender domain with Resend, and secrets.
 * Secrets: firebase functions:secrets:set RESEND_API_KEY
 *          firebase functions:secrets:set BAYMARIN_MAIL_FROM
 */
const {onRequest}=require("firebase-functions/v2/https");
const {onSchedule}=require("firebase-functions/v2/scheduler");
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,Timestamp}=require("firebase-admin/firestore");
const crypto=require("crypto");
initializeApp();
const {defineSecret}=require("firebase-functions/params");
const mailKey=defineSecret("RESEND_API_KEY");
const mailFrom=defineSecret("BAYMARIN_MAIL_FROM");
const STAFF_EMAIL="info@baymarin.org";
const VISIT_TIMEZONE="America/Los_Angeles";
const VISIT_ADDRESS="Guzman Hall, Dominican University, 50 Acacia Ave, San Rafael, CA 94901";
const VISIT_MAP="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(VISIT_ADDRESS);
const EVENT_COLLECTION="visitor_reminders";
const allowedHosts=new Set(["bay-marin-church-website.web.app","bay-marin-church-website.firebaseapp.com","baymarin.org","www.baymarin.org"]);
const hits=new Map();
const bad=(res,code,message)=>res.status(code).json({ok:false,message});
const string=(value,max=200)=>typeof value==="string"?value.trim().slice(0,max):"";
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function checkRate(ip){
 const now=Date.now();
 for(const [key,val] of hits){if(val.until<now)hits.delete(key);}
 const current=hits.get(ip)||{count:0,until:now+3600000};
 if(current.until<now){current.count=0;current.until=now+3600000;}
 current.count++;hits.set(ip,current);
 return current.count<=10;
}
function createMail(data){
 const isVisit=data.kind==="visit";
 const name=isVisit?string(data.first,80)+" "+string(data.last,80):string(data.name,120);
 const email=string(data.email,200);
 const subject=isVisit?"Plan My Visit - BayMarin":"Question from BayMarin Website";
 const rows=isVisit?[
  ["Name",name],["Email",email],["Phone",string(data.phone,80)||"Not provided"],
  ["Visit date",string(data.date,20)],["Service",string(data.service,120)],
  ["Location",string(data.location,150)],["Bringing children",string(data.children,30)],
  ["Children details",string(data.childrenDetails,250)||"Not provided"],
  ["New to the area",string(data.newArea,80)||"Not provided"],
  ["How they heard",string(data.how,150)||"Not provided"],
  ["Questions",string(data.help,1500)||"None"],
  ["Follow-up requested",data.contact?"Yes":"No"],["Email reminders opted in",data.reminders===true?"Yes":"No"]
 ]:[["Name",name],["Email",email],["Message",string(data.message,2500)]];
 const htmlRows=rows.map(([a,b])=>"<tr><th align='left' style='padding:9px;background:#edf3ee;vertical-align:top'>"+escapeHtml(a)+"</th><td style='padding:9px;white-space:pre-wrap'>"+escapeHtml(b)+"</td></tr>").join("");
 const cleanName=name.trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu,"").slice(0,50)||"there";
 const acknowledgement=isVisit
 ? "Hi "+cleanName+",\n\nWe're looking forward to welcoming you to BayMarin! We received your request to visit on "+string(data.date,20)+".\n\nGathering: Sunday at 10:00 AM\nWhere: "+VISIT_ADDRESS+"\nDirections: "+VISIT_MAP+"\n\nOur staff team will review your request and aims to respond within 24–48 hours, often sooner. "+(data.reminders===true?"You'll also receive a helpful reminder as Sunday approaches.":"You have not signed up for visit reminder emails.")+"\n\nNeed to change your plans or ask a question? Email info@baymarin.org.\n\nWe're glad you're coming!\nBayMarin Church"
 : "Hi "+cleanName+",\n\nThank you for reaching out to BayMarin Church. We received your message. Someone from our staff team will review it and aim to respond within 24–48 hours, often sooner.\n\nIf your need is urgent, please contact info@baymarin.org directly.\n\nWe're glad you connected with us!\nBayMarin Church";
 const staffMessage={from:mailFrom.value(),to:[STAFF_EMAIL],reply_to:email,
  subject:subject+" — "+name.trim(),html:"<h2>New "+escapeHtml(isVisit?"visit request":"question")+"</h2><table cellspacing='0' border='0' style='border-collapse:collapse'>"+htmlRows+"</table>"};
 const replyMessage={from:mailFrom.value(),to:[email],reply_to:STAFF_EMAIL,
  subject:"We received your message — BayMarin Church",text:acknowledgement};
 return [staffMessage,replyMessage];
}
exports.submitForm=onRequest({region:"us-west1",cors:["https://bay-marin-church-website.web.app","https://bay-marin-church-website.firebaseapp.com","https://baymarin.org","https://www.baymarin.org"],invoker:"public",secrets:[mailKey,mailFrom],maxInstances:5,timeoutSeconds:20},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="POST")return bad(res,405,"Method not allowed.");
 const origin=req.get("origin");
 if(origin){let host="";try{host=new URL(origin).hostname;}catch(e){}
   if(!allowedHosts.has(host))return bad(res,403,"This origin is not authorized.");
 }
 const ct=req.get("content-type")||"";
 if(!ct.toLowerCase().includes("application/json"))return bad(res,415,"Unsupported content type.");
 const data=req.body;
 if(!data||typeof data!=="object"||Array.isArray(data))return bad(res,400,"Invalid form data.");
 if(string(data.website,200))return bad(res,400,"Unable to submit this request.");
 if(!checkRate(req.ip||"unknown"))return bad(res,429,"Too many messages. Please try again later.");
 const isVisit=data.kind==="visit",isQuestion=data.kind==="question";
 if(!isVisit&&!isQuestion)return bad(res,400,"Unknown form type.");
 const email=string(data.email,200);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return bad(res,400,"Please enter a valid email address.");
 if(isVisit){
  if(!string(data.first,80)||!string(data.last,80)||!/^\d{4}-\d{2}-\d{2}$/.test(string(data.date,20))||
    !string(data.service,120)||!string(data.location,150)||!["Yes","No","Not sure"].includes(string(data.children,30)))
    return bad(res,400,"Please complete all required visit fields.");
 }else if(!string(data.name,120)||!string(data.message,2500))
  return bad(res,400,"Please include your name and question.");
 try{

   const messages=createMail(data);
   const response=await fetch("https://api.resend.com/emails/batch",{
    method:"POST",headers:{"Authorization":"Bearer "+mailKey.value(),"Content-Type":"application/json"},
    body:JSON.stringify(messages),signal:AbortSignal.timeout(12000)
   });
   if(!response.ok){console.error("Email provider rejected request; status:",response.status);return bad(res,503,"We couldn't confirm delivery. Please try again shortly.");}
   const result=await response.json();
   if(!Array.isArray(result.data)||result.data.length!==2)return bad(res,503,"We couldn't confirm both messages were accepted.");
   // Never schedule automated reminders unless the visitor deliberately opts in.
   if(isVisit&&data.reminders===true){
     const visitDate=string(data.date,20);
     const dateParts=visitDate.split("-").map(Number);
     const localNoonUTC=Date.UTC(dateParts[0],dateParts[1]-1,dateParts[2],12);
     const sunday=new Date(localNoonUTC).getUTCDay();
     if(sunday!==0)return bad(res,400,"Please select a Sunday visit date.");
     // At 10 AM PST (18 UTC) or PDT (17 UTC). Determine timezone via Intl.
     const noon=new Date(localNoonUTC);
     const tz=Intl.DateTimeFormat("en-US",{timeZone:VISIT_TIMEZONE,timeZoneName:"shortOffset"}).formatToParts(noon).find(p=>p.type==="timeZoneName").value;
     const offsetHours=Number(tz.replace("GMT","").replace(/[^0-9+-]/g,""))||0;
     const visitAt=new Date(Date.UTC(dateParts[0],dateParts[1]-1,dateParts[2],10-offsetHours));
     // 48 hours before at 10 AM, Sunday morning at 8 AM local.
     const reminder48=new Date(visitAt.getTime()-48*3600000);
     const reminderMorning=new Date(visitAt.getTime()-2*3600000);
     const now=Date.now();
     if(visitAt.getTime()>now){
       const stages=[{stage:"before",at:reminder48},{stage:"morning",at:reminderMorning}].filter(x=>x.at.getTime()>now);
       if(stages.length){
         const id=crypto.randomUUID();
         await getFirestore().collection(EVENT_COLLECTION).doc(id).set({
           name:string(data.first,80),email:string(data.email,200),visitDate,
           visitAt:Timestamp.fromDate(visitAt),reminderStage:stages[0].stage,
           nextReminderAt:Timestamp.fromDate(stages[0].at),createdAt:Timestamp.now(),
           attempts:0,remindersOptedIn:true
         });
       }
     }
   }
   return res.status(200).json({ok:true,message:"Thanks! Your message was received and confirmation email requested."});
 }catch(err){
   console.error("Form delivery failed",err?.name||"unknown");
   return bad(res,503,"Unable to submit right now. Please try again later.");
 }
});

function reminderMessage(record,stage){
 const short=record.name||"there";
 const when=stage==="before"?"in two days":"this morning";
 const subject=stage==="before"?"Your Sunday visit is coming up — BayMarin Church":"We're looking forward to seeing you today — BayMarin";
 return {from:mailFrom.value(),to:[record.email],reply_to:STAFF_EMAIL,subject,
  text:"Hi "+short+",\n\nJust a friendly reminder: your BayMarin visit is "+when+"!\n\nSunday worship: 10:00 AM\nLocation: "+VISIT_ADDRESS+"\nGet directions: "+VISIT_MAP+"\n\nCome as you are. We're looking forward to meeting you. If your plans have changed, just reply to this email and let us know.\n\nBayMarin Church\ninfo@baymarin.org"};
}
exports.sendVisitReminders=onSchedule({schedule:"every 30 minutes",timeZone:VISIT_TIMEZONE,region:"us-west1",secrets:[mailKey,mailFrom],maxInstances:1,timeoutSeconds:120},async()=>{
 const db=getFirestore();
 const now=Timestamp.now();
 const query=await db.collection(EVENT_COLLECTION).where("nextReminderAt","<=",now).limit(100).get();
 for(const snap of query.docs){
  try{
   // Lease each reminder to avoid overlapping scheduler invocations.
   let record=null;
   await db.runTransaction(async txn=>{
    const latest=await txn.get(snap.ref);
    if(!latest.exists)return;
    const data=latest.data();
    if(data.nextReminderAt.toMillis()>Date.now()||!data.remindersOptedIn)return;
    record=data;
    txn.update(snap.ref,{nextReminderAt:Timestamp.fromMillis(Date.now()+12*60000),attempts:(data.attempts||0)+1});
   });
   if(!record)continue;
   const reply=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{"Authorization":"Bearer "+mailKey.value(),"Content-Type":"application/json"},
    body:JSON.stringify(reminderMessage(record,record.reminderStage)),signal:AbortSignal.timeout(12000)
   });
   if(!reply.ok)throw new Error("Provider status "+reply.status);
   const visitMs=record.visitAt.toMillis();
   const morningMs=visitMs-2*3600000;
   if(record.reminderStage==="before"&&morningMs>Date.now()){
    await snap.ref.update({reminderStage:"morning",nextReminderAt:Timestamp.fromMillis(morningMs),attempts:0});
   }else{
    await snap.ref.delete();
   }
  }catch(err){console.error("Reminder send retry needed",snap.id,err?.message);}
 }
});
