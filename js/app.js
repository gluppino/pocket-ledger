import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  createFamily, joinFamily, loginParent, logout, getUserProfile,
  ensureParentLookup, requestPasswordReset, claimKidProfile
} from "./auth.js";

const $ = (id) => document.getElementById(id);

let profile = null;       // { familyId, role, name, kidId? }
let familyData = { name:"", inviteCode:"" };
let chores = [];
let ledger = [];
let requests = [];
let goal = { name:"", target:0, saved:0 };   // kid role's own goal
let goalsByKid = {};                          // parent role: kidId -> goal
let kids = [];             // active (non-archived) kid member docs
let archivedKids = [];
let selectedKidId = null;  // which kid the parent is currently viewing
let unsubs = [];
let activeTab = "chores";
let lastJoinRole = "parent";
let pendingKidSwitch = false;

function showToast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2000);
}

function esc(s){
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
function money(n){
  const v = Math.round((n||0)*100)/100;
  return (v<0?"-$":"$") + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function todayStr(){
  return new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});
}

function haptic(pattern=15){
  if(navigator.vibrate){
    try{ navigator.vibrate(pattern); }catch(e){ /* unsupported or blocked, ignore */ }
  }
}

const CONFETTI_COLORS = ["#0A0A0A","#DC2626","#F5F5F5","#737373","#FACC15","#16A34A"];
function confettiBurst(){
  if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const container = document.createElement("div");
  container.className = "confetti-container";
  for(let i=0;i<28;i++){
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random()*100 + "%";
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random()*CONFETTI_COLORS.length)];
    piece.style.animationDelay = (Math.random()*0.25) + "s";
    piece.style.transform = `rotate(${Math.random()*360}deg)`;
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(()=>container.remove(), 1800);
}

function showScreen(id){
  ["loading","screen-welcome","screen-create-family","screen-join-family","screen-login","screen-forgot-password","screen-app"]
    .forEach(s => $(s).classList.toggle("hide", s !== id));
}

/* ---------- auth wiring ---------- */

$("nav-create").onclick = () => showScreen("screen-create-family");
$("nav-join").onclick = () => showScreen("screen-join-family");
$("nav-login").onclick = () => showScreen("screen-login");
document.querySelectorAll(".back-to-welcome").forEach(b => b.onclick = () => showScreen("screen-welcome"));

$("create-family-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("create-family-error").classList.add("hide");
  try{
    await createFamily({
      familyName: f.familyName.value.trim(),
      parentName: f.parentName.value.trim(),
      email: f.email.value.trim(),
      password: f.password.value
    });
    showToast("Family created");
  }catch(err){
    $("create-family-error").textContent = friendlyError(err);
    $("create-family-error").classList.remove("hide");
  }
};

document.querySelectorAll(".join-role-btn").forEach(btn=>{
  btn.onclick = () => {
    lastJoinRole = btn.dataset.role;
    document.querySelectorAll(".join-role-btn").forEach(b=>b.classList.toggle("active", b===btn));
    $("join-parent-fields").classList.toggle("hide", lastJoinRole!=="parent");
    $("join-kid-note").classList.toggle("hide", lastJoinRole!=="kid");
    const pwInput = $("join-family-form").password;
    pwInput.required = lastJoinRole === "parent";
  };
});

$("join-family-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("join-family-error").classList.add("hide");
  try{
    if(lastJoinRole === "parent"){
      await joinFamily({
        inviteCode: f.inviteCode.value.trim(),
        name: f.name.value.trim(),
        email: f.email.value.trim(),
        password: f.password.value
      });
      showToast("Welcome to the family");
    } else {
      await claimKidProfile(f.name.value.trim(), f.inviteCode.value.trim());
      showToast("Welcome!");
    }
  }catch(err){
    $("join-family-error").textContent = friendlyError(err);
    $("join-family-error").classList.remove("hide");
  }
};

$("nav-forgot-password").onclick = () => showScreen("screen-forgot-password");

