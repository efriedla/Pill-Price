// ---- Data: four real demo prices + illustrative filler ----
const REAL=[
 {name:"amlodipine 5 MG Oral Tablet",brand:"Norvasc",g:"0.0101",b:"8.6949",unit:"tablet",form:"Tablet"},
 {name:"montelukast 10 MG Oral Tablet",brand:"Singulair",g:"0.0425",b:"9.2272",unit:"tablet",form:"Tablet"},
 {name:"atorvastatin 80 MG Oral Tablet",brand:"Lipitor",g:"0.0680",b:"19.0447",unit:"tablet",form:"Tablet"},
 {name:"gabapentin 100 MG Oral Capsule",brand:"Neurontin",g:"0.0210",b:"2.9567",unit:"capsule",form:"Capsule"}
];
const $=s=>document.querySelector(s);
const fmt=n=>Number(n).toLocaleString("en-US",{minimumFractionDigits:4,maximumFractionDigits:4});
const fmtMult=(b,g)=>{const m=Number(b)/Number(g);return m<10?m.toFixed(1):Math.round(m).toLocaleString()};
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Seeded PRNG for repeatable illustrative data ----
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646};
function history(base){const pts=[];let v=Number(base);for(let i=0;i<52;i++){v*=1+(rnd()-.5)*.06;pts.push(v)}pts[51]=Number(base);return pts}
function sparkline(pts,color){const w=120,h=32,mn=Math.min(...pts),mx=Math.max(...pts);
 const x=i=>i/(pts.length-1)*w,y=v=>h-3-(v-mn)/(mx-mn||1)*(h-6);
 const d=pts.map((v,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(v).toFixed(1)).join(" ");
 return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h}Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="${w}" cy="${y(pts[51])}" r="2.5" fill="${color}"/></svg>`}

// ---- Price cards ----
$("#cards").innerHTML=REAL.map(d=>{const pts=history(d.g);const prev=pts[47],pct=((pts[51]-prev)/prev*100);
 return `<article class="card">
  <div class="row"><div class="name">${d.name}</div><div class="price g">$${fmt(d.g)}<abbr title="per ${d.unit}">/u</abbr></div></div>
  <div class="row"><div class="name sub">${d.brand} (brand)</div><div class="price b">$${fmt(d.b)}<abbr title="per ${d.unit}">/u</abbr></div></div>
  <div class="gap" role="img" aria-label="Brand costs ${fmtMult(d.b,d.g)} times the generic">
    <div class="gapbar"><b></b><i style="width:${Math.max(1,Number(d.g)/Number(d.b)*100).toFixed(2)}%"></i></div>
    <div class="gaplabel">Brand costs <strong>${fmtMult(d.b,d.g)}×</strong> generic</div>
  </div>
  <div class="spark">${sparkline(pts,"var(--generic)")}<span class="trend ${pct>=0?"up":"down"}">${pct>=0?"▲":"▼"} ${Math.abs(pct).toFixed(1)}% vs 4 wk ago</span><span>52 wk, generic</span></div>
 </article>`}).join("");

// ---- Counters ----
const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target,end=+el.dataset.count,suf=el.dataset.suffix||"";io.unobserve(el);
 if(reduced){el.textContent=end+suf;return}const t0=performance.now();
 (function f(t){const p=Math.min(1,(t-t0)/600),v=Math.round(end*(1-Math.pow(1-p,3)));el.textContent=v+suf;if(p<1)requestAnimationFrame(f)})(t0)}),{threshold:.4});
document.querySelectorAll("[data-count]").forEach(el=>io.observe(el));

// ---- B1: What does $N buy ----
const sel=$("#drugsel");sel.innerHTML=REAL.map((d,i)=>`<option value="${i}">${d.name.split(" ").slice(0,3).join(" ")}</option>`).join("");
function dotMatrix(svg,count,color,cap=500){const shown=Math.min(count,cap),cols=25,r=4.5,gap=12;let s="";
 for(let i=0;i<shown;i++){const c=i%cols,rw=Math.floor(i/cols);s+=`<circle cx="${6+c*gap}" cy="${8+rw*gap}" r="${r}" fill="${color}"/>`}
 const rows=Math.ceil(shown/cols)||1;svg.setAttribute("viewBox",`0 0 300 ${Math.max(40,rows*gap+10)}`);svg.innerHTML=s;return shown}
function renderB1(){const amt=Math.max(1,Math.min(1000,+$("#amtn").value||1));$("#amt").value=amt;const d=REAL[+sel.value];
 const ng=Math.floor(amt/Number(d.g)),nb=Math.floor(amt/Number(d.b));
 $("#sentence").innerHTML=`At NADAC, <strong>$${amt}</strong> buys <strong class="g">${ng.toLocaleString()} ${d.unit}s</strong> of generic ${d.name.replace(/ Oral.*/,"")}, or <strong class="b">${nb.toLocaleString()} ${d.unit}${nb===1?"":"s"}</strong> of ${d.brand}.`;
 const sg=dotMatrix($("#dg"),ng,"var(--generic)"),sb=dotMatrix($("#db"),nb,"var(--brand)");
 $("#dgc").textContent=`Generic · ${sg<ng?sg+" shown of "+ng.toLocaleString():ng.toLocaleString()} ${d.unit}s`;
 $("#dbc").textContent=`${d.brand} · ${nb.toLocaleString()} ${d.unit}${nb===1?"":"s"}`}
$("#amt").addEventListener("input",e=>{$("#amtn").value=e.target.value;renderB1()});
$("#amtn").addEventListener("input",renderB1);sel.addEventListener("change",renderB1);renderB1();

// ---- B2: Beeswarm ----
const FORMS=["Tablet","Capsule","Solution","Injection"];
const DRUGS=REAL.map(d=>({name:d.name.split(" ")[0],brand:d.brand,g:Number(d.g),b:Number(d.b),form:d.form,real:true}));
const fake=["lisinopril","metformin","losartan","sertraline","omeprazole","levothyroxine","albuterol","amoxicillin","escitalopram","rosuvastatin","semaglutide","insulin glargine","prednisone","furosemide","tramadol","ibuprofen","cetirizine","fluoxetine","pantoprazole","hydrochlorothiazide"];
for(let i=0;i<81;i++){const form=FORMS[i%5===0?3:i%7===0?2:i%3===0?1:0];const base=form==="Injection"?2:form==="Solution"?.05:.01;
 const g=base*Math.pow(10,(rnd()-.3)*2.2);DRUGS.push({name:fake[i%fake.length]+(i>=fake.length?" "+(Math.floor(i/fake.length)*5+5)+" mg":""),brand:"Brand",g,b:g*Math.pow(10,.6+rnd()*2.2),form,real:false})}
const W=900,H=260,L=70,R=20,T=16,B=40,mnx=Math.log10(.003),mxx=Math.log10(300);
const X=v=>L+(Math.log10(v)-mnx)/(mxx-mnx)*(W-L-R),laneY=f=>T+(FORMS.indexOf(f)+.5)*((H-T-B)/FORMS.length);
let showBrand=false;
function drawBee(){const svg=$("#beesvg");let s="";
 [0.01,0.1,1,10,100].forEach(v=>{const x=X(v);s+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${H-B}" stroke="var(--grid)"/><text x="${x}" y="${H-B+18}" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="var(--mono)">$${v}</text>`});
 s+=`<text x="${W/2}" y="${H-4}" text-anchor="middle" font-size="12" fill="var(--muted)">per-unit price, log scale · NADAC as of Oct 30, 2026</text>`;
 FORMS.forEach(f=>s+=`<text x="${L-10}" y="${laneY(f)+4}" text-anchor="end" font-size="13" fill="var(--fg)">${f}</text>`);
 const occ={};DRUGS.forEach((d,i)=>{const x=X(d.g),y0=laneY(d.form);let jy=0,tries=0;const key=k=>Math.round(k/14);
  while(tries<10){const k=key(x)+":"+(y0+jy).toFixed(0);if(!occ[k]){occ[k]=1;break}jy=(tries%2?-1:1)*Math.ceil((tries+1)/2)*9;tries++}
  const y=y0+jy;d.x=x;d.y=y;
  if(showBrand)s+=`<line x1="${x}" y1="${y}" x2="${X(d.b)}" y2="${y}" stroke="var(--brand)" stroke-opacity=".35"/><circle cx="${X(d.b)}" cy="${y}" r="4" fill="none" stroke="var(--brand)" stroke-width="1.8"/>`;
  s+=`<a href="#drug-${i}" tabindex="0" aria-label="${d.name}, generic $${fmt(d.g)} per unit"><circle class="pt" data-i="${i}" cx="${x}" cy="${y}" r="${d.real?7:5.5}" fill="var(--generic)" fill-opacity="${d.real?1:.75}"/></a>`});
 svg.innerHTML=s}
