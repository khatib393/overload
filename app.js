/* Overload v2: entirely on-device. No analytics, API calls, trackers or cloud sync. */
(() => {
'use strict';
const DB_NAME='overload-private-v2', OLD_KEY='overload-log-v1', BACKUP_SCHEMA='overload-backup-v2';
const CHECKS=[
  ['wake','Wake on schedule','☀','Keep a steady start'],['breakfast','Breakfast','◕','Fuel your morning'],
  ['morning','Morning routine','✳','Start well'],['study','Focus block','◇','Small daily effort'],
  ['training','Training','▲','Only scheduled sessions'],['food','Meals on plan','◉','Your own food target'],
  ['work','Work shutdown','▧','Finish on time'],['screens','Intentional screen time','▣','Protect your evening'],
  ['night','Evening routine & log','☾','Wind down'],['lights','Lights out','◌','Protect your sleep']
];
const RECOVERY=[['wake','Wake on schedule','☀','Keep your anchor'],['breakfast','Breakfast','◕','First meal'],['useful','10-minute useful action','◇','Anything that helps'],['night','Evening log','☾','Close the day']];
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const $=id=>document.getElementById(id);let state, route='today', selectedDate='', db=null, memoryMode=false, legacyAvailable=false; let writeQueue=Promise.resolve();let selectedExercise='';let historyLimit=8,autoDay=true,lastLogDay='';
const blank=()=>({version:2,config:null,habits:{},workouts:{},weights:{},meals:{},gymSchedule:{},stages:[],settings:{theme:'auto',themeTimes:{light:'07:00',dark:'17:00',black:'22:00'}},legacyImported:false,exerciseConfig:{},exercisePlan:{},workoutTemplates:{},trainingSessions:{},created:new Date().toISOString()});
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pad=n=>String(n).padStart(2,'0');
const THEMES=['auto','light','dark','black'];
const defaultTimes={light:'07:00',dark:'17:00',black:'22:00'};
function normalizeSettings(){
 state.settings=state.settings||{};
 if(!THEMES.includes(state.settings.theme))state.settings.theme='auto';
 state.settings.themeTimes={...defaultTimes,...(state.settings.themeTimes||{})};
}
function minutes(hm){const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm));return m?Number(m[1])*60+Number(m[2]):null}
function themeAt(hourMinute,settings){
 const t={...defaultTimes,...(settings?.themeTimes||{})};
 const now=minutes(hourMinute),light=minutes(t.light),dark=minutes(t.dark),black=minutes(t.black);
 if([now,light,dark,black].some(x=>x===null)||!(light<dark&&dark<black))return 'light';
 return now>=black||now<light?'black':now>=dark?'dark':'light';
}
function currentClock(){const x=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const obj=Object.fromEntries(x.map(a=>[a.type,a.value]));return `${obj.hour}:${obj.minute}`}
function activeTheme(){return state.settings.theme==='auto'?themeAt(currentClock(),state.settings):state.settings.theme}
function applyTheme(){
 const theme=activeTheme();document.body.dataset.theme=theme;
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='light'?'#F6F8FC':theme==='dark'?'#131E2D':'#000000';
 const btn=$('themeButton');if(btn){btn.textContent=state.settings.theme==='auto'?'◐':theme==='light'?'☼':theme==='dark'?'☾':'●';btn.title=`Appearance: ${state.settings.theme}. Tap to switch`;btn.setAttribute('aria-label',`Appearance: ${state.settings.theme}. Tap to switch`)}
}

const offsetDate=(s,n)=>{const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const localParts=()=>{const x=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());return Object.fromEntries(x.map(v=>[v.type,v.value]))};
const today=()=>{const p=localParts(),d=`${p.year}-${p.month}-${p.day}`;return Number(p.hour)<4?offsetDate(d,-1):d};
const wday=d=>new Date(`${d}T12:00:00Z`).getUTCDay();
const pretty=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`));
const shortDay=d=>new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`));
const fmt=n=>Number.isFinite(n)?String(Math.round(n*10)/10):'—';
const cfg=()=>state.config||{};
const checksFor=d=>{const m=modeFor(d);const cs=m==='recovery'?RECOVERY:CHECKS;return cs.map(c=>({id:c[0],name:(cfg().checkLabels||{})[c[0]]||c[1],icon:c[2],description:c[3]}))};
const hasPlan=()=>!!state.config;
const planStart=()=>cfg().startDate||null;
const journalDate=()=>{const d=today(),start=planStart();return start&&d<start?start:d};
const beforePlanStart=()=>!!(planStart()&&today()<planStart());
const isFutureCheckin=d=>!hasPlan()||d<planStart()||d>today();
const isFutureWorkout=d=>d>today();
const currentStage=d=>{let s=(cfg().stages||[]).filter(x=>x.auto && x.date<=d).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.id||null;
 (state.stages||[]).filter(x=>x.date<=d).sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>s=x.id);return (cfg().stages||[]).find(x=>x.id===s)||null};
const phaseFor=d=>(cfg().phases||[]).find(p=>d>=p.start&&d<=p.end)||null;
const isMinimum=d=>phaseFor(d)?.mode==='minimum';
const scheduled=d=>{const wd=wday(d);return cfg().training?.[wd]||null};
const isFdeDay=d=>hasPlan()&&(isMinimum(d)?(cfg().minimumStudyDays||[]).includes(wday(d)):wday(d)!==0);
const applicable=d=>{const mode=modeFor(d);if(mode==='recovery')return RECOVERY.map(x=>x[0]);if(mode==='minimum')return ['wake','breakfast','morning','night'].concat(isFdeDay(d)?['study']:[]);
 let arr=CHECKS.map(x=>x[0]);if(!scheduled(d)||scheduled(d).rest)arr=arr.filter(x=>x!=='training');if(wday(d)===0||wday(d)===6)arr=arr.filter(x=>x!=='work');if(!isFdeDay(d))arr=arr.filter(x=>x!=='study');return arr;};
function baseScore(d,mode){const record=state.habits[d];if(!record)return null;const keys=mode==='recovery'?RECOVERY.map(x=>x[0]):mode==='minimum'?['wake','breakfast','morning','night',...(isFdeDay(d)?['study']:[])]:CHECKS.map(x=>x[0]).filter(x=>!(x==='training'&&(!scheduled(d)||scheduled(d).rest))&&!(x==='work'&&(wday(d)===0||wday(d)===6))&&!(x==='study'&&!isFdeDay(d)));
const allowed=keys.filter(k=>record.checks?.[k]!=='na');const answered=allowed.filter(k=>['yes','no'].includes(record.checks?.[k]));if(!answered.length)return null;return {pct:Math.round(100*allowed.filter(k=>record.checks?.[k]==='yes').length/allowed.length),answered:answered.length,total:allowed.length,complete:answered.length===allowed.length};}
function modeFor(d){if(!hasPlan())return 'normal';if(isMinimum(d))return 'minimum';const start=cfg().startDate||d;if(d<start)return 'normal';let recoveryTo=null;let consecutive=0;for(let day=start;day<d;day=offsetDate(day,1)){
 if(recoveryTo&&day<=recoveryTo){consecutive=0;continue}const m=isMinimum(day)?'minimum':'normal';const s=baseScore(day,m);if(s?.complete&&s.pct<80)consecutive++;else consecutive=0;
 if(consecutive>=2){recoveryTo=offsetDate(day,2);consecutive=0;}}
 return recoveryTo&&d<=recoveryTo?'recovery':'normal';}