$("forgot-password-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("forgot-password-error").classList.add("hide");
  $("forgot-password-success").classList.add("hide");
  try{
    await requestPasswordReset(f.email.value.trim(), f.inviteCode.value.trim());
    $("forgot-password-success").textContent = "Check your email for a link to set a new password.";
    $("forgot-password-success").classList.remove("hide");
    f.reset();
  }catch(err){
    $("forgot-password-error").textContent = friendlyError(err);
    $("forgot-password-error").classList.remove("hide");
  }
};

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("login-error").classList.add("hide");
  try{
    await loginParent(f.email.value.trim(), f.password.value);
  }catch(err){
    $("login-error").textContent = friendlyError(err);
    $("login-error").classList.remove("hide");
  }
};

function friendlyError(err){
  const code = err && err.code || "";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "That password doesn't match.";
  if(code.includes("user-not-found")) return "No account found with those details.";
  if(code.includes("email-already-in-use")) return "An account already exists with that email.";
  if(code.includes("weak-password")) return "Password should be at least 6 characters.";
  if(code.includes("admin-restricted-operation")) return "Kid sign-in isn't turned on yet — ask a parent to enable Anonymous sign-in in Firebase.";
  return err.message || "Something went wrong. Try again.";
}

/* ---------- auth state ---------- */

onAuthStateChanged(auth, async (user) => {
  cleanupListeners();
  if(!user){
    profile = null;
    if(pendingKidSwitch){
      pendingKidSwitch = false;
      showScreen("screen-join-family");
      document.querySelector('.join-role-btn[data-role="kid"]').click();
    } else {
      showScreen("screen-welcome");
    }
    return;
  }
  showScreen("loading");
  // On fresh signup, the auth account exists a beat before the Firestore
  // profile doc does (createFamily/joinFamily write it after auth succeeds).
  // Retry briefly instead of bailing to the welcome screen on the first miss.
  profile = await getUserProfile(user.uid);
  for(let attempt=0; !profile && attempt<10; attempt++){
    await new Promise(r=>setTimeout(r, 300));
    profile = await getUserProfile(user.uid);
  }
  if(!profile){
    showScreen("screen-welcome");
    showToast("Account created, but profile setup didn't finish. Try logging in again.");
    return;
  }
  if(profile.role === "kid" && !profile.kidId){
    // Pre-multi-kid test data with no stable kidId — can't safely scope
    // queries. Send them back through the claim flow to re-establish it.
    showScreen("screen-welcome");
    showToast("Please rejoin using your name and the family join code.");
    return;
  }
  activeTab = "chores";
  selectedKidId = null;
  attachListeners(profile.familyId);
  showScreen("screen-app");
  if(profile.role === "parent") ensureParentLookup(user.uid, profile.familyId);
});

function cleanupListeners(){
  unsubs.forEach(u=>u());
  unsubs = [];
}

