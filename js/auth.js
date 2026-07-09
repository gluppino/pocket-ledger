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
  // The query must itself constrain on `archived` (not just filter client-side
  // after the fact) — Firestore's security rules reject a list query upfront
  // if it can't prove every potential match satisfies the rule, and the rule
  // requires archived != true. Matching the query shape to the rule lets
  // Firestore prove it and allow the read.
  const kidsSnap = await getDocs(query(membersRef, where("role", "==", "kid"), where("archived", "==", false)));
  const match = kidsSnap.docs.find(d => (d.data().name || "").trim().toLowerCase() === nameLower);

  let kidId;
  if(match){
    kidId = match.id;
    await updateDoc(doc(db, "families", familyId, "members", kidId), { claimedUid: uid });
  } else {
    kidId = uid;
    await setDoc(doc(db, "families", familyId, "members", kidId), {
      name: nameTrim, role: "kid", claimedUid: uid, archived: false
    });
  }
  await setDoc(doc(db, "users", uid), { familyId, role: "kid", name: nameTrim, kidId });
  return { familyId, uid, kidId };
}

export async function getUserProfile(uid){
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Triggers Firebase Auth's built-in password reset email — no transactional
// email service involved, Firebase sends this itself. The emailed link is
// the verification step (only someone with inbox access can complete a
// reset), so there's no separate cross-check before sending it.
export async function requestPasswordReset(email){
  await sendPasswordResetEmail(auth, email.trim());
}
