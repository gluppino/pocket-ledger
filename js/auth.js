import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function generateInviteCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function kidEmail(username, inviteCode){
  const u = username.trim().toLowerCase().replace(/\s+/g,"");
  const c = inviteCode.trim().toLowerCase();
  return `${u}@${c}.pocketledger.local`;
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

export async function joinFamily({ inviteCode, role, name, email, password, username }){
  const familyId = await lookupFamilyByInviteCode(inviteCode);
  let cred;
  if(role === "parent"){
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } else {
    cred = await createUserWithEmailAndPassword(auth, kidEmail(username, inviteCode), password);
  }
  const uid = cred.user.uid;
  await setDoc(doc(db, "users", uid), { familyId, role, name });
  const memberData = role === "parent"
    ? { name, role, email }
    : { name, role, username: username.trim().toLowerCase() };
  await setDoc(doc(db, "families", familyId, "members", uid), memberData);
  return { familyId, uid };
}

export async function loginParent(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

export async function loginKid(inviteCode, username, password){
  return signInWithEmailAndPassword(auth, kidEmail(username, inviteCode), password);
}

export async function logout(){
  return signOut(auth);
}

export async function getUserProfile(uid){
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
