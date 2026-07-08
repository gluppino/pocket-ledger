import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function generateInviteCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

// Best-effort: this bookkeeping write must never block account creation,
// e.g. if the parentLookup security rule hasn't been deployed yet.
async function upsertParentLookup(email, familyId){
  try{
    await setDoc(doc(db, "parentLookup", email.trim().toLowerCase()), { familyId });
  }catch(e){
    console.warn("upsertParentLookup failed", e);
  }
}

export async function createFamily({ familyName, parentName, email, password }){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const familyId = uid + "-family";
  const inviteCode = generateInviteCode();

  await setDoc(doc(db, "families", familyId), {
    name: familyName || "Our family",
    inviteCode,
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "inviteCodes", inviteCode), { familyId });
  await setDoc(doc(db, "users", uid), { familyId, role: "parent", name: parentName });
  await setDoc(doc(db, "families", familyId, "members", uid), {
    name: parentName, role: "parent", email
  });
  await upsertParentLookup(email, familyId);

  return { familyId, inviteCode, uid };
}

export async function lookupFamilyByInviteCode(inviteCode){
  const snap = await getDoc(doc(db, "inviteCodes", inviteCode.trim().toUpperCase()));
  if(!snap.exists()) throw new Error("That invite code doesn't match a family. Double check it with whoever set up the account.");
  return snap.data().familyId;
}

export async function joinFamily({ inviteCode, name, email, password }){
  const familyId = await lookupFamilyByInviteCode(inviteCode);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  await setDoc(doc(db, "users", uid), { familyId, role: "parent", name });
  await setDoc(doc(db, "families", familyId, "members", uid), { name, role: "parent", email });
  await upsertParentLookup(email, familyId);
  return { familyId, uid };
}

export async function loginParent(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout(){
  return signOut(auth);
}

// Kid "login" has no password: a name + the family join code is the whole
// credential (accepted tradeoff — see index.html copy). We sign in
// anonymously, find the matching kid member record by name (added by a
// parent, or from a legacy password-based account), and attach this
// device's anonymous uid to it via `claimedUid`. Re-entering the same
// name + code on a different device re-claims it there too, by design.
export async function claimKidProfile(name, inviteCode){
  const familyId = await lookupFamilyByInviteCode(inviteCode);
  const nameTrim = name.trim();
  if(!nameTrim) throw new Error("Enter your name.");
  const nameLower = nameTrim.toLowerCase();

  if(!auth.currentUser){
    await signInAnonymously(auth);
  }
  const uid = auth.currentUser.uid;

  const membersRef = collection(db, "families", familyId, "members");
  const kidsSnap = await getDocs(query(membersRef, where("role", "==", "kid")));
  const match = kidsSnap.docs.find(d => (d.data().name || "").trim().toLowerCase() === nameLower);

  if(match){
    await updateDoc(doc(db, "families", familyId, "members", match.id), { claimedUid: uid });
  } else {
    await setDoc(doc(db, "families", familyId, "members", uid), {
      name: nameTrim, role: "kid", claimedUid: uid
    });
  }
  await setDoc(doc(db, "users", uid), { familyId, role: "kid", name: nameTrim });
  return { familyId, uid };
}

export async function getUserProfile(uid){
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Backfills parentLookup for accounts created before that collection existed.
// Called on successful parent login; failures are non-fatal (best effort).
export async function ensureParentLookup(uid, familyId){
  try{
    const snap = await getDoc(doc(db, "families", familyId, "members", uid));
    const email = snap.exists() ? snap.data().email : null;
    if(email) await upsertParentLookup(email, familyId);
  }catch(e){
    console.warn("ensureParentLookup failed", e);
  }
}

// Verifies the email + family join code refer to the same family, then
// triggers Firebase Auth's built-in password reset email. There is no
// transactional email service involved — Firebase sends this itself.
export async function requestPasswordReset(email, inviteCode){
  const familyId = await lookupFamilyByInviteCode(inviteCode);
  const emailLower = email.trim().toLowerCase();
  const snap = await getDoc(doc(db, "parentLookup", emailLower));
  if(!snap.exists() || snap.data().familyId !== familyId){
    throw new Error("That email and join code don't match a parent account. Double check both with whoever set up the family.");
  }
  await sendPasswordResetEmail(auth, email.trim());
}
