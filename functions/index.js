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
 const isGroup=data.kind==="community_group";
 const name=isVisit?string(data.first,80)+" "+string(data.last,80):string(data.name,120);
 const email=string(data.email,200);
 const subject=isVisit?"[VISIT REQUEST] Plan My Visit - BayMarin":isConnect?"[STAY CONNECTED] BayMarin":isGroup?"[COMMUNITY GROUP INTEREST] "+string(data.group,120)+" - BayMarin":"["+(string(data.topic,120)||"GENERAL QUESTION").toUpperCase()+"] BayMarin Website";
 const rows=isVisit?[
  ["Form type","Plan a Visit"],["Name",name],["Email",email],["Phone",string(data.phone,80)||"Not provided"],
  ["Visit date",string(data.date,20)],["Service",string(data.service,120)],
  ["Location",string(data.location,150)],["Bringing children",string(data.children,30)],
  ["Children details",string(data.childrenDetails,250)||"Not provided"],
  ["New to the area",string(data.newArea,80)||"Not provided"],
  ["How they heard",string(data.how,150)||"Not provided"],
  ["Questions",string(data.help,1500)||"None"],
  ["Follow-up requested",data.contact?"Yes":"No"],["Email reminders opted in",data.reminders===true?"Yes":"No"]
 ]:isConnect?[["Form type","Stay Connected"],["Name",name],["Email",email],["Request","Please help me stay connected with BayMarin."]]:isGroup?[["Form type","Community Group Interest"],["Name",name],["Email",email],["Phone",string(data.phone,80)||"Not provided"],["Selected group",string(data.group,120)],["Notes and availability",string(data.message,2500)||"None"]]:[["Form type",string(data.topic,120)||"General question"],["Name",name],["Email",email],["Phone",string(data.phone,80)||"Not provided"],["Interest",string(data.topic,120)||"General question"],["Message",string(data.message,2500)]];
 const htmlRows=rows.map(([a,b])=>"<tr><th align='left' style='padding:9px;background:#edf3ee;vertical-align:top'>"+escapeHtml(a)+"</th><td style='padding:9px;white-space:pre-wrap'>"+escapeHtml(b)+"</td></tr>").join("");
 const cleanName=name.trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu,"").slice(0,50)||"there";
 const acknowledgement=isVisit
 ? "Hi "+cleanName+",\n\nWe're looking forward to welcoming you to BayMarin! We received your request to visit on "+string(data.date,20)+".\n\nGathering: Sunday at 10:00 AM\nWhere: "+VISIT_ADDRESS+"\nDirections: "+VISIT_MAP+"\n\nOur staff team will review your request and aims to respond within 24–48 hours, often sooner. "+(data.reminders===true?"You'll also receive a helpful reminder as Sunday approaches.":"You have not signed up for visit reminder emails.")+"\n\nNeed to change your plans or ask a question? Email info@baymarin.org.\n\nWe're glad you're coming!\nBayMarin Church"
 : "Hi "+cleanName+",\n\nThank you for reaching out to BayMarin Church. We received your "+(isGroup?"Community Group Interest ("+string(data.group,120)+")":isConnect?"Stay Connected":string(data.topic,120)||"General Question")+" form. Someone from our staff team will review it and aim to respond within 24–48 hours, often sooner.\n\nIf your need is urgent, please contact info@baymarin.org directly.\n\nWe're glad you connected with us!\nBayMarin Church";
 const staffMessage={from:mailFrom.value(),to:[STAFF_EMAIL],reply_to:email,
  subject:subject+" — "+name.trim(),html:"<h2>New "+escapeHtml(isVisit?"visit request":isGroup?"community group interest request":isConnect?"stay connected request":"question")+"</h2><table cellspacing='0' border='0' style='border-collapse:collapse'>"+htmlRows+"</table>"};
 const replyMessage={from:mailFrom.value(),to:[email],reply_to:STAFF_EMAIL,
  subject:isVisit?"You're welcome at BayMarin — visit confirmation":isConnect?"You're connected with BayMarin":isGroup?"Community group interest received — BayMarin Church":"We received your message — BayMarin Church",
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
  :isGroup?brandedEmail("Let’s find your community.","COMMUNITY GROUP INTEREST RECEIVED",[
   "Hi "+cleanName+", thanks for your interest in "+string(data.group,120)+".",
   "We received your Community Group Interest form. Our team will review available gatherings and aims to follow up within 24–48 hours.",
   "Submitting this form is an expression of interest, not confirmation of group enrollment."
  ],"EXPLORE BAYMARIN","https://bay-marin-church-website.web.app")
  :brandedEmail("Your message is with us.","THANK YOU FOR REACHING OUT",[
   "Hi "+cleanName+", your "+(string(data.topic,120)||"general inquiry")+" form was received by BayMarin.",
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
 const isVisit=data.kind==="visit",isQuestion=data.kind==="question",isConnect=data.kind==="connect",isGroup=data.kind==="community_group";
 if(!isVisit&&!isQuestion&&!isConnect&&!isGroup)return bad(res,400,"Unknown form type.");
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
 if(isGroup&&!["Family Circles","Men & Community","Women & Community","Faith & Conversation","Neighbors & Friends","Serve Together","Not sure — help me find a group"].includes(string(data.group,120)))
  return bad(res,400,"Please select a valid community group interest.");
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
  html:brandedEmail(title,after?"STAY CONNECTED":"PLAN YOUR VISIT",message,after?"EXPLORE WAYS TO CONNECT":"GET DIRECTIONS",after?"https://baymarin.churchcenter.com/home":VISIT_MAP).replace("</body>",(stopUrl?'<p style="text-align:center;font:13px Arial,sans-serif;color:#315f4c;padding:14px"><a href="'+escapeHtml(stopUrl)+'" style="color:#315f4c">Stop visit reminders</a></p>':'')+"</body>")
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


/* BayMarin media publishing endpoints. Deploy Cloud Functions and configure Firestore/Storage. */
const {getAuth}=require("firebase-admin/auth");
const {getStorage,getDownloadURL}=require("firebase-admin/storage");
const {FieldValue}=require("firebase-admin/firestore");
const MEDIA_ORIGINS=["https://bay-marin-church-website.web.app","https://bay-marin-church-website.firebaseapp.com","https://baymarin.org","https://www.baymarin.org"];
const MEDIA_SITE="https://bay-marin-church-website.web.app";
const MEDIA_FEED="https://us-west1-bay-marin-church-website.cloudfunctions.net/sermonFeed";
const xmlSafe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
async function findPublishedMessages(max){
 const snapshot=await getFirestore().collection("sermons").where("published","==",true).orderBy("date","desc").limit(max).get();
 return snapshot.docs.map(doc=>{const d=doc.data();return {id:doc.id,title:d.title||"",series:d.series||"",speaker:d.speaker||"",speakerTitle:d.speakerTitle||"",speakerChurch:d.speakerChurch||"",description:d.description||"",date:d.date||"",topics:d.topics||[],audioUrl:d.audioUrl||"",audioBytes:d.audioBytes||0,audioType:d.audioType||"audio/mpeg",artworkUrl:d.artworkUrl||"",seriesArtworkUrl:d.seriesArtworkUrl||"",notesUrl:d.notesUrl||"",slidesUrl:d.slidesUrl||"",transcriptUrl:d.transcriptUrl||"",transcriptText:d.transcriptText||"",allowDownload:d.allowDownload===true,allowShare:d.allowShare!==false,photos:d.photos||[]};});
}
// Safe readiness probe: confirms the deployed API can reach the sermon database.
// It intentionally never exposes publisher identities, secrets or stored records.
exports.sermonHealth=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:2},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="GET")return bad(res,405,"Method not allowed");
 try{
  await getFirestore().collection("sermons").limit(1).get();
  return res.status(200).json({ok:true,service:"baymarin-sermon-publisher",database:"reachable"});
 }catch(e){console.error("Sermon health failed",e?.name);return res.status(503).json({ok:false,service:"baymarin-sermon-publisher",database:"unavailable"});}
});
exports.latestMessage=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:3},async(req,res)=>{
 if(req.method!=="GET")return bad(res,405,"Method not allowed");
 try{const messages=await findPublishedMessages(30);res.set("Cache-Control","public,max-age=120,s-maxage=120").json({ok:true,messages});}
 catch(e){console.error("Messages query error",e?.name);bad(res,503,"Message library unavailable");}
});
// Keep the legacy endpoint name for compatibility, but prevent unreviewed direct publishing.
exports.publishMessage=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:2},async(req,res)=>{
 res.set("Cache-Control","no-store");
 return bad(res,410,"Direct publishing has been replaced. Use the /media/ dashboard to upload, review and approve messages.");
});
exports.sermonFeed=onRequest({region:"us-west1",cors:false,invoker:"public",maxInstances:3},async(req,res)=>{
 if(req.method!=="GET")return res.status(405).send("Method not allowed");
 try{
  const sermons=await findPublishedMessages(100);
  const items=sermons.map(m=>{
   const published=new Date(m.date+"T10:00:00Z").toUTCString();
   return "<item><title>"+xmlSafe(m.title)+"</title><guid isPermaLink=\"false\">baymarin-"+xmlSafe(m.id)+"</guid>"+
    "<link>"+MEDIA_SITE+"/#messages</link><description>"+xmlSafe(m.description)+"</description>"+
    "<itunes:author>"+xmlSafe(m.speaker)+"</itunes:author><itunes:summary>"+xmlSafe(m.description)+"</itunes:summary>"+
    "<pubDate>"+published+"</pubDate><enclosure url=\""+xmlSafe(m.audioUrl)+"\" length=\""+Number(m.audioBytes)+"\" type=\""+xmlSafe(m.audioType)+"\"/>"+
    (m.artworkUrl?"<itunes:image href=\""+xmlSafe(m.artworkUrl)+"\"/>":"")+"</item>";
  }).join("");
  const xml='<?xml version="1.0" encoding="UTF-8"?>'+
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">'+
    '<channel><title>BayMarin Church Messages</title><link>'+MEDIA_SITE+'</link>'+
    '<atom:link href="'+MEDIA_FEED+'" rel="self" type="application/rss+xml"/>'+
    '<description>Sunday teachings and conversations from BayMarin Church in San Rafael, California.</description>'+
    '<language>en-us</language><itunes:author>BayMarin Church</itunes:author>'+
    '<itunes:owner><itunes:name>BayMarin Church</itunes:name><itunes:email>info@baymarin.org</itunes:email></itunes:owner>'+
    '<itunes:explicit>false</itunes:explicit><itunes:category text="Religion &amp; Spirituality"><itunes:category text="Christianity"/></itunes:category>'+
    items+'</channel></rss>';
  res.set("Content-Type","application/rss+xml; charset=utf-8");
  res.set("Cache-Control","public,max-age=600,s-maxage=600").status(200).send(xml);
 }catch(e){console.error("RSS failed",e?.name);res.status(503).send("Podcast feed unavailable");}
});


