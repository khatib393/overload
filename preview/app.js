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
const blank=()=>({version:2,config:null,habits:{},workouts:{},weights:{},meals:{},gymSchedule:{},stages:[],settings:{theme:'auto',themeTimes:{light:'07:00',dark:'17:00',black:'22:00'}},legacyImported:false,exerciseConfig:{},exercisePlan:{},created:new Date().toISOString()});
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
const txt=(id,text)=>{const v=id==='sleepHours'?state.habits[selectedDate]?.sleepHours:id==='weight'?state.weights[selectedDate]:null;return `<div class="fieldbox"><label for="${id}">${text}</label><input id="${id}" ${isFutureCheckin(selectedDate)?'disabled':''} type="number" inputmode="decimal" step="0.1" value="${v!=null&&Number.isFinite(Number(v))?escapeHTML(v):''}" placeholder="—"></div>`};
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
function gymView(){
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
  <section class="training-entry card"><div class="train-section-title"><div><p class="eyebrow">QUICK LOG</p><h2>Add a set</h2></div><span class="pill">KG · REPS</span></div>
  ${choices.length?`<div class="exercise-chips" aria-label="Your recent exercises">${choices.map(name=>`<button type="button" class="exercise-chip ${chosen===name?'picked':''}" data-pick-exercise="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('')}</div>`:''}
  <form id="workoutForm" class="training-form-v2"><div class="formrow exercise-field"><label for="exName">EXERCISE</label><input id="exName" list="exList" maxlength="80" required autocomplete="off" placeholder="Type or select an exercise" value="${escapeHTML(chosen)}" ${isFuture?'disabled':''}><datalist id="exList">${hints}</datalist></div>
  <div class="formrow"><label for="exWeight">WEIGHT (KG)</label><input id="exWeight" type="number" inputmode="decimal" step="0.5" min="0" max="1000" required placeholder="e.g. 52.5" value="${initial?fmt(Number(initial.weight)):''}" ${isFuture?'disabled':''}></div>
  <div class="formrow"><label for="exReps">REPS</label><input id="exReps" type="number" inputmode="numeric" min="1" max="1000" required placeholder="e.g. 8" value="${initial?initial.reps:''}" ${isFuture?'disabled':''}></div>
  <label class="warmup-check"><input type="checkbox" id="isWarmup" ${isFuture?'disabled':''}> Warm-up set</label><button class="primary add-set-button" type="submit" ${isFuture?'disabled':''}>+ Save set</button></form>
  <div class="training-previous" id="previousHint">${escapeHTML(chosen?previousHint(chosen):'Choose an exercise above to see your previous session and suggested next step.')}</div></section>
  <section class="card training-today"><div class="train-section-title"><div><p class="eyebrow">${escapeHTML(pretty(d)).toUpperCase()}</p><h2>Session log</h2></div><span class="pill">${groups.length} exercises</span></div>
  ${groups.length?groups.map((g,i)=>`<div class="training-exercise-group"><div class="train-group-header"><strong>${escapeHTML(g.name)}</strong><small>${g.sets.length} ${g.sets.length===1?'set':'sets'}</small></div>${groupedSetsHtml(g.sets,true)}</div>`).join(''):'<p class="training-empty">Nothing logged for this date yet. Choose an exercise and save your first set.</p>'}</section>
  <section class="card training-history"><div class="train-section-title"><div><p class="eyebrow">HISTORY</p><h2>Past workouts</h2></div><span class="pill">BY SESSION</span></div>
  ${recent.length?`<div class="training-history-list">${recent.map((date,i)=>{const g=workoutGroups(date),sets=g.reduce((n,x)=>n+x.sets.length,0);return `<details class="history-session" ${i===0?'open':''}><summary><span><strong>${pretty(date)}</strong><small>${g.length} exercises · ${sets} sets</small></span><span class="history-chevron">⌄</span></summary><div class="history-content">${g.map(x=>`<div class="history-exercise"><strong>${escapeHTML(x.name)}</strong>${groupedSetsHtml(x.sets,false)}</div>`).join('')}</div></details>`}).join('')}</div>${allHistory.length>recent.length?`<button type="button" class="secondary older-workouts" data-action="showOlderWorkouts">Show older workouts (${allHistory.length-recent.length} remaining)</button>`:''}`:'<p class="training-empty">Your first completed session will appear here.</p>'}
  </section></div>`;
}
function weekView(){let days=weekDates(selectedDate),logged=days.filter(d=>state.habits[d]),completed=logged.filter(d=>score(d)?.complete),scored=logged.filter(d=>score(d)!==null),pct=scored.length?Math.round(scored.reduce((a,d)=>a+(score(d)?.pct||0),0)/scored.length):null,avgSleep=logged.map(d=>state.habits[d]?.sleepHours).filter(x=>Number(x)>0),sleep=avgSleep.length?avgSleep.reduce((a,b)=>a+Number(b),0)/avgSleep.length:null,trained=days.flatMap(d=>state.workouts[d]||[]).length,miss=logged.filter(d=>Number(state.habits[d]?.sleepHours)>0&&Number(state.habits[d].sleepHours)<7).length;
return header('Progress<br><em>over perfect.</em>','One week at a time. The week is a signal, not a verdict.')+
`<div class="kpi-grid"><div class="kpi"><b>${pct===null?'—':pct+'%'}</b><span>WEEKLY HABIT SCORE</span></div><div class="kpi"><b>${sleep===null?'—':fmt(sleep)+'h'}</b><span>AVG ACTUAL SLEEP</span></div><div class="kpi"><b>${completed.length}/7</b><span>COMPLETE LOGGED DAYS</span></div></div>
<div class="twocol" style="margin-top:18px"><div class="card"><div class="section-head" style="margin-top:0"><h2>This week</h2><span class="pill">MON – SUN</span></div><div class="bar-chart">${days.map(d=>{const s=score(d);return `<div class="barcol"><div style="height:${s?Math.max(3,s.pct):3}%;background:${s?.pct>=80?'#accb9c':'#e4d4c4'}" title="${d}: ${s?.pct??'No log'}"></div><b>${shortDay(d).slice(0,2)}</b></div>`}).join('')}</div><div style="margin-top:20px">${days.map(d=>`<div class="compact"><div><div class="name">${shortDay(d)}</div><div class="detail">${pretty(d)} · ${modeFor(d)} mode</div></div><div class="right">${score(d)?score(d).pct+'%':'Not logged'}</div></div>`).join('')}</div></div><div class="side-section"><div class="info-block"><h3>Review signals</h3><div class="compact"><div><div class="name">Logged days</div><div class="detail">Including partial check-ins</div></div><div class="right">${logged.length}/7</div></div><div class="compact"><div><div class="name">Nights under 7h</div><div class="detail">Only reported actual sleep</div></div><div class="right">${miss}</div></div><div class="compact"><div><div class="name">Sets logged</div><div class="detail">Total across the week</div></div><div class="right">${trained}</div></div><div class="compact"><div><div class="name">Weight check-ins</div><div class="detail">Morning measurements</div></div><div class="right">${days.filter(d=>state.weights[d]>0).length}</div></div></div><div class="info-block"><h3>Sunday review</h3><p class="callout">Copy a concise summary for your weekly review. It includes applicable-day scores, sleep and training—not the entire workout archive.</p><div class="button-row"><button class="primary" data-action="copyWeek">Copy weekly summary</button><button class="secondary" data-action="exportBackup">JSON backup</button></div></div></div></div>`}
function settingsView(){const stages=cfg().stages||[],todayStage=currentStage(selectedDate);return header('Your space.<br><em>Your rules.</em>','No account, no ads, no tracking. Your data remains on this phone unless you export it.')+
`<div class="twocol"><div><div class="card"><h2>Private plan</h2><p class="explain">Import a personal configuration JSON only on your own device. Never put that file in a public repository.</p><div class="file-upload"><p class="eyebrow">LOCAL IMPORT</p><p>${hasPlan()?`Loaded: ${escapeHTML(cfg().title||'Private plan')}`:'No private plan imported yet.'}</p><button class="primary" data-action="importPlan">${hasPlan()?'Replace private plan':'Import your plan'} ↗</button></div>
${stages.length?`<div class="section-compact"><p class="eyebrow" style="margin-bottom:10px">CURRENT SLEEP STAGE</p><div class="fieldrow"><div class="fieldbox"><label for="stageChoice">STAGE</label><select id="stageChoice">${stages.map(s=>`<option value="${escapeHTML(s.id)}" ${s.id===todayStage?.id?'selected':''}>${escapeHTML(s.name)} · ${escapeHTML(s.wake)}</option>`).join('')}</select></div><div class="fieldbox"><label for="stageDate">EFFECTIVE DATE</label><input id="stageDate" type="date" value="${today()}"></div></div><div class="button-row"><button class="secondary" data-action="applyStage">Save stage change</button></div><p class="callout">Only advance at the designated review after verifying the previous sleep window. The app never advances your sleep stage automatically unless the imported plan marks that stage automatic.</p></div>`:''}
</div><div class="card"><h2>Backups & migration</h2><p class="explain">Back up your workouts and habit records regularly. This JSON file contains private information: keep it in Files or your private Drive.</p><div class="button-row"><button class="primary" data-action="exportBackup">Export private backup (.json)</button><button class="secondary" data-action="importBackup">Restore backup</button><button class="secondary" data-action="importWorkoutText">Import workout text (.txt)</button></div><div class="section-compact">${legacyAvailable&&!state.legacyImported?'<div class="notice"><strong>Classic app data detected.</strong> Import a copy without deleting the original. <button class="textbtn" data-action="importLegacy">Import now</button></div>':`<p class="callout">Classic workout migration: ${state.legacyImported?'Imported — original untouched':'No local source detected. Open this on the same website and browser as your old app.'}</p>`}</div><p class="footer">Exports save through your browser to iPhone Files → Downloads (or Chrome Downloads). Confirm the file exists before clearing any website data. Food photos from the previous app are not included in this backup.</p></div></div>
<div><div class="info-block"><h3>Privacy contract</h3><p class="callout">All entries are saved to local browser storage. The app never sends entries, sleep data, photos, or plan settings to GitHub or any third party. The publicly hostable files contain generic software only. Service worker caches app code—not your records. Changing browsers or clearing website data can delete local records. Export JSON backups and store them in your own private Drive.</p></div><div class="card theme-settings"><h2>Appearance</h2><p class="explain">Three automatic themes based on Stockholm local time. Or keep one theme all day.</p>
 <div class="theme-options">${[['auto','Automatic'],['light','Light'],['dark','Dark'],['black','Black AMOLED']].map(o=>`<button class="theme-option ${state.settings?.theme===o[0]?'chosen':''}" data-theme-choice="${o[0]}">${o[1]}</button>`).join('')}</div>
 <div class="theme-slots"><div class="fieldbox"><label for="theme-light">LIGHT BEGINS</label><input id="theme-light" type="time" value="${escapeHTML(state.settings?.themeTimes?.light||'07:00')}"></div><div class="fieldbox"><label for="theme-dark">DARK BEGINS</label><input id="theme-dark" type="time" value="${escapeHTML(state.settings?.themeTimes?.dark||'17:00')}"></div><div class="fieldbox"><label for="theme-black">BLACK BEGINS</label><input id="theme-black" type="time" value="${escapeHTML(state.settings?.themeTimes?.black||'22:00')}"></div></div>
 <button class="secondary" data-action="saveThemeTimes">Save automatic hours</button><p class="callout" style="margin-top:12px">Default: 07:00–16:59 Light · 17:00–21:59 Dark · 22:00–06:59 Black. Manual selection overrides the clock until you choose Automatic again.</p></div>
 <div class="button-row"><button class="secondary" data-action="changeDate">Jump to a date</button></div><p class="footer">Timezone: Europe/Stockholm · Day changes at 04:00 · Build 2.0 · Offline after first load (HTTPS)</p></div>`}
function render(){let target=$('screen');target.innerHTML=route==='today'?todayView():route==='training'?gymView():route==='week'?weekView():settingsView();document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===route));applyTheme(); if(route==='today'){const rec=state.habits[selectedDate]||{};if($('sleepHours'))$('sleepHours').value=rec.sleepHours??'';if($('weight'))$('weight').value=state.weights[selectedDate]??'';}}
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
 try{const txt=await file.text();const r=importClassicText(txt);await persist();render();toast(`Imported ${r.newSets} new sets and ${r.weightCount} weight entries; originals kept`)}
 catch(e){toast('Import failed: '+e.message)}
}
function migration(){if(state.legacyImported)return;let old;try{old=JSON.parse(localStorage.getItem(OLD_KEY));}catch(e){toast('Cannot read classic data');return}if(!old||!old.log){toast('No classic workout records');return}let count=0;Object.entries(old.log||{}).forEach(([exercise,dates])=>Object.entries(dates||{}).forEach(([date,sets])=>{if(!Array.isArray(sets))return;const arr=state.workouts[date]||(state.workouts[date]=[]);const warm=inferWarmups(sets);sets.forEach((s,i)=>{if(Array.isArray(s)&&Number.isFinite(Number(s[0]))&&Number.isFinite(Number(s[1]))){const id=`legacy-${exercise}-${date}-${i}`;if(!arr.some(x=>x.id===id)){arr.push({exercise,weight:Number(s[0]),reps:Number(s[1]),source:'classic',warmup:warm[i],id});count++}}})}));Object.entries(old.body||{}).forEach(([d,v])=>{if(Number(v?.w)>0&&!state.weights[d])state.weights[d]=Number(v.w)});Object.entries(old.food||{}).forEach(([d,v])=>{if(!state.meals[d])state.meals[d]=v});state.gymSchedule=old.schedule||{};state.exercisePlan=old.plan||{};state.exerciseConfig=old.ex||{};state.legacyImported=true;persist();render();toast(`Imported ${count} classic sets; original preserved`)}
async function loadJSON(file,mode){if(!file)return;if(file.size>5*1024*1024){toast('File is too large');return}let j;try{j=JSON.parse(await file.text())}catch(e){toast('Invalid JSON');return}if(mode==='plan'){if(j.kind!=='overload-private-plan'||!Array.isArray(j.stages)||!j.startDate){toast('This is not an Overload plan');return}if(state.config&&!confirm('Replace current private plan? Entries will be retained.'))return;state.config=j;selectedDate=journalDate();await persist();render();toast('Private plan imported — daily tracking begins '+pretty(planStart()))}else{if(j.kind!==BACKUP_SCHEMA||!j.data?.version){toast('Unrecognised backup');return}if(!confirm('Replace current local records with this backup? Export your current data first.'))return;state=j.data;normalizeSettings();state.workouts=state.workouts||{};state.habits=state.habits||{};state.weights=state.weights||{};state.stages=state.stages||[];await persist();render();toast('Private backup restored')}}
function saveCheckin(){if(isFutureCheckin(selectedDate)){toast(hasPlan()?'Daily logging starts '+pretty(planStart()):'Import your private plan first');return}const r=ensureDay();r.sleepHours=$('sleepHours')?.value?Number($('sleepHours').value):null;const weight=$('weight')?.value;if(weight&&Number(weight)>0&&Number(weight)<500)state.weights[selectedDate]=Number(weight);r.note=($('note')?.value||'').trim().slice(0,400);r.loggedAt=new Date().toISOString();persist();render();toast('Check-in saved on this device')}
function addSet(e){e.preventDefault();if(isFutureWorkout(selectedDate)){toast('Choose today or a past date');return}const name=$('exName').value.trim().slice(0,80),w=Number($('exWeight').value),reps=Number($('exReps').value);if(!name||!Number.isFinite(w)||w<0||w>1000||!Number.isInteger(reps)||reps<1||reps>1000){toast('Check the set details');return}if(!state.workouts[selectedDate])state.workouts[selectedDate]=[];selectedExercise=name;state.workouts[selectedDate].push({exercise:name,weight:w,reps,warmup:!!$('isWarmup')?.checked,id:`set-${Date.now()}-${Math.random().toString(36).slice(2,7)}`});persist();render();toast('Set recorded')}
function doAction(a){switch(a){case 'showOlderWorkouts':historyLimit+=8;render();break;case 'importPlan':$('planPicker').click();break;case 'importBackup':$('backupPicker').click();break;case 'importWorkoutText':$('workoutTextPicker').click();break;case 'exportBackup':download({kind:BACKUP_SCHEMA,exportedAt:new Date().toISOString(),data:state},`overload-private-backup-${today()}.json`);toast('Backup requested — verify it in Files → Downloads');break;case 'copyWeek':copyWeek();break;case 'importLegacy':migration();break;case 'toggleTheme':{const i=THEMES.indexOf(state.settings.theme);state.settings.theme=THEMES[(i+1)%THEMES.length];persist();render();toast(`Theme: ${state.settings.theme}`);break;}case 'saveThemeTimes':{const light=$('theme-light')?.value,dark=$('theme-dark')?.value,black=$('theme-black')?.value;const a=minutes(light),b=minutes(dark),c=minutes(black);if([a,b,c].some(x=>x===null)||!(a<b&&b<c)){toast('Choose increasing times: Light → Dark → Black');break;}state.settings.themeTimes={light,dark,black};persist();applyTheme();toast('Theme hours saved on this device');break;}case 'changeDate':{const d=prompt('Enter date YYYY-MM-DD',selectedDate);if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))){selectedDate=d;autoDay=false;changeRoute('today')}break}case 'applyStage':{if(!hasPlan())return;const id=$('stageChoice')?.value,date=$('stageDate')?.value,stage=(cfg().stages||[]).find(s=>s.id===id);if(!stage||!date)return; if(stage.gate&&!confirm(`Confirm you've checked the sleep requirement for ${stage.name}?`))return;state.stages=(state.stages||[]).filter(x=>x.date!==date);state.stages.push({date,id});persist();render();toast('Sleep stage saved privately');break;}}}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.nav){changeRoute(b.dataset.nav);return}if(b.dataset.pickExercise){pickExercise(b.dataset.pickExercise);return}if(b.dataset.themeChoice){state.settings.theme=b.dataset.themeChoice;persist();render();toast(`Theme: ${state.settings.theme}`);return}if(b.dataset.date){selectedDate=b.dataset.date;autoDay=false;render();return}if(b.dataset.check){if(isFutureCheckin(selectedDate)||!applicable(selectedDate).includes(b.dataset.check))return;const r=ensureDay(),key=b.dataset.check;const v=nextState(r.checks[key]);if(v==='unset')delete r.checks[key];else r.checks[key]=v;r.loggedAt=new Date().toISOString();persist();render();return}if(b.dataset.mood){if(isFutureCheckin(selectedDate))return;ensureDay().mood=Number(b.dataset.mood);persist();render();return}if(b.dataset.energy){if(isFutureCheckin(selectedDate))return;ensureDay().energy=Number(b.dataset.energy);persist();render();return}if(b.dataset.removeSet){if(isFutureWorkout(selectedDate))return;const ix=Number(b.dataset.removeSet);state.workouts[selectedDate]?.splice(ix,1);persist();render();return}if(b.dataset.action){doAction(b.dataset.action);return}if(b.id==='saveDay'){saveCheckin();return}if(b.id==='themeButton'){doAction('toggleTheme')}});
document.addEventListener('input',e=>{
 const id=e.target.id;
 if(id==='exName'&&route==='training'){selectedExercise=e.target.value;const hint=$('previousHint');if(hint)hint.textContent=previousHint(e.target.value);return;}if(route!=='today'||!['sleepHours','weight','note'].includes(id)||isFutureCheckin(selectedDate))return;
 const rec=ensureDay();
 if(id==='sleepHours')rec.sleepHours=e.target.value===''?null:Number(e.target.value);
 if(id==='weight'){const v=Number(e.target.value);if(v>0&&v<500)state.weights[selectedDate]=v;else delete state.weights[selectedDate];}
 if(id==='note')rec.note=e.target.value.slice(0,400);
 persist();
});
document.addEventListener('submit',e=>{if(e.target.id==='workoutForm')addSet(e)});
$('planPicker').addEventListener('change',async e=>{await loadJSON(e.target.files[0],'plan');e.target.value=''});$('backupPicker').addEventListener('change',async e=>{await loadJSON(e.target.files[0],'backup');e.target.value=''});$('workoutTextPicker').addEventListener('change',async e=>{await importWorkoutFile(e.target.files[0]);e.target.value=''});
window.addEventListener('hashchange',()=>{let x=location.hash.slice(1);if(['today','training','week','settings'].includes(x)){route=x;render()}});
async function init(){state=await readState();state.workouts=state.workouts||{};state.weights=state.weights||{};state.habits=state.habits||{};normalizeSettings();selectedDate=journalDate();lastLogDay=today();const hash=location.hash.slice(1);if(['today','training','week','settings'].includes(hash))route=hash;try{legacyAvailable=!!localStorage.getItem(OLD_KEY)}catch(e){}render();if(location.protocol==='https:'&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})}
init();
setInterval(()=>{if(state?.settings?.theme==='auto')applyTheme();if(state&&today()!==lastLogDay){lastLogDay=today();if(autoDay){selectedDate=journalDate();render()}}},30000);
})();