drawBee();
const tip=$("#tip");
function showTip(i,el){const d=DRUGS[i];const box=$("#bee").getBoundingClientRect(),c=el.getBoundingClientRect();
 tip.innerHTML=`${d.name}${d.real?"":" (illustrative)"}<br>generic <span class="price">$${fmt(d.g)}</span>${showBrand?` · brand <span class="price">$${fmt(d.b)}</span>`:""}`;
 tip.style.left=(c.left+c.width/2-box.left)+"px";tip.style.top=(c.top-box.top)+"px";tip.classList.add("on");
 document.querySelectorAll(".pt.hl").forEach(p=>p.classList.remove("hl"));el.classList.add("hl")}
$("#bee").addEventListener("mouseover",e=>{const p=e.target.closest(".pt");if(p)showTip(+p.dataset.i,p)});
$("#bee").addEventListener("mouseout",e=>{if(e.target.closest(".pt")){tip.classList.remove("on");e.target.closest(".pt").classList.remove("hl")}});
$("#bee").addEventListener("focusin",e=>{const p=e.target.querySelector?.(".pt");if(p)showTip(+p.dataset.i,p)});
$("#bee").addEventListener("focusout",()=>{tip.classList.remove("on")});
$("#bee").addEventListener("click",e=>{if(e.target.closest("a"))e.preventDefault()});
$("#ovG").onclick=()=>{showBrand=false;$("#ovG").setAttribute("aria-pressed","true");$("#ovB").setAttribute("aria-pressed","false");drawBee()};
$("#ovB").onclick=()=>{showBrand=true;$("#ovB").setAttribute("aria-pressed","true");$("#ovG").setAttribute("aria-pressed","false");drawBee()};
let sortKey="g",sortDir=1;
function drawTable(){const rows=[...DRUGS].sort((a,b)=>(typeof a[sortKey]==="string"?a[sortKey].localeCompare(b[sortKey]):a[sortKey]-b[sortKey])*sortDir);
 const th=(k,l,num)=>`<th class="${num?"num":""}" aria-sort="${sortKey===k?(sortDir>0?"ascending":"descending"):"none"}"><button data-k="${k}" style="font:inherit;background:none;border:0;color:inherit;cursor:pointer;padding:0">${l}${sortKey===k?(sortDir>0?" ↑":" ↓"):""}</button></th>`;
 $("#beetable").innerHTML=`<table><thead><tr>${th("name","Drug")}${th("form","Form")}${th("g","Generic / unit",1)}${th("b","Brand / unit",1)}<th class="num">Gap</th></tr></thead><tbody>${rows.map(d=>`<tr><td>${d.name}${d.real?"":" <span class='note'>(illustrative)</span>"}</td><td>${d.form}</td><td class="num">$${fmt(d.g)}</td><td class="num">$${fmt(d.b)}</td><td class="num">${fmtMult(d.b,d.g)}×</td></tr>`).join("")}</tbody></table>`;
 $("#beetable").querySelectorAll("button[data-k]").forEach(b=>b.onclick=()=>{const k=b.dataset.k;if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=1}drawTable()})}
$("#vChart").onclick=()=>{$("#bee").hidden=false;$("#beetable").hidden=true;$("#vChart").setAttribute("aria-pressed","true");$("#vTable").setAttribute("aria-pressed","false")};
$("#vTable").onclick=()=>{drawTable();$("#bee").hidden=true;$("#beetable").hidden=false;$("#vTable").setAttribute("aria-pressed","true");$("#vChart").setAttribute("aria-pressed","false")};
