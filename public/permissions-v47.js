(() => {
  "use strict";

  const VERSION = "47.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const ACTIVE_PERMISSION_KEY = "arenaCommander.activePermission.v47";
  let pollTimer = null;
  let permissions = [];
  let copyData = null;

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
    } catch { return null; }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function cardName(card) {
    return String(card?.cardData?.name || card?.name || "Card").trim();
  }

  function cardImage(card) {
    return card?.cardData?.imageUrl || card?.imageUrl || card?.cardData?.faces?.[0]?.imageUrl || "";
  }

  function typeLine(card) {
    return String(card?.cardData?.typeLine || card?.typeLine || "");
  }

  async function api(path, body = {}) {
    const auth = session();
    if (!auth) throw new Error("No saved room session.");
    const response = await fetch(path, {
      method:"POST",
      headers:{"Content-Type":"application/json",Accept:"application/json"},
      cache:"no-store",
      body:JSON.stringify({...auth,...body})
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok||!payload?.success) throw new Error(payload?.error||`HTTP ${response.status}`);
    return payload;
  }

  function toast(message,type="info"){
    const region=document.getElementById("toastRegion");if(!region)return;
    const item=document.createElement("div");item.className=`toast ${type}`;item.textContent=message;
    region.appendChild(item);setTimeout(()=>item.remove(),4300);
  }

  function installButton(){
    const actions=document.querySelector(".arena-game-topbar .arena-top-actions");
    if(!actions)return;
    let button=document.getElementById("v47PlayableButton");
    if(!button){
      button=document.createElement("button");
      button.type="button";button.id="v47PlayableButton";
      button.className="arena-hotfix-control v47-playable-button";
      button.innerHTML="<span>◈</span><small>Playable</small><b>0</b>";
      actions.appendChild(button);
    }
    const count=permissions.length;
    button.querySelector("b").textContent=String(count);
    button.classList.toggle("has-cards",count>0);
  }

  function permissionCard(permission){
    const card=permission.card;
    return `
      <article class="v47-permission-card">
        ${cardImage(card)?`<img src="${escapeHtml(cardImage(card))}" alt="${escapeHtml(cardName(card))}">`:`<div>♛</div>`}
        <strong>${escapeHtml(cardName(card))}</strong>
        <small>${escapeHtml(permission.sourceName)} · ${escapeHtml(permission.freeCast?"Free cast":permission.zone)}</small>
        <button type="button" data-v47-play="${escapeHtml(permission.id)}">
          ${/\bLand\b/i.test(typeLine(card))?"Play land":permission.freeCast?"Cast free":"Cast card"}
        </button>
      </article>
    `;
  }

  function showPlayable(){
    document.getElementById("v47PlayableSheet")?.remove();
    const overlay=document.createElement("div");
    overlay.id="v47PlayableSheet";overlay.className="v47-playable-sheet";
    overlay.innerHTML=`
      <section>
        <header><div><small>PLAY PERMISSIONS</small><h2>Cards you may play now</h2></div><button type="button" data-v47-close>×</button></header>
        <div class="v47-permission-grid">
          ${permissions.map(permissionCard).join("")||"<p>No temporary or static play permissions are available.</p>"}
        </div>
        <button type="button" class="v47-copy-open" data-v47-copy-open>Open copy controls</button>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  function proxyOpen(permission){
    sessionStorage.setItem(ACTIVE_PERMISSION_KEY,JSON.stringify(permission));
    const button=document.createElement("button");
    button.type="button";button.hidden=true;button.dataset.v41Forward="1";
    button.dataset.action="open-cast-card";button.dataset.cardId=permission.cardId;
    button.dataset.fromZone=permission.zone==="library-top"?"library":permission.zone;
    document.body.appendChild(button);button.click();button.remove();
    document.getElementById("v47PlayableSheet")?.remove();
  }

  function enhancePermissionCast(form){
    if(form.dataset.v47Permission)return;
    let permission;
    try{permission=JSON.parse(sessionStorage.getItem(ACTIVE_PERMISSION_KEY)||"null");}catch{return;}
    if(!permission||String(new FormData(form).get("cardId"))!==String(permission.cardId))return;
    form.dataset.v47Permission="1";

    form.querySelector("[data-v42-autotap-panel]")?.classList.add("v47-hidden-base-cast");
    form.querySelector("[data-v46-mechanics-panel]")?.classList.add("v47-hidden-base-cast");

    const button=document.createElement("button");
    button.type="button";button.className="v47-permission-cast";
    button.dataset.v47PermissionCast="1";
    button.innerHTML=`<strong>${permission.freeCast?"Cast without paying mana":"Cast with permission"}</strong><small>${escapeHtml(permission.sourceName)}</small>`;
    form.querySelector("button[type='submit']")?.before(button);
  }

  async function castPermission(form,button){
    const permission=JSON.parse(sessionStorage.getItem(ACTIVE_PERMISSION_KEY)||"null");
    if(!permission)return;
    const data=new FormData(form);
    button.disabled=true;
    try{
      await api("/api/permissions/play",{
        permissionId:permission.id,
        cardId:permission.cardId,
        fromZone:permission.zone,
        xValue:Number(data.get("xValue")||0),
        targets:data.getAll("targets").map(String),
        modes:String(data.get("modes")||"").split(/\s*;\s*|\n/).filter(Boolean)
      });
      sessionStorage.removeItem(ACTIVE_PERMISSION_KEY);
      document.querySelector("#modalBackdrop [data-action='close-modal']")?.click();
      toast("Permitted card played.","success");
    }catch(error){
      button.disabled=false;toast(error.message||"Unable to play permitted card.","error");
    }
  }

  async function loadCopyData(){
    copyData=await api("/api/permissions/copy-candidates");
  }

  async function showCopy(){
    try{await loadCopyData();}catch(error){return toast(error.message,"error");}
    document.getElementById("v47CopySheet")?.remove();
    const overlay=document.createElement("div");
    overlay.id="v47CopySheet";overlay.className="v47-copy-sheet";
    overlay.innerHTML=`
      <section>
        <header><div><small>COPY CONTROLS</small><h2>Copy a spell or permanent</h2></div><button type="button" data-v47-copy-close>×</button></header>
        <h3>Stack</h3>
        <div class="v47-copy-list">
          ${(copyData.stack||[]).map((item)=>`<button type="button" data-v47-copy-stack="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.kind)}</small></button>`).join("")||"<p>Stack is empty.</p>"}
        </div>
        <h3>Battlefield</h3>
        <div class="v47-copy-list">
          ${(copyData.permanents||[]).map((entry)=>`<button type="button" data-v47-copy-permanent="${escapeHtml(entry.card.id)}"><strong>${escapeHtml(cardName(entry.card))}</strong><small>${escapeHtml(entry.playerName)}</small></button>`).join("")||"<p>No permanents.</p>"}
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function copy(path,body){
    try{
      await api(path,body);
      document.getElementById("v47CopySheet")?.remove();
      toast("Copy created.","success");
    }catch(error){toast(error.message||"Copy failed.","error");}
  }

  async function poll(){
    clearTimeout(pollTimer);
    try{
      const payload=await api("/api/permissions/list");
      permissions=payload.permissions||[];
      installButton();
    }catch{}
    pollTimer=setTimeout(poll,document.hidden?4000:1200);
  }

  document.addEventListener("click",(event)=>{
    if(event.target.closest("#v47PlayableButton")){event.preventDefault();showPlayable();}
    if(event.target.closest("[data-v47-close]")){event.preventDefault();document.getElementById("v47PlayableSheet")?.remove();}
    const play=event.target.closest("[data-v47-play]");
    if(play){event.preventDefault();const permission=permissions.find((entry)=>entry.id===play.dataset.v47Play);if(permission)proxyOpen(permission);}
    const cast=event.target.closest("[data-v47-permission-cast]");
    if(cast){event.preventDefault();castPermission(cast.closest("#castCardForm"),cast);}
    if(event.target.closest("[data-v47-copy-open]")){event.preventDefault();showCopy();}
    if(event.target.closest("[data-v47-copy-close]")){event.preventDefault();document.getElementById("v47CopySheet")?.remove();}
    const stack=event.target.closest("[data-v47-copy-stack]");
    if(stack){event.preventDefault();copy("/api/permissions/copy-stack",{stackItemId:stack.dataset.v47CopyStack});}
    const permanent=event.target.closest("[data-v47-copy-permanent]");
    if(permanent){event.preventDefault();copy("/api/permissions/copy-permanent",{targetCardId:permanent.dataset.v47CopyPermanent});}
  });

  const observer=new MutationObserver(()=>{
    installButton();
    const form=document.getElementById("castCardForm");if(form)enhancePermissionCast(form);
  });
  const app=document.getElementById("app");
  if(app)observer.observe(app,{childList:true,subtree:true});
  const modalBody=document.getElementById("modalBody");
  if(modalBody)observer.observe(modalBody,{childList:true,subtree:true});

  document.addEventListener("visibilitychange",poll);
  window.addEventListener("load",poll,{once:true});
  poll();

  window.ArenaCommanderPermissionsV47={version:VERSION,refresh:poll};
})();
