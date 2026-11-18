#!/usr/bin/env python3
"""One-time, resumable archival transfer of BayMarin's published audio to Firebase Storage.

The existing published audio files remain available as a fallback until migration succeeds.
Use the church-approved Firebase service identity; never commit service keys.
"""
import hashlib,json,os,pathlib,tempfile,uuid,urllib.parse
import requests
from google.cloud import firestore,storage

PROJECT="bay-marin-church-website"
CATALOG=pathlib.Path("BayMarin_Firebase_Master_V36/public/assets/baymarin-messages-catalog.json")
LIMIT=int(os.getenv("MIGRATION_LIMIT","230"))
MAX_SIZE=250*1024*1024

def main():
 doc=json.loads(CATALOG.read_text(encoding="utf-8"))
 db=firestore.Client(project=PROJECT)
 client=storage.Client(project=PROJECT)
 bucket_name=os.environ.get("BAYMARIN_STORAGE_BUCKET",PROJECT+".firebasestorage.app")
 bucket=client.bucket(bucket_name)
 if not bucket.exists():raise RuntimeError("Firebase Storage bucket not available: "+bucket_name)
 success=0;errors=[]
 for message in doc["messages"]:
  if success>=LIMIT:break
  legacy=message.get("legacyAudioUrl") or message.get("audioUrl","")
  if not legacy.startswith("https://"):continue
  uid=hashlib.sha256(legacy.encode()).hexdigest()[:32]
  ext=".mp3" if ".mp3" in urllib.parse.urlparse(legacy).path.lower() else ".m4a"
  dest="archive/audio/"+uid+ext
  blob=bucket.blob(dest)
  try:
   if not blob.exists():
    size=0
    with tempfile.TemporaryDirectory() as tmp:
     file=pathlib.Path(tmp)/("audio"+ext)
     with requests.get(legacy,stream=True,timeout=(20,120),headers={"User-Agent":"BayMarinMediaArchive/1.0"}) as response:
      response.raise_for_status()
      with file.open("wb") as output:
       for chunk in response.iter_content(1024*1024):
        if not chunk:continue
        size+=len(chunk)
        if size>MAX_SIZE:raise ValueError("Audio exceeds 250 MB")
        output.write(chunk)
     if size<1024:raise ValueError("Empty audio recording")
     blob.metadata={"firebaseStorageDownloadTokens":str(uuid.uuid4())}
     blob.upload_from_filename(str(file),content_type="audio/mpeg" if ext==".mp3" else "audio/mp4",timeout=300)
   blob.reload()
   token=(blob.metadata or {}).get("firebaseStorageDownloadTokens")
   if not token:
    token=str(uuid.uuid4())
    blob.metadata={**(blob.metadata or {}),"firebaseStorageDownloadTokens":token}
    blob.patch()
   url=("https://firebasestorage.googleapis.com/v0/b/"+urllib.parse.quote(bucket.name,safe="")+
        "/o/"+urllib.parse.quote(dest,safe="")+"?alt=media&token="+urllib.parse.quote(token,safe=""))
   message["legacyAudioUrl"]=legacy
   message["audioUrl"]=url
   message["audioPath"]=dest
   message["audioBytes"]=int(blob.size or 0)
   message["audioType"]=blob.content_type or ("audio/mpeg" if ext==".mp3" else "audio/mp4")
   db.collection("sermons").document("archive_"+uid).set({
     "title":message.get("title","Untitled"),"series":message.get("series","Individual Messages"),
     "speaker":message.get("speaker","BayMarin"),"date":message.get("date") or "",
     "dateLabel":message.get("dateLabel") or "","description":message.get("description") or "BayMarin message archive",
     "topics":message.get("topics") or [],"published":True,"legacyImported":True,
     "audioPath":dest,"audioUrl":url,"legacyAudioUrl":legacy,
     "audioBytes":message["audioBytes"],"audioType":message["audioType"],
     "artworkUrl":"","notesUrl":"","slidesUrl":"",
     "migratedAt":firestore.SERVER_TIMESTAMP
   },merge=True)
   success+=1
   if success%10==0:print("Transferred",success,"audio recordings",flush=True)
  except Exception as e:
   errors.append({"title":message.get("title"),"error":str(e)[:150]})
   print("Migration failed:",message.get("title"),type(e).__name__,str(e)[:150],flush=True)
   if len(errors)>=5:break
 doc["firebaseMigrationStatus"]="complete" if all(m.get("legacyAudioUrl") for m in doc["messages"]) else "partial"
 CATALOG.write_text(json.dumps(doc,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
 print(json.dumps({"migrated":success,"failures":len(errors),"errors":errors}))
 if errors:raise SystemExit(1)

if __name__=="__main__":main()