function attachListeners(familyId){
  const famRef = doc(db, "families", familyId);
  unsubs.push(onSnapshot(famRef, (snap)=>{
    if(snap.exists()){
      const d = snap.data();
      familyData = { name: d.name||"", inviteCode: d.inviteCode||"" };
      render();
    }
  }));

  const membersQ = collection(db, "families", familyId, "members");
  unsubs.push(onSnapshot(membersQ, (snap)=>{
    const allKids = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(m=>m.role==="kid");
    const byName = (a,b) => a.name.localeCompare(b.name);
    kids = allKids.filter(k=>!k.archived).sort(byName);
    archivedKids = allKids.filter(k=>k.archived).sort(byName);
    if(profile && profile.role==="parent" && (!selectedKidId || !kids.find(k=>k.id===selectedKidId))){
      selectedKidId = kids[0] ? kids[0].id : null;
    }
    render();
  }));

  const choresQ = profile.role==="kid"
    ? query(collection(db, "families", familyId, "chores"), where("kidId","==",profile.kidId))
    : collection(db, "families", familyId, "chores");
  unsubs.push(onSnapshot(choresQ, (snap)=>{
    chores = snap.docs.map(d=>({id:d.id, ...d.data()}));
    render();
  }));

  const ledgerQ = profile.role==="kid"
    ? query(collection(db, "families", familyId, "ledger"), where("kidId","==",profile.kidId))
    : collection(db, "families", familyId, "ledger");
  unsubs.push(onSnapshot(ledgerQ, (snap)=>{
    ledger = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>b.createdAt-a.createdAt);
    render();
  }));

  const reqQ = profile.role==="kid"
    ? query(collection(db, "families", familyId, "requests"), where("kidId","==",profile.kidId))
    : collection(db, "families", familyId, "requests");
  unsubs.push(onSnapshot(reqQ, (snap)=>{
    requests = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>b.createdAt-a.createdAt);
    render();
  }));

  if(profile.role==="kid"){
    const goalRef = doc(db, "families", familyId, "goal", profile.kidId);
    unsubs.push(onSnapshot(goalRef, (snap)=>{
      goal = snap.exists() ? snap.data() : { name:"", target:0, saved:0 };
      render();
    }));
  } else {
    const goalsQ = collection(db, "families", familyId, "goal");
    unsubs.push(onSnapshot(goalsQ, (snap)=>{
      goalsByKid = {};
      snap.docs.forEach(d=>{ goalsByKid[d.id] = d.data(); });
      render();
    }));
  }
}

/* ---------- derived ---------- */

function currentKidId(){
  return profile.role==="kid" ? profile.kidId : selectedKidId;
}
function currentKidGoal(){
  return profile.role==="kid" ? goal : (goalsByKid[selectedKidId] || {name:"",target:0,saved:0});
}
function computeBalance(ledgerArr){
  let bal = 0;
  ledgerArr.forEach(e=>{
    if(e.type === "sent") bal -= e.amount;
    else if(e.status === "approved") bal += e.amount;
  });
  return bal;
}
function availableToSpend(ledgerArr, goalObj){
  return computeBalance(ledgerArr) - (goalObj.saved||0);
}

/* ---------- actions ---------- */