const score=d=>baseScore(d,modeFor(d));
function initDB(){return new Promise((resolve,reject)=>{try{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('kv'))r.result.createObjectStore('kv')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}catch(e){reject(e)}})}
async function readState(){try{db=await initDB();return await new Promise((resolve,reject)=>{const r=db.transaction('kv','readonly').objectStore('kv').get('main');r.onsuccess=()=>resolve(r.result||blank());r.onerror=()=>reject(r.error)})}catch(e){memoryMode=true;try{return JSON.parse(localStorage.getItem('overload-private-v2-fallback'))||blank()}catch(_){return blank()}}}
function persist(){
 const snapshot=JSON.parse(JSON.stringify(state));
 writeQueue=writeQueue.catch(()=>{}).then(async()=>{
  if(db)await new Promise((resolve,reject)=>{
    const t=db.transaction('kv','readwrite');
    t.objectStore('kv').put(snapshot,'main');t.oncomplete=resolve;t.onerror=()=>reject(t.error);
  });
  else localStorage.setItem('overload-private-v2-fallback',JSON.stringify(snapshot));
 }).catch(()=>{toast('Storage failed — export a backup')});
 return writeQueue;
}
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3000)}
const download=(obj,name)=>{const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)};
function parseSleep(raw){
 const v=String(raw??'').trim();if(!v)return null;
 let h;
 if(/^\d{1,2}:[0-5]\d$/.test(v)){
  const [hours,mins]=v.split(':').map(Number);h=hours+mins/60;
 } else if(/^\d{1,2}(?:[.,]\d{1,2})?$/.test(v)) h=Number(v.replace(',','.'));
 else return NaN;
 return h>=0&&h<=24?Math.round(h*10000)/10000:NaN;
}
const txt=(id,text)=>{const v=id==='sleepHours'?state.habits[selectedDate]?.sleepHours:id==='weight'?state.weights[selectedDate]:null;
 if(id==='sleepHours')return `<div class="fieldbox"><label for="sleepHours">${text}</label><input id="sleepHours" type="text" inputmode="text" autocomplete="off" ${isFutureCheckin(selectedDate)?'disabled':''} value="${v!=null&&Number.isFinite(Number(v))?escapeHTML(v):''}" placeholder="7:36 or 7,5" aria-describedby="sleepHelp"><small id="sleepHelp" class="sleep-help">7:36 = 7h 36m · 7,36 = 7.36 hours. Both . and , work.</small></div>`;
 return `<div class="fieldbox"><label for="${id}">${text}</label><input id="${id}" ${isFutureCheckin(selectedDate)?'disabled':''} type="number" inputmode="decimal" step="0.1" value="${v!=null&&Number.isFinite(Number(v))?escapeHTML(v):''}" placeholder="—"></div>`;
};
const stageText=d=>{const s=currentStage(d);return s?`${s.lightsOut} lights out · ${s.wake} wake`:'Import your plan to unlock timings'};
function header(title,subtitle){return `<div class="hero"><div><p class="eyebrow">PRIVATE PROGRESS / NO NOISE</p><h1>${title}</h1><p class="lead">${subtitle}</p></div><div class="hero-right"><div class="date-tag">YOUR LOCAL DAY <strong>${pretty(selectedDate)}</strong></div></div></div>`}
function weekDates(d){const monday=offsetDate(d,-((wday(d)+6)%7));return Array.from({length:7},(_,i)=>offsetDate(monday,i))}
function daystrip(){return `<div class="week-strip" aria-label="Choose day">${weekDates(selectedDate).map(x=>`<button class="day-chip ${selectedDate===x?'selected':''} ${state.habits[x]?'has':''}" data-date="${x}" aria-pressed="${selectedDate===x}"><b>${shortDay(x).slice(0,3)}</b><span class="num">${Number(x.slice(8))}</span><i class="tiny"></i></button>`).join('')}</div>`}
function todayView(){
 const d=selectedDate,mode=modeFor(d),app=applicable(d),r=state.habits[d]||{checks:{}},s=score(d),locked=isFutureCheckin(d);
 const stage=currentStage(d),phase=phaseFor(d),sc=s?.pct||0;
 let planDay=null,totalDays=null;
 if(cfg().startDate&&cfg().endDate){totalDays=Math.round((new Date(cfg().endDate+'T12:00:00Z')-new Date(cfg().startDate+'T12:00:00Z'))/86400000)+1;planDay=Math.max(1,Math.min(totalDays,Math.round((new Date(d+'T12:00:00Z')-new Date(cfg().startDate+'T12:00:00Z'))/86400000)+1));}
 const train=scheduled(d)?.label||'Recovery day';const focus=isFdeDay(d)?'Planned':'Rest day';
 const complete=s?.complete;const total=s?.total||app.length;const done=s?(state.habits[d]&&Object.entries(state.habits[d].checks||{}).filter(([k,v])=>app.includes(k)&&v==='yes').length):0;
 const stageLabel=stage?`Sleep Stage ${escapeHTML(stage.id)}`:'No plan yet';
 const metrics=[['♧','Wake target',stage?escapeHTML(stage.wake):'—','Sleep schedule'],['⌁','Training',escapeHTML(train).slice(0,26), 'Today'],['▣','Focus',focus,'Daily block'],['ϟ','Energy',r.energy?`${r.energy}/5`:'—',r.energy?'Logged':'Not logged']];
 const card=(key,value)=>{const v=value==='yes'?'done':value==='no'?'missed':value==='na'?'off':'';return v};
 return `<div class="today-head"><div class="overline-row"><span>${pretty(d)}</span><span>${locked&&hasPlan()?'Starts '+pretty(planStart()):planDay?'Day '+planDay+' of '+totalDays:'Your local day'}</span></div>
 <div class="title-row"><h1>Today</h1><span class="stage-badge">${stageLabel}</span></div></div>
 ${!hasPlan()?`<div class="notice welcome"><strong>Import your private plan to set the challenge start date.</strong> Your schedule and targets never enter the public website code. <button class="textbtn" data-action="importPlan">Import private plan</button></div>`:''}${locked&&hasPlan()?`<div class="notice prestart-notice"><strong>${d<planStart()?'Challenge has not started':'Your challenge begins '+pretty(planStart())}.</strong> This is a preview of your schedule. Daily logging unlocks on your start date (Stockholm time).</div>`:''}
 <div class="dashboard-score"><div class="score-ring" style="--p:${sc}" role="img" aria-label="${s?sc+' percent of applicable checks done':'Not logged yet'}"><div class="score-center"><b>${s?`${sc}%`:'—'}</b><span>${done} of ${total}</span></div></div><div class="score-copy"><b>Daily progress</b><span>${complete?'Daily check-in complete':s?'Keep going — small steps count':'Your day, your pace'}</span><div class="progress-rail"><i style="width:${sc}%"></i></div><small>${phase?escapeHTML(phase.label):'Your private plan'}${phase?.mode!==mode?' · '+mode+' mode':''}</small></div></div>
 <div class="four-metrics">${metrics.map(m=>`<div class="today-metric"><span class="metric-icon">${m[0]}</span><small>${m[1]}</small><strong>${m[2]}</strong><em>${m[3]}</em></div>`).join('')}</div>
 <div class="section-head checkhead"><h2>Daily checks</h2><span class="check-count">${done}/${total}</span></div>${daystrip()}
 <div class="daily-checks">${checksFor(d).map(c=>{const included=app.includes(c.id),value=included?(r.checks?.[c.id]||'unset'):'na',status=card(c.id,value);return `<button class="check-row ${status}" data-check="${escapeHTML(c.id)}" ${(!included||locked)?'disabled':''} aria-label="${escapeHTML(c.name)}: ${value}; tap to change"><span class="check-box">${value==='yes'?'✓':value==='no'?'×':value==='na'?'–':''}</span><span class="check-name">${escapeHTML(c.name)}</span><small>${value==='na'?'Not scheduled':value==='no'?'Not done':value==='yes'?'Done':''}</small><span class="chevron">›</span></button>`}).join('')}</div>
 <div class="section-head"><h2>Evening check-in</h2><span class="pill">LOCAL ONLY</span></div>
 <div class="card evening-card"><div class="fieldrow">${txt('sleepHours','Actual sleep, last night (hours)')}${(wday(d)===0||d===planStart()||state.weights[d])?txt('weight','Weight (kg) · Sunday'):''}<div class="fieldbox wide"><label>MOOD</label><div class="mood-grid">${[1,2,3,4,5].map(n=>`<button ${locked?'disabled':''} data-mood="${n}" class="${r.mood===n?'active':''}">${n}</button>`).join('')}</div></div><div class="fieldbox wide"><label>ENERGY</label><div class="mood-grid">${[1,2,3,4,5].map(n=>`<button ${locked?'disabled':''} data-energy="${n}" class="${r.energy===n?'active':''}">${n}</button>`).join('')}</div></div><div class="fieldbox wide"><label for="note">NOTES (OPTIONAL)</label><textarea id="note" ${locked?'disabled':''} maxlength="400" placeholder="Anything worth remembering?">${escapeHTML(r.note||'')}</textarea></div></div><button id="saveDay" class="primary full-action" ${locked?'disabled':''}>Save daily check-in</button><p class="callout">Your answers stay on this device. Weekly backup recommended.</p></div>
 ${hasPlan()?`<div class="section-head"><h2>Today's rhythm</h2></div><div class="card">${(cfg().timeline||[]).map(t=>`<div class="time-block"><time>${escapeHTML(t.time)}</time><span>${escapeHTML(t.title)}</span></div>`).join('')}</div>`:''}
 <p class="footer">Europe/Stockholm · Entries logged after midnight and before 04:00 count for the previous day.</p>`;
}
function previousExercise(name,d){
 const matches=Object.entries(state.workouts||{}).filter(([date])=>date<d).sort((a,b)=>b[0].localeCompare(a[0]));
 for(const [date,sets] of matches){const found=sets.filter(s=>s.exercise.toLowerCase()===name.toLowerCase());if(found.length)return {date,sets:found}}
 return null;
}
function previousHint(name){if(!name?.trim())return 'Choose an exercise to see your previous session.';const prev=previousExercise(name.trim(),selectedDate);if(!prev)return 'No earlier session found. Start with a comfortable working set.';
 const working=prev.sets.filter(x=>!x.warmup);const used=working.length?working:prev.sets;
 const best=used.reduce((a,x)=>!a||x.weight>a.weight?x:a,null);
 const cfg=state.exerciseConfig?.[name.trim()]||{};const hi=Number(cfg.hi)||12,inc=Number(cfg.inc)||2.5;
 const allAtTop=used.filter(x=>x.weight===best.weight).every(x=>x.reps>=hi);
 const suggestion=allAtTop?`Consider ${fmt(best.weight+inc)} kg for the next working sets (if form is good).`:`Aim to add a rep at around ${fmt(best.weight)} kg before raising the weight.`;
 return `Previous: ${prev.date} · ${used.map(x=>`${fmt(x.weight)} kg × ${x.reps}`).join(', ')}. ${suggestion}`;
}
function workoutGroups(date){
 const groups=[];
 (state.workouts[date]||[]).forEach((set,index)=>{
  const key=String(set.exercise||'').trim().toLowerCase();
  let g=groups.find(x=>x.key===key);
  if(!g){g={key,name:set.exercise||'Exercise',sets:[]};groups.push(g)}
  g.sets.push({...set,index});
 });
 return groups;
}
function compactSet(s){return `${Number(s.weight)===0?'BW':fmt(Number(s.weight))+' kg'} × ${Number(s.reps)}`}
function groupedSetsHtml(sets,editable){return `<div class="training-sets">${sets.map(s=>`<span class="training-set ${s.warmup?'warm':''}">${escapeHTML(compactSet(s))}${s.warmup?'<small>W</small>':''}${editable?`<button type="button" data-remove-set="${s.index}" aria-label="Remove ${escapeHTML(s.exercise)} set">×</button>`:''}</span>`).join('')}</div>`}
function historyDates(){return Object.keys(state.workouts||{}).filter(d=>d!==selectedDate&&Array.isArray(state.workouts[d])&&state.workouts[d].length>0).sort((a,b)=>b.localeCompare(a))}
function trainingSuggestions(){
 const latest=new Map();
 Object.entries(state.workouts||{}).forEach(([d,sets])=>sets.forEach(s=>{if(s.exercise&&(latest.get(s.exercise)||'')<d)latest.set(s.exercise,d)}));
 return Array.from(latest).sort((a,b)=>b[1].localeCompare(a[1])).map(v=>v[0]);
}
function pickExercise(name){
 selectedExercise=name;
 const input=$('exName');if(!input)return;
 input.value=name;
 const todaySets=(state.workouts[selectedDate]||[]).filter(s=>String(s.exercise).toLowerCase()===name.toLowerCase());
 const prev=previousExercise(name,selectedDate);
 const base=todaySets.at(-1)||prev?.sets.filter(s=>!s.warmup).at(-1)||prev?.sets.at(-1);
 if(base){$('exWeight').value=Number(base.weight);$('exReps').value=Number(base.reps)}
 const hint=$('previousHint');if(hint)hint.textContent=previousHint(name);
 document.querySelectorAll('[data-pick-exercise]').forEach(b=>b.classList.toggle('picked',b.dataset.pickExercise===name));
 $('exWeight').focus();
}
/* On-device routine templates. Nothing personal ships in the GitHub files. */
const ROUTINE_GROUPS=['legs','push','pull','run'];
const groupFromDate=d=>{
 const label=String(scheduled(d)?.label||'').toLowerCase();
 if(/leg|lower/.test(label))return 'legs';
 if(/push|chest|shoulder/.test(label))return 'push';
 if(/pull|back/.test(label))return 'pull';
 if(/run|cardio/.test(label))return 'run';
 return {1:'legs',2:'push',4:'pull',6:'run'}[wday(d)]||null;
};
const routineNames={legs:'Legs',push:'Push',pull:'Pull',run:'Easy run'};
function categoryForExercise(name){
 const n=String(name||'').toLowerCase();
 if(/leg press|squat|lunge|rdl|romanian|deadlift|hamstring|quad|calf|leg curl|leg extension|hip thrust/.test(n))return 'legs';
 if(/\bcurl\b|biceps|lat pulldown|pulldown|pull.up|\brow\b|face pull|hyperextension|rear delt/.test(n))return 'pull';
 if(/bench|chest|incline|pushdown|triceps|shoulder press|lateral raise|overhead|dip|pec|fly/.test(n))return 'push';
 if(/run|treadmill|jog/.test(n))return 'run';
 return null;
}
const routineFallback={
 legs:['Squat','Romanian deadlift','Leg press','Leg curl','Calf raise'],
 push:['Bench press','Incline press','Shoulder press','Lateral raise','Triceps pushdown'],
 pull:['Lat pulldown','Seated row','Face pull','Biceps curl'],
 run:['Easy run (5 km)']
};
function buildTemplateFromHistory(group){
 const available=new Map();
 Object.entries(state.workouts||{}).forEach(([d,sets])=>sets.forEach(set=>{
  const name=String(set.exercise||'').trim();if(!name||categoryForExercise(name)!==group)return;
  const key=name.toLowerCase(),prev=available.get(key);
  if(!prev||d>prev.date)available.set(key,{name,date:d});
 }));
 const names=[...available.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(x=>x.name);
 return names.length?names.slice(0,8):routineFallback[group].slice();
}
function ensureWorkoutTemplates(){
 if(!state.workoutTemplates||typeof state.workoutTemplates!=='object')state.workoutTemplates={};
 let changed=false;
 for(const group of ROUTINE_GROUPS){
  if(!Array.isArray(state.workoutTemplates[group])){
   state.workoutTemplates[group]=buildTemplateFromHistory(group);changed=true;
  }
 }
 return changed;
}
function templateList(group){return Array.isArray(state.workoutTemplates?.[group])?state.workoutTemplates[group]:[]}
function populateHistoryTemplates(){for(const group of ROUTINE_GROUPS){const current=templateList(group),defaults=routineFallback[group];if(current.length===defaults.length&&current.every((n,i)=>n===defaults[i])){const derived=buildTemplateFromHistory(group);if(derived.some((n,i)=>n!==defaults[i]))state.workoutTemplates[group]=derived;}}}
function previousExerciseAt(name,reference){
 const entries=Object.entries(state.workouts||{}).filter(([d])=>d<reference).sort((a,b)=>b[0].localeCompare(a[0]));
 for(const [date,sets] of entries){const items=sets.filter(x=>String(x.exercise).toLowerCase()===String(name).toLowerCase());if(items.length)return {date,sets:items};}
 return null;
}
function templateCard(name,date,index){
 const prev=previousExerciseAt(name,date),todaySets=(state.workouts[date]||[]).filter(x=>String(x.exercise).toLowerCase()===name.toLowerCase());
 const working=prev?.sets.filter(x=>!x.warmup)||[],sets=working.length?working:prev?.sets||[];
 const last=sets.at(-1),range=state.exerciseConfig?.[name]||{};
 const lastText=prev?`${pretty(prev.date)} · ${sets.map(s=>compactSet(s)).join(' / ')}`:'No earlier sets recorded';
 const reached=!!(last&&Number(range.hi)>0&&sets.length>0&&sets.every(x=>Number(x.reps)>=Number(range.hi)));
 const guidance=last?`Last working: ${compactSet(last)}${reached?' · top of rep range; consider a small increase if form is good':''}`:'Start light and record your first working sets';
 return `<div class="routine-exercise ${todaySets.length?'routine-done':''}">
  <div class="routine-number">${index+1}</div>
  <div class="routine-detail"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(lastText)}</small><em>${escapeHTML(guidance)}</em></div>
  <button type="button" class="routine-log" data-pick-template="${escapeHTML(name)}" aria-label="Log ${escapeHTML(name)}" ${isFutureWorkout(date)?'disabled':''}>${todaySets.length?todaySets.length+' ✓':'+ Log'}</button>
 </div>`;
}
let editingRoutine=false;
function routinePanel(date){
 const group=groupFromDate(date);
 if(!group)return `<section class="card routine-card"><h2>No scheduled workout today</h2><p class="callout">Your existing workout history is still below. Choose an exercise if you're training anyway.</p></section>`;
 const names=templateList(group),firstWeek=planStart()&&date>=planStart()&&date<offsetDate(planStart(),7);
 return `<section class="card routine-card" id="routinePanel">
  <div class="routine-heading"><div><p class="eyebrow">YOUR REUSABLE ROUTINE</p><h2>${escapeHTML(routineNames[group])} plan</h2></div><button type="button" class="secondary small-action" data-action="toggleRoutineEdit">${editingRoutine?'Done':'Edit exercises'}</button></div>
  <p class="routine-help">${firstWeek?'Restart week: aim for 2 comfortable working sets per exercise.':'Your routine stays here each week. Previous weights and reps update from saved sets.'} ${names.length} exercises planned.</p>
  ${names.length?names.map((name,i)=>templateCard(name,date,i)).join(''):'<p class="training-empty">No exercises yet. Add one below.</p>'}
  ${editingRoutine?`<div class="routine-editor"><p class="eyebrow">EDIT ${escapeHTML(routineNames[group]).toUpperCase()} ROUTINE · SAVED PRIVATELY</p>
     ${names.map((n,i)=>`<div class="routine-edit-row"><span>${escapeHTML(n)}</span><button data-template-move="${group}:${i}:-1" aria-label="Move ${escapeHTML(n)} up" ${i===0?'disabled':''}>↑</button><button data-template-move="${group}:${i}:1" aria-label="Move ${escapeHTML(n)} down" ${i===names.length-1?'disabled':''}>↓</button><button data-template-remove="${group}:${i}" aria-label="Remove ${escapeHTML(n)}">×</button></div>`).join('')}
     <form id="templateForm" class="template-add-form"><input id="templateExercise" maxlength="80" placeholder="Add an exercise" aria-label="Add exercise name" required><button type="submit" class="secondary">Add</button></form>
     <p class="callout">Editing the routine does not delete any previously logged sets.</p>
  </div>`:''}
 </section>`;
}
function templateActionAdd(event){event.preventDefault();const group=groupFromDate(selectedDate),input=$('templateExercise'),name=input?.value.trim().slice(0,80);if(!group||!name)return;
 const names=templateList(group);if(names.some(x=>x.toLowerCase()===name.toLowerCase())){toast('Exercise already in this routine');return;}
 if(names.length>=15){toast('Limit is 15 exercises per routine');return}
 names.push(name);persist();render();toast('Exercise added to '+routineNames[group]);}
