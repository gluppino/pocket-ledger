import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  createFamily, joinFamily, loginParent, loginKid, logout, getUserProfile
} from "./auth.js";

const $ = (id) => document.getElementById(id);

let profile = null;       // { familyId, role, name }
let familyData = { name:"", inviteCode:"", kidPhone:"" };
let chores = [];
let ledger = [];
let requests = [];
let goal = { name:"", target:0, saved:0 };
let unsubs = [];
let activeTab = "chores";
let lastJoinRole = "parent";

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
function uid(){ return Math.random().toString(36).slice(2,9); }

function showScreen(id){
  ["loading","screen-welcome","screen-create-family","screen-join-family","screen-login","screen-app"]
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
    $("join-kid-fields").classList.toggle("hide", lastJoinRole!=="kid");
  };
});

$("join-family-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("join-family-error").classList.add("hide");
  try{
    await joinFamily({
      inviteCode: f.inviteCode.value.trim(),
      role: lastJoinRole,
      name: f.name.value.trim(),
      email: lastJoinRole==="parent" ? f.email.value.trim() : undefined,
      username: lastJoinRole==="kid" ? f.username.value.trim() : undefined,
      password: f.password.value
    });
    showToast("Welcome to the family");
  }catch(err){
    $("join-family-error").textContent = friendlyError(err);
    $("join-family-error").classList.remove("hide");
  }
};

document.querySelectorAll(".login-role-btn").forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll(".login-role-btn").forEach(b=>b.classList.toggle("active", b===btn));
    const role = btn.dataset.role;
    $("login-parent-fields").classList.toggle("hide", role!=="parent");
    $("login-kid-fields").classList.toggle("hide", role!=="kid");
    $("login-form").dataset.role = role;
  };
});
$("login-form").dataset.role = "parent";

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  $("login-error").classList.add("hide");
  try{
    if(f.dataset.role === "parent"){
      await loginParent(f.email.value.trim(), f.password.value);
    } else {
      await loginKid(f.inviteCode.value.trim(), f.username.value.trim(), f.password.value);
    }
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
  return err.message || "Something went wrong. Try again.";
}

/* ---------- auth state ---------- */

onAuthStateChanged(auth, async (user) => {
  cleanupListeners();
  if(!user){
    profile = null;
    showScreen("screen-welcome");
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
  attachListeners(profile.familyId);
  showScreen("screen-app");
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
      familyData = { name: d.name||"", inviteCode: d.inviteCode||"", kidPhone: d.kidPhone||"" };
      render();
    }
  }));

  const choresQ = collection(db, "families", familyId, "chores");
  unsubs.push(onSnapshot(choresQ, (snap)=>{
    chores = snap.docs.map(d=>({id:d.id, ...d.data()}));
    render();
  }));

  const ledgerQ = query(collection(db, "families", familyId, "ledger"), orderBy("createdAt","desc"));
  unsubs.push(onSnapshot(ledgerQ, (snap)=>{
    ledger = snap.docs.map(d=>({id:d.id, ...d.data()}));
    render();
  }));

  const reqQ = query(collection(db, "families", familyId, "requests"), orderBy("createdAt","desc"));
  unsubs.push(onSnapshot(reqQ, (snap)=>{
    requests = snap.docs.map(d=>({id:d.id, ...d.data()}));
    render();
  }));

  const goalRef = doc(db, "families", familyId, "goal", "main");
  unsubs.push(onSnapshot(goalRef, (snap)=>{
    goal = snap.exists() ? snap.data() : { name:"", target:0, saved:0 };
    render();
  }));
}

/* ---------- derived ---------- */

function computeBalance(){
  let bal = 0;
  ledger.forEach(e=>{
    if(e.type === "sent") bal -= e.amount;
    else if(e.status === "approved") bal += e.amount;
  });
  return bal;
}
function availableToSpend(){
  return computeBalance() - (goal.saved||0);
}

/* ---------- actions ---------- */