window.appActions = {
  signOut: () => logout(),

  switchKid: () => {
    pendingKidSwitch = true;
    return logout();
  },

  selectKid: (kidId) => { selectedKidId = kidId; render(); },

  setTab: (t) => { activeTab = t; render(); },

  addKid: async () => {
    const name = $("newKidName").value.trim();
    if(!name) return;
    try{
      await addDoc(collection(db,"families",profile.familyId,"members"), { name, role:"kid", archived:false });
      $("newKidName").value = "";
      showToast("Kid added");
    }catch(err){
      showToast(friendlyError(err));
    }
  },
  archiveKid: async (kidId) => {
    if(!confirm("Archive this kid? Their history stays, but they'll disappear from active lists and can't be re-claimed by name + join code.")) return;
    try{
      await updateDoc(doc(db,"families",profile.familyId,"members",kidId), { archived: true });
      showToast("Kid archived");
    }catch(err){
      showToast(friendlyError(err));
    }
  },

  markDone: async (choreId) => {
    const chore = chores.find(c=>c.id===choreId);
    if(!chore) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"chore", desc:chore.title, amount:chore.amount, status:"pending",
      date: todayStr(), createdAt: Date.now(), kidId: chore.kidId
    });
    confettiBurst();
    haptic(15);
    showToast("Sent for approval");
  },

  approveEntry: async (id) => {
    const e = ledger.find(x=>x.id===id);
    if(!e || e.kidId !== currentKidId()) return;
    await updateDoc(doc(db,"families",profile.familyId,"ledger",id), { status:"approved" });
    haptic(20);
  },
  declineEntry: async (id) => {
    const e = ledger.find(x=>x.id===id);
    if(!e || e.kidId !== currentKidId()) return;
    await deleteDoc(doc(db,"families",profile.familyId,"ledger",id));
  },

  addChore: async () => {
    const title = $("newChoreTitle").value.trim();
    const amount = Number($("newChoreAmt").value);
    const kidId = currentKidId();
    if(!title || !amount || amount<=0 || !kidId) return;
    await addDoc(collection(db,"families",profile.familyId,"chores"), { title, amount, kidId });
    $("newChoreTitle").value=""; $("newChoreAmt").value="";
  },
  removeChore: async (id) => {
    const c = chores.find(x=>x.id===id);
    if(!c || c.kidId !== currentKidId()) return;
    await deleteDoc(doc(db,"families",profile.familyId,"chores",id));
  },

  addBonus: async () => {
    const desc = $("bonusDesc").value.trim();
    const amount = Number($("bonusAmt").value);
    const kidId = currentKidId();
    if(!desc || !amount || !kidId) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"bonus", desc, amount, status:"approved", date: todayStr(), createdAt: Date.now(), kidId
    });
    $("bonusDesc").value=""; $("bonusAmt").value="";
  },

  requestAllowance: async () => {
    const amount = Number($("reqAmt").value);
    const note = $("reqNote").value.trim();
    if(!amount || amount<=0) return;
    await addDoc(collection(db,"families",profile.familyId,"requests"), {
      amount, note, status:"pending", requestedByName: profile.name,
      date: todayStr(), createdAt: Date.now(), kidId: profile.kidId
    });
    showToast("Request sent");
    $("reqNote").value="";
  },
  approveRequest: async (id) => {
    const r = requests.find(x=>x.id===id);
    if(!r) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"sent", desc: r.note ? `Sent via Apple Cash — ${r.note}` : "Sent via Apple Cash",
      amount:r.amount, status:"approved", date: todayStr(), createdAt: Date.now(), kidId: r.kidId
    });
    await updateDoc(doc(db,"families",profile.familyId,"requests",id), { status:"sent" });
    haptic(20);
    showToast("Marked as sent");
  },
  declineRequest: async (id) => {
    await updateDoc(doc(db,"families",profile.familyId,"requests",id), { status:"declined" });
  },
  openMessages: () => {
    const viewingKid = kids.find(k=>k.id===currentKidId());
    if(!viewingKid || !viewingKid.phone) return;
    window.open("sms:" + viewingKid.phone.replace(/[^0-9+]/g,""), "_blank");
  },

  allocateToGoal: async (amount) => {
    const kidId = currentKidId();
    if(!kidId) return;
    const kidGoalObj = currentKidGoal();
    const kidLedgerArr = ledger.filter(e=>e.kidId===kidId);
    const avail = availableToSpend(kidLedgerArr, kidGoalObj);
    const amt = Math.min(amount, avail);
    if(amt<=0) return;
    await setDoc(doc(db,"families",profile.familyId,"goal",kidId), {
      name: kidGoalObj.name||"", target: kidGoalObj.target||0, saved: (kidGoalObj.saved||0) + amt
    });
  },
  deallocateFromGoal: async (amount) => {
    const kidId = currentKidId();
    if(!kidId) return;
    const kidGoalObj = currentKidGoal();
    const amt = Math.min(amount, kidGoalObj.saved||0);
    if(amt<=0) return;
    await setDoc(doc(db,"families",profile.familyId,"goal",kidId), {
      name: kidGoalObj.name||"", target: kidGoalObj.target||0, saved: (kidGoalObj.saved||0) - amt
    });
  },
  saveGoalSettings: async () => {
    const kidId = currentKidId();
    if(!kidId) return;
    const name = $("setGoalName").value.trim();
    const target = Number($("setGoalTarget").value) || 0;
    const kidGoalObj = currentKidGoal();
    await setDoc(doc(db,"families",profile.familyId,"goal",kidId), {
      name, target, saved: kidGoalObj.saved||0
    });
    showToast("Goal saved");
  },
  saveKidPhone: async () => {
    const kidId = currentKidId();
    if(!kidId) return;
    const phone = $("setKidPhone").value.trim();
    await updateDoc(doc(db,"families",profile.familyId,"members",kidId), { phone });
    showToast("Settings saved");
  }
};

