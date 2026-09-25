/* AccuQual QMS landing page. Vanilla JS, no dependencies. */
(function(){
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function(s,c){return (c||document).querySelector(s)};
  var $$ = function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
  var yr=$("#yr"); if(yr) yr.textContent=new Date().getFullYear();

  /* ---------- nav state ---------- */
  var nav=$("#nav");
  function onScroll(){ nav.classList.toggle("scrolled", window.scrollY>30); }
  window.addEventListener("scroll",onScroll,{passive:true}); onScroll();

  /* ---------- reveal on scroll ---------- */
  var reveals=$$(".reveal");
  if(!("IntersectionObserver" in window) || reduce){ reveals.forEach(function(el){el.classList.add("in")}); }
  else{
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target);} });
    },{threshold:.12,rootMargin:"0px 0px -40px 0px"});
    // stagger siblings
    reveals.forEach(function(el){
      var sib=$$(":scope > .reveal", el.parentElement); var i=sib.indexOf(el);
      if(i>0) el.style.setProperty("--d",(Math.min(i,6)*0.08)+"s");
      io.observe(el);
    });
  }

  /* ---------- starfield + parallax ---------- */
  var canvas=$("#stars"), ctx=canvas && canvas.getContext("2d");
  var W=0,H=0,DPR=Math.min(window.devicePixelRatio||1,2), stars=[], motes=[];
  var mouse={x:.5,y:.5,tx:.5,ty:.5,px:-999,py:-999};
  function resize(){
    if(!canvas) return;
    var r=canvas.getBoundingClientRect(); W=r.width; H=r.height;
    canvas.width=W*DPR; canvas.height=H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
    var n=Math.round(Math.min(900, W*H/1800));
    stars=[]; for(var i=0;i<n;i++) stars.push(newStar(true));
    motes=[]; var m=Math.round(Math.min(90,W/16)); for(var j=0;j<m;j++) motes.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.25,vy:(Math.random()-.5)*.25,c:Math.random()<.5?"0,243,255":"168,85,247"});
  }
  function newStar(init){ return {x:(Math.random()-.5)*2, y:(Math.random()-.5)*2, z:init?Math.random():1, tw:Math.random()*6.28, hue:Math.random()<.15?(Math.random()<.5?"0,243,255":"168,85,247"):"255,255,255"}; }
  function drawFrame(t, still){
    ctx.clearRect(0,0,W,H);
    mouse.x+=(mouse.tx-mouse.x)*.05; mouse.y+=(mouse.ty-mouse.y)*.05;
    var warp=Math.max(0,1-(t-(warpT0||t))/1800); if(!warpT0) warpT0=t; var cx=W*(.5+(mouse.x-.5)*.25), cy=H*(.45+(mouse.y-.5)*.25), speed=still?0:0.0022*(1+18*warp*warp);
    for(var i=0;i<stars.length;i++){
      var s=stars[i]; s.z-=speed; if(s.z<=0.02){ stars[i]=newStar(false); continue; }
      var k=0.9/s.z, x=cx+s.x*k*W*.5, y=cy+s.y*k*H*.5;
      if(x<-20||x>W+20||y<-20||y>H+20){ stars[i]=newStar(false); continue; }
      var a=Math.min(1,(1-s.z)*1.3)*(0.6+0.4*Math.sin(t*.002+s.tw)), r=(1-s.z)*2.1+.2;
      ctx.fillStyle="rgba("+s.hue+","+a.toFixed(3)+")";
      if(!still && (s.z<.25 || warp>.15)){ // warp streak
        var k2=0.9/(s.z+speed*(6+30*warp)), x2=cx+s.x*k2*W*.5, y2=cy+s.y*k2*H*.5;
        ctx.strokeStyle="rgba("+s.hue+","+(a*.45).toFixed(3)+")"; ctx.lineWidth=Math.max(.6,r*.6); ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x,y); ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.fill(); }
    }
    // measurement-point motes that connect near the cursor
    for(var j=0;j<motes.length;j++){
      var m=motes[j];
      if(!still){ m.x+=m.vx; m.y+=m.vy; if(m.x<0||m.x>W) m.vx*=-1; if(m.y<0||m.y>H) m.vy*=-1; }
      var dx=m.x-mouse.px, dy=m.y-mouse.py, d=Math.sqrt(dx*dx+dy*dy);
      if(d<170){
        ctx.strokeStyle="rgba("+m.c+","+(0.5*(1-d/170)).toFixed(3)+")"; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(m.x,m.y); ctx.lineTo(mouse.px,mouse.py); ctx.stroke();
        if(!still){ m.x+=dx/d*.3; m.y+=dy/d*.3; }
      }
      ctx.fillStyle="rgba("+m.c+","+(d<170?.95:.45)+")";
      ctx.fillRect(m.x-1.5,m.y-1.5,3,3);
    }
    if(mouse.px>0){ // crosshair reticle
      ctx.strokeStyle="rgba(0,243,255,.55)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(mouse.px,mouse.py,14,0,6.283); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mouse.px-24,mouse.py); ctx.lineTo(mouse.px-8,mouse.py); ctx.moveTo(mouse.px+8,mouse.py); ctx.lineTo(mouse.px+24,mouse.py);
      ctx.moveTo(mouse.px,mouse.py-24); ctx.lineTo(mouse.px,mouse.py-8); ctx.moveTo(mouse.px,mouse.py+8); ctx.lineTo(mouse.px,mouse.py+24); ctx.stroke();
    }
  }
  var heroVisible=true, raf, warpT0=0;
  function loop(t){ if(heroVisible) drawFrame(t,false); raf=requestAnimationFrame(loop); }
  if(canvas){
    resize(); window.addEventListener("resize",function(){resize(); if(reduce) drawFrame(0,true);});
    if(reduce){ drawFrame(0,true); }
    else{
      raf=requestAnimationFrame(loop);
      if("IntersectionObserver" in window) new IntersectionObserver(function(e){heroVisible=e[0].isIntersecting}).observe($(".hero"));
    }
    var hero=$(".hero"), rx=$("#rx"), ry=$("#ry");
    var layers=$$("[data-depth]", hero);
    hero.addEventListener("pointermove",function(e){
      var r=hero.getBoundingClientRect();
      mouse.tx=(e.clientX-r.left)/r.width; mouse.ty=(e.clientY-r.top)/r.height;
      mouse.px=e.clientX-r.left; mouse.py=e.clientY-r.top;
      if(rx){ rx.textContent=fmt((mouse.tx-.5)*400); ry.textContent=fmt((.5-mouse.ty)*250); }
      if(!reduce){
        layers.forEach(function(l){ var d=parseFloat(l.dataset.depth); l.style.transform="translate3d("+((mouse.tx-.5)*d*-600)+"px,"+((mouse.ty-.5)*d*-400)+"px,0)"; });
        if(reduce===false && raf==null) drawFrame(0,true);
      } else drawFrame(0,true);
    });
    hero.addEventListener("pointerleave",function(){mouse.px=-999;mouse.py=-999; if(reduce) drawFrame(0,true);});
    if(!reduce) window.addEventListener("scroll",function(){
      var y=window.scrollY; if(y>window.innerHeight) return;
      var art=$(".hero-art"); if(art) art.style.translate="0 "+(y*.25)+"px";
      var inner=$(".hero-inner"); if(inner){ inner.style.translate="0 "+(y*.12)+"px"; inner.style.opacity=String(Math.max(0,1-y/(window.innerHeight*.8))); }
    },{passive:true});
  }
  function fmt(v){ var s=v<0?"−":"+"; v=Math.abs(v); var a=v.toFixed(3); while(a.length<7) a="0"+a; return s+a; }

  /* ---------- card spotlight ---------- */
  $$(".mod,.glass").forEach(function(c){
    c.addEventListener("pointermove",function(e){ var r=c.getBoundingClientRect(); c.style.setProperty("--mx",(e.clientX-r.left)+"px"); c.style.setProperty("--my",(e.clientY-r.top)+"px"); });
  });

  /* ---------- CMM scan demo (illustrative values) ---------- */
  var pts=[
    {f:"Datum A edge",x:80,y:150,n:"0.000",d:0.004},{f:"Top edge P1",x:200,y:90,n:"0.000",d:-0.006},{f:"Top edge P2",x:330,y:90,n:"0.000",d:0.009},
    {f:"Chamfer P1",x:500,y:140,n:"0.000",d:0.012},{f:"Chamfer P2",x:545,y:185,n:"0.000",d:0.027},{f:"Right face",x:572,y:280,n:"0.000",d:-0.003},
    {f:"Bottom P1",x:450,y:350,n:"0.000",d:0.002},{f:"Bottom P2",x:200,y:350,n:"0.000",d:-0.011},
    {f:"Bore Ø92 N",x:190,y:174,n:"92.000",d:0.008},{f:"Bore Ø92 E",x:236,y:220,n:"92.000",d:0.014},{f:"Bore Ø92 S",x:190,y:266,n:"92.000",d:0.006},{f:"Bore Ø92 W",x:144,y:220,n:"92.000",d:-0.004},
    {f:"Bore Ø60 N",x:360,y:190,n:"60.000",d:-0.009},{f:"Bore Ø60 E",x:390,y:220,n:"60.000",d:-0.024},{f:"Bore Ø60 S",x:360,y:250,n:"60.000",d:-0.013},
    {f:"Pocket depth",x:485,y:280,n:"12.500",d:0.005}
  ];
  var TOL=0.020, svgNS="http://www.w3.org/2000/svg";
  var gPts=$("#scanPts"), probe=$("#probe"), trail=$("#scanTrail"), tip=$("#scanTip"), readout=$("#readout");
  var mPts=$("#mPts"), mOk=$("#mOk"), mBad=$("#mBad"), state=$("#scanState"), ncr=$("#ncrCard"), ncrText=$("#ncrText"), runBtn=$("#scanRun");
  var idx=0, timer=null, running=false, okN=0, badN=0, trailD="", pos={x:80,y:40};
  function actual(p){ return (parseFloat(p.n)+p.d).toFixed(3); }
  function devStr(d){ return (d>=0?"+":"−")+Math.abs(d).toFixed(3); }
  function color(d){ var a=Math.abs(d); return a>TOL?"#FF2A6D":a>TOL*.6?"#FFB703":"#00FF9D"; }
  function resetScan(){
    clearTimeout(timer); running=false; idx=0; okN=0; badN=0; trailD="";
    gPts.innerHTML=""; trail.setAttribute("d",""); $$(".ro-row:not(.ro-head)",readout).forEach(function(r){r.remove()});
    ncr.hidden=true; tip.hidden=true; moveProbe(80,40,0); update(); state.textContent="Idle"; state.classList.remove("on"); runBtn.textContent="▶ Run scan";
  }
  function update(){ mPts.textContent=idx+" / "+pts.length; mOk.textContent=okN; mBad.textContent=badN; }
  function moveProbe(x,y,ms){
    if(reduce||!ms){ probe.setAttribute("transform","translate("+x+" "+y+")"); pos={x:x,y:y}; return Promise.resolve(); }
    var sx=pos.x, sy=pos.y, t0=performance.now();
    return new Promise(function(res){
      (function step(now){ var k=Math.min(1,(now-t0)/ms), e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
        var cx=sx+(x-sx)*e, cy=sy+(y-sy)*e; probe.setAttribute("transform","translate("+cx+" "+cy+")");
        if(k<1) requestAnimationFrame(step); else { pos={x:x,y:y}; res(); } })(t0);
    });
  }
  function addPoint(p,i){
    var c=color(p.d);
    var ring=document.createElementNS(svgNS,"circle"); ring.setAttribute("cx",p.x); ring.setAttribute("cy",p.y); ring.setAttribute("r",12); ring.setAttribute("class","spt-ring"); ring.setAttribute("stroke",c);
    var dot=document.createElementNS(svgNS,"circle"); dot.setAttribute("cx",p.x); dot.setAttribute("cy",p.y); dot.setAttribute("r",6); dot.setAttribute("fill",c); dot.setAttribute("class","spt");
    dot.setAttribute("tabindex","0"); dot.setAttribute("role","button"); dot.setAttribute("aria-label",p.f+": deviation "+devStr(p.d)+" millimeters (illustrative)");
    dot.style.filter="drop-shadow(0 0 6px "+c+")";
    function show(){ var box=$(".scan-viz").getBoundingClientRect(), svg=$("#scanSvg").getBoundingClientRect(), s=svg.width/640;
      tip.innerHTML="<b>"+p.f+"</b><br>Nominal "+p.n+"<br>Actual "+actual(p)+"<br>Dev <span style='color:"+c+"'>"+devStr(p.d)+"</span> · Tol ±"+TOL.toFixed(3)+"<br><span style='color:#FFB703'>Illustrative</span>";
      tip.style.left=(svg.left-box.left+p.x*s)+"px"; tip.style.top=(svg.top-box.top+p.y*s)+"px"; tip.hidden=false; }
    function hide(){ tip.hidden=true; }
    dot.addEventListener("pointerenter",show); dot.addEventListener("pointerleave",hide); dot.addEventListener("focus",show); dot.addEventListener("blur",hide); dot.addEventListener("click",show);
    gPts.appendChild(ring); gPts.appendChild(dot);
    if(!reduce && ring.animate) ring.animate([{r:6,opacity:1},{r:22,opacity:0}],{duration:900,easing:"ease-out"});
    var out=Math.abs(p.d)>TOL; if(out) badN++; else okN++;
    var row=document.createElement("div"); row.className="ro-row"+(out?" o":"");
    row.innerHTML="<span>"+p.f+"</span><span>"+p.n+"</span><span>"+actual(p)+"</span><span style='color:"+c+"'>"+devStr(p.d)+"</span>";
    readout.appendChild(row); readout.scrollTop=readout.scrollHeight;
    if(out){ ncr.hidden=false; ncrText.textContent=p.f+" is "+devStr(p.d)+" mm against ±"+TOL.toFixed(3)+" mm. In AccuQual, this becomes an issue with the readings attached. (Illustrative)"; }
    update();
  }
  function stepScan(){
    if(!running) return;
    if(idx>=pts.length){ running=false; state.textContent="Complete"; state.classList.remove("on"); runBtn.textContent="↻ Run again"; moveProbe(80,40,600); return; }
    var p=pts[idx];
    moveProbe(p.x,p.y-10,420).then(function(){ return moveProbe(p.x,p.y,160); }).then(function(){
      if(!running) return;
      trailD+=(trailD?" L":"M")+p.x+" "+p.y; trail.setAttribute("d",trailD);
      addPoint(p,idx); idx++;
      timer=setTimeout(stepScan, reduce?120:220);
    });
  }
  if(runBtn){
    runBtn.addEventListener("click",function(){
      if(running){ running=false; clearTimeout(timer); state.textContent="Paused"; state.classList.remove("on"); runBtn.textContent="▶ Resume"; return; }
      if(idx>=pts.length) resetScan();
      running=true; state.textContent="Scanning"; state.classList.add("on"); runBtn.textContent="❚❚ Pause"; stepScan();
    });
    $("#scanReset").addEventListener("click",resetScan);
    resetScan();
    // autoplay once when scrolled into view
    if("IntersectionObserver" in window){
      var so=new IntersectionObserver(function(e){ if(e[0].isIntersecting){ so.disconnect(); if(!running&&idx===0) runBtn.click(); } },{threshold:.45});
      so.observe($(".scan-stage"));
    }
  }


  /* ---- manual probing: drag the probe onto edges/bores (illustrative) ---- */
  (function(){
    var svg=$("#scanSvg"), viz=$(".scan-viz"), hint=$("#dragHint"); if(!svg||!probe) return;
    var cands=[], taken=[], path=$("#partPath"), L=path.getTotalLength();
    for(var s=0;s<L;s+=3){ var q=path.getPointAtLength(s), f;
      if(q.y<=92) f="Top edge"; else if(q.x<=82) f="Left edge (Datum A)"; else if(q.y>=348) f="Bottom edge"; else if(q.x>=570) f="Right face"; else f="Chamfer";
      cands.push({x:q.x,y:q.y,f:f,n:"0.000"}); }
    [[190,220,46,"Bore Ø92","92.000"],[360,220,30,"Bore Ø60","60.000"]].forEach(function(b){ for(var a=0;a<360;a+=4){ var r=a*Math.PI/180; cands.push({x:b[0]+b[2]*Math.cos(r),y:b[1]+b[2]*Math.sin(r),f:b[3],n:b[4]}); } });
    for(var x=450;x<=520;x+=4){ cands.push({x:x,y:250,f:"Pocket wall",n:"0.000"}); cands.push({x:x,y:310,f:"Pocket wall",n:"0.000"}); }
    for(var y=260;y<=300;y+=4){ cands.push({x:440,y:y,f:"Pocket wall",n:"0.000"}); cands.push({x:530,y:y,f:"Pocket wall",n:"0.000"}); }
    function hash(x,y){ var h=Math.sin(x*12.9898+y*78.233)*43758.5453; return h-Math.floor(h); }
    function toSvg(e){ var p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
    var dragging=false, pid=null, manualN=0;
    probe.addEventListener("pointerdown",function(e){
      dragging=true; pid=e.pointerId; probe.setPointerCapture(pid); viz.classList.add("dragging"); if(hint) hint.hidden=true;
      if(running){ running=false; clearTimeout(timer); state.textContent="Manual"; runBtn.textContent="▶ Resume"; }
      else state.textContent="Manual"; state.classList.add("on"); e.preventDefault();
    });
    probe.addEventListener("pointermove",function(e){
      if(!dragging||e.pointerId!==pid) return; var p=toSvg(e);
      var x=Math.max(20,Math.min(620,p.x)), y=Math.max(20,Math.min(400,p.y));
      probe.setAttribute("transform","translate("+x+" "+y+")"); pos={x:x,y:y};
      var best=null,bd=1e9; for(var i=0;i<cands.length;i++){ var c=cands[i], d=(c.x-x)*(c.x-x)+(c.y-y)*(c.y-y); if(d<bd){bd=d;best=c;} }
      if(best && bd<36){
        for(var j=0;j<taken.length;j++){ if(Math.hypot(taken[j].x-best.x,taken[j].y-best.y)<22) return; }
        taken.push(best); manualN++;
        var r=hash(best.x,best.y), dev=(r-.5)*0.05; dev=Math.round(dev*1000)/1000;
        var pt={f:best.f+" · M"+manualN,x:Math.round(best.x),y:Math.round(best.y),n:best.n,d:dev};
        addPoint(pt); idx=Math.min(idx,pts.length); mPts.textContent=(okN+badN)+" pts";
        probe.setAttribute("aria-valuetext",pt.f+" deviation "+devStr(dev)+" mm, illustrative");
        if(window.AQFX){ var sp=svg.getBoundingClientRect(), k=sp.width/640; window.AQFX.burst(sp.left+best.x*k,sp.top+best.y*k,color(dev),14); }
      }
    });
    function end(e){ if(!dragging||e.pointerId!==pid) return; dragging=false; viz.classList.remove("dragging"); }
    probe.addEventListener("pointerup",end); probe.addEventListener("pointercancel",end);
    // keyboard: arrows nudge probe
    probe.addEventListener("keydown",function(e){ var m={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]}[e.key]; if(!m) return; e.preventDefault();
      var fake={pointerId:"kb",clientX:0,clientY:0}; dragging=true; pid="kb";
      var x=pos.x+m[0], y=pos.y+m[1], sc=svg.getScreenCTM(); fake.clientX=sc.a*x+sc.e; fake.clientY=sc.d*y+sc.f;
      probe.dispatchEvent(Object.assign(new Event("pointermove"),{pointerId:"kb",clientX:fake.clientX,clientY:fake.clientY})); dragging=false; });
    $("#scanReset").addEventListener("click",function(){ taken=[]; manualN=0; if(hint) hint.hidden=false; });
  })();

  /* ---------- tab helper ---------- */
  function tabs(container, attr, onSel){
    var btns=$$("button",container);
    btns.forEach(function(b,i){
      b.addEventListener("click",function(){ sel(i); });
      b.addEventListener("keydown",function(e){ var k=e.key; if(k==="ArrowRight"||k==="ArrowLeft"){ e.preventDefault(); var n=(i+(k==="ArrowRight"?1:-1)+btns.length)%btns.length; sel(n); btns[n].focus(); } });
    });
    function sel(i){ btns.forEach(function(b,j){ b.setAttribute("aria-selected",String(i===j)); b.tabIndex=i===j?0:-1; }); onSel(i); }
    sel(0);
  }

  /* ---------- plant switcher (illustrative) ---------- */
  var plantData=[{i:7,f:4,g:12,d:3},{i:3,f:2,g:5,d:6},{i:11,f:7,g:9,d:1}];
  var ps=$("#plants .plant-switch");
  if(ps) tabs(ps,"data-plant",function(i){
    $$("#plantStats strong").forEach(function(el){
      var v=plantData[i][el.dataset.k]; if(window.AQCount) window.AQCount(el,v); else el.textContent=v;
    });
  });

  /* ---------- role-aware home (illustrative) ---------- */
  var roleData=[
    [["pill bad","Issue","Fix overdue: burr on bore edge","9 days"],["pill amb","Doc","Control plan waiting on your approval","3 days"],["pill amb","Gauge","2 gauges go overdue this week","Due Fri"],["pill bad","Supplier","Supplier response past due","5 days"]],
    [["pill bad","Issue","Suspect parts on Line 2 need a disposition","Today"],["pill amb","Training","3 people not yet trained on WI rev C","Due Mon"],["pill cy","Audit","Layered audit for Line 2 scheduled","Thu"],["pill amb","Fix","Containment check waiting on you","2 days"]],
    [["pill amb","Training","Read and sign: Assembly WI rev C","New"],["pill cy","Task","Record first-piece check, Job 1043","Today"],["pill ok","Gauge","Your caliper is current","OK"],["pill cy","Issue","Add a photo to the issue you logged","1 day"]]
  ];
  var rs=$("#roles .plant-switch"), stuck=$("#stuckList");
  if(rs) tabs(rs,"data-role",function(i){
    stuck.innerHTML=roleData[i].map(function(r,j){ return "<li style='animation-delay:"+(j*60)+"ms'><span><span class='"+r[0]+"'>"+r[1]+"</span>"+r[2]+"</span><span class='age'>"+r[3]+"</span></li>"; }).join("");
  });

  /* ---------- loop ---------- */
  var steps=[
    ["Issue","Someone spots a problem: a bad part, a customer complaint, an audit finding. It’s logged in seconds with photos, quantities, and where it happened."],
    ["Contain","Stop the bleeding first. Quarantine suspect stock, sort, and record what was checked so nothing bad ships while you dig in."],
    ["Fix","Find the real root cause, not the first guess. Assign corrective actions with owners and due dates, in CAPA or full 8D format."],
    ["Verify","Prove it worked. Follow-up checks confirm the fix held before the issue can close."],
    ["Document","Update the work instruction, control plan, or drawing. The change goes through review and approval, and the old revision is pulled."],
    ["Train","Everyone who uses the changed document is assigned the update, and you can see who’s done and who isn’t."]
  ];
  var nodes=$("#loopNodes"), arc=$("#loopArc"), cur=0, loopTimer=null, C=2*Math.PI*150;
  if(nodes){
    steps.forEach(function(s,i){
      var a=(-90+i*60)*Math.PI/180, x=50+37.5*Math.cos(a), y=50+37.5*Math.sin(a);
      var b=document.createElement("button"); b.type="button"; b.className="loop-node"; b.setAttribute("role","tab");
      b.style.left=x+"%"; b.style.top=y+"%"; b.innerHTML="<small>0"+(i+1)+"</small>"+s[0];
      b.addEventListener("click",function(){ setStep(i); stopAuto(); });
      nodes.appendChild(b);
    });
    var nbtns=$$(".loop-node",nodes);
    function setStep(i){
      cur=i; nbtns.forEach(function(b,j){ b.setAttribute("aria-selected",String(i===j)); b.classList.toggle("done",j<i); });
      $("#loopNo").textContent="0"+(i+1)+" / 06"; $("#loopTitle").textContent=steps[i][0]; $("#loopText").textContent=steps[i][1];
      arc.setAttribute("stroke-dasharray",C.toFixed(1)); arc.setAttribute("stroke-dashoffset",(C*(1-(i+1)/6)).toFixed(1));
    }
    function stopAuto(){ clearInterval(loopTimer); loopTimer=null; }
    setStep(0);
    if(!reduce && "IntersectionObserver" in window){
      new IntersectionObserver(function(e){
        if(e[0].isIntersecting){ if(!loopTimer && !nodes.dataset.stopped) loopTimer=setInterval(function(){ setStep((cur+1)%6); },2800); }
        else stopAuto();
      },{threshold:.4}).observe($("#loopRing"));
      nodes.addEventListener("click",function(){ nodes.dataset.stopped="1"; });
    }
  }

  /* ---------- gallery: gentle tilt + expand-to-lightbox ---------- */
  var lb=$("#lightbox"), lbImg=lb&&$("img",lb), lastFocus=null;
  var fineHover=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  $$(".gx").forEach(function(f){
    var stage=$(".gx-stage",f);
    if(stage) f.addEventListener("pointermove",function(e){
      var r=stage.getBoundingClientRect(), px=(e.clientX-r.left)/r.width, py=(e.clientY-r.top)/r.height;
      stage.style.setProperty("--gx",(px*100)+"%"); stage.style.setProperty("--gy",(py*100)+"%");
      // toned-down tilt: mouse only, off while dragging, off for the probe playground
      if(reduce || !fineHover || e.pointerType!=="mouse" || !f.classList.contains("tilt") || f.classList.contains("gx-busy")){ return; }
      var fr=f.getBoundingClientRect(), qx=(e.clientX-fr.left)/fr.width, qy=(e.clientY-fr.top)/fr.height;
      f.style.transform="rotateY("+((qx-.5)*3)+"deg) rotateX("+((.5-qy)*2.4)+"deg)";
    });
    f.addEventListener("pointerleave",function(){ f.style.transform=""; });
  });
  function openLb(src,alt,from){ if(!lb) return; lastFocus=from; lbImg.src=src; lbImg.alt=alt||""; lb.hidden=false; $(".lb-close",lb).focus(); document.body.style.overflow="hidden"; }
  $$(".gx-expand").forEach(function(b){
    b.addEventListener("pointerdown",function(e){ e.stopPropagation(); });
    b.addEventListener("click",function(e){ e.stopPropagation(); openLb(b.dataset.src,b.dataset.alt,b); });
  });
  window.AQLightbox=openLb;
  function closeLb(){ lb.hidden=true; document.body.style.overflow=""; if(lastFocus) lastFocus.focus(); }
  if(lb){
    lb.addEventListener("click",function(e){ if(e.target!==lbImg) closeLb(); });
    document.addEventListener("keydown",function(e){ if(e.key==="Escape"&&!lb.hidden) closeLb(); });
  }

  /* ---------- early access form: posts to the AccuQual API's public /contact endpoint ---------- */
  /* config.js (generated at build time from the app's VITE_API_BASE_URL) says where the API lives. */
  var API=typeof window.AQ_API==="string"?window.AQ_API:"/api";
  var form=$("#eaForm");
  if(form) form.addEventListener("submit",function(e){
    e.preventDefault();
    var email=$("#eaEmail"), err=$("#eaErr"), v=email.value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)){ err.textContent="Please enter a valid work email."; email.setAttribute("aria-invalid","true"); email.focus(); return; }
    email.removeAttribute("aria-invalid"); err.textContent="";
    var name=$("#eaName").value.trim(), company=$("#eaCo").value.trim();
    var btn=form.querySelector("button[type=submit]"); btn.disabled=true;
    fetch(API.replace(/\/$/,"")+"/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name||undefined,email:v,company:company,website:($("#eaWebsite")||{}).value||""})})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(b){ if(!r.ok) throw new Error(b.message||"We couldn't send that. Please try again."); }); })
      .then(function(){
        $("#eaThanksName").textContent=name?", "+name:""; $("#eaThanksEmail").textContent=v;
        var sb=btn.getBoundingClientRect(); if(window.AQFX) window.AQFX.burst(sb.left+sb.width/2,sb.top+sb.height/2,"#00FF9D",50);
        form.hidden=true; var t=$("#eaThanks"); t.hidden=false; t.focus();
      })
      .catch(function(ex){ err.textContent=ex.message||"We couldn't send that. Please try again."; btn.disabled=false; });
  });
})();