window.appActions = {
  signOut: () => logout(),

  setTab: (t) => { activeTab = t; render(); },

  markDone: async (choreId) => {
    const chore = chores.find(c=>c.id===choreId);
    if(!chore) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"chore", desc:chore.title, amount:chore.amount, status:"pending",
      date: todayStr(), createdAt: Date.now()
    });
    showToast("Sent for approval");
  },

  approveEntry: async (id) => {
    await updateDoc(doc(db,"families",profile.familyId,"ledger",id), { status:"approved" });
  },
  declineEntry: async (id) => {
    await deleteDoc(doc(db,"families",profile.familyId,"ledger",id));
  },

  addChore: async () => {
    const title = $("newChoreTitle").value.trim();
    const amount = Number($("newChoreAmt").value);
    if(!title || !amount || amount<=0) return;
    await addDoc(collection(db,"families",profile.familyId,"chores"), { title, amount });
    $("newChoreTitle").value=""; $("newChoreAmt").value="";
  },
  removeChore: async (id) => {
    await deleteDoc(doc(db,"families",profile.familyId,"chores",id));
  },

  addBonus: async () => {
    const desc = $("bonusDesc").value.trim();
    const amount = Number($("bonusAmt").value);
    if(!desc || !amount) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"bonus", desc, amount, status:"approved", date: todayStr(), createdAt: Date.now()
    });
    $("bonusDesc").value=""; $("bonusAmt").value="";
  },

  requestAllowance: async () => {
    const amount = Number($("reqAmt").value);
    const note = $("reqNote").value.trim();
    if(!amount || amount<=0) return;
    await addDoc(collection(db,"families",profile.familyId,"requests"), {
      amount, note, status:"pending", requestedByName: profile.name,
      date: todayStr(), createdAt: Date.now()
    });
    showToast("Request sent");
    $("reqNote").value="";
  },
  approveRequest: async (id) => {
    const r = requests.find(x=>x.id===id);
    if(!r) return;
    await addDoc(collection(db,"families",profile.familyId,"ledger"), {
      type:"sent", desc: r.note ? `Sent via Apple Cash — ${r.note}` : "Sent via Apple Cash",
      amount:r.amount, status:"approved", date: todayStr(), createdAt: Date.now()
    });
    await updateDoc(doc(db,"families",profile.familyId,"requests",id), { status:"sent" });
    showToast("Marked as sent");
  },
  declineRequest: async (id) => {
    await updateDoc(doc(db,"families",profile.familyId,"requests",id), { status:"declined" });
  },
  openMessages: () => {
    if(!familyData.kidPhone) return;
    window.open("sms:" + familyData.kidPhone.replace(/[^0-9+]/g,""), "_blank");
  },

  allocateToGoal: async (amount) => {
    const avail = availableToSpend();
    const amt = Math.min(amount, avail);
    if(amt<=0) return;
    await setDoc(doc(db,"families",profile.familyId,"goal","main"), {
      name: goal.name||"", target: goal.target||0, saved: (goal.saved||0) + amt
    });
  },
  deallocateFromGoal: async (amount) => {
    const amt = Math.min(amount, goal.saved||0);
    if(amt<=0) return;
    await setDoc(doc(db,"families",profile.familyId,"goal","main"), {
      name: goal.name||"", target: goal.target||0, saved: (goal.saved||0) - amt
    });
  },
  saveGoalSettings: async () => {
    const name = $("setGoalName").value.trim();
    const target = Number($("setGoalTarget").value) || 0;
    await setDoc(doc(db,"families",profile.familyId,"goal","main"), {
      name, target, saved: goal.saved||0
    });
    showToast("Goal saved");
  },
  saveFamilySettings: async () => {
    const kidPhone = $("setKidPhone").value.trim();
    await updateDoc(doc(db,"families",profile.familyId), { kidPhone });
    showToast("Settings saved");
  }
};

/* ---------- rendering ---------- */

function render(){
  if(!profile) return;
  const bal = computeBalance();
  const pendingCount = ledger.filter(e=>e.status==="pending").length
    + requests.filter(r=>r.status==="pending").length;

  $("app-root").innerHTML = `
    <div class="cover">
      <p class="cover-eyebrow">Pocket Ledger</p>
      <h1 class="cover-title">${esc(familyData.name || "Our family")}</h1>
      <div class="cover-row">
        <p class="cover-name">Signed in as <b>${esc(profile.name)}</b> (${profile.role})</p>
        <div style="text-align:right">
          <p class="balance-label">Balance</p>
          <p class="balance-amt">${money(bal)}</p>
        </div>
      </div>
      <div class="signout-row">
        <button class="signout-btn" onclick="appActions.signOut()">Sign out</button>
      </div>
    </div>
    <div class="tabs">
      ${tabBtn("chores","Chores")}
      ${tabBtn("requests","Requests", requests.filter(r=>r.status==="pending").length>0 && profile.role==="parent")}
      ${tabBtn("ledger","Ledger")}
      ${tabBtn("goal","Goal")}
      ${profile.role==="parent" ? tabBtn("settings","Settings") : ""}
    </div>
    <div class="panel">${renderPanel()}</div>
  `;
}

function tabBtn(key, label, dot){
  return `<button class="tab ${activeTab===key?"active":""}" onclick="appActions.setTab('${key}')">${label}${dot?'<span class="badge-dot"></span>':""}</button>`;
}

function renderPanel(){
  if(activeTab==="chores") return renderChores();
  if(activeTab==="requests") return renderRequests();
  if(activeTab==="ledger") return renderLedger();
  if(activeTab==="goal") return renderGoal();
  if(activeTab==="settings") return renderSettings();
  return "";
}

