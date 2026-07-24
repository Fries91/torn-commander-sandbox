(() => {
  "use strict";

  const VERSION = "46.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  let pendingTimer = null;
  let activeChoiceId = "";

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
    } catch { return null; }
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function cardName(card) {
    return clean(card?.cardData?.name || card?.name || "Card");
  }

  function cardImage(card) {
    return card?.cardData?.imageUrl || card?.imageUrl || card?.cardData?.faces?.[0]?.imageUrl || "";
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
    const payload = await response.json().catch(()=>null);
    if(!response.ok||!payload?.success) throw new Error(payload?.error||`HTTP ${response.status}`);
    return payload;
  }

  function toast(message,type="info"){
    const region=document.getElementById("toastRegion"); if(!region)return;
    const item=document.createElement("div"); item.className=`toast ${type}`; item.textContent=message;
    region.appendChild(item); setTimeout(()=>item.remove(),4300);
  }

  function checkboxCards(cards, group, title) {
    if (!cards?.length) return "";
    return `
      <fieldset class="v46-card-cost-group">
        <legend>${escapeHtml(title)}</legend>
        <div>
          ${cards.map((card)=>`
            <label>
              <input type="checkbox" data-v46-group="${group}" value="${escapeHtml(card.id)}">
              ${cardImage(card)?`<img src="${escapeHtml(cardImage(card))}" alt="">`:""}
              <span>${escapeHtml(cardName(card))}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
    `;
  }

  async function enhanceCastForm(form) {
    if (form.dataset.v46Mechanics) return;
    form.dataset.v46Mechanics="loading";
    const data=new FormData(form);

    try {
      const payload=await api("/api/mechanics/preview",{
        cardId:data.get("cardId"),
        fromZone:data.get("fromZone")||"hand"
      });
      const m=payload.mechanics||{};
      const hasMechanic=Boolean(
        m.kicker||m.multikicker||m.overload||m.buyback||m.flashback||m.escape||
        m.convoke||m.delve||m.improvise||m.cascadeCount||m.discoverValue
      );
      if(!hasMechanic){form.dataset.v46Mechanics="none";return;}

      const panel=document.createElement("section");
      panel.className="v46-mechanics-panel";
      panel.dataset.v46MechanicsPanel="1";
      panel.innerHTML=`
        <header><div><small>ADVANCED CASTING</small><strong>${escapeHtml(payload.cardName)}</strong></div><span>v46</span></header>
        <div class="v46-option-grid">
          ${m.kicker?`<label><input type="checkbox" data-v46-kicker> Kicker ${escapeHtml(m.kicker)}</label>`:""}
          ${m.multikicker?`<label>Multikicker ${escapeHtml(m.multikicker)} <input type="number" min="0" max="20" value="0" data-v46-kicker-count></label>`:""}
          ${m.overload?`<label><input type="checkbox" data-v46-overload> Overload ${escapeHtml(m.overload)}</label>`:""}
          ${m.buyback?`<label><input type="checkbox" data-v46-buyback> Buyback ${escapeHtml(m.buyback)}</label>`:""}
          ${m.flashback&&payload.fromZone==="graveyard"?`<label><input type="checkbox" data-v46-flashback checked> Flashback ${escapeHtml(m.flashback)}</label>`:""}
          ${m.escape&&payload.fromZone==="graveyard"?`<label><input type="checkbox" data-v46-escape> Escape ${escapeHtml(m.escape)}</label>`:""}
        </div>
        ${checkboxCards(payload.candidates?.convoke,"convoke","Tap creatures for Convoke")}
        ${checkboxCards(payload.candidates?.improvise,"improvise","Tap artifacts for Improvise")}
        ${checkboxCards(payload.candidates?.delve,"delve","Exile cards for Delve")}
        ${checkboxCards(payload.candidates?.escape,"escape","Exile other cards for Escape")}
        <button type="button" class="v46-cast-button" data-v46-cast>
          <strong>Use mechanics, Auto-Tap & Cast</strong>
          <small>Apply selected costs and put the spell on the stack</small>
        </button>
      `;

      const autoPanel=form.querySelector("[data-v42-autotap-panel]");
      (autoPanel||form.querySelector("button[type='submit']"))?.before(panel);
      if(autoPanel) autoPanel.classList.add("v46-base-autotap-hidden");
      form.dataset.v46Mechanics="ready";
    } catch {
      form.dataset.v46Mechanics="error";
    }
  }

  function selected(form,group){
    return [...form.querySelectorAll(`[data-v46-group="${group}"]:checked`)].map((input)=>input.value);
  }

  async function cast(form,button){
    const data=new FormData(form);
    button.disabled=true;
    const old=button.innerHTML;
    button.innerHTML="<strong>Applying mechanics…</strong><small>Paying costs on the server</small>";
    try{
      await api("/api/mechanics/cast",{
        cardId:data.get("cardId"),
        fromZone:data.get("fromZone")||"hand",
        xValue:Number(data.get("xValue")||0),
        modes:String(data.get("modes")||"").split(/\s*;\s*|\n/).filter(Boolean),
        additionalCosts:String(data.get("additionalCosts")||"").split(/\s*;\s*|\n/).filter(Boolean),
        targets:data.getAll("targets").map(String),
        kicker:Boolean(form.querySelector("[data-v46-kicker]:checked")),
        kickerCount:Number(form.querySelector("[data-v46-kicker-count]")?.value||0),
        overload:Boolean(form.querySelector("[data-v46-overload]:checked")),
        buyback:Boolean(form.querySelector("[data-v46-buyback]:checked")),
        flashback:Boolean(form.querySelector("[data-v46-flashback]:checked")),
        escape:Boolean(form.querySelector("[data-v46-escape]:checked")),
        convokeCardIds:selected(form,"convoke"),
        improviseCardIds:selected(form,"improvise"),
        delveCardIds:selected(form,"delve"),
        escapeExileCardIds:selected(form,"escape")
      });
      document.querySelector("#modalBackdrop [data-action='close-modal']")?.click();
      toast("Advanced casting costs paid.", "success");
    }catch(error){
      button.disabled=false; button.innerHTML=old;
      toast(error.message||"Advanced casting failed.","error");
    }
  }

  function closeChoice(){
    document.getElementById("v46MechanicChoice")?.remove();
    activeChoiceId="";
  }

  function renderChoice(choice){
    if(!choice||choice.id===activeChoiceId)return;
    closeChoice(); activeChoiceId=choice.id;
    const card=choice.candidate;
    const overlay=document.createElement("div");
    overlay.id="v46MechanicChoice"; overlay.className="v46-mechanic-choice"; overlay.dataset.choiceId=choice.id;
    overlay.innerHTML=`
      <section>
        <header><div><small>${escapeHtml(choice.kind.toUpperCase())}</small><h2>${escapeHtml(choice.sourceName)}</h2></div><span>FOUND CARD</span></header>
        ${cardImage(card)?`<img src="${escapeHtml(cardImage(card))}" alt="${escapeHtml(cardName(card))}">`:""}
        <h3>${escapeHtml(cardName(card))}</h3>
        <div>
          <button type="button" data-v46-decline>Put on bottom</button>
          ${choice.kind==="discover"?`<button type="button" data-v46-hand>Put into hand</button>`:""}
          <button type="button" class="v46-free" data-v46-free>Cast without paying mana</button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  async function resolveChoice(decision){
    const overlay=document.getElementById("v46MechanicChoice"); if(!overlay)return;
    overlay.querySelectorAll("button").forEach((button)=>button.disabled=true);
    try{
      await api("/api/mechanics/resolve",{choiceId:overlay.dataset.choiceId,decision});
      closeChoice();
      toast(decision==="cast"?"Free-cast permission created.":"Mechanic choice completed.","success");
    }catch(error){
      overlay.querySelectorAll("button").forEach((button)=>button.disabled=false);
      toast(error.message||"Unable to resolve mechanic.","error");
    }
  }

  async function pollPending(){
    clearTimeout(pendingTimer);
    try{
      const payload=await api("/api/mechanics/pending");
      if(payload.choices?.[0])renderChoice(payload.choices[0]); else closeChoice();
    }catch{}
    pendingTimer=setTimeout(pollPending,document.hidden?3500:1000);
  }

  document.addEventListener("click",(event)=>{
    const castButton=event.target.closest("[data-v46-cast]");
    if(castButton){event.preventDefault();cast(castButton.closest("#castCardForm"),castButton);}
    if(event.target.closest("[data-v46-free]")){event.preventDefault();resolveChoice("cast");}
    if(event.target.closest("[data-v46-hand]")){event.preventDefault();resolveChoice("hand");}
    if(event.target.closest("[data-v46-decline]")){event.preventDefault();resolveChoice("decline");}
  });

  const observer=new MutationObserver(()=>{
    const form=document.getElementById("castCardForm"); if(form)enhanceCastForm(form);
  });
  const modalBody=document.getElementById("modalBody");
  if(modalBody)observer.observe(modalBody,{childList:true,subtree:true});

  document.addEventListener("visibilitychange",pollPending);
  window.addEventListener("load",pollPending,{once:true});
  pollPending();

  window.ArenaCommanderMechanicsV46={version:VERSION,refresh:pollPending};
})();