function weeklyTrainingSummary(){
 const days=weekDates(selectedDate),lines=[`OVERLOAD TRAINING REVIEW · ${days[0]} to ${days[6]}`,'Source: private on-device training log. Reps and weights are observations, not verified prescriptions.'];
 const workdays=days.filter(d=>groupFromDate(d)&&groupFromDate(d)!=='run'&&scheduled(d)&&!scheduled(d).rest);
 const actual=days.filter(d=>(state.workouts[d]||[]).length>0);
 lines.push(`Training sessions logged: ${actual.length} · planned lifting days: ${workdays.length}.`);
 for(const d of days){
  const group=groupFromDate(d),scheduledName=scheduled(d)?.label||routineNames[group]||'Rest';
  const logged=workoutGroups(d);
  if(!scheduled(d)&&!logged.length)continue;
  lines.push(`\n${d} ${shortDay(d)} · ${scheduledName} · ${logged.length?'Logged':'Not logged'}`);
  if(!logged.length){const template=templateList(group);if(template.length)lines.push('Planned exercises: '+template.join(', '));continue;}
  for(const exercise of logged){
   const work=exercise.sets.filter(x=>!x.warmup),previous=previousExerciseAt(exercise.name,d);
   const prevWork=previous?.sets.filter(x=>!x.warmup)||[];
   const max=work.length?Math.max(...work.map(x=>Number(x.weight)||0)):null;
   const prevMax=prevWork.length?Math.max(...prevWork.map(x=>Number(x.weight)||0)):null;
   const change=(max!==null&&prevMax!==null)?` · load change vs ${previous.date}: ${max>prevMax?'+':''}${fmt(max-prevMax)} kg max working set` : '';
   lines.push(`  ${exercise.name}: ${exercise.sets.map(x=>compactSet(x)+(x.warmup?' warmup':'')).join(', ')}${change}`);
  }
 }
 lines.push('\nNEXT WEEK TEMPLATE (modifiable; do not auto-increase loads):');
 for(const group of ['legs','push','pull','run'])lines.push(`${routineNames[group]}: ${templateList(group).join(', ')||'Not configured'}`);
 lines.push('\nAI REVIEW REQUEST: Summarize what was completed, note possible recovery or performance trends, and suggest cautious options for next week. Keep exercises unless I choose to change them. Do not claim an unlogged session happened.');
 return lines.join('\n');
}
function combinedWeeklySummary(){return `${weeklySummary()}\n\n---\n\n${weeklyTrainingSummary()}`}
async function copyReport(which){
 const body=which==='training'?weeklyTrainingSummary():which==='both'?combinedWeeklySummary():weeklySummary();
 try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(body);toast(which==='training'?'Training report copied':which==='both'?'Both weekly reports copied':'Habit report copied');}
 catch(e){
   const box=$('copyFallback'),area=$('copyFallbackText');
   if(box&&area){area.value=body;box.hidden=false;area.focus();area.select();toast('Select text and use Copy');}
   else toast('Clipboard unavailable. Please try from Safari.');
 }
}
/* v2.3 — focused offline-first workout sessions. No backend required. */
let activeSessionExercise='',savedSessionSet=false;
const currentSession=d=>state.trainingSessions?.[d]||null;
const sessionCompleted=(d,name)=>currentSession(d)?.completedExercises?.some(x=>x.toLowerCase()===name.toLowerCase())||false;
function sessionExerciseNames(d){
 const group=groupFromDate(d);const names=(currentSession(d)?.exerciseNames||templateList(group)).slice();
 // Historical sets outside the current template must remain visible; never discard them.
 for(const g of workoutGroups(d))if(!names.some(n=>n.toLowerCase()===g.name.toLowerCase()))names.push(g.name);
 return names;
}
function sessionMetrics(d){
 const sets=state.workouts[d]||[],working=sets.filter(x=>!x.warmup);
 return {total:sets.length,working:working.length,volume:working.reduce((n,x)=>n+Number(x.weight||0)*Number(x.reps||0),0)};
}
function sessionClock(s){if(!s?.startedAt)return '—';const end=s.finishedAt?new Date(s.finishedAt):new Date();const n=Math.max(0,Math.round((end-new Date(s.startedAt))/60000));return n<60?`${n} min`:`${Math.floor(n/60)}h ${n%60}m`}
function sessionStart(){
 const d=selectedDate;if(d!==today()){toast('Start a session for today only');return}
 const old=currentSession(d);
 if(old?.status==='active'){render();return}
 if(old?.status==='finished'){toast('Session already finished. Reopen from the summary if needed.');return}
 state.trainingSessions=state.trainingSessions||{};
 state.trainingSessions[d]={status:'active',startedAt:new Date().toISOString(),finishedAt:null,completedExercises:[],exerciseNames:templateList(groupFromDate(d)).slice()};
 activeSessionExercise='';savedSessionSet=false;persist();render();
}
function sessionSelectExercise(name){
 if(currentSession(selectedDate)?.status!=='active')return;
 const names=sessionExerciseNames(selectedDate);
 if(!names.some(n=>n.toLowerCase()===name.toLowerCase()))return;
 activeSessionExercise=name;savedSessionSet=false;render();
}
function sessionFinishExercise(){
 const d=selectedDate,s=currentSession(d);if(!s||s.status!=='active'||!activeSessionExercise)return;
 const name=activeSessionExercise,sets=(state.workouts[d]||[]).filter(x=>x.exercise.toLowerCase()===name.toLowerCase());
 if(!sets.length){toast('Save a set first, or return to exercises');return}
 if(!sessionCompleted(d,name))s.completedExercises.push(name);
 const next=sessionExerciseNames(d).find(n=>!sessionCompleted(d,n));
 activeSessionExercise=next||'';savedSessionSet=false;persist();render();
}
function sessionFinish(){
 const s=currentSession(selectedDate);if(!s||s.status!=='active')return;
 const m=sessionMetrics(selectedDate);if(!m.total){toast('Log at least one set before finishing');return}
 if(sessionExerciseNames(selectedDate).some(n=>!sessionCompleted(selectedDate,n))&&!confirm('Some exercises are unfinished. Finish the session anyway?'))return;
 s.status='finished';s.finishedAt=new Date().toISOString();activeSessionExercise='';savedSessionSet=false;persist();render();
}
function sessionReopen(){const s=currentSession(selectedDate);if(!s||s.status!=='finished'||selectedDate!==today())return;
 if(!confirm('Reopen today\'s completed session to add more sets?'))return;
 s.status='active';s.finishedAt=null;activeSessionExercise='';persist();render();}
