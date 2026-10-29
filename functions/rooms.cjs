const { randomBytes, createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new HttpsError(code, message); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

// All authority comes from the verified callable UID and server-owned documents.
async function roomOperation(db, uid, input = {}) {
  if (!uid) fail('unauthenticated', 'Sign in to use rooms.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-argument', 'Invalid room request.');
  const { action } = input;
  const directory = db.collection(`roomDirectories/${uid}/rooms`);
  if (action === 'list') {
    let query = directory.orderBy('__name__').limit(51);
    if (input.cursor) {
      if (!validId(input.cursor)) fail('invalid-argument', 'Invalid page.');
      query = query.startAfter(input.cursor);
    }
    const rows = (await query.get()).docs;
    return { rooms: rows.slice(0, 50).map(doc => ({ id: doc.id, ...doc.data() })), cursor: rows.length > 50 ? rows[49].id : null };
  }
  if (action === 'create') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!name || name.length > 60 || description.length > 500 || !Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 100 || typeof input.allowInvites !== 'boolean' || !validId(input.requestId)) {
      fail('invalid-argument', 'Use a name up to 60 characters, description up to 500, and capacity from 2 to 100.');
    }
    const id = hash(`${uid}:${input.requestId}`);
    const room = db.doc(`rooms/${id}`);
    const code = randomBytes(18).toString('hex');
    await db.runTransaction(async tx => {
      if ((await tx.get(room)).exists) return; // Retried requests create exactly one room.
      const profile = (await tx.get(db.doc(`users/${uid}`))).data();
      const createdAt = new Date().toISOString();
      tx.create(room, { name, description, capacity: input.capacity, allowInvites: input.allowInvites, hostUid: uid, memberCount: 1, status: 'open', createdAt });
      tx.create(room.collection('members').doc(uid), { uid, displayName: profile?.displayName || 'Player', role: 'host', joinedAt: createdAt });
      tx.create(directory.doc(id), { name, role: 'host', joinedAt: createdAt });
      tx.create(db.doc(`roomInvitations/${hash(code)}`), { roomId: id });
      tx.create(room.collection('private').doc('invitation'), { code });
    });
    return { id };
  }
  let id = input.id;
  if (action === 'join') {
    const code = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{36}$/.test(code)) fail('not-found', 'Invalid invitation.');
    id = (await db.doc(`roomInvitations/${hash(code)}`).get()).data()?.roomId;
    if (!id) fail('not-found', 'Invalid invitation.');
  }
  if (!validId(id)) fail('invalid-argument', 'Invalid room.');
  const room = db.doc(`rooms/${id}`);
  if (action === 'join') {
    await db.runTransaction(async tx => {
      const [snapshot, membership, profile] = await Promise.all([tx.get(room), tx.get(room.collection('members').doc(uid)), tx.get(db.doc(`users/${uid}`))]);
      if (!snapshot.exists) fail('not-found', 'Invalid invitation.');
      if (membership.exists) return;
      const data = snapshot.data();
      if (data.status !== 'open') fail('failed-precondition', 'Membership is finalized. This room is closed to new joins.');
      if (!data.allowInvites) fail('failed-precondition', 'Invitations are disabled for this room.');
      if (data.memberCount >= data.capacity) fail('resource-exhausted', 'This room is full.');
      const joinedAt = new Date().toISOString();
      tx.create(room.collection('members').doc(uid), { uid, displayName: profile.data()?.displayName || 'Player', role: 'member', joinedAt });
      tx.create(directory.doc(id), { name: data.name, role: 'member', joinedAt });
      tx.update(room, { memberCount: data.memberCount + 1 });
    });
    return { id };
  }
  if (action === 'finalize') {
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(room);
      if (!snapshot.exists || snapshot.data().hostUid !== uid) fail('permission-denied', 'Only the host can finalize membership.');
      if (snapshot.data().status === 'finalized') return;
      tx.update(room, { status: 'finalized', finalizedAt: new Date().toISOString() });
    });
    return { id };
  }
  const member = await room.collection('members').doc(uid).get();
  if (!member.exists) fail('permission-denied', 'You do not have access to this room.');
  const data = (await room.get()).data();
  if (action === 'chatSend') {
    const message = typeof input.text === 'string' ? input.text.trim() : '';
    if (!message || message.length > 500 || !validId(input.requestId)) fail('invalid-argument', 'Messages must contain 1–500 characters.');
    const ref = room.collection('chat').doc(hash(`${uid}:${input.requestId}`));
    await db.runTransaction(async tx => {
      const [membership, existing] = await Promise.all([tx.get(room.collection('members').doc(uid)), tx.get(ref)]);
      if (!membership.exists) fail('permission-denied', 'Room membership required.');
      if (existing.exists) return;
      tx.create(ref, { senderId: uid, senderName: membership.data().displayName || 'Player', text: message, createdAt: new Date().toISOString() });
    });
    return { sent: true };
  }
  if (action === 'chatList') {
    let query = room.collection('chat').orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(21);
    if (input.cursor) {
      if (!validId(input.cursor)) fail('invalid-argument', 'Invalid cursor.');
      const last = await room.collection('chat').doc(input.cursor).get();
      if (!last.exists) fail('invalid-argument', 'Invalid cursor.');
      query = query.startAfter(last);
    }
    const docs = (await query.get()).docs;
    return { messages: docs.slice(0, 20).map(doc => ({ id: doc.id, ...doc.data() })), cursor: docs.length > 20 ? docs[19].id : null };
  }
  if (action === 'overview') {
    const members = (await room.collection('members').orderBy('joinedAt').limit(100).get()).docs.map(doc => doc.data());
    return { id, ...data, members };
  }
  if (action === 'invite') {
    if (data.hostUid !== uid) fail('permission-denied', 'Only the host can share invitations.');
    if (!data.allowInvites || data.status !== 'open') fail('failed-precondition', 'Invitations are closed.');
    return (await room.collection('private').doc('invitation').get()).data();
  }
  fail('invalid-argument', 'Unknown room operation.');
}
module.exports = { roomOperation };