/* Two-stage media publishing: draft/upload -> staff review -> explicit approval -> public RSS. */
async function approvedMediaUser(req){
 const auth=req.get("authorization")||"";
 if(!auth.startsWith("Bearer "))throw Object.assign(Error("Sign in required"),{code:401});
 let user;
 try{user=await getAuth().verifyIdToken(auth.slice(7),true);}
 catch(_){throw Object.assign(Error("Session expired; sign in again"),{code:401});}
 const grant=await getFirestore().collection("media_publishers").doc(user.uid).get();
 if(!grant.exists||grant.data()?.active!==true)throw Object.assign(Error("Publisher approval required"),{code:403});
 return user;
}
const MEDIA_MIMES={
 mp3:["audio/mpeg","audio/mp3"],m4a:["audio/mp4","audio/x-m4a"],
 jpg:["image/jpeg"],jpeg:["image/jpeg"],png:["image/png"],webp:["image/webp"],
 pdf:["application/pdf"],txt:["text/plain"],
 docx:["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
 pptx:["application/vnd.openxmlformats-officedocument.presentationml.presentation"]
};
async function verifiedMediaFile(bucket,uid,id,path,prefix,exts,limit,required=false){
 if(!path){if(required)throw Object.assign(Error(prefix+" is required"),{code:400});return {path:"",url:"",bytes:0,contentType:""};}
 if(typeof path!=="string")throw Object.assign(Error("Invalid attachment path"),{code:400});
 const root="sermons/"+uid+"/"+id+"/";
 const suffix=path.startsWith(root)?path.slice(root.length):"";
 const extension=suffix.split(".").pop().toLowerCase();
 if(!exts.includes(extension)||suffix!==prefix+"."+extension)throw Object.assign(Error("Invalid "+prefix+" file"),{code:400});
 const file=bucket.file(path);
 const [exists]=await file.exists();
 if(!exists)throw Object.assign(Error("Upload incomplete: "+prefix),{code:400});
 const [meta]=await file.getMetadata();
 const bytes=Number(meta.size||0);
 if(bytes<1024||bytes>limit||!MEDIA_MIMES[extension].includes(meta.contentType))
  throw Object.assign(Error("Invalid "+prefix+" size or file type"),{code:400});
 return {path,url:await getDownloadURL(file),bytes,contentType:meta.contentType};
}
async function mediaReceipt(to,record,stage){
 // Receipt failures are reported but never disguised as successful email delivery.
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to||""))return false;
 const title=stage==="review"?"Your message is ready to review":"Your message has been published";
 const link=stage==="review"?MEDIA_SITE+"/media/?draft="+encodeURIComponent(record.id):MEDIA_SITE+"/?message="+encodeURIComponent(record.id)+"#messages";
 try{
  const result=await fetch("https://api.resend.com/emails",{
   method:"POST",headers:{"Authorization":"Bearer "+mailKey.value(),"Content-Type":"application/json"},
   body:JSON.stringify({from:mailFrom.value(),to:[to],subject:title+" — BayMarin",
    html:brandedEmail(title,stage==="review"?"MEDIA TEAM · REVIEW REQUIRED":"MEDIA TEAM · PUBLISHED",[
     'Message: '+record.title+' · '+record.speaker+' · '+record.date,
     stage==="review"?"Your uploads are saved as a private draft. Please listen to the entire recording, check the artwork and attachments, then sign into the dashboard and press Approve & Publish. The public website and podcast feed are not updated yet.":"The message is published in the BayMarin library and church podcast RSS feed. If connected, Spotify will pick it up on its own refresh schedule."
    ],stage==="review"?"REVIEW DRAFT":"VIEW MESSAGE",link)})
   ,signal:AbortSignal.timeout(12000)});
  return result.ok;
 }catch(e){console.error("Media receipt failed",e?.name);return false;}
}
exports.stageMessage=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:3,timeoutSeconds:90,secrets:[mailKey,mailFrom]},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="POST")return bad(res,405,"Method not allowed");
 try{
  const user=await approvedMediaUser(req),d=req.body;
  if(!d||typeof d!=="object"||Array.isArray(d))return bad(res,400,"Invalid request");
  const id=string(d.id,64),day=string(d.date,20);
  if(!/^[a-f0-9-]{36}$/i.test(id)||!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day)))return bad(res,400,"Invalid message ID or date");
  for(const k of ["title","series","speaker","description"]){if(!string(d[k],k==="description"?5000:160))return bad(res,400,k+" is required");}
  const email=string(d.confirmationEmail,200);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return bad(res,400,"Enter a valid confirmation email");
  const topics=Array.isArray(d.topics)?[...new Set(d.topics.map(x=>string(x,80)).filter(Boolean))].slice(0,8):[];
  const speakerTitle=string(d.speakerTitle,120),speakerChurch=string(d.speakerChurch,160);
  const bucket=getStorage().bucket();
  const results={};
  for(const [key,prefix,ext,limit,required] of [
    ["audio","message",["mp3","m4a"],262144000,true],
    ["artwork","artwork",["jpg","jpeg","png","webp"],12582912,false],
    ["seriesArtwork","seriesArtwork",["jpg","jpeg","png","webp"],12582912,false],
    ["notes","notes",["pdf","docx","txt"],15728640,false],
    ["slides","slides",["pdf","pptx"],52428800,false],
    ["transcript","transcript",["pdf","txt"],15728640,false],
    ["photo1","photo1",["jpg","jpeg","png","webp"],12582912,false],
    ["photo2","photo2",["jpg","jpeg","png","webp"],12582912,false],
    ["photo3","photo3",["jpg","jpeg","png","webp"],12582912,false]
  ])results[key]=await verifiedMediaFile(bucket,user.uid,id,d[key+"Path"],prefix,ext,limit,required);
  const record={
   id,title:string(d.title,160),series:string(d.series,120),speaker:string(d.speaker,120),
   speakerTitle,speakerChurch,description:string(d.description,5000),date:day,topics,
   authorUid:user.uid,reviewStatus:"pending_review",published:false,
   allowDownload:d.allowDownload===true,allowShare:d.allowShare!==false,
   shareResources:d.shareResources===true,allowTranscript:d.allowTranscript===true,
   transcriptText:d.allowTranscript===true&&results.transcript.path.endsWith(".txt")?string(d.transcriptText,80000):"",
   audioPath:results.audio.path,audioUrl:results.audio.url,audioBytes:results.audio.bytes,audioType:results.audio.contentType,
   artworkPath:results.artwork.path,artworkUrl:results.artwork.url,
   seriesArtworkPath:results.seriesArtwork.path,seriesArtworkUrl:results.seriesArtwork.url,
   notesPath:results.notes.path,notesUrl:d.shareResources===true?results.notes.url:"",
   slidesPath:results.slides.path,slidesUrl:d.shareResources===true?results.slides.url:"",
   transcriptPath:results.transcript.path,transcriptUrl:d.allowTranscript===true?results.transcript.url:"",
   photos:[results.photo1,results.photo2,results.photo3].filter(x=>x.path).map(x=>({path:x.path,url:x.url})),
   createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()
  };
  const doc=getFirestore().collection("sermons").doc(id);
  // Creating is atomic; a repeated request cannot overwrite a previously approved sermon.
  const batch=getFirestore().batch();
  batch.create(doc,record);
  batch.create(getFirestore().collection("media_receipts").doc(id),{ownerUid:user.uid,email,createdAt:FieldValue.serverTimestamp()});
  await batch.commit();
  const emailed=await mediaReceipt(email,record,"review");
  return res.status(201).json({ok:true,id,reviewStatus:"pending_review",emailSent:emailed,reviewUrl:MEDIA_SITE+"/media/?draft="+encodeURIComponent(id)});
 }catch(e){
  if(e.code===6||e.code===409)return bad(res,409,"A draft already exists for this message");
  console.error("Stage media draft failed",e?.name);
  return bad(res,e.code>=400&&e.code<500?e.code:503,e.code>=400&&e.code<500?e.message:"Draft could not be saved. Check Firebase setup and permissions.");
 }
});
exports.reviewMessage=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:3,timeoutSeconds:30},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="GET")return bad(res,405,"Method not allowed");
 try{
  const user=await approvedMediaUser(req),id=string(req.query.id,64);
  if(!/^[a-f0-9-]{36}$/i.test(id))return bad(res,400,"Invalid message ID");
  const snap=await getFirestore().collection("sermons").doc(id).get();
  if(!snap.exists||snap.data()?.authorUid!==user.uid)return bad(res,404,"Draft not found");
  const d=snap.data();
  const {confirmationEmail,...safe}=d;
  return res.json({ok:true,message:{id,...safe,createdAt:undefined,updatedAt:undefined}});
 }catch(e){return bad(res,e.code>=400&&e.code<500?e.code:503,e.code>=400&&e.code<500?e.message:"Unable to open draft");}
});
exports.finalizeMessage=onRequest({region:"us-west1",cors:MEDIA_ORIGINS,invoker:"public",maxInstances:3,timeoutSeconds:45,secrets:[mailKey,mailFrom]},async(req,res)=>{
 res.set("Cache-Control","no-store");
 if(req.method!=="POST")return bad(res,405,"Method not allowed");
 try{
  const user=await approvedMediaUser(req),id=string(req.body?.id,64);
  if(!/^[a-f0-9-]{36}$/i.test(id)||req.body?.approved!==true)return bad(res,400,"Explicit review approval required");
  const ref=getFirestore().collection("sermons").doc(id);
  // Atomic state transition prevents accidental double publication.
  const published=await getFirestore().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists||snap.data().authorUid!==user.uid)throw Object.assign(Error("Draft not found"),{code:404});
   const m=snap.data();
   if(m.published||m.reviewStatus!=="pending_review")throw Object.assign(Error("Message has already been processed"),{code:409});
   tx.update(ref,{published:true,reviewStatus:"published",approvedBy:user.uid,approvedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   return {id,title:m.title,date:m.date,speaker:m.speaker};
  });
  const receipt=await getFirestore().collection("media_receipts").doc(id).get();
  const email=receipt.exists&&receipt.data()?.ownerUid===user.uid?receipt.data().email:"";
  const emailed=await mediaReceipt(email,published,"published");
  return res.json({ok:true,id,emailSent:emailed,libraryUrl:MEDIA_SITE+"/?message="+encodeURIComponent(id)+"#messages",
   podcastFeed:MEDIA_FEED,spotifyStatus:"RSS available when feed is connected; Spotify ingestion not confirmed"});
 }catch(e){console.error("Finalize media failed",e?.name);return bad(res,e.code>=400&&e.code<500?e.code:503,e.code>=400&&e.code<500?e.message:"Publication could not complete");}
});