function renderChores(){
  const pending = ledger.filter(e=>e.status==="pending");
  let html = `<h2 class="section">Chores</h2><p class="sub">Tap a chore when it's done. It lands in approval until a parent okays it.</p>`;

  if(chores.length===0){
    html += `<div class="empty"><i class="ti ti-clipboard-list"></i><p>No chores yet.</p>${profile.role==="parent"?'<p>Add one below.</p>':'<p>Ask a parent to add some.</p>'}</div>`;
  } else {
    chores.forEach(c=>{
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
      <label>Add a chore</label>
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
      <label>Add a one-off bonus or adjustment</label>
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

function renderRequests(){
  let html = `<h2 class="section">Requests</h2>`;

  if(profile.role==="kid"){
    const avail = availableToSpend();
    html += `<p class="sub">Ask for your balance whenever you're ready — no need to wait for someone to remember.</p>
    <div class="send-box">
      <label>Amount</label>
      <input id="reqAmt" type="number" min="0" step="0.5" value="${avail>0?avail.toFixed(2):""}" />
      <label>Note (optional)</label>
      <input id="reqNote" placeholder="Saving up for shoes" />
      <button class="btn full" style="margin-top:12px" onclick="appActions.requestAllowance()">Request allowance</button>
    </div>`;
    const mine = requests;
    html += `<div class="section-divider"><h2 class="section">History</h2>`;
    if(mine.length===0){
      html += `<div class="empty"><i class="ti ti-send"></i><p>No requests yet.</p></div>`;
    } else {
      mine.forEach(r=>{
        html += `<div class="pending-card">
          <div class="info"><p class="who">${esc(r.note || "Allowance request")}</p><p class="amt">${r.date} · ${money(r.amount)}</p></div>
          <span class="stamp ${r.status==="sent"?"good":""}">${r.status}</span>
        </div>`;
      });
    }
    html += `</div>`;
  } else {
    const pending = requests.filter(r=>r.status==="pending");
    html += `<p class="sub">Allowance requests from the kids land here.</p>`;
    if(pending.length===0){
      html += `<div class="empty"><i class="ti ti-send"></i><p>No pending requests.</p></div>`;
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
      if(familyData.kidPhone){
        html += `<button class="btn secondary full" style="margin-top:8px" onclick="appActions.openMessages()">Open Messages to send</button>`;
      }
    }
  }
  return html;
}

function renderLedger(){
  const rows = ledger.filter(e=>e.status==="approved");
  let html = `<h2 class="section">Ledger</h2><p class="sub">Every approved chore, bonus, and send, in order.</p>`;
  html += `<div class="send-box"><p class="send-note"><i class="ti ti-info-circle" style="font-size:14px;vertical-align:-2px;margin-right:4px"></i>This app tracks the money, it doesn't move it. Send it however your family usually does (Apple Cash, cash, etc.), then it shows up here once approved.</p></div>`;

  if(rows.length===0){
    html += `<div class="empty"><i class="ti ti-receipt-2"></i><p>Nothing logged yet.</p></div>`;
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

function renderGoal(){
  const target = goal.target||0;
  const saved = goal.saved||0;
  const pct = target>0 ? Math.min(100, Math.round((saved/target)*100)) : 0;
  const avail = availableToSpend();

  let html = `<h2 class="section">Savings goal</h2><p class="sub">Set aside part of the balance toward something specific.</p>`;
  if(!goal.name){
    html += `<div class="empty"><i class="ti ti-target-arrow"></i><p>No goal set yet.</p><p>${profile.role==="parent"?"Add one in Settings.":"Ask a parent to set one up."}</p></div>`;
    return html;
  }
  html += `<div class="goal-card">
    <p class="goal-name">${esc(goal.name)}</p>
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

function renderSettings(){
  let html = `<h2 class="section">Settings</h2>`;
  html += `<div class="card">
    <p class="chore-title" style="margin-bottom:6px">Invite code</p>
    <p class="sub">Share this with anyone joining the family. Parents pick "Parent," kids pick "Kid."</p>
    <div class="invite-code">${esc(familyData.inviteCode)}</div>
  </div>`;
  html += `<div class="card">
    <p class="chore-title" style="margin-bottom:6px">Savings goal</p>
    <div class="field"><label>Goal name</label><input id="setGoalName" value="${esc(goal.name)}" placeholder="New bike" /></div>
    <div class="field"><label>Goal target ($)</label><input id="setGoalTarget" type="number" min="0" step="1" value="${goal.target||""}" /></div>
    <button class="btn" onclick="appActions.saveGoalSettings()">Save goal</button>
  </div>`;
  html += `<div class="card">
    <p class="chore-title" style="margin-bottom:6px">Kid's phone (optional)</p>
    <p class="sub">Lets you jump straight to Messages when sending Apple Cash.</p>
    <input id="setKidPhone" value="${esc(familyData.kidPhone)}" placeholder="555-867-5309" />
    <button class="btn" style="margin-top:10px" onclick="appActions.saveFamilySettings()">Save</button>
  </div>`;
  return html;
}