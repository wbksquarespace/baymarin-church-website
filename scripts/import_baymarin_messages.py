#!/usr/bin/env python3
"""Build a searchable index of BayMarin's public sermon archive (metadata + links only).
No audio is copied. Dates and speakers are taken from the church's published listings.
Topic labels are suggestions inferred from titles, NOT transcripts.
"""
import json,re,datetime,urllib.request,html
from bs4 import BeautifulSoup, NavigableString
URL='https://baymarin.org/messages'
def norm(s): return re.sub(r'\s+',' ',html.unescape(str(s))).strip()
req=urllib.request.Request(URL,headers={'User-Agent':'Mozilla/5.0 (compatible; BayMarinArchiveIndexer/1.0)'})
markup=urllib.request.urlopen(req,timeout=45).read().decode('utf-8','replace')
soup=BeautifulSoup(markup,'html.parser')
# Audio link anchors are grouped with a date/title block followed by the speaker.
anchors=[a for a in soup.find_all('a',href=True) if 'static1.squarespace.com' in a['href'] and ('.m4a' in a['href'].lower() or '.mp3' in a['href'].lower() or 'download' in norm(a.get_text(' ',strip=True)).lower())]
print('AUDIO_LINKS',len(anchors))
date_re=re.compile(r'(?:(?:\d{1,2}/\d{1,2}/\d{2,4})|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}|(?:\d{1,2}/\d{1,2}))',re.I)
years={'2026':2026,'2025':2025,'2024':2024,'2023':2023,'2022':2022}
topic_rules=[
('Prayer & Spiritual Practices',r'prayer|pray|meditat|contempl|spiritual discipline|rule of life|confession|sabbath|rest|worship|fasting|listening|study|simplicity'),
('Hope & Encouragement',r'hope|take heart|courage|fear|worry|anxiet|joy|peace|glory|weakness|strength|longing|standing on the edge'),
('Identity & Purpose',r'identit|calling|gift|purpose|vocation|creativ|art|work|minister|service|serve'),
('Jesus & Scripture',r'jesus|christ|gospel|luke|mark|john|matthew|isaiah|romans|philippians|corinthians|acts|church in|the church|scripture|magi|resurrect|easter'),
('Relationships & Community',r'people|community|friend|love|forgiv|prodigal|relationship|together|neighbor|family|story of'),
('Faith & Growth',r'faith|growth|grow|spirit|grace|born again|disciple|formation|vision|trust'),
('Advent & Christmas',r'advent|christmas|magi|nativity'),
]
def topics(title,series):
 t=(title+' '+series).lower()
 result=[name for name,pattern in topic_rules if re.search(pattern,t,re.I)]
 return result[:3] or ['Faith & Growth']
def parse_date(label,year):
 s=label.strip()
 m=re.search(r'(\d{1,2})/(\d{1,2})/(\d{2,4})',s)
 if m:
  mo,day,yr=map(int,m.groups());yr=2000+yr if yr<100 else yr
  try:return datetime.date(yr,mo,day).isoformat(),yr
  except ValueError:pass
 m=re.search(r'\b(\d{1,2})/(\d{1,2})\b',s)
 if m:
  try:return datetime.date(year,int(m[1]),int(m[2])).isoformat(),year
  except ValueError:pass
 m=re.search(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})',s,re.I)
 if m:
  try:return datetime.date(year,datetime.datetime.strptime(m[1],'%B').month,int(m[2])).isoformat(),year
  except ValueError:pass
 return '',year
def series_of(title):
 t=title.lower()
 if 'prayer, week' in t:return 'Prayer'
 if 'creativity and the arts' in t:return 'Creativity and the Arts'
 if 'spiritual gifts' in t or 'growing into our gifts' in t:return 'Spiritual Gifts'
 if 'story of people' in t:return 'The Story of People'
 if 'from the inside out' in t:return 'From the Inside Out'
 if 'cycle of grace' in t:return 'Cycle of Grace'
 if 'advent' in t:return 'Advent'
 if re.search(r'philippians',t):return 'Philippians'
 if re.search(r'^acts [123]$',t):return 'Acts'
 if 'the church in ' in t:return 'The Seven Churches'
 if re.search(r'holy spirit',t):return 'Holy Spirit'
 if re.search(r'^mark \d',t):return 'Mark'
 if re.search(r'^john \d',t):return 'John'
 if re.search(r'^isaiah \d',t):return 'Isaiah'
 return 'Individual Messages'
entries=[];current_year=2026;prev_date=None
for i,a in enumerate(anchors):
 # capture text immediately before the download anchor, excluding navigation and decorative material
 strings=[]
 for elem in a.find_all_previous(string=True,limit=70):
  if not isinstance(elem,NavigableString):continue
  p=elem.parent
  if p.name in ('script','style','noscript'):continue
  t=norm(elem)
  if t and len(t)<280 and t.lower() not in ('download','listen','play','share','new here','image','read more') and (not strings or t!=strings[-1]):
   strings.append(t)
  if len(strings)>=12:break
 date_idx=next((j for j,t in enumerate(strings) if date_re.search(t)),None)
 if date_idx is None:
  # The 2022 archive contains several titled recordings without a published date.
  # Keep them searchable by title and speaker, but never invent a calendar date.
  if len(strings)<2 or strings[1]=='Minimal Mode Player Structure':
   print('SKIPPED',i,strings[:5]);continue
  titleline=strings[1];speaker=strings[0];label=titleline;title=titleline;date='';yr=current_year
 else:
  titleline=strings[date_idx]
  # speakers are often the immediately preceding element, closest to link
  speaker=' · '.join(strings[:date_idx]) if date_idx>0 else ''
  label=titleline
  match=date_re.search(label)
  title=label[match.end():].strip(' -–—:;,') if match else label
  if not title:title=label
  date,yr=parse_date(label,current_year)
 speaker=norm(speaker)[:120]
 speaker=re.sub(r'^(?:Download|Listen)\s*','',speaker,flags=re.I)
 if date and prev_date and date>prev_date and (datetime.date.fromisoformat(date)-datetime.date.fromisoformat(prev_date)).days>150 and '/2' not in label[:3]:
  # old pages omit year after 2026; falling back to chronological year decrement
  if not re.search(r'\d{1,2}/\d{1,2}/\d{2,4}',label):
   current_year-=1;date,yr=parse_date(label,current_year)
 if date:current_year=yr;prev_date=date
 series=series_of(title)
 entries.append({'date':date,'dateLabel':label,'title':title,'speaker':speaker or 'BayMarin','series':series,'topics':topics(title,series),'audioUrl':a['href']})
 if i<6:print('SAMPLE',json.dumps(entries[-1],ensure_ascii=False)[:400])
# Deduplicate by audio URL and discard nonsensical entries.
unique={e['audioUrl']:e for e in entries if e['title'] and len(e['title'])<190 and e['audioUrl'].startswith('https://')}
output=list(unique.values())
assert len(output)>70, 'Archive scraper failed safe: too few valid audio recordings'
output.sort(key=lambda e:e['date'] or '0000-00-00',reverse=True)
target='BayMarin_Firebase_Master_V36/public/assets/baymarin-messages-catalog.json'
with open(target,'w',encoding='utf-8') as f:json.dump({'source':'BayMarin published messages archive','sourceUrl':URL,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'messages':output},f,ensure_ascii=False,separators=(',',':'))
print('EXPORTED',len(output),'to',target)