/**
 * Public, read-only Community Group events feed.
 * Only approved published future events are returned; no private attendee data.
 * Staff automation writes documents to group_events via privileged Admin SDK.
 */
exports.listGroupEvents=onRequest({region:"us-west1",cors:[...allowedHosts].map(h=>"https://"+h)},async(req,res)=>{
 if(req.method!=="GET")return bad(res,405,"Method not allowed");
 res.set("Cache-Control","public, max-age=60, s-maxage=120");
 try{
  const snap=await getFirestore().collection("group_events").where("status","==","published").limit(150).get();
  const now=Date.now();
  const events=snap.docs.map(doc=>{
   const x=doc.data();
   const start=x.start?.toDate?.()?.toISOString?.()||x.start;
   const end=x.end?.toDate?.()?.toISOString?.()||x.end||start;
   return {id:doc.id,title:string(x.title,160),group:string(x.group,100),location:string(x.location,200),start,end,status:"published",registrationUrl:typeof x.registrationUrl==="string"&&/^https:\/\//.test(x.registrationUrl)?x.registrationUrl:""};
  }).filter(e=>e.title&&Number.isFinite(Date.parse(e.start))&&Date.parse(e.end)>=now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,30);
  res.json({ok:true,events});
 }catch(e){console.error("listGroupEvents",e);bad(res,500,"Events are temporarily unavailable")}
});
