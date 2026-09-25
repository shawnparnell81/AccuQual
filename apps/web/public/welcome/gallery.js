/* AccuQual QMS landing: interactive gallery mini-demos. Vanilla JS, Pointer Events, no dependencies.
   Every number shown in these scenes is an illustrative sample, not a real spec or measurement. */
(function(){
  "use strict";
  var reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $=function(s,c){return (c||document).querySelector(s)}, $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
  var NS="http://www.w3.org/2000/svg";
  var OK="#00FF9D", AMB="#FFB703", BAD="#FF2A6D", CY="#00F3FF", VI="#A855F7";

  /* ---------- helpers ---------- */
  function mk(tag,attrs,parent){ var e=document.createElementNS(NS,tag); for(var k in attrs) e.setAttribute(k,attrs[k]); if(parent) parent.appendChild(e); return e; }
  function clamp(v,a,b){ return v<a?a:v>b?b:v; }
  function toSvg(svg,x,y){ var p=svg.createSVGPoint(); p.x=x; p.y=y; return p.matrixTransform(svg.getScreenCTM().inverse()); }
  function toClient(svg,x,y){ var p=svg.createSVGPoint(); p.x=x; p.y=y; return p.matrixTransform(svg.getScreenCTM()); }
  function burst(svg,x,y,c,n){ if(reduce||!window.AQFX) return; var q=toClient(svg,x,y); window.AQFX.burst(q.x,q.y,c,n); }
  function say(el,t){ if(!el) return; clearTimeout(el._t); el._t=setTimeout(function(){ el.textContent=t; },220); }
  function firstUse(fig){ var h=$(".gx-hint",fig); if(h) h.classList.add("gone"); }
  function pill(el,text,cls){ el.textContent=text; el.className="gx-pill"+(cls?" "+cls:""); }
  function pulse(el){ if(reduce||!el) return; el.classList.remove("gx-pulse"); el.getBoundingClientRect(); el.classList.add("gx-pulse"); }
  function tween(from,to,ms,fn,done){
    if(reduce||ms<=0){ fn(to); if(done) done(); return {stop:function(){}}; }
    var t0=performance.now(), stopped=false;
    (function s(now){ if(stopped) return; var k=Math.min(1,(now-t0)/ms), e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2; fn(from+(to-from)*e); if(k<1) requestAnimationFrame(s); else if(done) done(); })(t0);
    return {stop:function(){ stopped=true; }};
  }
  function fade(el,ms,from,to,extra){ // attribute fade for SVG bits (ripples, click labels)
    if(reduce){ el.setAttribute("opacity",to); return; }
    tween(0,1,ms,function(k){ el.setAttribute("opacity",from+(to-from)*k); if(extra) extra(k); });
  }
  /* pointer drag on an SVG handle, with capture and no page scroll */
  function drag(handle,fig,h){
    var pid=null;
    handle.addEventListener("pointerdown",function(e){
      if(e.button>0) return; pid=e.pointerId;
      try{ handle.setPointerCapture(pid); }catch(_){}
      fig.classList.add("gx-busy","gx-ptr"); fig.style.transform=""; firstUse(fig);
      try{ handle.focus({preventScroll:true}); }catch(_){}
      h.start(e); e.preventDefault();
    });
    handle.addEventListener("pointermove",function(e){ if(e.pointerId!==pid) return; e.preventDefault(); h.move(e); });
    function up(e){ if(e.pointerId!==pid) return; pid=null; fig.classList.remove("gx-busy"); if(h.end) h.end(); }
    handle.addEventListener("pointerup",up); handle.addEventListener("pointercancel",up); handle.addEventListener("lostpointercapture",up);
    handle.addEventListener("touchstart",function(e){ e.preventDefault(); },{passive:false});
    handle.addEventListener("keydown",function(){ fig.classList.remove("gx-ptr"); });
  }
  function fmtSigned(v,w){ var s=v<0?"−":"+"; v=Math.abs(v); var a=v.toFixed(3); while(a.length<(w||7)) a="0"+a; return s+a; }
  function devStr(d){ return (d>=0?"+":"−")+Math.abs(d).toFixed(3); }

  $$(".gx-stage").forEach(function(s){ s.addEventListener("scroll",function(){ s.scrollTop=0; s.scrollLeft=0; }); });

  /* starfields inside the SVG scenes (seeded so they never jump) */
  $$(".gx-stars").forEach(function(g,gi){
    var n=+g.dataset.n||20, w=+g.dataset.w||800, h=+g.dataset.h||400, seed=gi*977+13;
    function rnd(){ seed=(seed*16807)%2147483647; return seed/2147483647; }
    for(var i=0;i<n;i++){ var r=rnd(), c=r<.15?CY:r<.28?VI:"#ffffff";
      mk("circle",{cx:(rnd()*w).toFixed(1),cy:(rnd()*h).toFixed(1),r:(.4+rnd()*1.1).toFixed(2),fill:c,opacity:(.25+rnd()*.6).toFixed(2)},g); }
  });

  /* =================== 1. BRIDGE CMM =================== */
  (function(){
    var fig=$("#gxCmm"); if(!fig) return;
    var svg=$(".gx-svg",fig), car=$("#cmmCar"), ram=$("#cmmRam"), head=$("#cmmHead"), led=$("#cmmHeadLed"), joint=$("#cmmJoint"), sty=$("#cmmStylus"), halo=$("#cmmHalo"), ruby=$("#cmmRuby");
    var hsG=$("#cmmHs"), tags=$("#cmmTags"), fxG=$("#cmmFx"), read=$("#cmmRead"), sub=$("#cmmSub"), pl=$("#cmmPill"), live=$("#cmmLive"), allBtn=$("#cmmAll");
    var dX=$("#cmmX"), dY=$("#cmmY"), dZ=$("#cmmZ");
    var TOL=0.020, REST={x:500,y:270}, SAFE=300;
    var HS=[
      {f:"Bore Ø25",x:470,y:362,yy:12.4,n:"25.000",d:0.012},
      {f:"Pocket A depth",x:400,y:364,yy:18.6,n:"8.000",d:-0.005},
      {f:"Pocket B width",x:646,y:362,yy:9.2,n:"40.000",d:0.027},
      {f:"Datum A flatness",x:322,y:365,yy:21.8,n:"0.000",d:0.016}
    ];
    var pos={x:REST.x,y:REST.y}, curYY=0, busy=false, pending=null, els=[];
    function col(d){ var a=Math.abs(d); return a>TOL?BAD:a>TOL*.6?AMB:OK; }
    function word(d){ var a=Math.abs(d); return a>TOL?"OUT":a>TOL*.6?"NEAR LIMIT":"IN TOL"; }
    function draw(x,y){
      car.setAttribute("transform","translate("+(x-500).toFixed(2)+" 0)");
      ram.setAttribute("height",Math.max(10,y-58-140).toFixed(2));
      head.setAttribute("y",(y-58).toFixed(2)); led.setAttribute("y",(y-55).toFixed(2)); joint.setAttribute("cy",(y-36).toFixed(2));
      sty.setAttribute("y1",(y-28).toFixed(2)); sty.setAttribute("y2",(y-8).toFixed(2)); halo.setAttribute("cy",y.toFixed(2)); ruby.setAttribute("cy",y.toFixed(2));
      dX.textContent=fmtSigned((x-500)*.5); dY.textContent=fmtSigned(curYY); dZ.textContent=fmtSigned((REST.y-y)*.4);
    }
    function move(x,y,ms){ return new Promise(function(res){ var sx=pos.x, sy=pos.y; tween(0,1,ms,function(k){ pos={x:sx+(x-sx)*k,y:sy+(y-sy)*k}; draw(pos.x,pos.y); },res); }); }
    function ripple(x,y,c){
      if(reduce) return;
      [0,160].forEach(function(delay){ setTimeout(function(){
        var e=mk("ellipse",{cx:x,cy:y,rx:4,ry:1.4,fill:"none",stroke:c,"stroke-width":2},fxG);
        tween(0,1,700,function(k){ e.setAttribute("rx",4+44*k); e.setAttribute("ry",1.4+14*k); e.setAttribute("opacity",1-k); },function(){ e.remove(); });
      },delay); });
    }
    function tag(i){
      var p=HS[i], c=col(p.d), g=mk("g",{transform:"translate("+p.x+" "+(p.y-34)+")"},tags), t=devStr(p.d);
      mk("line",{x1:0,y1:8,x2:0,y2:22,stroke:c,"stroke-width":1,opacity:.7},g);
      mk("rect",{x:-30,y:-11,width:60,height:19,rx:5,fill:"rgba(4,6,10,.85)",stroke:c},g);
      var tx=mk("text",{x:0,y:3,"text-anchor":"middle","font-size":11,fill:c,"class":"gx-svgmono"},g); tx.textContent=t;
      if(!reduce) fade(g,300,0,1);
    }
    function contact(i){
      var p=HS[i], c=col(p.d), el=els[i];
      el.classList.add("done"); el.style.setProperty("--c",c);
      el.setAttribute("aria-label","Probe "+p.f+" again. Last deviation "+devStr(p.d)+" millimeters, "+word(p.d)+". Illustrative.");
      $$("g",tags).forEach(function(t){ if(t.dataset.i==i) t.remove(); }); tag(i); tags.lastChild.dataset.i=i;
      ripple(p.x,p.y,c); pulse(halo); burst(svg,p.x,p.y,c,24);
      var act=(parseFloat(p.n)+p.d).toFixed(3);
      sub.textContent="Nom "+p.n+" · Act "+act+" · Tol ±0.020 · Sample";
      read.textContent=p.f+" · "+devStr(p.d)+" mm";
      pill(pl,word(p.d),c===OK?"is-ok":c===AMB?"is-amb":"is-bad");
      say(live,p.f+": nominal "+p.n+", actual "+act+", deviation "+devStr(p.d)+" millimeters against plus or minus 0.020. "+word(p.d)+". Illustrative sample.");
    }
    function probe(i){
      if(busy){ pending=i; return Promise.resolve(); }
      busy=true; firstUse(fig);
      var p=HS[i]; pill(pl,"Probing","is-cy"); read.textContent="Moving to "+p.f+"…";
      var dist=Math.abs(p.x-pos.x);
      return move(pos.x,Math.min(pos.y,SAFE),pos.y>SAFE?260:0)
        .then(function(){ curYY=p.yy; return move(p.x,SAFE,Math.min(750,260+dist*1.3)); })
        .then(function(){ return move(p.x,p.y-8,320); })
        .then(function(){ contact(i); return new Promise(function(r){ setTimeout(r,reduce?0:260); }); })
        .then(function(){ return move(p.x,SAFE,300); })
        .then(function(){ busy=false; if(pending!==null){ var n=pending; pending=null; return probe(n); } });
    }
    HS.forEach(function(p,i){
      var g=mk("g",{"class":"cmm-hs",transform:"translate("+p.x+" "+p.y+")",tabindex:0,role:"button","aria-label":"Probe "+p.f+" (illustrative)"},hsG);
      mk("circle",{r:22,fill:"transparent","class":"hs-hit"},g); mk("circle",{r:10,"class":"hs-ring"},g); mk("circle",{r:8.5,"class":"hs-core"},g); mk("circle",{r:3.2,"class":"hs-dot"},g); mk("circle",{r:15,"class":"hs-focus"},g);
      g.addEventListener("click",function(){ probe(i); });
      g.addEventListener("keydown",function(e){
        if(e.key==="Enter"||e.key===" "){ e.preventDefault(); probe(i); return; }
        var d={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key]; if(!d) return; e.preventDefault(); els[(i+d+els.length)%els.length].focus();
      });
      els.push(g);
    });
    allBtn.addEventListener("click",function(){
      allBtn.disabled=true; firstUse(fig);
      var chain=Promise.resolve(); HS.forEach(function(_,i){ chain=chain.then(function(){ return probe(i); }); });
      chain.then(function(){ allBtn.disabled=false; var out=HS.filter(function(p){return Math.abs(p.d)>TOL}).length;
        say(live,"Routine complete. "+HS.length+" features probed, "+out+" out of tolerance. Illustrative."); });
    });
    $("#cmmReset").addEventListener("click",function(){
      pending=null; els.forEach(function(e,i){ e.classList.remove("done"); e.style.removeProperty("--c"); e.setAttribute("aria-label","Probe "+HS[i].f+" (illustrative)"); });
      tags.innerHTML=""; read.textContent="Pick a hotspot to probe"; sub.textContent="Last point · Sample"; pill(pl,"Ready","");
      var go=function(){ curYY=0; move(REST.x,REST.y,500); }; if(busy){ var w=setInterval(function(){ if(!busy){ clearInterval(w); go(); } },60); } else go();
      say(live,"CMM reset.");
    });
    draw(pos.x,pos.y);
  })();

  /* =================== 2. CALIPERS =================== */
  (function(){
    var fig=$("#gxCal"); if(!fig) return;
    var svg=$(".gx-svg",fig), jaw=$("#calJaw"), lcd=$("#calLcd"), lcdU=$("#calLcdU"), read=$("#calRead"), pl=$("#calPill"), tolEl=$("#calTol"), live=$("#calLive");
    var dim=$("#calDim"), dimLine=$("#calDimLine"), dimBg=$("#calDimBg"), dimTxt=$("#calDimTxt"), c1=$("#calC1"), c2=$("#calC2"), part=$("#calPart"), partLbl=$("#calPartLbl");
    var S=6, X0=324, MAX=40, NOM=25.40, TOL=0.03, PARTS=[25.42,25.47,25.39,25.34], pi=0, unit="mm", g=34, contact=false;
    var ticks=$("#calTicks");
    for(var mm=0; X0+mm*S<=754; mm++){ var x=X0+mm*S, L=mm%10===0?9:mm%5===0?6:3.5;
      mk("line",{x1:x,y1:150,x2:x,y2:150+L,stroke:"#2b3440","stroke-width":mm%10===0?1:.7},ticks);
      if(mm%10===0&&mm>0){ var t=mk("text",{x:x,y:171,"text-anchor":"middle","font-size":7,fill:"#2b3440","class":"gx-svgmono"},ticks); t.textContent=mm/10; } }
    function f(v){ return unit==="mm"?v.toFixed(2):(v/25.4).toFixed(3); }
    function uw(){ return unit==="mm"?"millimeters":"inches"; }
    function pass(){ return Math.abs(PARTS[pi]-NOM)<=TOL+1e-9; }
    function render(){
      var x2=X0+g*S, c=contact?(pass()?OK:BAD):CY;
      jaw.setAttribute("transform","translate("+(g*S).toFixed(2)+" 0)");
      lcd.textContent=f(g); lcdU.textContent=unit.toUpperCase();
      read.innerHTML=f(g)+" <em>"+unit+"</em>";
      dim.setAttribute("opacity",1);
      dimLine.setAttribute("d","M"+X0+" 336H"+x2.toFixed(2)+"M"+X0+" 328V344M"+x2.toFixed(2)+" 328V344");
      dimLine.setAttribute("stroke",c); dimBg.setAttribute("stroke",c); dimTxt.setAttribute("fill",c);
      var mid=(X0+x2)/2; dimBg.setAttribute("x",mid-40); dimTxt.setAttribute("x",mid); dimTxt.textContent=(unit==="mm"?"Ø":"Ø")+f(g)+(unit==="in"?"″":"");
      [c1,c2].forEach(function(e){ e.setAttribute("fill",c); e.setAttribute("opacity",contact?1:.35); });
      tolEl.textContent=unit==="mm"?"Nominal Ø25.40 ±0.03 mm":"Nominal Ø1.000 ±0.001 in";
      if(contact) pill(pl,pass()?"PASS":"OUT",pass()?"is-ok":"is-bad"); else pill(pl,"Open","");
      jaw.setAttribute("aria-valuemin",PARTS[pi].toFixed(2)); jaw.setAttribute("aria-valuenow",g.toFixed(2));
      jaw.setAttribute("aria-valuetext",f(g)+" "+uw()+(contact?", jaws on part, "+(pass()?"pass":"out of tolerance"):", open"));
    }
    function onContact(){
      var c=pass()?OK:BAD; pulse(c1); pulse(c2);
      burst(svg,X0,262,c,12); burst(svg,X0+g*S,262,c,12);
      say(live,"Jaws on part. Measured "+f(PARTS[pi])+" "+uw()+" against nominal "+(unit==="mm"?"25.40 plus or minus 0.03 millimeters":"1.000 plus or minus 0.001 inches")+". "+(pass()?"PASS":"OUT")+". Sample reading.");
    }
    function setG(v){ var D=PARTS[pi]; v=clamp(v,D,MAX); var was=contact; g=v; contact=g<=D+1e-9; render(); if(contact&&!was) onContact(); }
    var g0=0,x0=0;
    drag(jaw,fig,{start:function(e){ g0=g; x0=toSvg(svg,e.clientX,e.clientY).x; },move:function(e){ setG(g0+(toSvg(svg,e.clientX,e.clientY).x-x0)/S); },
      end:function(){ if(!contact) say(live,"Jaws open at "+f(g)+" "+uw()+". Sample."); }});
    jaw.addEventListener("keydown",function(e){
      var st=e.shiftKey?1:.1, m={ArrowLeft:-st,ArrowDown:-st,ArrowRight:st,ArrowUp:st,PageUp:5,PageDown:-5}[e.key];
      if(e.key==="Home"){ m=-999; } if(e.key==="End"){ m=999; }
      if(m===undefined) return; e.preventDefault(); firstUse(fig); setG(g+m);
      if(!contact) say(live,f(g)+" "+uw());
    });
    $$(".gx-seg button",fig).forEach(function(b){ b.addEventListener("click",function(){
      unit=b.dataset.u; $$(".gx-seg button",fig).forEach(function(o){ o.setAttribute("aria-pressed",String(o===b)); }); render(); firstUse(fig);
      say(live,"Units: "+uw()+". Reading "+f(g)+".");
    }); });
    $("#calNext").addEventListener("click",function(){
      pi=(pi+1)%PARTS.length; partLbl.textContent="PART "+(pi+1)+" / "+PARTS.length+" · SAMPLE"; firstUse(fig);
      part.classList.remove("swap"); part.getBoundingClientRect(); if(!reduce) part.classList.add("swap");
      tween(g,34,450,function(v){ setG(Math.max(v,PARTS[pi])); });
      say(live,"Part "+(pi+1)+" of "+PARTS.length+" loaded. Close the jaws to measure.");
    });
    render();
  })();

  /* =================== 3. HEIGHT GAUGE =================== */
  (function(){
    var fig=$("#gxHg"); if(!fig) return;
    var svg=$(".gx-svg",fig), headG=$("#hgHead"), lcd=$("#hgLcd"), read=$("#hgRead"), pl=$("#hgPill"), live=$("#hgLive"), chips=$("#hgChips"), tip=$("#hgTip"), line=$("#hgLine"), tagsG=$("#hgTags");
    var S=2.8, Y0=392, MAX=89, TOL=0.05;
    var F=[{n:"Top face",nom:60,a:60.02,tx:552,ty:196,an:"middle"},{n:"Step",nom:40,a:39.94,tx:664,ty:252,an:"middle"},{n:"Bore top",nom:30,a:30.01,tx:548,ty:304,an:"start"},{n:"Bore bottom",nom:14,a:13.99,tx:548,ty:366,an:"start"}];
    var paths=$$("#hgFeat path"), touched={}, cur=-1, h=75, tagEls=[];
    var ticks=$("#hgTicks");
    for(var mm=0; mm<=110; mm+=2){ var y=Y0-mm*S; if(y<40) break; var L=mm%10===0?9:4;
      mk("line",{x1:232,y1:y,x2:232+L,y2:y,stroke:"#2b3440","stroke-width":mm%10===0?1:.7},ticks);
      if(mm%20===0){ var t=mk("text",{x:226,y:y+3,"text-anchor":"end","font-size":8,fill:"#94A3B8",opacity:.75,"class":"gx-svgmono"},ticks); t.textContent=mm; } }
    F.forEach(function(ft){ var g=mk("g",{opacity:0},tagsG); var w=ft.an==="middle"?-30:-4;
      mk("rect",{x:ft.tx+w,y:ft.ty-12,width:60,height:17,rx:4,fill:"rgba(4,6,10,.85)"},g);
      var t=mk("text",{x:ft.an==="middle"?ft.tx:ft.tx+26,y:ft.ty,"text-anchor":"middle"},g); t.textContent=ft.a.toFixed(2); tagEls.push(g); });
    function ok(i){ return Math.abs(F[i].a-F[i].nom)<=TOL+1e-9; }
    function colr(i){ return ok(i)?OK:BAD; }
    function renderChips(){
      var ks=Object.keys(touched).map(Number).sort(); if(!ks.length){ chips.innerHTML="<span class='gx-chip'>No features touched yet</span>"; return; }
      var html=ks.map(function(i){ return "<span class='gx-chip "+(ok(i)?"is-ok":"is-bad")+"'>"+F[i].n+" "+F[i].a.toFixed(2)+(ok(i)?" ✓":" ✕")+"</span>"; }).join("");
      if(touched[2]&&touched[3]) html+="<span class='gx-chip is-cy'>Bore Ø "+(F[2].a-F[3].a).toFixed(2)+" (derived)</span>";
      chips.innerHTML=html;
    }
    function render(){
      var ty=Y0-h*S;
      headG.setAttribute("transform","translate(0 "+(-h*S).toFixed(2)+")");
      lcd.textContent=h.toFixed(2); read.innerHTML=h.toFixed(2)+" <em>mm</em>";
      paths.forEach(function(p,i){ p.setAttribute("stroke",i===cur?colr(i):touched[i]?colr(i):"transparent"); p.setAttribute("opacity",i===cur?1:.35); });
      tagEls.forEach(function(t,i){ t.setAttribute("opacity",i===cur?1:touched[i]?.55:0); $("text",t).setAttribute("fill",colr(i)); $("rect",t).setAttribute("stroke",colr(i)); });
      var c=cur>=0?colr(cur):CY; tip.setAttribute("fill",c); tip.setAttribute("opacity",cur>=0?1:.5); line.setAttribute("stroke",c); line.setAttribute("opacity",cur>=0?.9:.5);
      if(cur>=0) pill(pl,F[cur].n+" · "+(ok(cur)?"PASS":"OUT"),ok(cur)?"is-ok":"is-bad"); else pill(pl,"Free","");
      headG.setAttribute("aria-valuenow",h.toFixed(2)); headG.setAttribute("aria-valuetext",h.toFixed(2)+" millimeters"+(cur>=0?", touching "+F[cur].n:""));
    }
    function setH(v,zone){
      var raw=clamp(v,0,MAX), snap=-1;
      for(var i=0;i<F.length;i++) if(Math.abs(raw-F[i].nom)<=zone){ snap=i; break; }
      h=snap>=0?F[snap].a:raw;
      var prev=cur; cur=snap; var first=snap>=0&&!touched[snap]; if(snap>=0) touched[snap]=true;
      render();
      if(snap>=0&&snap!==prev){
        pulse(tip); renderChips();
        if(first) burst(svg,505,Y0-h*S,colr(snap),16);
        say(live,"Scriber touching "+F[snap].n+" at "+F[snap].a.toFixed(2)+" millimeters, nominal "+F[snap].nom.toFixed(2)+". "+(ok(snap)?"PASS":"OUT")+". Sample.");
      }
    }
    var raw0=0,y0=0;
    drag(headG,fig,{start:function(e){ raw0=h; y0=toSvg(svg,e.clientX,e.clientY).y; },move:function(e){ setH(raw0-(toSvg(svg,e.clientX,e.clientY).y-y0)/S,2.2); },
      end:function(){ if(cur<0) say(live,"Height "+h.toFixed(2)+" millimeters. Sample."); }});
    var kraw=h;
    headG.addEventListener("keydown",function(e){
      var st=e.shiftKey?1:.1, k=e.key, target=null;
      if(k==="ArrowUp"||k==="ArrowRight") target=h+st; else if(k==="ArrowDown"||k==="ArrowLeft") target=h-st;
      else if(k==="PageUp"||k==="PageDown"){ var up=k==="PageUp", best=null; F.forEach(function(ft){ if(up?ft.nom>h+.1:ft.nom<h-.1){ if(best===null||(up?ft.nom<best:ft.nom>best)) best=ft.nom; } }); target=best===null?(up?MAX:0):best; }
      else if(k==="Home") target=0; else if(k==="End") target=MAX; else return;
      e.preventDefault(); firstUse(fig);
      // step out of a snapped feature cleanly
      if(cur>=0&&(k.indexOf("Arrow")===0)) target=(target>h?F[cur].nom+.61:F[cur].nom-.61);
      setH(target,.6); if(cur<0) say(live,h.toFixed(2)+" millimeters");
    });
    render();
  })();

  /* =================== 4. MICROMETER =================== */
  (function(){
    var fig=$("#gxMic"); if(!fig) return;
    var svg=$(".gx-svg",fig), turn=$("#micTurn"), thim=$("#micThimble"), spin=$("#micSpindle"), tg=$("#micTG"), knurl=$("#micKnurl"), ridge=$("#micRidge"), ratch=$("#micRatch"), click=$("#micClick"), ring=$("#micRing");
    var hud=$("#micHud"), hudS=$("#micHudS"), read=$("#micRead"), brk=$("#micBreak"), pl=$("#micPill"), live=$("#micLive"), c1=$("#micC1"), c2=$("#micC2"), pin=$("#micPin"), focusR=$("#micFocus");
    var S=5.5, X0=150, E0=478, MAX=25, NOM=10, TOL=0.005, PINS=[10.003,9.992,10.001], pi=0, g=14.2, contact=false, lastClick=0;
    var sl=$("#micSleeve");
    for(var k=0;k<=50;k++){ var mm=k/2, x=E0+mm*S;
      if(k%2===0){ mk("line",{x1:x,y1:200,x2:x,y2:mm%5===0?187:191},sl); if(mm%5===0){ var t=mk("text",{x:x,y:185.5,"text-anchor":"middle","font-size":7,fill:"#1a2230",stroke:"none","class":"gx-svgmono"},sl); t.textContent=mm; } }
      else mk("line",{x1:x,y1:200,x2:x,y2:207},sl); }
    var gl=[], gt=[];
    for(var i=0;i<50;i++){ gl.push(mk("line",{x1:E0,x2:E0+(i%5===0?11:6),stroke:"#1a2230","stroke-width":1},tg));
      if(i%5===0){ var tt=mk("text",{x:E0+14,"font-size":7,fill:"#1a2230","class":"gx-svgmono"},tg); tt.textContent=i; gt.push({i:i,el:tt}); } }
    function D(){ return PINS[pi]; }
    function pass(){ return Math.abs(D()-NOM)<=TOL+1e-9; }
    function render(){
      var sx=X0+g*S, turns=g/.5, r=(turns-Math.floor(turns))*50, c=contact?(pass()?OK:BAD):CY;
      spin.setAttribute("x",sx.toFixed(2)); spin.setAttribute("width",Math.max(0,420-sx).toFixed(2));
      thim.setAttribute("transform","translate("+(g*S).toFixed(2)+" 0)"); focusR.setAttribute("x",(470+g*S).toFixed(2));
      for(var i=0;i<50;i++){ var th=(i-r)/50*Math.PI*2, y=200-26*Math.sin(th), v=Math.cos(th);
        gl[i].setAttribute("y1",y.toFixed(2)); gl[i].setAttribute("y2",y.toFixed(2)); gl[i].setAttribute("opacity",v>.12?v.toFixed(2):0); }
      gt.forEach(function(o){ var th=(o.i-r)/50*Math.PI*2, v=Math.cos(th); o.el.setAttribute("y",(200-26*Math.sin(th)+2.5).toFixed(2)); o.el.setAttribute("opacity",v>.35?v.toFixed(2):0); });
      var off=(turns*2*Math.PI*26)%8; knurl.setAttribute("patternTransform","translate(0 "+off.toFixed(2)+")"); ridge.setAttribute("patternTransform","translate(0 "+((turns*2*Math.PI*18)%5).toFixed(2)+")");
      var slv=Math.floor(g*2+1e-9)/2, thv=g-slv;
      hud.textContent=g.toFixed(3); hud.setAttribute("fill",c); read.innerHTML=g.toFixed(3)+" <em>mm</em>";
      brk.textContent="Sleeve "+slv.toFixed(3)+" + thimble "+thv.toFixed(3)+" · Nominal Ø10.000 ±0.005";
      hudS.textContent=contact?(pass()?"ON PART · PASS":"ON PART · OUT"):"FREE"; hudS.setAttribute("fill",contact?c:"#94A3B8");
      [c1,c2].forEach(function(e){ e.setAttribute("fill",c); e.setAttribute("opacity",contact?1:.3); });
      c2.setAttribute("cx",(X0+D()*S).toFixed(2));
      if(contact) pill(pl,pass()?"PASS":"OUT",pass()?"is-ok":"is-bad"); else pill(pl,"Free","");
      turn.setAttribute("aria-valuemin",D().toFixed(3)); turn.setAttribute("aria-valuenow",g.toFixed(3));
      turn.setAttribute("aria-valuetext",g.toFixed(3)+" millimeters"+(contact?", on part, "+(pass()?"pass":"out of tolerance"):""));
    }
    function ratchetClick(){
      var now=performance.now(); if(now-lastClick<160) return; lastClick=now;
      pulse(ratch); if(!reduce){ fade(click,420,1,0,function(k){ click.setAttribute("y",160-10*k); }); }
    }
    function onContact(){
      var c=pass()?OK:BAD; ratchetClick(); pulse(c1); pulse(c2);
      ring.setAttribute("stroke",c); ring.setAttribute("cx",(X0+D()*S).toFixed(2));
      if(!reduce) tween(0,1,520,function(k){ ring.setAttribute("r",8+26*k); ring.setAttribute("opacity",1-k); });
      burst(svg,X0+D()*S,200,c,10);
      say(live,"Ratchet click. Spindle on pin at "+D().toFixed(3)+" millimeters, nominal 10.000 plus or minus 0.005. "+(pass()?"PASS":"OUT")+". Sample reading.");
    }
    function setG(v){ var d=D(); if(v<d-1e-9&&contact) ratchetClick(); v=clamp(v,d,MAX); var was=contact; g=Math.round(v*1000)/1000; contact=g<=d+1e-9; render(); if(contact&&!was) onContact(); }
    var g0=0,p0=null;
    drag(turn,fig,{start:function(e){ g0=g; p0=toSvg(svg,e.clientX,e.clientY); },
      move:function(e){ var p=toSvg(svg,e.clientX,e.clientY); setG(g0+(p.x-p0.x)/S+(p0.y-p.y)*.01); },
      end:function(){ if(!contact) say(live,g.toFixed(3)+" millimeters. Sample."); }});
    turn.addEventListener("wheel",function(e){
      e.preventDefault(); firstUse(fig);
      var n=clamp(Math.abs(e.deltaY||e.deltaX)/100,.25,3), dir=(e.deltaY||e.deltaX)>0?-1:1;
      setG(g+dir*n*(e.shiftKey?.005:.05)); say(live,g.toFixed(3)+" millimeters");
    },{passive:false});
    turn.addEventListener("keydown",function(e){
      var st=e.shiftKey?.1:.01, m={ArrowRight:st,ArrowUp:st,ArrowLeft:-st,ArrowDown:-st,PageUp:.5,PageDown:-.5}[e.key];
      if(e.key==="Home") m=-999; if(e.key==="End") m=999; if(m===undefined) return;
      e.preventDefault(); firstUse(fig); setG(g+m); if(!contact) say(live,g.toFixed(3)+" millimeters");
    });
    $("#micNext").addEventListener("click",function(){
      pi=(pi+1)%PINS.length; firstUse(fig); pin.classList.remove("swap"); pin.getBoundingClientRect(); if(!reduce) pin.classList.add("swap");
      tween(g,14.2,500,function(v){ setG(Math.max(v,D())); });
      say(live,"Pin "+(pi+1)+" of "+PINS.length+" loaded. Turn the thimble down to measure.");
    });
    render();
  })();

  /* =================== 5. TABLET CHECKLIST =================== */
  (function(){
    var fig=$("#gxTab"); if(!fig) return;
    var stage=$(".gx-tabstage",fig), world=$("#tabWorld"), screen=$("#tabScreen"), list=$("#tsList"), go=$("#tsGo"), prog=$("#tsProg"), stamp=$("#tsStamp"), stampT=$("#tsStampT"), toast=$("#tsToast"), toastT=$("#tsToastT");
    var read=$("#tabRead"), pl=$("#tabPill"), live=$("#tabLive");
    var rows=$$("li",list), names=["Bore Ø","Face flatness","Thread M8","Surface Ra"], state=[null,null,null,null], locked=false;
    function fit(){
      var r=stage.getBoundingClientRect(); if(!r.width) return;
      var k=Math.min(r.width/760,r.height/580), tx=r.width/2-796*k, ty=r.height/2-500*k;
      tx=Math.min(0,Math.max(r.width-1600*k,tx)); ty=Math.min(0,Math.max(r.height-1000*k,ty));
      world.style.transform="translate("+tx.toFixed(2)+"px,"+ty.toFixed(2)+"px) scale("+k.toFixed(4)+")";
    }
    fit(); if("ResizeObserver" in window) new ResizeObserver(fit).observe(stage); else addEventListener("resize",fit);
    function count(){ return state.filter(function(s){ return s!==null; }).length; }
    function fails(){ return state.map(function(s,i){ return s===false?names[i]:null; }).filter(Boolean); }
    function update(){
      rows.forEach(function(li,i){ li.classList.toggle("is-pass",state[i]===true); li.classList.toggle("is-fail",state[i]===false);
        $(".ts-p",li).setAttribute("aria-pressed",String(state[i]===true)); $(".ts-f",li).setAttribute("aria-pressed",String(state[i]===false));
        $(".ts-p",li).disabled=locked; $(".ts-f",li).disabled=locked; });
      var n=count(), fl=fails(); prog.textContent=n+" / 4 checked"; screen.classList.toggle("locked",locked);
      if(locked) return;
      go.classList.toggle("danger",n===4&&fl.length>0);
      go.disabled=n<4; go.textContent=n===4&&fl.length?"Open NCR":"Sign off";
      read.textContent="Lot 1043 · "+n+" of 4 checked"+(fl.length?" · "+fl.length+" fail":"");
      if(n<4) pill(pl,fl.length?"Fail found":"In progress",fl.length?"is-bad":"");
      else pill(pl,fl.length?"NCR needed":"Ready to sign",fl.length?"is-bad":"is-cy");
    }
    rows.forEach(function(li,i){
      [[".ts-p",true],[".ts-f",false]].forEach(function(pair){
        $(pair[0],li).addEventListener("click",function(){
          if(locked) return; firstUse(fig);
          state[i]=state[i]===pair[1]?null:pair[1]; update();
          say(live,names[i]+(state[i]===null?" cleared":state[i]?" marked pass":" marked fail")+". "+count()+" of 4 checked."+(count()===4?(fails().length?" A failure was recorded: Open NCR is available.":" Ready to sign off."):""));
        });
      });
    });
    go.addEventListener("click",function(){
      if(locked||count()<4) return;
      var fl=fails(); locked=true;
      if(fl.length){
        toastT.textContent="Sample · "+fl.join(", ")+" · Lot 1043"; toast.hidden=false;
        go.classList.add("danger"); go.textContent="NCR opened"; go.disabled=true;
        pill(pl,"NCR opened","is-bad"); read.textContent="Lot 1043 · on hold · NCR-0147 (sample)";
        say(live,"NCR-0147 created for "+fl.join(", ")+". Sample record. Use reset to start over.");
      } else {
        var t=new Date().toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
        stampT.textContent=t; stamp.hidden=false; go.textContent="Signed ✓"; go.disabled=true;
        pill(pl,"Approved","is-ok"); read.textContent="Lot 1043 · approved "+t;
        requestAnimationFrame(function(){ var r=stamp.getBoundingClientRect(); if(!reduce&&window.AQFX){ window.AQFX.burst(r.left+r.width/2,r.top+r.height/2,OK,50); } });
        say(live,"Record signed off and stamped Approved at "+t+". Sample record.");
      }
      update(); $("#tsReset").focus({preventScroll:true});
    });
    function reset(){ state=[null,null,null,null]; locked=false; stamp.hidden=true; toast.hidden=true; go.classList.remove("danger"); update(); say(live,"Checklist reset."); }
    $("#tsReset").addEventListener("click",reset); $("#tabReset").addEventListener("click",reset);
    update();
  })();

  /* =================== 6. PROBE PLAYGROUND =================== */
  (function(){
    var fig=$("#gxHero"); if(!fig) return;
    var stage=$("#heroStage"), img=$("img",stage), cv=$("#heroCv"), ctx=cv.getContext("2d"), live=$("#heroLive");
    var nEl=$("#heroN"), dEl=$("#heroD"), rEl=$("#heroR"), autoBtn=$("#heroAuto");
    var DPR=Math.min(window.devicePixelRatio||1,2), W=0, H=0, k=1, ox=0, oy=0, RUBY={x:1080,y:580}, MMPX=.1;
    var pts=[], fitC=null, trail=[], ret={x:0,y:0}, tgt={x:0,y:0}, vis=0, active=false, running=false, ripples=[], down=null, lastTrail=null, autoT=[];
    function map(){
      var r=stage.getBoundingClientRect(); W=r.width; H=r.height; if(!W) return;
      cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
      var op=(getComputedStyle(img).objectPosition||"50% 45%").split(" "), px=parseFloat(op[0])/100, py=parseFloat(op[1]||"50")/100;
      k=Math.max(W/1600,H/1000); ox=(W-1600*k)*(isNaN(px)?.5:px); oy=(H-1000*k)*(isNaN(py)?.45:py);
    }
    function i2s(p){ return {x:ox+p.x*k,y:oy+p.y*k}; }
    function s2i(p){ return {x:(p.x-ox)/k,y:(p.y-oy)/k}; }
    function local(e){ var r=stage.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
    function fit(){
      fitC=null; var n=pts.length; if(n<3) return;
      var mx=0,my=0; pts.forEach(function(p){ mx+=p.x; my+=p.y; }); mx/=n; my/=n;
      var Suu=0,Svv=0,Suv=0,Suuu=0,Svvv=0,Suvv=0,Svuu=0;
      pts.forEach(function(p){ var u=p.x-mx, v=p.y-my; Suu+=u*u; Svv+=v*v; Suv+=u*v; Suuu+=u*u*u; Svvv+=v*v*v; Suvv+=u*v*v; Svuu+=v*u*u; });
      var det=Suu*Svv-Suv*Suv; if(Math.abs(det)<1e-6*(Suu+Svv)*(Suu+Svv)) return;
      var a=.5*(Suuu+Suvv), b=.5*(Svvv+Svuu), uc=(a*Svv-b*Suv)/det, vc=(Suu*b-Suv*a)/det, r=Math.sqrt(uc*uc+vc*vc+(Suu+Svv)/n);
      if(!isFinite(r)||r>6000) return;
      var cx=uc+mx, cy=vc+my, mn=1e9, mxr=0; pts.forEach(function(p){ var d=Math.hypot(p.x-cx,p.y-cy); if(d<mn) mn=d; if(d>mxr) mxr=d; });
      fitC={x:cx,y:cy,r:r,rnd:mxr-mn};
    }
    function report(announce){
      nEl.textContent=pts.length;
      if(fitC){ dEl.innerHTML=(2*fitC.r*MMPX).toFixed(2)+" <em>mm</em>"; rEl.innerHTML=(fitC.rnd*MMPX).toFixed(2)+" <em>mm</em>"; }
      else { dEl.textContent="–"; rEl.textContent=pts.length<3?"Drop "+(3-pts.length)+" more point"+(pts.length===2?"":"s"):"Points are nearly in a line"; }
      if(announce) say(live,pts.length+" point"+(pts.length===1?"":"s")+". "+(fitC?"Fitted circle diameter "+(2*fitC.r*MMPX).toFixed(2)+" millimeters, roundness "+(fitC.rnd*MMPX).toFixed(2)+" millimeters. Sample scale.":rEl.textContent+"."));
    }
    function drop(sp,quiet){
      var p=s2i(sp); pts.push({x:p.x,y:p.y}); if(pts.length>16) pts.shift();
      var had=!!fitC; fit(); ripples.push({x:p.x,y:p.y,t:performance.now()});
      var r=stage.getBoundingClientRect();
      if(!reduce&&window.AQFX){ window.AQFX.burst(r.left+sp.x,r.top+sp.y,CY,8);
        if(fitC&&!had){ var c=i2s(fitC); window.AQFX.burst(r.left+c.x,r.top+c.y,VI,30); } }
      report(!quiet); kick();
    }
    function kick(){ if(!running){ running=true; requestAnimationFrame(loop); } }
    function loop(now){
      if(reduce){ ret.x=tgt.x; ret.y=tgt.y; vis=active?1:0; }
      else { ret.x+=(tgt.x-ret.x)*.2; ret.y+=(tgt.y-ret.y)*.2; vis+=((active?1:0)-vis)*.14;
        if(active&&(!lastTrail||Math.hypot(ret.x-lastTrail.x,ret.y-lastTrail.y)>3)){ lastTrail={x:ret.x,y:ret.y}; trail.push({x:ret.x,y:ret.y,t:now}); if(trail.length>90) trail.shift(); } }
      while(trail.length&&now-trail[0].t>1100) trail.shift();
      ripples=ripples.filter(function(q){ return now-q.t<700; });
      draw(now);
      var moving=Math.abs(tgt.x-ret.x)+Math.abs(tgt.y-ret.y)>.3||Math.abs((active?1:0)-vis)>.01;
      if(!reduce&&(moving||trail.length||ripples.length||active)) requestAnimationFrame(loop); else running=false;
    }
    function draw(now){
      ctx.clearRect(0,0,W,H);
      // scan trail
      for(var i=0;i<trail.length;i++){ var t=trail[i], a=1-(now-t.t)/1100; if(a<=0) continue;
        ctx.globalAlpha=a*.9; ctx.fillStyle=i%2?CY:VI; ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(t.x,t.y,.6+2.2*a,0,6.283); ctx.fill(); }
      ctx.shadowBlur=0; ctx.globalAlpha=1;
      // polyline between points
      if(pts.length>1){ ctx.setLineDash([3,5]); ctx.strokeStyle="rgba(255,255,255,.22)"; ctx.lineWidth=1; ctx.beginPath();
        pts.forEach(function(p,j){ var s=i2s(p); if(j) ctx.lineTo(s.x,s.y); else ctx.moveTo(s.x,s.y); }); ctx.stroke(); ctx.setLineDash([]); }
      // fitted circle
      if(fitC){ var c=i2s(fitC), R=fitC.r*k;
        ctx.strokeStyle=CY; ctx.lineWidth=2; ctx.shadowColor=CY; ctx.shadowBlur=16; ctx.beginPath(); ctx.arc(c.x,c.y,R,0,6.283); ctx.stroke(); ctx.shadowBlur=0;
        ctx.strokeStyle="rgba(168,85,247,.5)"; ctx.lineWidth=1; ctx.setLineDash([6,6]); ctx.beginPath(); ctx.arc(c.x,c.y,R+fitC.rnd*k*.5+6,0,6.283); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle="rgba(255,255,255,.55)"; ctx.beginPath(); ctx.moveTo(c.x-10,c.y); ctx.lineTo(c.x+10,c.y); ctx.moveTo(c.x,c.y-10); ctx.lineTo(c.x,c.y+10); ctx.stroke();
        ctx.strokeStyle="rgba(0,243,255,.6)"; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(c.x-R,c.y); ctx.lineTo(c.x+R,c.y); ctx.stroke(); ctx.setLineDash([]);
        // residual whiskers
        pts.forEach(function(p){ var d=Math.hypot(p.x-fitC.x,p.y-fitC.y), res=d-fitC.r, rel=fitC.rnd>0?Math.abs(res)/(fitC.rnd/2):0;
          var s=i2s(p), ux=(p.x-fitC.x)/d, uy=(p.y-fitC.y)/d; ctx.strokeStyle=rel>.8?BAD:rel>.45?AMB:OK; ctx.lineWidth=2;
          ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(c.x+ux*R,c.y+uy*R); ctx.stroke(); });
        var lbl="Ø "+(2*fitC.r*MMPX).toFixed(2)+" · RND "+(fitC.rnd*MMPX).toFixed(2)+" mm · sample";
        ctx.font="600 11px 'JetBrains Mono',ui-monospace,monospace"; var tw=ctx.measureText(lbl).width, lx=clamp(c.x-tw/2-8,6,W-tw-22), ly=c.y-R-30; if(ly<40) ly=c.y+R+10; ly=clamp(ly,40,H-28);
        ctx.fillStyle="rgba(4,6,10,.82)"; ctx.strokeStyle="rgba(0,243,255,.5)"; ctx.lineWidth=1; roundRect(lx,ly,tw+16,20,6); ctx.fill(); ctx.stroke();
        ctx.fillStyle=CY; ctx.fillText(lbl,lx+8,ly+14);
      }
      // points + ripples
      pts.forEach(function(p,j){ var s=i2s(p); ctx.strokeStyle="#fff"; ctx.lineWidth=1.4; ctx.beginPath(); ctx.arc(s.x,s.y,5.5,0,6.283); ctx.stroke();
        ctx.fillStyle="#FF2A6D"; ctx.beginPath(); ctx.arc(s.x,s.y,2.4,0,6.283); ctx.fill();
        ctx.fillStyle="rgba(255,255,255,.7)"; ctx.font="600 9px 'JetBrains Mono',monospace"; ctx.fillText(String(j+1),s.x+7,s.y-6); });
      ripples.forEach(function(q){ var s=i2s(q), a=(now-q.t)/700; ctx.globalAlpha=1-a; ctx.strokeStyle=CY; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(s.x,s.y,6+26*a,0,6.283); ctx.stroke(); });
      ctx.globalAlpha=1;
      // beam from the real ruby to the ghost probe + reticle
      if(vis>.02){ var rb=i2s(RUBY);
        ctx.globalAlpha=vis; var gr=ctx.createLinearGradient(rb.x,rb.y,ret.x,ret.y); gr.addColorStop(0,"rgba(0,243,255,.85)"); gr.addColorStop(1,"rgba(168,85,247,.5)");
        ctx.strokeStyle=gr; ctx.lineWidth=1.3; ctx.setLineDash([8,6]); ctx.lineDashOffset=reduce?0:-now/30; ctx.beginPath(); ctx.moveTo(rb.x,rb.y); ctx.lineTo(ret.x,ret.y); ctx.stroke(); ctx.setLineDash([]);
        var sg=ctx.createLinearGradient(ret.x,ret.y-40,ret.x,ret.y); sg.addColorStop(0,"rgba(223,229,236,0)"); sg.addColorStop(1,"rgba(223,229,236,.9)");
        ctx.strokeStyle=sg; ctx.lineWidth=2.4; ctx.beginPath(); ctx.moveTo(ret.x,ret.y-40); ctx.lineTo(ret.x,ret.y-6); ctx.stroke();
        var rg=ctx.createRadialGradient(ret.x-2,ret.y-2,1,ret.x,ret.y,7); rg.addColorStop(0,"#ffe1e6"); rg.addColorStop(.35,"#ff3b5c"); rg.addColorStop(1,"#7d0a22");
        ctx.shadowColor="#ff3b5c"; ctx.shadowBlur=14; ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(ret.x,ret.y,6.5,0,6.283); ctx.fill(); ctx.shadowBlur=0;
        ctx.strokeStyle="rgba(0,243,255,.6)"; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(ret.x,ret.y,15,0,6.283); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ret.x-26,ret.y); ctx.lineTo(ret.x-18,ret.y); ctx.moveTo(ret.x+18,ret.y); ctx.lineTo(ret.x+26,ret.y); ctx.moveTo(ret.x,ret.y+18); ctx.lineTo(ret.x,ret.y+26); ctx.stroke();
        var ip=s2i(ret); ctx.fillStyle="rgba(0,243,255,.85)"; ctx.font="500 10px 'JetBrains Mono',monospace";
        var tx=ret.x+20>W-110?ret.x-128:ret.x+20; ctx.fillText("X "+fmtSigned((ip.x-RUBY.x)*MMPX,6)+"  Y "+fmtSigned((RUBY.y-ip.y)*MMPX,6),tx,ret.y-20);
        ctx.globalAlpha=1; }
    }
    function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
    function isUi(e){ return e.target.closest&&e.target.closest(".gx-expand"); }
    stage.addEventListener("pointermove",function(e){ if(isUi(e)) return; var p=local(e);
      if(e.pointerType==="mouse"||down){ tgt=p; active=true; if(e.pointerType==="mouse") stage.classList.add("has-mouse"); kick(); } });
    stage.addEventListener("pointerleave",function(e){ if(e.pointerType==="mouse"&&!down&&document.activeElement!==stage){ active=false; kick(); } });
    stage.addEventListener("pointerdown",function(e){ if(isUi(e)||e.button>0) return; firstUse(fig); var p=local(e);
      down={x:p.x,y:p.y,t:performance.now(),id:e.pointerId}; try{ stage.setPointerCapture(e.pointerId); }catch(_){}
      if(e.pointerType!=="mouse"){ tgt=p; if(!active){ ret.x=p.x; ret.y=p.y; } active=true; kick(); }
      e.preventDefault(); try{ stage.focus({preventScroll:true}); }catch(_){}
    });
    function up(e){ if(!down||e.pointerId!==down.id) return; var p=local(e), d=down; down=null;
      if(Math.hypot(p.x-d.x,p.y-d.y)<10&&performance.now()-d.t<800) drop(p);
      if(e.pointerType!=="mouse") setTimeout(function(){ if(!down){ active=false; kick(); } },900); }
    stage.addEventListener("pointerup",up); stage.addEventListener("pointercancel",function(){ down=null; });
    stage.addEventListener("touchstart",function(e){ if(!isUi(e)) e.preventDefault(); },{passive:false});
    stage.addEventListener("focus",function(){ if(!active){ var c=i2s({x:800,y:470}); if(!tgt.x){ tgt=c; ret={x:c.x,y:c.y}; } } active=true; kick(); });
    stage.addEventListener("blur",function(){ active=false; kick(); });
    stage.addEventListener("keydown",function(e){
      var st=e.shiftKey?40:12, m={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];
      if(m){ e.preventDefault(); firstUse(fig); tgt={x:clamp(tgt.x+m[0],8,W-8),y:clamp(tgt.y+m[1],8,H-8)}; active=true; kick(); return; }
      if(e.key==="Enter"||e.key===" "){ e.preventDefault(); firstUse(fig); drop({x:tgt.x,y:tgt.y}); return; }
      if(e.key==="Backspace"||e.key==="Delete"){ e.preventDefault(); undo(); return; }
      if(e.key==="Escape"){ clear(); }
    });
    function undo(){ if(!pts.length) return; pts.pop(); fit(); report(true); kick(); }
    function clear(){ autoT.forEach(clearTimeout); autoT=[]; autoBtn.disabled=false; pts=[]; fitC=null; report(false); say(live,"Points cleared."); kick(); }
    $("#heroUndo").addEventListener("click",undo); $("#heroClear").addEventListener("click",clear);
    autoBtn.addEventListener("click",function(){
      clear(); firstUse(fig); autoBtn.disabled=true;
      var cx=W*(.42+Math.random()*.16), cy=H*(.5+Math.random()*.08), R=Math.min(W,H)*(.26+Math.random()*.06), n=9, a0=Math.random()*6.283;
      for(var i=0;i<n;i++){ (function(i){ autoT.push(setTimeout(function(){
        var a=a0+i/n*6.283+(Math.random()-.5)*.25, rr=R*(1+(Math.random()-.5)*.05), p={x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr};
        tgt=p; active=true; drop(p,i<n-1); if(i===n-1){ autoBtn.disabled=false; setTimeout(function(){ if(document.activeElement!==stage&&!down) { active=false; kick(); } },700); }
      },reduce?0:140*i)); })(i); }
    });
    function resize(){ var old=s2i(tgt); map(); var n=i2s(old); tgt=n; ret={x:n.x,y:n.y}; kick(); if(reduce) draw(performance.now()); }
    map(); var c0=i2s(RUBY); tgt={x:c0.x,y:c0.y}; ret={x:c0.x,y:c0.y};
    if("ResizeObserver" in window) new ResizeObserver(resize).observe(stage); else addEventListener("resize",resize);
    if(img.complete) draw(performance.now()); else img.addEventListener("load",function(){ draw(performance.now()); });
    report(false);
  })();
})();