/* ---------- pull to refresh ---------- */
// Data is already realtime via onSnapshot, so there's nothing to re-fetch;
// this just gives the familiar mobile gesture + confirmation the list is current.
(function setupPullToRefresh(){
  const PULL_THRESHOLD = 64;
  const indicator = document.createElement("div");
  indicator.className = "ptr-indicator";
  indicator.innerHTML = '<i class="ti ti-refresh"></i>';
  document.body.appendChild(indicator);

  let startY = null;
  let pulling = false;

  function active(){
    return !$("screen-app").classList.contains("hide") && window.scrollY === 0;
  }

  document.addEventListener("touchstart", (e) => {
    if(active()){
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, {passive:true});

  document.addEventListener("touchmove", (e) => {
    if(!pulling || startY==null) return;
    const dy = e.touches[0].clientY - startY;
    if(dy > 0 && window.scrollY === 0){
      const pull = Math.min(dy, 90);
      indicator.style.transform = `translate(-50%, ${pull - 40}px)`;
      indicator.classList.toggle("ready", pull > PULL_THRESHOLD);
    }
  }, {passive:true});

  document.addEventListener("touchend", () => {
    if(!pulling) return;
    pulling = false;
    if(indicator.classList.contains("ready")){
      indicator.classList.add("spinning");
      haptic(10);
      setTimeout(()=>{
        indicator.classList.remove("spinning","ready");
        indicator.style.transform = "";
        showToast("Up to date");
      }, 600);
    } else {
      indicator.style.transform = "";
    }
    startY = null;
  });
})();

/* ---------- rendering ---------- */

function render(){
  if(!profile) return;
  const kidId = currentKidId();
  const kidChores = chores.filter(c=>c.kidId===kidId);
  const kidLedgerArr = ledger.filter(e=>e.kidId===kidId);
  const kidRequestsArr = requests.filter(r=>r.kidId===kidId);
  const kidGoalObj = currentKidGoal();
  const bal = computeBalance(kidLedgerArr);
  const pendingReqCount = kidRequestsArr.filter(r=>r.status==="pending").length;

  $("app-root").innerHTML = `
    <div class="cover">
      <p class="cover-eyebrow">Pocket Ledger</p>
      <h1 class="cover-title">${esc(familyData.name || "Our family")}</h1>
      ${profile.role==="parent" ? renderKidSwitcher() : ""}
      <div class="cover-row">
        <p class="cover-name">Signed in as <b>${esc(profile.name)}</b> (${profile.role})</p>
        <div style="text-align:right">
          <p class="balance-label">Balance</p>
          <p class="balance-amt">${money(bal)}</p>
        </div>
      </div>
      <div class="signout-row">
        ${profile.role==="kid" ? `<button class="signout-btn" onclick="appActions.switchKid()">Not you? Switch kid</button>` : ""}
        <button class="signout-btn" onclick="appActions.signOut()">Sign out</button>
      </div>
    </div>
    <div class="tabs">
      ${tabBtn("chores","Chores")}
      ${tabBtn("requests","Requests", pendingReqCount>0 && profile.role==="parent")}
      ${tabBtn("ledger","Ledger")}
      ${tabBtn("goal","Goal")}
      ${profile.role==="parent" ? tabBtn("settings","Settings") : ""}
    </div>
    <div class="panel">${renderPanel(kidChores, kidLedgerArr, kidRequestsArr, kidGoalObj)}</div>
  `;
}

function renderKidSwitcher(){
  if(kids.length===0){
    return `<p class="sub" style="margin:8px 0 0">No kids added yet — add one in Settings.</p>`;
  }
  return `<div class="kid-switcher">${kids.map(k=>
    `<button class="kid-pill ${k.id===selectedKidId?"active":""}" onclick="appActions.selectKid('${k.id}')">${esc(k.name)}</button>`
  ).join("")}</div>`;
}

function tabBtn(key, label, dot){
  return `<button class="tab ${activeTab===key?"active":""}" onclick="appActions.setTab('${key}')">${label}${dot?'<span class="badge-dot"></span>':""}</button>`;
}

function renderPanel(kidChores, kidLedgerArr, kidRequestsArr, kidGoalObj){
  if(activeTab==="settings" && profile.role!=="parent") activeTab = "chores";
  if(profile.role==="parent" && kids.length===0 && activeTab!=="settings"){
    return `<div class="empty"><div class="empty-badge"><i class="ti ti-user-plus"></i></div><p>Add a kid to get started.</p><p>Head to Settings to add your first kid.</p></div>`;
  }
  if(activeTab==="chores") return renderChores(kidChores, kidLedgerArr);
  if(activeTab==="requests") return renderRequests(kidRequestsArr, kidLedgerArr, kidGoalObj);
  if(activeTab==="ledger") return renderLedger(kidLedgerArr);
  if(activeTab==="goal") return renderGoal(kidLedgerArr, kidGoalObj);
  if(activeTab==="settings") return renderSettings(kidGoalObj);
  return "";
}

function renderChores(kidChores, kidLedgerArr){
  const pending = kidLedgerArr.filter(e=>e.status==="pending");
  const viewingKid = kids.find(k=>k.id===currentKidId());
  const forName = viewingKid ? ` for ${esc(viewingKid.name)}` : "";
  let html = `<h2 class="section">Chores</h2><p class="sub">Tap a chore when it's done. It lands in approval until a parent okays it.</p>`;

  if(kidChores.length===0){
    html += `<div class="empty"><div class="empty-badge"><i class="ti ti-clipboard-list"></i></div><p>All clear — no chores yet.</p>${profile.role==="parent"?'<p>Add one below.</p>':'<p>Ask a parent to add some.</p>'}</div>`;
  } else {
    kidChores.forEach(c=>{
      html += `<div class="card chore-row">
        <div class="chore-info"><p class="chore-title">${esc(c.title)}</p><p class="chore-amt">${money(c.amount)}</p></div>
        ${profile.role==="parent"
          ? `<button class="btn small danger" onclick="appActions.removeChore('${c.id}')">Remove</button>`
          : `<button class="btn small" onclick="appActions.markDone('${c.id}')">Mark done</button>`}
      </div>`;
    });
  }

  if(profile.role==="parent"){
    html += `<div class="section-divider">
      <label>Add a chore${forName}</label>
      <div class="add-chore-form">
        <input id="newChoreTitle" placeholder="Empty dishwasher" />
        <input id="newChoreAmt" type="number" min="0" step="0.5" placeholder="$" />
        <button class="btn small" onclick="appActions.addChore()">Add</button>
      </div>
    </div>`;
  }

  if(pending.length>0){
    html += `<div class="section-divider"><h2 class="section">Awaiting approval</h2><p class="sub">${profile.role==="parent"?"Approve to add these to the balance.":"A parent needs to approve these."}</p>`;
    pending.forEach(e=>{
      html += `<div class="pending-card">
        <div class="info"><p class="who">${esc(e.desc)}</p><p class="amt">${e.date} · ${money(e.amount)}</p></div>
        ${profile.role==="parent" ? `<div class="pending-actions">
          <button class="btn small" onclick="appActions.approveEntry('${e.id}')">Approve</button>
          <button class="btn small secondary" onclick="appActions.declineEntry('${e.id}')">Decline</button>
        </div>` : `<span class="stamp">Pending</span>`}
      </div>`;
    });
    html += `</div>`;
  }

  if(profile.role==="parent"){
    html += `<div class="section-divider">
      <label>Add a one-off bonus or adjustment${forName}</label>
      <div class="add-chore-form">
        <input id="bonusDesc" placeholder="Birthday money" />
        <input id="bonusAmt" type="number" step="0.5" placeholder="$" />
        <button class="btn small" onclick="appActions.addBonus()">Add</button>
      </div>
      <p class="sub" style="margin-top:8px">Use a negative number to subtract.</p>
    </div>`;
  }
  return html;
}

function renderRequests(kidRequestsArr, kidLedgerArr, kidGoalObj){
  let html = `<h2 class="section">Requests</h2>`;

  if(profile.role==="kid"){
    const avail = availableToSpend(kidLedgerArr, kidGoalObj);
    html += `<p class="sub">Ask for your balance whenever you're ready — no need to wait for someone to remember.</p>
    <div class="send-box">
      <label>Amount</label>
      <input id="reqAmt" type="number" min="0" step="0.5" value="${avail>0?avail.toFixed(2):""}" />
      <label>Note (optional)</label>
      <input id="reqNote" placeholder="Saving up for shoes" />
      <button class="btn full" style="margin-top:12px" onclick="appActions.requestAllowance()">Request allowance</button>
    </div>`;
    html += `<div class="section-divider"><h2 class="section">History</h2>`;
    if(kidRequestsArr.length===0){
      html += `<div class="empty"><div class="empty-badge"><i class="ti ti-send"></i></div><p>No requests yet.</p></div>`;
    } else {
      kidRequestsArr.forEach(r=>{
        html += `<div class="pending-card">
          <div class="info"><p class="who">${esc(r.note || "Allowance request")}</p><p class="amt">${r.date} · ${money(r.amount)}</p></div>
          <span class="stamp ${r.status==="sent"?"good":""}">${r.status}</span>
        </div>`;
      });
    }
    html += `</div>`;
  } else {
    const pending = kidRequestsArr.filter(r=>r.status==="pending");
    const viewingKid = kids.find(k=>k.id===currentKidId());
    html += `<p class="sub">Allowance requests from the kids land here.</p>`;
    if(pending.length===0){
      html += `<div class="empty"><div class="empty-badge"><i class="ti ti-send"></i></div><p>You're all caught up.</p></div>`;
    } else {
      pending.forEach(r=>{
        html += `<div class="pending-card">
          <div class="info"><p class="who">${esc(r.requestedByName)} — ${esc(r.note || "allowance")}</p><p class="amt">${r.date} · ${money(r.amount)}</p></div>
          <div class="pending-actions">
            <button class="btn small" onclick="appActions.approveRequest('${r.id}')">Approve and send</button>
            <button class="btn small secondary" onclick="appActions.declineRequest('${r.id}')">Decline</button>
          </div>
        </div>`;
      });
      if(viewingKid && viewingKid.phone){
        html += `<button class="btn secondary full" style="margin-top:8px" onclick="appActions.openMessages()">Open Messages to send</button>`;
      }
    }
  }
  return html;
}

function renderLedger(kidLedgerArr){
  const rows = kidLedgerArr.filter(e=>e.status==="approved");
  let html = `<h2 class="section">Ledger</h2><p class="sub">Every approved chore, bonus, and send, in order.</p>`;
  html += `<div class="send-box"><p class="send-note"><i class="ti ti-info-circle" style="font-size:14px;vertical-align:-2px;margin-right:4px"></i>This app tracks the money, it doesn't move it. Send it however your family usually does (Apple Cash, cash, etc.), then it shows up here once approved.</p></div>`;

  if(rows.length===0){
    html += `<div class="empty"><div class="empty-badge"><i class="ti ti-receipt-2"></i></div><p>Nothing logged yet.</p></div>`;
  } else {
    const chrono = [...rows].reverse();
    let running = 0;
    const withRunning = chrono.map(e=>{ running += (e.type==="sent")?-e.amount:e.amount; return {...e, running}; });
    withRunning.reverse().forEach(e=>{
      const isNeg = e.type==="sent";
      const stampLabel = e.type==="sent" ? "Sent" : (e.type==="bonus" ? "Bonus" : "Approved");
      html += `<div class="ledger-row">
        <div><p class="ledger-desc">${esc(e.desc)}</p><p class="ledger-date">${e.date} &nbsp; <span class="stamp ${isNeg?'':'good'}">${stampLabel}</span></p></div>
        <div><p class="ledger-amt ${isNeg?'neg':'pos'}">${isNeg?'-':'+'}${money(e.amount)}</p></div>
        <p class="ledger-run">bal ${money(e.running)}</p>
      </div>`;
    });
  }
  return html;
}

function renderGoal(kidLedgerArr, kidGoalObj){
  const target = kidGoalObj.target||0;
  const saved = kidGoalObj.saved||0;
  const pct = target>0 ? Math.min(100, Math.round((saved/target)*100)) : 0;
  const avail = availableToSpend(kidLedgerArr, kidGoalObj);

  let html = `<h2 class="section">Savings goal</h2><p class="sub">Set aside part of the balance toward something specific.</p>`;
  if(!kidGoalObj.name){
    html += `<div class="empty"><div class="empty-badge"><i class="ti ti-target-arrow"></i></div><p>No goal set yet.</p><p>${profile.role==="parent"?"Add one in Settings.":"Ask a parent to set one up."}</p></div>`;
    return html;
  }
  html += `<div class="goal-card">
    <p class="goal-name">${esc(kidGoalObj.name)}</p>
    <p class="goal-nums">${money(saved)} of ${money(target)}</p>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="goal-pct">${pct}% there</p>
    <div class="allocate-row">
      <button class="btn small secondary" onclick="appActions.deallocateFromGoal(5)" ${saved<=0?"disabled":""}>- $5</button>
      <button class="btn small" onclick="appActions.allocateToGoal(5)" ${avail<5?"disabled":""}>+ $5 to goal</button>
    </div>
    <p class="sub" style="margin-top:14px">Spendable right now: ${money(avail)}</p>
  </div>`;
  return html;
}

function renderSettings(kidGoalObj){
  const viewingKid = kids.find(k=>k.id===selectedKidId);
  let html = `<h2 class="section">Settings</h2>`;

  html += `<div class="card">
    <p class="chore-title" style="margin-bottom:6px">Invite code</p>
    <p class="sub">Share this with anyone joining the family. Parents pick "Parent," kids pick "Kid."</p>
    <div class="invite-code">${esc(familyData.inviteCode)}</div>
  </div>`;

  html += `<div class="card">
    <p class="chore-title" style="margin-bottom:6px">Kids</p>
    <p class="sub">Add a kid when they're ready to start using the app. Archive them when they age out — their history stays intact.</p>`;
  if(kids.length===0){
    html += `<p class="sub">No kids yet.</p>`;
  } else {
    kids.forEach(k=>{
      html += `<div class="chore-row" style="margin-bottom:8px">
        <div class="chore-info"><p class="chore-title">${esc(k.name)}</p></div>
        <button class="btn small danger" onclick="appActions.archiveKid('${k.id}')">Archive</button>
      </div>`;
    });
  }
  html += `<div class="add-chore-form" style="margin-top:12px">
    <input id="newKidName" placeholder="Kid's name" />
    <button class="btn small" onclick="appActions.addKid()">Add kid</button>
  </div>`;
  if(archivedKids.length>0){
    html += `<div class="section-divider"><label>Archived</label>`;
    archivedKids.forEach(k=>{ html += `<p class="sub">${esc(k.name)}</p>`; });
    html += `</div>`;
  }
  html += `</div>`;

  if(viewingKid){
    html += `<div class="card">
      <p class="chore-title" style="margin-bottom:6px">Savings goal for ${esc(viewingKid.name)}</p>
      <div class="field"><label>Goal name</label><input id="setGoalName" value="${esc(kidGoalObj.name)}" placeholder="New bike" /></div>
      <div class="field"><label>Goal target ($)</label><input id="setGoalTarget" type="number" min="0" step="1" value="${kidGoalObj.target||""}" /></div>
      <button class="btn" onclick="appActions.saveGoalSettings()">Save goal</button>
    </div>`;
    html += `<div class="card">
      <p class="chore-title" style="margin-bottom:6px">${esc(viewingKid.name)}'s phone (optional)</p>
      <p class="sub">Lets you jump straight to Messages when sending Apple Cash.</p>
      <input id="setKidPhone" value="${esc(viewingKid.phone||"")}" placeholder="555-867-5309" />
      <button class="btn" style="margin-top:10px" onclick="appActions.saveKidPhone()">Save</button>
    </div>`;
  }
  return html;
}