function sessionAddExercise(e){e.preventDefault();const s=currentSession(selectedDate),name=$('sessionAddName')?.value?.trim().slice(0,80);if(!s||s.status!=='active'||!name)return;
 if(!s.exerciseNames.some(x=>x.toLowerCase()===name.toLowerCase()))s.exerciseNames.push(name);
 activeSessionExercise=name;persist();render();}
async function sessionSaveSet(e){
 e.preventDefault();const d=selectedDate,s=currentSession(d);if(d!==today()||s?.status!=='active'||!activeSessionExercise)return;
 const weight=Number(String($('sessionWeight')?.value||'').replace(',','.')),reps=Number($('sessionReps')?.value),warmup=!!$('sessionWarmup')?.checked;
 if(!Number.isFinite(weight)||weight<0||weight>1000||!Number.isInteger(reps)||reps<1||reps>1000){toast('Enter a valid weight and rep count');return}
 const btn=$('sessionSaveBtn');if(btn)btn.disabled=true;
 state.workouts[d]=state.workouts[d]||[];
 state.workouts[d].push({exercise:activeSessionExercise,weight,reps,warmup,id:`set-${Date.now()}-${Math.random().toString(36).slice(2,7)}`});
 savedSessionSet=true;
 await persist();render();
 $('sessionLastSaved')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function sessionExerciseView(d,name){
 const prev=previousExerciseAt(name,d),sets=(state.workouts[d]||[]).map((x,i)=>({...x,index:i})).filter(x=>x.exercise.toLowerCase()===name.toLowerCase()),last=sets.at(-1)||prev?.sets.filter(x=>!x.warmup).at(-1)||prev?.sets.at(-1),names=sessionExerciseNames(d);
 const recommended=prev?.sets.filter(x=>!x.warmup)||[];
 return `<div class="session-focus-head"><button class="session-back" data-action="sessionBack" aria-label="Back to exercises">← Exercises</button><span class="session-pill">${escapeHTML(routineNames[groupFromDate(d)]||'Workout')} · ${names.indexOf(name)+1}/${names.length}</span></div>
 <section class="card session-exercise-card"><p class="eyebrow">CURRENT EXERCISE</p><h1>${escapeHTML(name)}</h1>
 <div class="session-previous"><span>LAST TIME</span><strong>${prev?escapeHTML(pretty(prev.date)):'First recorded session'}</strong><p>${prev?escapeHTML(recommended.length?recommended.map(compactSet).join(' · '):prev.sets.map(compactSet).join(' · ')):'Start comfortably and build from here.'}</p></div>
 <div class="session-log-head"><h2>Today's sets</h2><span>${sets.length} saved</span></div>
 <div class="session-set-list" aria-live="polite">${sets.length?sets.map((x,i)=>`<div class="session-set-row ${i===sets.length-1&&savedSessionSet?'session-set-new':''}"><span class="session-set-ordinal">${i+1}</span><strong>${escapeHTML(compactSet(x))}</strong><small>${x.warmup?'Warm-up':'Working'}</small><span class="session-set-check" aria-label="Saved">✓</span><button type="button" data-remove-set="${x.index}" aria-label="Remove saved set" class="session-remove">×</button></div>`).join(''):'<p class="session-no-sets">No sets yet. Your first saved set will appear here immediately.</p>'}</div>
 ${savedSessionSet?'<div id="sessionLastSaved" class="session-saved-banner" role="status">✓ Set saved on this device</div>':''}
 <form id="sessionSetForm" class="session-set-form"><div><label for="sessionWeight">WEIGHT (KG)</label><input id="sessionWeight" type="text" inputmode="decimal" required value="${last?escapeHTML(fmt(Number(last.weight))):''}" placeholder="0" autocomplete="off"></div><div><label for="sessionReps">REPS</label><input id="sessionReps" inputmode="numeric" type="number" min="1" max="1000" required value="${last?escapeHTML(last.reps):''}" placeholder="8"></div>
 <label class="session-warmup"><input type="checkbox" id="sessionWarmup"> Warm-up set</label>
 <button type="submit" id="sessionSaveBtn" class="primary session-big-btn ${savedSessionSet?'session-saved-btn':''}">${savedSessionSet?'✓ Saved · Add another set':'+ Save set'}</button></form>
 <button type="button" data-action="sessionFinishExercise" class="session-finish-exercise" ${sets.length?'':'disabled'}>✓ Finish exercise</button></section>`;
}
function sessionFocusView(d){
 const s=currentSession(d),names=sessionExerciseNames(d),m=sessionMetrics(d),done=names.filter(n=>sessionCompleted(d,n)).length;
 if(activeSessionExercise&&!names.some(n=>n.toLowerCase()===activeSessionExercise.toLowerCase()))activeSessionExercise='';
 if(activeSessionExercise)return sessionExerciseView(d,activeSessionExercise);
 return `<div class="session-page-head"><div><p class="eyebrow">WORKOUT IN PROGRESS</p><h1>${escapeHTML(routineNames[groupFromDate(d)]||"Today’s workout")} <span>day.</span></h1><p>${escapeHTML(pretty(d))} · Changes save immediately on this device</p></div><span class="session-live"><i></i> LIVE</span></div>
 <section class="card session-summary-card"><div><small>COMPLETED</small><strong>${done}<span>/${names.length}</span></strong><em>exercises</em></div><div><small>WORKING SETS</small><strong>${m.working}</strong><em>logged</em></div><div><small>VOLUME</small><strong>${fmt(m.volume)}</strong><em>kg</em></div></section>
 <div class="session-list-title"><h2>Today's exercises</h2><span>Tap to log</span></div>
 <div class="session-exercise-list">${names.map((n,i)=>{const count=(state.workouts[d]||[]).filter(x=>x.exercise.toLowerCase()===n.toLowerCase()).length,done=sessionCompleted(d,n),prev=previousExerciseAt(n,d);return `<button class="session-choice ${done?'session-choice-done':''}" data-session-exercise="${escapeHTML(n)}"><span class="session-choice-index">${done?'✓':i+1}</span><span class="session-choice-info"><strong>${escapeHTML(n)}</strong><small>${count?`${count} sets logged · `:''}${prev?'Last: '+escapeHTML(prev.sets.filter(x=>!x.warmup).map(compactSet).join(' / ')):'No previous sets'}</small></span><span class="session-choice-arrow">→</span></button>`}).join('')}</div>
 <form id="sessionAddForm" class="session-add-form"><label for="sessionAddName">Need a different exercise?</label><div><input id="sessionAddName" placeholder="Add an exercise" maxlength="80" autocomplete="off" required><button class="secondary" type="submit">+ Add</button></div></form>
 <button class="primary session-big-btn" data-action="sessionFinish" ${!m.total?'disabled':''}>Finish workout →</button>
 <p class="session-caution">Your logged sets stay saved even if you close Overload before finishing.</p>`;
}
function finishedSessionCard(d){const s=currentSession(d);if(s?.status!=='finished')return '';
 const m=sessionMetrics(d),count=(s.completedExercises||[]).length;
 return `<section class="card session-finished-card"><span class="session-finished-icon">✓</span><p class="eyebrow">WORKOUT COMPLETE</p><h2>${escapeHTML(routineNames[groupFromDate(d)]||'Workout')} finished</h2><p>${count} exercises completed · ${m.working} working sets · ${fmt(m.volume)} kg volume · ${sessionClock(s)}</p>${d===today()?'<button class="secondary" data-action="sessionReopen">Reopen session</button>':''}</section>`;
}
function gymView(){
 if(selectedDate===today()&&currentSession(selectedDate)?.status==='active')return sessionFocusView(selectedDate);
 const d=selectedDate,plan=scheduled(d),groups=workoutGroups(d),allHistory=historyDates(),recent=allHistory.slice(0,historyLimit),all=trainingSuggestions(),chosen=selectedExercise;
 const planned=plan?.label||'Choose your session';
 const workingCount=groups.reduce((n,g)=>n+g.sets.filter(s=>!s.warmup).length,0);
 const allExercises=new Set([...all,...Object.values(state.gymSchedule||{}).flatMap(x=>x.exerciseNames||[]),...Object.values(state.exercisePlan||{}).flatMap(x=>Array.isArray(x)?x:[])]);
 const hints=[...allExercises].sort().map(name=>`<option value="${escapeHTML(name)}"></option>`).join('');
 const choices=all.slice(0,7);
 const isFuture=isFutureWorkout(d);
 const lastCurrent=(state.workouts[d]||[]).filter(s=>s.exercise?.toLowerCase()===chosen.toLowerCase()).at(-1);
 const prev=chosen?previousExercise(chosen,d):null;
 const initial=lastCurrent||prev?.sets.filter(s=>!s.warmup).at(-1)||prev?.sets.at(-1)||null;
 return `<div class="training-head"><div><p class="eyebrow">TRAINING / PRIVATE HISTORY</p><h1>Your training<span>.</span></h1><p class="training-sub">Keep moving forward, one quality set at a time.</p></div><span class="training-date">${pretty(d)}</span></div>
 <div class="session-overview"><div><span class="overview-kicker">${plan?'YOUR PLAN':'WORKOUT JOURNAL'}</span><strong>${escapeHTML(planned)}</strong><small>${isFuture?'Choose today or an earlier date to log':groups.length?'Session in progress · Saved on this device':'Ready when you are'}</small></div><div class="overview-stats"><span><b>${groups.length}</b> exercises</span><span><b>${workingCount}</b> working sets</span></div></div>
 <div class="training-stack">
  ${finishedSessionCard(d)}
  ${d===today()&&!currentSession(d)?`<section class="card session-launch"><p class="eyebrow">TODAY'S SESSION</p><h2>Ready to train?</h2><p>Start a focused ${escapeHTML(routineNames[groupFromDate(d)]||'workout')} session. See only today's exercises, past weights and saved sets.</p><button class="primary session-big-btn" data-action="sessionStart">▶ Start session</button></section>`:''}
  ${routinePanel(d)}
  <details class="training-legacy"><summary>Manual logging (outside a session)</summary><section class="training-entry card"><div class="train-section-title"><div><p class="eyebrow">QUICK LOG</p><h2>Add a set</h2></div><span class="pill">KG · REPS</span></div>
  ${choices.length?`<div class="exercise-chips" aria-label="Your recent exercises">${choices.map(name=>`<button type="button" class="exercise-chip ${chosen===name?'picked':''}" data-pick-exercise="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('')}</div>`:''}
  <form id="workoutForm" class="training-form-v2"><div class="formrow exercise-field"><label for="exName">EXERCISE</label><input id="exName" list="exList" maxlength="80" required autocomplete="off" placeholder="Type or select an exercise" value="${escapeHTML(chosen)}" ${isFuture?'disabled':''}><datalist id="exList">${hints}</datalist></div>
  <div class="formrow"><label for="exWeight">WEIGHT (KG)</label><input id="exWeight" type="number" inputmode="decimal" step="0.5" min="0" max="1000" required placeholder="e.g. 52.5" value="${initial?fmt(Number(initial.weight)):''}" ${isFuture?'disabled':''}></div>
  <div class="formrow"><label for="exReps">REPS</label><input id="exReps" type="number" inputmode="numeric" min="1" max="1000" required placeholder="e.g. 8" value="${initial?initial.reps:''}" ${isFuture?'disabled':''}></div>
  <label class="warmup-check"><input type="checkbox" id="isWarmup" ${isFuture?'disabled':''}> Warm-up set</label><button class="primary add-set-button" type="submit" ${isFuture?'disabled':''}>+ Save set</button></form>
  <div class="training-previous" id="previousHint">${escapeHTML(chosen?previousHint(chosen):'Choose an exercise above to see your previous session and suggested next step.')}</div></section>
  </details><section class="card training-today"><div class="train-section-title"><div><p class="eyebrow">${escapeHTML(pretty(d)).toUpperCase()}</p><h2>Session log</h2></div><span class="pill">${groups.length} exercises</span></div>
  ${groups.length?groups.map((g,i)=>`<div class="training-exercise-group"><div class="train-group-header"><strong>${escapeHTML(g.name)}</strong><small>${g.sets.length} ${g.sets.length===1?'set':'sets'}</small></div>${groupedSetsHtml(g.sets,true)}</div>`).join(''):'<p class="training-empty">Nothing logged for this date yet. Choose an exercise and save your first set.</p>'}</section>
  <section class="card training-history"><div class="train-section-title"><div><p class="eyebrow">HISTORY</p><h2>Past workouts</h2></div><span class="pill">BY SESSION</span></div>
  ${recent.length?`<div class="training-history-list">${recent.map((date,i)=>{const g=workoutGroups(date),sets=g.reduce((n,x)=>n+x.sets.length,0);return `<details class="history-session" ${i===0?'open':''}><summary><span><strong>${pretty(date)}</strong><small>${g.length} exercises · ${sets} sets</small></span><span class="history-chevron">⌄</span></summary><div class="history-content">${g.map(x=>`<div class="history-exercise"><strong>${escapeHTML(x.name)}</strong>${groupedSetsHtml(x.sets,false)}</div>`).join('')}</div></details>`}).join('')}</div>${allHistory.length>recent.length?`<button type="button" class="secondary older-workouts" data-action="showOlderWorkouts">Show older workouts (${allHistory.length-recent.length} remaining)</button>`:''}`:'<p class="training-empty">Your first completed session will appear here.</p>'}
  </section><section class="card training-review-card"><p class="eyebrow">WEEKLY AI REVIEW</p><h2>Training report</h2><p class="callout">Copy workouts, set history, comparisons and next-week routine to your AI review. Nothing is sent automatically.</p><button class="secondary" data-action="copyTrainingWeek">Copy this week’s training</button></section></div>`;
}
function weekView(){let days=weekDates(selectedDate),logged=days.filter(d=>state.habits[d]),completed=logged.filter(d=>score(d)?.complete),scored=logged.filter(d=>score(d)!==null),pct=scored.length?Math.round(scored.reduce((a,d)=>a+(score(d)?.pct||0),0)/scored.length):null,avgSleep=logged.map(d=>state.habits[d]?.sleepHours).filter(x=>Number(x)>0),sleep=avgSleep.length?avgSleep.reduce((a,b)=>a+Number(b),0)/avgSleep.length:null,trained=days.flatMap(d=>state.workouts[d]||[]).length,miss=logged.filter(d=>Number(state.habits[d]?.sleepHours)>0&&Number(state.habits[d].sleepHours)<7).length;
return header('Progress<br><em>over perfect.</em>','One week at a time. The week is a signal, not a verdict.')+
`<div class="kpi-grid"><div class="kpi"><b>${pct===null?'—':pct+'%'}</b><span>WEEKLY HABIT SCORE</span></div><div class="kpi"><b>${sleep===null?'—':fmt(sleep)+'h'}</b><span>AVG ACTUAL SLEEP</span></div><div class="kpi"><b>${completed.length}/7</b><span>COMPLETE LOGGED DAYS</span></div></div>
<div class="twocol" style="margin-top:18px"><div class="card"><div class="section-head" style="margin-top:0"><h2>This week</h2><span class="pill">MON – SUN</span></div><div class="bar-chart">${days.map(d=>{const s=score(d);return `<div class="barcol"><div style="height:${s?Math.max(3,s.pct):3}%;background:${s?.pct>=80?'#accb9c':'#e4d4c4'}" title="${d}: ${s?.pct??'No log'}"></div><b>${shortDay(d).slice(0,2)}</b></div>`}).join('')}</div><div style="margin-top:20px">${days.map(d=>`<div class="compact"><div><div class="name">${shortDay(d)}</div><div class="detail">${pretty(d)} · ${modeFor(d)} mode</div></div><div class="right">${score(d)?score(d).pct+'%':'Not logged'}</div></div>`).join('')}</div></div><div class="side-section"><div class="info-block"><h3>Review signals</h3><div class="compact"><div><div class="name">Logged days</div><div class="detail">Including partial check-ins</div></div><div class="right">${logged.length}/7</div></div><div class="compact"><div><div class="name">Nights under 7h</div><div class="detail">Only reported actual sleep</div></div><div class="right">${miss}</div></div><div class="compact"><div><div class="name">Sets logged</div><div class="detail">Total across the week</div></div><div class="right">${trained}</div></div><div class="compact"><div><div class="name">Weight check-ins</div><div class="detail">Morning measurements</div></div><div class="right">${days.filter(d=>state.weights[d]>0).length}</div></div></div><div class="info-block"><h3>Sunday review</h3><p class="callout">Copy a concise summary for your weekly review. It includes applicable-day scores, sleep and training—not the entire workout archive.</p><div class="button-row"><button class="primary" data-action="copyWeek">Copy habits</button><button class="secondary" data-action="copyTrainingWeek">Copy training</button><button class="secondary" data-action="copyBothWeek">Copy both for AI</button><button class="secondary" data-action="exportBackup">JSON backup</button></div></div></div></div>`}
function settingsView(){const stages=cfg().stages||[],todayStage=currentStage(selectedDate);return header('Your space.<br><em>Your rules.</em>','No account, no ads, no tracking. Your data remains on this phone unless you export it.')+
`<div class="twocol"><div><div class="card"><h2>Private plan</h2><p class="explain">Import a personal configuration JSON only on your own device. Never put that file in a public repository.</p><div class="file-upload"><p class="eyebrow">LOCAL IMPORT</p><p>${hasPlan()?`Loaded: ${escapeHTML(cfg().title||'Private plan')}`:'No private plan imported yet.'}</p><button class="primary" data-action="importPlan">${hasPlan()?'Replace private plan':'Import your plan'} ↗</button></div>
${stages.length?`<div class="section-compact"><p class="eyebrow" style="margin-bottom:10px">CURRENT SLEEP STAGE</p><div class="fieldrow"><div class="fieldbox"><label for="stageChoice">STAGE</label><select id="stageChoice">${stages.map(s=>`<option value="${escapeHTML(s.id)}" ${s.id===todayStage?.id?'selected':''}>${escapeHTML(s.name)} · ${escapeHTML(s.wake)}</option>`).join('')}</select></div><div class="fieldbox"><label for="stageDate">EFFECTIVE DATE</label><input id="stageDate" type="date" value="${today()}"></div></div><div class="button-row"><button class="secondary" data-action="applyStage">Save stage change</button></div><p class="callout">Only advance at the designated review after verifying the previous sleep window. The app never advances your sleep stage automatically unless the imported plan marks that stage automatic.</p></div>`:''}
</div><div class="card"><h2>Backups & migration</h2><p class="explain">Back up your workouts and habit records regularly. This JSON file contains private information: keep it in Files or your private Drive.</p><div class="button-row"><button class="primary" data-action="exportBackup">Export private backup (.json)</button><button class="secondary" data-action="importBackup">Restore backup</button><button class="secondary" data-action="importWorkoutText">Import workout text (.txt)</button></div><div class="section-compact">${legacyAvailable&&!state.legacyImported?'<div class="notice"><strong>Classic app data detected.</strong> Import a copy without deleting the original. <button class="textbtn" data-action="importLegacy">Import now</button></div>':`<p class="callout">Classic workout migration: ${state.legacyImported?'Imported — original untouched':'No local source detected. Open this on the same website and browser as your old app.'}</p>`}</div><p class="footer">Exports save through your browser to iPhone Files → Downloads (or Chrome Downloads). Confirm the file exists before clearing any website data. Food photos from the previous app are not included in this backup.</p></div></div>
<div><div class="info-block"><h3>Privacy contract</h3><p class="callout">All entries are saved to local browser storage. The app never sends entries, sleep data, photos, or plan settings to GitHub or any third party. The publicly hostable files contain generic software only. Service worker caches app code—not your records. Changing browsers or clearing website data can delete local records. Export JSON backups and store them in your own private Drive.</p></div><div class="card theme-settings"><h2>Appearance</h2><p class="explain">Three automatic themes based on Stockholm local time. Or keep one theme all day.</p>
 <div class="theme-options">${[['auto','Automatic'],['light','Light'],['dark','Dark'],['black','Black AMOLED']].map(o=>`<button class="theme-option ${state.settings?.theme===o[0]?'chosen':''}" data-theme-choice="${o[0]}">${o[1]}</button>`).join('')}</div>
 <div class="theme-slots"><div class="fieldbox"><label for="theme-light">LIGHT BEGINS</label><input id="theme-light" type="time" value="${escapeHTML(state.settings?.themeTimes?.light||'07:00')}"></div><div class="fieldbox"><label for="theme-dark">DARK BEGINS</label><input id="theme-dark" type="time" value="${escapeHTML(state.settings?.themeTimes?.dark||'17:00')}"></div><div class="fieldbox"><label for="theme-black">BLACK BEGINS</label><input id="theme-black" type="time" value="${escapeHTML(state.settings?.themeTimes?.black||'22:00')}"></div></div>
 <button class="secondary" data-action="saveThemeTimes">Save automatic hours</button><p class="callout" style="margin-top:12px">Default: 07:00–16:59 Light · 17:00–21:59 Dark · 22:00–06:59 Black. Manual selection overrides the clock until you choose Automatic again.</p></div>
 <div class="button-row"><button class="secondary" data-action="changeDate">Jump to a date</button></div><p class="footer">Timezone: Europe/Stockholm · Day changes at 04:00 · Build 2.0 · Offline after first load (HTTPS)</p></div>`}

/* iOS-style sliding navigation: horizontal drag commits only when released. Ordinary taps & keyboard remain. */
let navDrag=null,ignoreNavClickUntil=0;
function navButtons(){return [...document.querySelectorAll('.bottomnav [data-nav]')]}
function navIndicator(){let bar=document.querySelector('.bottomnav');if(!bar)return null;let ink=bar.querySelector('.dock-indicator');if(!ink){ink=document.createElement('span');ink.className='dock-indicator';ink.setAttribute('aria-hidden','true');bar.prepend(ink)}return ink}
function setDockVisual(target,preview=false,fingerX=null){
 const bar=document.querySelector('.bottomnav'),ink=navIndicator(),button=navButtons().find(b=>b.dataset.nav===target);
 if(!bar||!ink||!button)return;
 const barRect=bar.getBoundingClientRect(),rect=button.getBoundingClientRect();
 ink.style.width=rect.width+'px';const offset=fingerX==null?rect.left-barRect.left-4:Math.max(0,Math.min(barRect.width-rect.width-8,fingerX-barRect.left-rect.width/2-4));ink.style.transform=`translate3d(${offset}px,0,0)`;
 bar.classList.toggle('dock-dragging',preview);
 navButtons().forEach(b=>b.classList.toggle('active',b.dataset.nav===target));
}
function initSwipeDock(){
 const bar=document.querySelector('.bottomnav');if(!bar)return;
 const routeAt=x=>{const b=navButtons().find(b=>{const r=b.getBoundingClientRect();return x>=r.left&&x<=r.right});return b?.dataset.nav||null};
 bar.addEventListener('pointerdown',e=>{
  const btn=e.target.closest('[data-nav]');if(!btn||e.button!==0)return;
  navDrag={pointerId:e.pointerId,startX:e.clientX,route:btn.dataset.nav,moved:false};
  try{bar.setPointerCapture(e.pointerId)}catch(_){}
  setDockVisual(btn.dataset.nav,true);
 });
 bar.addEventListener('pointermove',e=>{
  if(!navDrag||e.pointerId!==navDrag.pointerId)return;
  if(Math.abs(e.clientX-navDrag.startX)>4)navDrag.moved=true;
  const r=routeAt(e.clientX);if(r){navDrag.route=r;setDockVisual(r,true,e.clientX)}
 });
 const end=(e,cancel=false)=>{
  if(!navDrag||e.pointerId!==navDrag.pointerId)return;
  const chosen=navDrag.route,moved=navDrag.moved;navDrag=null;
  try{if(bar.hasPointerCapture(e.pointerId))bar.releasePointerCapture(e.pointerId)}catch(_){}
  if(!cancel){ignoreNavClickUntil=Date.now()+250;if(chosen&&route!==chosen)changeRoute(chosen);else setDockVisual(route)}
  else setDockVisual(route);
  bar.classList.remove('dock-dragging');
 };
 bar.addEventListener('pointerup',e=>end(e));
 bar.addEventListener('pointercancel',e=>end(e,true));
 window.addEventListener('resize',()=>setDockVisual(navDrag?.route||route));
 requestAnimationFrame(()=>setDockVisual(route));
}

function render(){let target=$('screen');target.innerHTML=route==='today'?todayView():route==='training'?gymView():route==='week'?weekView():settingsView();document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===route));setDockVisual(route);applyTheme(); if(route==='today'){const rec=state.habits[selectedDate]||{};if($('sleepHours'))$('sleepHours').value=rec.sleepHours??'';if($('weight'))$('weight').value=state.weights[selectedDate]??'';}}
function changeRoute(r){route=r;render();window.scrollTo({top:0,behavior:'instant'});location.hash=r}
function nextState(x){return x==='yes'?'no':x==='no'?'unset':'yes'}
function ensureDay(){if(!state.habits[selectedDate])state.habits[selectedDate]={checks:{},mood:null,energy:null,notes:'',loggedAt:null};return state.habits[selectedDate]}
function weeklySummary(){const days=weekDates(selectedDate);const log=days.filter(d=>state.habits[d]),complete=log.filter(d=>score(d)?.complete),scored=log.filter(d=>score(d)!==null),pct=scored.length?Math.round(scored.reduce((s,d)=>s+score(d).pct,0)/scored.length):null;let out=[`Overload weekly review: ${days[0]} to ${days[6]}`,`Completed log days: ${complete.length}/7; any logged: ${log.length}/7`,`Weekly habit score: ${pct==null?'not enough complete days':pct+'%'}`];
for(const d of days){const r=state.habits[d],s=score(d);out.push(`${d} (${modeFor(d)}): ${s?.complete?s.pct+'%':r?'partial':'not logged'}${r?.sleepHours?' | sleep '+r.sleepHours+'h':''}${r?.mood?' | mood '+r.mood:''}${r?.energy?' | energy '+r.energy:''}${r?.note?' | note: '+r.note:''}`)}out.push('Weight: '+days.filter(d=>state.weights[d]>0).map(d=>`${d} ${state.weights[d]} kg`).join(', '));out.push('Workout sets: '+days.reduce((a,d)=>a+(state.workouts[d]?.length||0),0));out.push('This is a personal log; check your plan gates, do not re-plan.');return out.join('\n')}
async function copyWeek(){const text=weeklySummary();try{await navigator.clipboard.writeText(text);toast('Weekly review copied')}catch(e){download({summary:text},`overload-week-${selectedDate}.json`);toast('Clipboard unavailable — downloaded instead')}}
function inferWarmups(sets){
 const top=Math.max(...sets.map(x=>Number(x[0])||0));
 const firstTop=sets.findIndex(x=>Number(x[0])===top);
 return sets.map((x,i)=>i<firstTop&&Number(x[0])<top);
}
function importClassicText(text){
 if(typeof text!=='string'||text.length>250000)throw new Error('Text file is empty or too large');
 let exercise=null,processed=0,newSets=0,configs=0,weightCount=0,body=false;
 const exline=/^(.+?)\s*\((\d+)\s*-\s*(\d+)\s*,\s*\+([\d.]+)\)\s*$/;
 const dateLine=/^\-\s*(\d{4}-\d{2}-\d{2})\s*:\s*(.+)$/;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;
  if(line==='BODY'){exercise=null;body=true;continue}
  if(line==='PLAN'){exercise=null;body=false;continue}
  const e=exline.exec(line);
  if(e){exercise=e[1].trim().slice(0,80);body=false;const lo=Number(e[2]),hi=Number(e[3]),inc=Number(e[4]);if(lo>=1&&hi>=lo&&inc>0&&!state.exerciseConfig[exercise]){state.exerciseConfig[exercise]={lo,hi,inc};configs++}continue}
  const m=dateLine.exec(line);
  if(m&&exercise){
   const date=m[1],tokens=m[2].split(/,\s*/);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
   const arr=state.workouts[date]||(state.workouts[date]=[]);
   const parsed=tokens.map(tok=>/^(BW|\d+(?:\.\d+)?)\s*x\s*(\d+)$/i.exec(tok.trim()));
   const list=parsed.map(m=>m?[m[1].toUpperCase()==='BW'?0:Number(m[1]),Number(m[2])]:null);
   const valid=list.filter(x=>x&&x[0]>=0&&x[0]<=1000&&x[1]>=1&&x[1]<=1000);
   const warm=valid.length?inferWarmups(valid):[];
   let j=0;
   list.forEach((set,i)=>{
    if(!set||set[0]<0||set[0]>1000||set[1]<1||set[1]>1000)return;
    const id=`legacy-${exercise}-${date}-${i}`;
    if(!arr.some(x=>x.id===id)){arr.push({exercise,weight:set[0],reps:set[1],warmup:warm[j],source:'text-import',id});newSets++}
    processed++;j++;
   });continue;
  }
  if(body){const w=/^\-\s*(\d{4}-\d{2}-\d{2})\s*:\s*(\d+(?:\.\d+)?)\s*kg\b/i.exec(line);if(w){const v=Number(w[2]);if(v>0&&v<500&&!state.weights[w[1]]){state.weights[w[1]]=v;weightCount++}}}
 }
 if(processed===0&&weightCount===0)throw new Error('No workout entries found');
 return {newSets,configs,weightCount,processed};
}
async function importWorkoutFile(file){
 if(!file)return;
 if(file.size>250000){toast('Choose a workout text file under 250 KB');return}
 try{const txt=await file.text();const r=importClassicText(txt);ensureWorkoutTemplates();populateHistoryTemplates();await persist();render();toast(`Imported ${r.newSets} new sets and ${r.weightCount} weight entries; originals kept`)}
 catch(e){toast('Import failed: '+e.message)}
}
function migration(){if(state.legacyImported)return;let old;try{old=JSON.parse(localStorage.getItem(OLD_KEY));}catch(e){toast('Cannot read classic data');return}if(!old||!old.log){toast('No classic workout records');return}let count=0;Object.entries(old.log||{}).forEach(([exercise,dates])=>Object.entries(dates||{}).forEach(([date,sets])=>{if(!Array.isArray(sets))return;const arr=state.workouts[date]||(state.workouts[date]=[]);const warm=inferWarmups(sets);sets.forEach((s,i)=>{if(Array.isArray(s)&&Number.isFinite(Number(s[0]))&&Number.isFinite(Number(s[1]))){const id=`legacy-${exercise}-${date}-${i}`;if(!arr.some(x=>x.id===id)){arr.push({exercise,weight:Number(s[0]),reps:Number(s[1]),source:'classic',warmup:warm[i],id});count++}}})}));Object.entries(old.body||{}).forEach(([d,v])=>{if(Number(v?.w)>0&&!state.weights[d])state.weights[d]=Number(v.w)});Object.entries(old.food||{}).forEach(([d,v])=>{if(!state.meals[d])state.meals[d]=v});state.gymSchedule=old.schedule||{};state.exercisePlan=old.plan||{};state.exerciseConfig=old.ex||{};state.legacyImported=true;ensureWorkoutTemplates();populateHistoryTemplates();persist();render();toast(`Imported ${count} classic sets; original preserved`)}
async function loadJSON(file,mode){if(!file)return;if(file.size>5*1024*1024){toast('File is too large');return}let j;try{j=JSON.parse(await file.text())}catch(e){toast('Invalid JSON');return}if(mode==='plan'){if(j.kind!=='overload-private-plan'||!Array.isArray(j.stages)||!j.startDate){toast('This is not an Overload plan');return}if(state.config&&!confirm('Replace current private plan? Entries will be retained.'))return;state.config=j;selectedDate=journalDate();await persist();render();toast('Private plan imported — daily tracking begins '+pretty(planStart()))}else{if(j.kind!==BACKUP_SCHEMA||!j.data?.version){toast('Unrecognised backup');return}if(!confirm('Replace current local records with this backup? Export your current data first.'))return;state=j.data;normalizeSettings();state.workouts=state.workouts||{};state.habits=state.habits||{};state.weights=state.weights||{};state.trainingSessions=state.trainingSessions||{};state.stages=state.stages||[];ensureWorkoutTemplates();await persist();render();toast('Private backup restored')}}
function saveCheckin(){if(isFutureCheckin(selectedDate)){toast(hasPlan()?'Daily logging starts '+pretty(planStart()):'Import your private plan first');return}const sleep=parseSleep($('sleepHours')?.value);if(Number.isNaN(sleep)){toast('Use 7:36 for hours:minutes, or 7,5 for decimal hours');$('sleepHours')?.focus();return;}const r=ensureDay();r.sleepHours=sleep;const weight=$('weight')?.value;if(weight&&Number(weight)>0&&Number(weight)<500)state.weights[selectedDate]=Number(weight);r.note=($('note')?.value||'').trim().slice(0,400);r.loggedAt=new Date().toISOString();persist();render();toast('Check-in saved on this device')}
function addSet(e){e.preventDefault();if(isFutureWorkout(selectedDate)){toast('Choose today or a past date');return}const name=$('exName').value.trim().slice(0,80),w=Number($('exWeight').value),reps=Number($('exReps').value);if(!name||!Number.isFinite(w)||w<0||w>1000||!Number.isInteger(reps)||reps<1||reps>1000){toast('Check the set details');return}if(!state.workouts[selectedDate])state.workouts[selectedDate]=[];selectedExercise=name;state.workouts[selectedDate].push({exercise:name,weight:w,reps,warmup:!!$('isWarmup')?.checked,id:`set-${Date.now()}-${Math.random().toString(36).slice(2,7)}`});persist();render();toast('Set recorded')}
function doAction(a){switch(a){case 'sessionStart':sessionStart();break;case 'sessionBack':activeSessionExercise='';savedSessionSet=false;render();break;case 'sessionFinishExercise':sessionFinishExercise();break;case 'sessionFinish':sessionFinish();break;case 'sessionReopen':sessionReopen();break;case 'showOlderWorkouts':historyLimit+=8;render();break;case 'toggleRoutineEdit':editingRoutine=!editingRoutine;render();break;case 'copyTrainingWeek':copyReport('training');break;case 'copyBothWeek':copyReport('both');break;case 'importPlan':$('planPicker').click();break;case 'importBackup':$('backupPicker').click();break;case 'importWorkoutText':$('workoutTextPicker').click();break;case 'exportBackup':download({kind:BACKUP_SCHEMA,exportedAt:new Date().toISOString(),data:state},`overload-private-backup-${today()}.json`);toast('Backup requested — verify it in Files → Downloads');break;case 'copyWeek':copyReport('habits');break;case 'importLegacy':migration();break;case 'toggleTheme':{const i=THEMES.indexOf(state.settings.theme);state.settings.theme=THEMES[(i+1)%THEMES.length];persist();render();toast(`Theme: ${state.settings.theme}`);break;}case 'saveThemeTimes':{const light=$('theme-light')?.value,dark=$('theme-dark')?.value,black=$('theme-black')?.value;const a=minutes(light),b=minutes(dark),c=minutes(black);if([a,b,c].some(x=>x===null)||!(a<b&&b<c)){toast('Choose increasing times: Light → Dark → Black');break;}state.settings.themeTimes={light,dark,black};persist();applyTheme();toast('Theme hours saved on this device');break;}case 'changeDate':{const d=prompt('Enter date YYYY-MM-DD',selectedDate);if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))){selectedDate=d;autoDay=false;changeRoute('today')}break}case 'applyStage':{if(!hasPlan())return;const id=$('stageChoice')?.value,date=$('stageDate')?.value,stage=(cfg().stages||[]).find(s=>s.id===id);if(!stage||!date)return; if(stage.gate&&!confirm(`Confirm you've checked the sleep requirement for ${stage.name}?`))return;state.stages=(state.stages||[]).filter(x=>x.date!==date);state.stages.push({date,id});persist();render();toast('Sleep stage saved privately');break;}}}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.nav){if(Date.now()<ignoreNavClickUntil)return;changeRoute(b.dataset.nav);return}if(b.dataset.sessionExercise){sessionSelectExercise(b.dataset.sessionExercise);return}if(b.dataset.pickExercise){pickExercise(b.dataset.pickExercise);return}if(b.dataset.pickTemplate){pickExercise(b.dataset.pickTemplate);$('exName')?.scrollIntoView({behavior:'smooth',block:'center'});return}if(b.dataset.templateRemove){const [g,i]=b.dataset.templateRemove.split(':');const a=templateList(g);a.splice(Number(i),1);persist();render();toast('Removed from routine, history preserved');return}if(b.dataset.templateMove){const [g,ix,dir]=b.dataset.templateMove.split(':');const a=templateList(g),i=Number(ix),j=i+Number(dir);if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];persist();render();return}if(b.dataset.themeChoice){state.settings.theme=b.dataset.themeChoice;persist();render();toast(`Theme: ${state.settings.theme}`);return}if(b.dataset.date){selectedDate=b.dataset.date;autoDay=false;render();return}if(b.dataset.check){if(isFutureCheckin(selectedDate)||!applicable(selectedDate).includes(b.dataset.check))return;const r=ensureDay(),key=b.dataset.check;const v=nextState(r.checks[key]);if(v==='unset')delete r.checks[key];else r.checks[key]=v;r.loggedAt=new Date().toISOString();persist();render();return}if(b.dataset.mood){if(isFutureCheckin(selectedDate))return;ensureDay().mood=Number(b.dataset.mood);persist();render();return}if(b.dataset.energy){if(isFutureCheckin(selectedDate))return;ensureDay().energy=Number(b.dataset.energy);persist();render();return}if(b.dataset.removeSet){if(isFutureWorkout(selectedDate))return;const ix=Number(b.dataset.removeSet);state.workouts[selectedDate]?.splice(ix,1);savedSessionSet=false;persist();render();return}if(b.dataset.action){doAction(b.dataset.action);return}if(b.id==='saveDay'){saveCheckin();return}if(b.id==='themeButton'){doAction('toggleTheme')}});
document.addEventListener('input',e=>{
 const id=e.target.id;
 if(id==='exName'&&route==='training'){selectedExercise=e.target.value;const hint=$('previousHint');if(hint)hint.textContent=previousHint(e.target.value);return;}if(route!=='today'||!['sleepHours','weight','note'].includes(id)||isFutureCheckin(selectedDate))return;
 const rec=ensureDay();
 if(id==='sleepHours'){const v=parseSleep(e.target.value);if(v===null||Number.isFinite(v))rec.sleepHours=v;else return;}
 if(id==='weight'){const v=Number(e.target.value);if(v>0&&v<500)state.weights[selectedDate]=v;else delete state.weights[selectedDate];}
 if(id==='note')rec.note=e.target.value.slice(0,400);
 persist();
});
document.addEventListener('submit',e=>{if(e.target.id==='workoutForm')addSet(e);if(e.target.id==='templateForm')templateActionAdd(e);if(e.target.id==='sessionSetForm')sessionSaveSet(e);if(e.target.id==='sessionAddForm')sessionAddExercise(e)});
$('planPicker').addEventListener('change',async e=>{await loadJSON(e.target.files[0],'plan');e.target.value=''});$('backupPicker').addEventListener('change',async e=>{await loadJSON(e.target.files[0],'backup');e.target.value=''});$('workoutTextPicker').addEventListener('change',async e=>{await importWorkoutFile(e.target.files[0]);e.target.value=''});
window.addEventListener('hashchange',()=>{let x=location.hash.slice(1);if(['today','training','week','settings'].includes(x)){route=x;render()}});
async function init(){state=await readState();state.workouts=state.workouts||{};state.weights=state.weights||{};state.habits=state.habits||{};state.trainingSessions=state.trainingSessions||{};normalizeSettings();const addedTemplates=ensureWorkoutTemplates();if(addedTemplates)await persist();selectedDate=journalDate();lastLogDay=today();const hash=location.hash.slice(1);if(['today','training','week','settings'].includes(hash))route=hash;try{legacyAvailable=!!localStorage.getItem(OLD_KEY)}catch(e){}render();initSwipeDock();if(location.protocol==='https:'&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})}
init();
setInterval(()=>{if(state?.settings?.theme==='auto')applyTheme();if(state&&today()!==lastLogDay){lastLogDay=today();if(autoDay){selectedDate=journalDate();render()}}},30000);
})();
