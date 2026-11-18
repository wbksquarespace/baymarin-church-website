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

function brandedEmail(title,introduction,content,buttonLabel,buttonHref){
 const p=(text)=>"<p style=\"font-size:16px;line-height:1.7;color:#27463a;margin:0 0 18px\">"+escapeHtml(text)+"</p>";
 return "<!doctype html><html><body style=\"margin:0;padding:0;background:#edf2ed;font-family:Arial,Helvetica,sans-serif\">"+
 "<div style=\"display:none;max-height:0;overflow:hidden\">A note from your BayMarin community</div>"+
 "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#edf2ed\"><tr><td align=\"center\" style=\"padding:35px 16px\">"+
 "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"600\" style=\"width:100%;max-width:600px;background:#fff;border-radius:22px;overflow:hidden\">"+
 "<tr><td style=\"background:#123e32;padding:28px 35px;color:#fff;font-size:25px;font-weight:800;letter-spacing:-.7px\">BayMarin<span style=\"font-size:11px;font-weight:400;letter-spacing:2px;display:block;margin-top:8px\">THERE IS ROOM TO BELONG</span></td></tr>"+
 "<tr><td style=\"padding:40px 36px 30px\"><div style=\"color:#42806b;font-size:12px;font-weight:800;letter-spacing:2px;margin-bottom:14px\">"+escapeHtml(introduction)+"</div>"+
 "<h1 style=\"color:#173d31;font-size:37px;line-height:1.13;letter-spacing:-1px;margin:0 0 24px\">"+escapeHtml(title)+"</h1>"+
 content.map(p).join("")+
 (buttonHref?"<p style=\"margin:28px 0\"><a href=\""+escapeHtml(buttonHref)+"\" style=\"background:#143e33;color:#fff;text-decoration:none;border-radius:50px;display:inline-block;padding:15px 24px;font-weight:750\">"+escapeHtml(buttonLabel||"LEARN MORE")+"</a></p>":"")+
 "</td></tr><tr><td style=\"background:#eaf1ec;padding:24px 36px;color:#486655;font-size:13px;line-height:1.65\">BayMarin Church · Sundays at 10:00 AM<br>Guzman Hall, Dominican University · San Rafael, CA<br>Questions? Reply to this email or contact info@baymarin.org</td></tr>"+
 "</table></td></tr></table></body></html>";
}
function createMail(data){
 const isVisit=data.kind==="visit";
 const isConnect=data.kind==="connect";
 const name=isVisit?string(data.first,80)+" "+string(data.last,80):string(data.name,120);
 const email=string(data.email,200);
 const subject=isVisit?"Plan My Visit - BayMarin":isConnect?"Stay Connected - BayMarin":"Question from BayMarin Website";
 const rows=isVisit?[
  ["Name",name],["Email",email],["Phone",string(data.phone,80)||"Not provided"],
  ["Visit date",string(data.date,20)],["Service",string(data.service,120)],
  ["Location",string(data.location,150)],["Bringing children",string(data.children,30)],
  ["Children details",string(data.childrenDetails,250)||"Not provided"],
  ["New to the area",string(data.newArea,80)||"Not provided"],
  ["How they heard",string(data.how,150)||"Not provided"],
  ["Questions",string(data.help,1500)||"None"],
  ["Follow-up requested",data.contact?"Yes":"No"],["Email reminders opted in",data.reminders===true?"Yes":"No"]
 ]:isConnect?[["Name",name],["Email",email],["Request","Please help me stay connected with BayMarin."]]:[["Name",name],["Email",email],["Message",string(data.message,2500)]];
 const htmlRows=rows.map(([a,b])=>"<tr><th align='left' style='padding:9px;background:#edf3ee;vertical-align:top'>"+escapeHtml(a)+"</th><td style='padding:9px;white-space:pre-wrap'>"+escapeHtml(b)+"</td></tr>").join("");
 const cleanName=name.trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu,"").slice(0,50)||"there";
 const acknowledgement=isVisit
 ? "Hi "+cleanName+",\n\nWe're looking forward to welcoming you to BayMarin! We received your request to visit on "+string(data.date,20)+".\n\nGathering: Sunday at 10:00 AM\nWhere: "+VISIT_ADDRESS+"\nDirections: "+VISIT_MAP+"\n\nOur staff team will review your request and aims to respond within 24–48 hours, often sooner. "+(data.reminders===true?"You'll also receive a helpful reminder as Sunday approaches.":"You have not signed up for visit reminder emails.")+"\n\nNeed to change your plans or ask a question? Email info@baymarin.org.\n\nWe're glad you're coming!\nBayMarin Church"
 : "Hi "+cleanName+",\n\nThank you for reaching out to BayMarin Church. We received your message. Someone from our staff team will review it and aim to respond within 24–48 hours, often sooner.\n\nIf your need is urgent, please contact info@baymarin.org directly.\n\nWe're glad you connected with us!\nBayMarin Church";
 const staffMessage={from:mailFrom.value(),to:[STAFF_EMAIL],reply_to:email,
  subject:subject+" — "+name.trim(),html:"<h2>New "+escapeHtml(isVisit?"visit request":"question")+"</h2><table cellspacing='0' border='0' style='border-collapse:collapse'>"+htmlRows+"</table>"};
 const replyMessage={from:mailFrom.value(),to:[email],reply_to:STAFF_EMAIL,
  subject:isVisit?"You're welcome at BayMarin — visit confirmation":isConnect?"You're connected with BayMarin":"We received your message — BayMarin Church",
  text:acknowledgement,
  html:isVisit?brandedEmail("We look forward to welcoming you!","YOUR VISIT IS ON OUR CALENDAR",[
   "Hi "+cleanName+", thanks for planning a visit to BayMarin on "+string(data.date,20)+".",
   "Sunday gathering: 10:00 AM at "+VISIT_ADDRESS+".",
   "Come as you are. You don't need to know anyone or have everything figured out. Our team will review your request and aims to respond within 24–48 hours.",
   data.reminders===true?"You've also asked for helpful email reminders before Sunday.":"Email reminders are off. You can always reach us at info@baymarin.org."
  ],"GET DIRECTIONS",VISIT_MAP)
  :isConnect?brandedEmail("Glad you connected with us!","WELCOME TO BAYMARIN",[
   "Hi "+cleanName+", thanks for reaching out to BayMarin.",
   "Our team received your contact request and aims to get back to you within 24–48 hours.",
   "You can also see current connections and gatherings through Church Center."
  ],"EXPLORE CHURCH CENTER","https://baymarin.churchcenter.com/home")
  :brandedEmail("Your message is with us.","THANK YOU FOR REACHING OUT",[
   "Hi "+cleanName+", your message has been received by BayMarin.",
   "Someone from our staff team will review it and aims to reply within 24–48 hours, often sooner."
  ],"EXPLORE BAYMARIN","https://bay-marin-church-website.web.app")};
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
 const isVisit=data.kind==="visit",isQuestion=data.kind==="question",isConnect=data.kind==="connect";
 if(!isVisit&&!isQuestion&&!isConnect)return bad(res,400,"Unknown form type.");
 const email=string(data.email,200);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return bad(res,400,"Please enter a valid email address.");
 if(isVisit){
   const dateString=string(data.date,20);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(dateString))return bad(res,400,"Please choose a valid Sunday.");
   const selected=new Date(dateString+"T12:00:00Z");
   if(Number.isNaN(selected.getTime())||selected.toISOString().slice(0,10)!==dateString||selected.getUTCDay()!==0)
    return bad(res,400,"BayMarin meets on Sundays. Please choose a Sunday.");
   if(selected.getTime()<Date.now()-24*3600000||selected.getTime()>Date.now()+365*86400000)
    return bad(res,400,"Please choose an upcoming Sunday within the next year.");
 }

 if(isVisit){
  if(!string(data.first,80)||!string(data.last,80)||!/^\d{4}-\d{2}-\d{2}$/.test(string(data.date,20))||
    !string(data.service,120)||!string(data.location,150)||!["Yes","No","Not sure"].includes(string(data.children,30)))
    return bad(res,400,"Please complete all required visit fields.");
 }else if(!string(data.name,120)||(isQuestion&&!string(data.message,2500)))
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
       const stages=[{stage:"before",at:reminder48},{stage:"morning",at:reminderMorning},{stage:"after",at:new Date(visitAt.getTime()+24*3600000)}].filter(x=>x.at.getTime()>now);
       if(stages.length){
         const id=crypto.randomUUID();
         await getFirestore().collection(EVENT_COLLECTION).doc(id).set({
           id,name:string(data.first,80),email:string(data.email,200),visitDate,
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
 const after=stage==="after";
 const stopUrl=record.id?"https://us-west1-bay-marin-church-website.cloudfunctions.net/stopVisitReminders?token="+encodeURIComponent(record.id):"";
 const title=after?"Thanks for connecting with BayMarin!":stage==="before"?"Sunday is almost here.":"Welcome to Sunday at BayMarin!";
 const message=after
  ?["Hi "+short+", we hope your weekend went well.","Whether you were able to visit or your plans changed, we'd love to help you find your next step. Have a question or want to connect? Just reply to this email."]
  :["Hi "+short+", a friendly reminder that your BayMarin visit is "+when+".","We gather at 10:00 AM at "+VISIT_ADDRESS+". There's room for you, and we're glad you're considering joining us.","Need to change your plans or stop reminders? Reply to this email and let us know."];
 return {from:mailFrom.value(),to:[record.email],reply_to:STAFF_EMAIL,subject:after?"A note from BayMarin after Sunday":subject,
  text:message.join("\n\n")+"\n\nBayMarin Church\ninfo@baymarin.org",
  html:brandedEmail(title,after?"STAY CONNECTED":"PLAN YOUR VISIT",message,after?"EXPLORE WAYS TO CONNECT":"GET DIRECTIONS",after?"https://baymarin.churchcenter.com/home":VISIT_MAP)+(stopUrl?'<p style="text-align:center;font:13px Arial,sans-serif;color:#315f4c;padding:14px"><a href="'+escapeHtml(stopUrl)+'" style="color:#315f4c">Stop visit reminders</a></p>':'')
 };
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
   const afterMs=visitMs+24*3600000;
   if(record.reminderStage==="before"&&morningMs>Date.now()){
    await snap.ref.update({reminderStage:"morning",nextReminderAt:Timestamp.fromMillis(morningMs),attempts:0});
   }else if(record.reminderStage!=="after"&&afterMs>Date.now()){
    await snap.ref.update({reminderStage:"after",nextReminderAt:Timestamp.fromMillis(afterMs),attempts:0});
   }else{
    await snap.ref.delete();
   }
  }catch(err){console.error("Reminder send retry needed",snap.id,err?.message);}
 }
});

exports.stopVisitReminders=onRequest({region:"us-west1",cors:false,invoker:"public",maxInstances:2},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).send("Method not allowed");
 const token=string(req.query.token,80);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)){
   return res.status(400).send("Invalid reminder link.");
 }
 try{
   await getFirestore().collection(EVENT_COLLECTION).doc(token).delete();
   res.status(200).type("html").send('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>BayMarin reminders</title><body style="background:#edf3ee;font:18px/1.6 Arial,sans-serif;color:#173e32;margin:0;padding:50px 22px"><main style="max-width:520px;padding:40px;margin:50px auto;background:#fff;border-radius:24px"><h1>BayMarin</h1><h2>Your visit reminders are off.</h2><p>We will not send any more automated visit reminders for this request. You are always welcome to join us or reach out with questions.</p><a href="https://bay-marin-church-website.web.app" style="color:#173e32">Back to BayMarin</a></main></body></html>');
 }catch(err){console.error("Reminder opt-out failed",err?.name||"unknown");res.status(503).send("Unable to update preferences. Please contact info@baymarin.org.");}
});
