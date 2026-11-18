"use strict";
/**
 * BayMarin website forms.
 * Deploy: firebase deploy --only functions:submitForm --project bay-marin-church-website
 * Prerequisites: Firebase Blaze plan, verified sender domain with Resend, and secrets.
 * Secrets: firebase functions:secrets:set RESEND_API_KEY
 *          firebase functions:secrets:set BAYMARIN_MAIL_FROM
 */
const {onRequest}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const mailKey=defineSecret("RESEND_API_KEY");
const mailFrom=defineSecret("BAYMARIN_MAIL_FROM");
const STAFF_EMAIL="info@baymarin.org";
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
  ["Follow-up requested",data.contact?"Yes":"No"]
 ]:[["Name",name],["Email",email],["Message",string(data.message,2500)]];
 const htmlRows=rows.map(([a,b])=>"<tr><th align='left' style='padding:9px;background:#edf3ee;vertical-align:top'>"+escapeHtml(a)+"</th><td style='padding:9px;white-space:pre-wrap'>"+escapeHtml(b)+"</td></tr>").join("");
 const cleanName=name.trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu,"").slice(0,50)||"there";
 const acknowledgement="Hi "+cleanName+",\n\nThank you for reaching out to BayMarin Church. We received your "+(isVisit?"visit request":"message")+". Someone from our staff team will review it and aim to respond within 24–48 hours, often sooner.\n\nIf your need is urgent, please contact info@baymarin.org directly.\n\nWe're glad you connected with us!\nBayMarin Church";
 const staffMessage={from:mailFrom.value(),to:[STAFF_EMAIL],reply_to:email,
  subject:subject+" — "+name.trim(),html:"<h2>New "+escapeHtml(isVisit?"visit request":"question")+"</h2><table cellspacing='0' border='0' style='border-collapse:collapse'>"+htmlRows+"</table>"};
 const replyMessage={from:mailFrom.value(),to:[email],reply_to:STAFF_EMAIL,
  subject:"We received your message — BayMarin Church",text:acknowledgement};
 return [staffMessage,replyMessage];
}
exports.submitForm=onRequest({region:"us-west1",cors:false,invoker:"public",secrets:[mailKey,mailFrom],maxInstances:5,timeoutSeconds:20},async(req,res)=>{
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
   const response=await fetch("https://api.resend.com/emails/batch",{
    method:"POST",headers:{"Authorization":"Bearer "+mailKey.value(),"Content-Type":"application/json"},
    body:JSON.stringify(createMail(data)),signal:AbortSignal.timeout(12000)
   });
   if(!response.ok){console.error("Email provider rejected request; status:",response.status);return bad(res,503,"We couldn't confirm delivery. Please try again shortly.");}
   const result=await response.json();
   if(!Array.isArray(result.data)||result.data.length!==2)return bad(res,503,"We couldn't confirm both messages were accepted.");
   return res.status(200).json({ok:true,message:"Thanks! Your message was received and confirmation email requested."});
 }catch(err){
   console.error("Form delivery failed",err?.name||"unknown");
   return bad(res,503,"Unable to submit right now. Please try again later.");
 }
});
