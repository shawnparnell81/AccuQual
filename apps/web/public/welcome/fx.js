/* AccuQual QMS landing: effects + drag-and-drop triage board. Vanilla JS, Pointer Events. */
(function(){
  "use strict";
  var reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  var $=function(s,c){return (c||document).querySelector(s)}, $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};

  /* ---------- hero entrance ---------- */
  requestAnimationFrame(function(){ document.body.classList.add("loaded"); });

  /* ---------- FX canvas: bursts, confetti, cursor trail ---------- */
  var fx=$("#fx"), fctx=fx.getContext("2d"), parts=[], fxRun=false, DPR=Math.min(window.devicePixelRatio||1,2);
  function fxSize(){ fx.width=innerWidth*DPR; fx.height=innerHeight*DPR; fctx.setTransform(DPR,0,0,DPR,0,0); }
  fxSize(); addEventListener("resize",fxSize);
  function fxTick(){
    fctx.clearRect(0,0,innerWidth,innerHeight);
    for(var i=parts.length-1;i>=0;i--){
      var p=parts[i]; p.life-=p.decay; if(p.life<=0){ parts.splice(i,1); continue; }
      p.vx*=p.drag; p.vy=p.vy*p.drag+p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr;
      fctx.globalAlpha=Math.max(0,Math.min(1,p.life));
      fctx.fillStyle=p.c;
      if(p.kind==="conf"){ fctx.save(); fctx.translate(p.x,p.y); fctx.rotate(p.rot); fctx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); fctx.restore(); }
      else { fctx.shadowBlur=p.kind==="spark"?12:0; fctx.shadowColor=p.c; fctx.beginPath(); fctx.arc(p.x,p.y,p.s*p.life,0,6.283); fctx.fill(); fctx.shadowBlur=0; }
    }
    fctx.globalAlpha=1;
    if(parts.length){ requestAnimationFrame(fxTick); } else { fxRun=false; fctx.clearRect(0,0,innerWidth,innerHeight); }
  }
  function kick(){ if(!fxRun){ fxRun=true; requestAnimationFrame(fxTick); } }
  var COLORS=["#00F3FF","#A855F7","#00FF9D","#FFB703","#FF2A6D","#ffffff"];
  function burst(x,y,color,n){
    if(reduce) return; n=n||26;
    for(var i=0;i<n;i++){ var a=Math.random()*6.283, v=2+Math.random()*5;
      parts.push({kind:"spark",x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:.06,drag:.92,s:1.5+Math.random()*2.5,life:1,decay:.02+Math.random()*.02,rot:0,vr:0,c:Math.random()<.6?color:"#ffffff"}); }
    kick();
  }
  function confetti(){
    if(reduce) return;
    for(var i=0;i<220;i++){ var fromLeft=i%2===0;
      parts.push({kind:"conf",x:fromLeft?-10:innerWidth+10,y:innerHeight*(.55+Math.random()*.4),vx:(fromLeft?1:-1)*(6+Math.random()*10),vy:-(9+Math.random()*11),g:.28,drag:.985,s:7+Math.random()*7,life:1.6,decay:.006+Math.random()*.006,rot:Math.random()*6,vr:(Math.random()-.5)*.4,c:COLORS[i%COLORS.length]}); }
    kick();
  }
  window.AQFX={burst:burst,confetti:confetti};

  /* cursor glow + trail (desktop only) */
  var glow=$("#cursorGlow");
  if(fine && !reduce){
    var gx=innerWidth/2, gy=innerHeight/2, tx=gx, ty=gy, lastT=0, gRun=false;
    addEventListener("pointermove",function(e){
      if(e.pointerType!=="mouse") return;
      tx=e.clientX; ty=e.clientY; glow.classList.add("on");
      if(!gRun){ gRun=true; requestAnimationFrame(gTick); }
      var now=performance.now();
      if(now-lastT>28 && !document.body.classList.contains("dnd-active")){ lastT=now;
        parts.push({kind:"dot",x:tx,y:ty,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,g:0,drag:.96,s:2.2,life:1,decay:.045,rot:0,vr:0,c:Math.random()<.5?"#00F3FF":"#A855F7"}); kick(); }
    },{passive:true});
    document.addEventListener("pointerleave",function(){ glow.classList.remove("on"); });
    function gTick(){ gx+=(tx-gx)*.14; gy+=(ty-gy)*.14; glow.style.transform="translate3d("+gx+"px,"+gy+"px,0)";
      if(Math.abs(tx-gx)+Math.abs(ty-gy)>.5) requestAnimationFrame(gTick); else gRun=false; }
  }

  /* magnetic buttons */
  if(fine && !reduce) $$(".hero .btn, .pricing .btn-primary, .nav .btn").forEach(function(b){
    b.classList.add("mag");
    b.addEventListener("pointermove",function(e){ var r=b.getBoundingClientRect(); var x=e.clientX-r.left-r.width/2, y=e.clientY-r.top-r.height/2; b.style.transform="translate("+(x*.28)+"px,"+(y*.4)+"px)"; });
    b.addEventListener("pointerleave",function(){ b.style.transform=""; });
  });

  /* scroll progress + story word highlight */
  var prog=$("#scrollProg"), big=$(".story .big"), words=[];
  if(big && !reduce){
    // wrap words, keep <br> and span.muted structure
    (function wrap(node){
      $$(":scope > *",node).forEach(wrap);
      Array.prototype.slice.call(node.childNodes).forEach(function(n){
        if(n.nodeType===3 && n.textContent.trim()){ var frag=document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function(t){ if(!t) return; if(/^\s+$/.test(t)) frag.appendChild(document.createTextNode(t)); else { var s=document.createElement("span"); s.className="w"; s.textContent=t; frag.appendChild(s); } });
          node.replaceChild(frag,n); }
      });
    })(big);
    words=$$(".w",big);
  }
  var ticking=false;
  function onScroll(){ if(ticking) return; ticking=true; requestAnimationFrame(function(){
    ticking=false; var max=document.documentElement.scrollHeight-innerHeight; prog.style.transform="scaleX("+(max>0?scrollY/max:0)+")";
    if(words.length){ var r=big.getBoundingClientRect(); var k=(innerHeight*.85-r.top)/(innerHeight*.5); k=Math.max(0,Math.min(1,k)); var n=Math.round(k*words.length);
      for(var i=0;i<words.length;i++) words[i].classList.toggle("lit",i<n); }
  }); }
  addEventListener("scroll",onScroll,{passive:true}); onScroll();

  /* subtle 3D tilt on module cards */
  if(fine && !reduce) $$(".mod").forEach(function(c){
    c.addEventListener("pointermove",function(e){ var r=c.getBoundingClientRect(), px=(e.clientX-r.left)/r.width-.5, py=(e.clientY-r.top)/r.height-.5;
      c.style.transform="perspective(1000px) rotateX("+(-py*5)+"deg) rotateY("+(px*6)+"deg) translateY(-6px)"; });
    c.addEventListener("pointerleave",function(){ c.style.transform=""; });
  });

  /* animated counters for illustrative plant stats */
  window.AQCount=function(el,to){
    var from=parseInt(el.textContent,10)||0; if(reduce||from===to){ el.textContent=to; return; }
    var t0=performance.now(), d=700; (function s(now){ var k=Math.min(1,(now-t0)/d), e=1-Math.pow(1-k,3); el.textContent=Math.round(from+(to-from)*e); if(k<1) requestAnimationFrame(s); })(t0);
  };

  /* =================== TRIAGE BOARD =================== */
  var board=$("#board"); if(!board) return;
  var STAGES=["inbox","open","contain","fix","verify","closed"];
  var SLABEL={inbox:"Floor inbox",open:"Open",contain:"Contain",fix:"Fix",verify:"Verify",closed:"Closed"};
  var CARDS=[
    {id:"NCR-0142",type:"Issue (NCR)",c:"#FF2A6D",t:"Bore Ø60 undersize on 14 brackets",av:"QT",
     owner:{inbox:"Unassigned",open:"Quality tech",contain:"Line 2 supervisor",fix:"Mfg engineer",verify:"Quality engineer",closed:"Quality manager"},
     next:{inbox:"Log it: photos, qty, where found",open:"Assign an owner and severity",contain:"Quarantine lot, 100% sort WIP",fix:"Root cause the undersize bore",verify:"Re-measure next 3 lots on CMM",closed:"Closed. Trail saved to history"}},
    {id:"CAPA-031",type:"Fix (CAPA / 8D)",c:"#A855F7",t:"Worn boring insert, no change interval",av:"ME",
     owner:{inbox:"Unassigned",open:"Quality engineer",contain:"Team lead",fix:"Mfg engineer",verify:"Quality engineer",closed:"Quality manager"},
     next:{inbox:"Open a fix from NCR-0142",open:"Form the team (D1-D2)",contain:"Confirm containment holds (D3)",fix:"5-why + set insert change interval (D4-D6)",verify:"Check 30 days of data (D7)",closed:"Recognize the team (D8)"}},
    {id:"WI-207 Rev D",type:"Document revision",c:"#00F0FF",t:"Add tool-change interval to the WI",av:"DC",
     owner:{inbox:"Unassigned",open:"Doc control",contain:"Doc control",fix:"Mfg engineer",verify:"Approver",closed:"Doc control"},
     next:{inbox:"Start revision from CAPA-031",open:"Draft Rev D redline",contain:"Hold Rev C at the machine",fix:"Write the change and reason",verify:"Review and approve Rev D",closed:"Rev D released, Rev C pulled"}},
    {id:"TRN-088",type:"Training assignment",c:"#00FF9D",t:"Train 2nd shift on WI-207 Rev D",av:"TR",
     owner:{inbox:"Unassigned",open:"Training coord.",contain:"Shift supervisor",fix:"Trainer",verify:"Shift supervisor",closed:"Training coord."},
     next:{inbox:"Auto-assigned when Rev D releases",open:"Pick who needs it",contain:"Brief the shift at start-up",fix:"Run the session, sign off",verify:"Observe one tool change",closed:"Everyone signed off"}},
    {id:"AUD-F12",type:"Audit finding",c:"#FFB703",t:"Bore gauge missing calibration label",av:"IA",
     owner:{inbox:"Unassigned",open:"Internal auditor",contain:"Metrology tech",fix:"Metrology tech",verify:"Internal auditor",closed:"Quality manager"},
     next:{inbox:"Record the finding",open:"Link it to the gauge record",contain:"Tag gauge out of service",fix:"Recalibrate and relabel",verify:"Spot-check gauges on Line 2",closed:"Finding closed"}}
  ];
  var DUE={inbox:"–",open:"Today",contain:"Today",fix:"+5 days",verify:"+14 days",closed:"Done"};
  var zones={}; $$(".dz",board).forEach(function(z){ zones[z.dataset.stage]=z; });
  var live=$("#triLive"), strip=$("#strip");

  function cardEl(d){
    var el=document.createElement("div"); el.className="card"; el.tabIndex=0; el.dataset.id=d.id; el.style.setProperty("--c",d.c);
    el.setAttribute("role","button"); el.setAttribute("aria-roledescription","draggable card"); el.setAttribute("aria-describedby","triHelp");
    el.innerHTML="<div class='ct'><span>"+d.type+"</span><span class='cid'>"+d.id+"</span></div><h4>"+d.t+"</h4><div class='cm'><span class='av' aria-hidden='true'>"+d.av+"</span><span class='ow'></span><span class='st'></span></div>";
    return el;
  }
  function dataOf(el){ for(var i=0;i<CARDS.length;i++) if(CARDS[i].id===el.dataset.id) return CARDS[i]; }
  function stageOf(el){ return el.parentElement && el.parentElement.dataset.stage; }
  function refreshCard(el){ var d=dataOf(el), s=stageOf(el); $(".ow",el).textContent=d.owner[s]; $(".st",el).textContent=SLABEL[s]; el.classList.toggle("done",s==="closed");
    el.setAttribute("aria-label",d.type+" "+d.id+": "+d.t+". Stage: "+SLABEL[s]+". Owner: "+d.owner[s]+"."); }
  function counts(){
    $$(".col",board).forEach(function(c){ $(".cnt",c).textContent=$$(".card:not(.ghost)",$(".dz",c)).length; });
    var closed=$$(".card",zones.closed).length; $("#triBar").style.width=(closed/5*100)+"%"; $("#triCount").textContent=closed+" / 5 closed";
    return closed;
  }
  function setStrip(el){
    var d=dataOf(el), s=stageOf(el);
    $("#ssCard").textContent=d.id+" · "+d.t; $("#ssStage").textContent=SLABEL[s]; $("#ssOwner").textContent=d.owner[s]+" (sample)";
    $("#ssDue").textContent=DUE[s]; $("#ssNext").textContent=d.next[s];
    strip.classList.remove("flash"); void strip.offsetWidth; strip.classList.add("flash");
  }
  var celebrated=false;
  function afterDrop(el,fromStage){
    refreshCard(el); setStrip(el); var closed=counts();
    var s=stageOf(el); live.textContent=dataOf(el).id+" moved to "+SLABEL[s]+". Next action: "+dataOf(el).next[s]+".";
    var r=el.getBoundingClientRect(); burst(r.left+r.width/2,r.top+r.height/2,s==="closed"?"#00FF9D":dataOf(el).c, s==="closed"?40:26);
    if(closed===5 && !celebrated){ celebrated=true; setTimeout(function(){ confetti(); var ld=$("#loopDone"); ld.hidden=false; setTimeout(function(){ var b=$("#triAgain"); if(b) b.focus({preventScroll:true}); },50); live.textContent="All five cards closed. Loop closed!"; },250); }
    if(closed<5 && celebrated){ celebrated=false; $("#loopDone").hidden=true; }
  }
  function reset(){
    $$(".card",board).forEach(function(c){c.remove()});
    CARDS.forEach(function(d){ var el=cardEl(d); zones.inbox.appendChild(el); refreshCard(el); bindCard(el); });
    celebrated=false; $("#loopDone").hidden=true; counts();
    $("#ssCard").textContent="Pick up a card to start"; ["#ssStage","#ssOwner","#ssDue","#ssNext"].forEach(function(s){ $(s).textContent="–"; });
  }

  /* FLIP helper: animate elements from old rects to new ones with a spring-ish ease */
  function flip(els,fn){
    var first=els.map(function(e){ return e.getBoundingClientRect(); }); fn();
    if(reduce) return;
    els.forEach(function(e,i){ var l=e.getBoundingClientRect(), dx=first[i].left-l.left, dy=first[i].top-l.top;
      if((dx||dy) && e.animate) e.animate([{transform:"translate("+dx+"px,"+dy+"px)"},{transform:"none"}],{duration:380,easing:"cubic-bezier(.34,1.56,.64,1)"}); });
  }

  /* ---- pointer drag ---- */
  var drag=null;
  function bindCard(el){
    el.addEventListener("pointerdown",onDown);
    el.addEventListener("keydown",onKey);
    el.addEventListener("blur",function(){ if(kb && kb.el===el && !kbMoving) setTimeout(function(){ if(kb && kb.el===el && document.activeElement!==el) dropKb(true); },0); });
  }
  function onDown(e){
    if(e.button!==0 || drag) return;
    var el=e.currentTarget; if(kb) dropKb(false);
    drag={el:el,id:e.pointerId,sx:e.clientX,sy:e.clientY,started:false,from:el.parentElement,next:el.nextSibling,lx:e.clientX,vx:0};
    window.addEventListener("pointermove",onMove,{passive:false}); window.addEventListener("pointerup",onUp); window.addEventListener("pointercancel",onCancel);
  }
  function start(e){
    var el=drag.el, r=el.getBoundingClientRect();
    drag.started=true; drag.ox=e.clientX-r.left; drag.oy=e.clientY-r.top;
    var g=el.cloneNode(true); g.classList.add("ghost"); g.removeAttribute("tabindex"); g.setAttribute("aria-hidden","true");
    g.style.width=r.width+"px"; g.style.height=r.height+"px"; document.body.appendChild(g); drag.ghost=g;
    el.classList.add("placeholder"); board.classList.add("is-dragging"); document.body.classList.add("dnd-active");
    placeGhost(e.clientX,e.clientY,0,1.06);
    if(g.animate && !reduce) g.animate([{transform:"translate("+r.left+"px,"+r.top+"px) scale(1)"},{transform:"translate("+r.left+"px,"+r.top+"px) scale(1.06) rotate(-2deg)"}],{duration:160});
  }
  function placeGhost(x,y,rot,sc){ drag.ghost.style.transform="translate("+(x-drag.ox)+"px,"+(y-drag.oy)+"px) rotate("+rot+"deg) scale("+sc+")"; }
  var overZone=null;
  function onMove(e){
    if(!drag || e.pointerId!==drag.id) return;
    if(!drag.started){ if(Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)<5) return; start(e); }
    e.preventDefault();
    drag.vx=drag.vx*.7+(e.clientX-drag.lx)*.3; drag.lx=e.clientX;
    placeGhost(e.clientX,e.clientY,reduce?0:Math.max(-12,Math.min(12,drag.vx*.9)),1.06);
    var hit=document.elementFromPoint(e.clientX,e.clientY), z=hit&&hit.closest&&hit.closest(".dz");
    if(!z && hit && hit.closest){ var col=hit.closest(".col"); if(col) z=$(".dz",col); }
    if(z!==overZone){ if(overZone) overZone.classList.remove("over"); overZone=z; if(z) z.classList.add("over"); }
    if(z){ // live reposition placeholder
      var sibs=$$(".card:not(.placeholder)",z), before=null;
      for(var i=0;i<sibs.length;i++){ var r=sibs[i].getBoundingClientRect(); if(e.clientY<r.top+r.height/2){ before=sibs[i]; break; } }
      if(drag.el.parentElement!==z || drag.el.nextSibling!==before){ var moved=$$(".card:not(.placeholder)",board); flip(moved,function(){ z.insertBefore(drag.el,before); }); counts(); }
    }
    // autoscroll near edges (touch / small screens)
    var edge=70; if(e.clientY<edge) scrollBy(0,-12); else if(e.clientY>innerHeight-edge) scrollBy(0,12);
  }
  function finish(ok){
    var el=drag.el, g=drag.ghost, fromStage=drag.from.dataset.stage;
    window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); window.removeEventListener("pointercancel",onCancel);
    if(overZone){ overZone.classList.remove("over"); }
    var target=ok?overZone:null; overZone=null;
    if(!drag.started){ drag=null; return; }
    if(!target){ var moved=$$(".card:not(.placeholder)",board); flip(moved,function(){ drag.from.insertBefore(el,drag.next&&drag.next.parentElement===drag.from?drag.next:null); }); counts(); }
    var r=el.getBoundingClientRect(), d=drag; drag=null;
    board.classList.remove("is-dragging"); document.body.classList.remove("dnd-active");
    function done(){ g.remove(); el.classList.remove("placeholder"); if(target) afterDrop(el,fromStage); }
    if(reduce||!g.animate){ done(); return; }
    var cur=g.style.transform;
    var a=g.animate([{transform:cur},{transform:"translate("+r.left+"px,"+r.top+"px) rotate(0deg) scale(1)"}],{duration:target?520:420,easing:"cubic-bezier(.34,1.56,.64,1)",fill:"forwards"});
    a.onfinish=function(){ done(); if(target && el.animate) el.animate([{transform:"scale(1.07)"},{transform:"scale(.98)"},{transform:"none"}],{duration:380,easing:"ease-out"}); };
  }
  function onUp(e){ if(drag && e.pointerId===drag.id) finish(true); }
  function onCancel(e){ if(drag && e.pointerId===drag.id) finish(false); }

  /* ---- keyboard drag ---- */
  var kb=null, kbMoving=false;
  function onKey(e){
    var el=e.currentTarget, k=e.key;
    if(!kb && (k===" "||k==="Enter")){ e.preventDefault(); kb={el:el,from:el.parentElement,next:el.nextSibling}; el.classList.add("grabbed"); el.setAttribute("aria-pressed","true");
      live.textContent="Picked up "+dataOf(el).id+" in "+SLABEL[stageOf(el)]+". Use arrow keys to move, Space to drop, Escape to cancel."; return; }
    if(!kb || kb.el!==el) return;
    if(k===" "||k==="Enter"){ e.preventDefault(); dropKb(true); return; }
    if(k==="Escape"){ e.preventDefault(); dropKb(false,true); return; }
    var s=STAGES.indexOf(stageOf(el)), moved=$$(".card",board);
    if(k==="ArrowRight"||k==="ArrowLeft"){ e.preventDefault(); var n=s+(k==="ArrowRight"?1:-1); if(n<0||n>=STAGES.length) return;
      kbMoving=true; flip(moved,function(){ zones[STAGES[n]].appendChild(el); }); el.focus(); kbMoving=false; refreshCard(el); counts(); live.textContent=SLABEL[STAGES[n]]; }
    if(k==="ArrowUp"||k==="ArrowDown"){ e.preventDefault(); var z=el.parentElement;
      kbMoving=true; flip(moved,function(){ if(k==="ArrowUp"&&el.previousElementSibling) z.insertBefore(el,el.previousElementSibling); else if(k==="ArrowDown"&&el.nextElementSibling) z.insertBefore(el.nextElementSibling,el); }); el.focus(); kbMoving=false; }
  }
  function dropKb(commit,cancel){
    var el=kb.el, from=kb.from, next=kb.next; kb=null; el.classList.remove("grabbed"); el.removeAttribute("aria-pressed");
    if(cancel){ from.insertBefore(el,next&&next.parentElement===from?next:null); refreshCard(el); counts(); el.focus(); live.textContent="Move cancelled."; return; }
    if(commit) afterDrop(el,from.dataset.stage);
  }

  $("#triReset").addEventListener("click",reset);
  $("#triAgain").addEventListener("click",function(){ reset(); var f=$(".card",zones.inbox); if(f) f.focus(); });
  reset();
})();
