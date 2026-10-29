const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const fail = (code, message) => { throw new HttpsError(code, message); };
const bands = Object.freeze([10, 25, 50, 100]);
function capacityBand(capacity) {
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 100) fail('invalid-argument', 'Capacity must be 2–100, including the host.');
  return bands.find(max => capacity <= max);
}

// Deliberately no live adapter or enablement switch: legal, tax, provider and
// infrastructure review must precede a separately reviewed live implementation.
async function commerceOperation(db, uid, input, runtime = process.env) {
  if (!uid) fail('unauthenticated', 'Sign in to review room access.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.action !== 'string') fail('invalid-argument', 'Invalid request.');
  if (input.action === 'commerceStatus') return {
    purchasingEnabled: false, currency: 'INR', capacityBands: [...bands],
    pricingStatus: 'unconfigured', model: 'host-access-only',
    prizes: false, cashouts: false, redeemableXP: false,
  };
  if (input.action === 'commerceReview') return {
    capacity: input.capacity, bandMaximum: capacityBand(input.capacity),
    totalPaise: null, taxPaise: null, currency: 'INR', purchasingEnabled: false,
  };
  if (!input.action.startsWith('commerceTest')) fail('failed-precondition', 'Purchasing is unavailable. No payment has been initiated.');
  const project = runtime.GCLOUD_PROJECT || runtime.GOOGLE_CLOUD_PROJECT;
  if (project !== 'demo-f1predict' || runtime.FUNCTIONS_EMULATOR !== 'true' || !runtime.FIRESTORE_EMULATOR_HOST) {
    fail('failed-precondition', 'Payment simulations are restricted to local emulators.');
  }
  const purchases = db.collection('commerceSimulations').doc(uid).collection('purchases');
  if (input.action === 'commerceTestHistory') {
    let query = purchases.orderBy('__name__').limit(21);
    if (input.cursor) {
      if (!/^[a-f0-9]{64}$/.test(input.cursor)) fail('invalid-argument', 'Invalid cursor.');
      query = query.startAfter(input.cursor);
    }
    const docs = (await query.get()).docs;
    return { simulation: true, purchases: docs.slice(0, 20).map(d => ({ id: d.id, ...d.data() })), cursor: docs.length > 20 ? docs[19].id : null };
  }
  if (input.action !== 'commerceTestAttempt') fail('invalid-argument', 'Unknown simulation.');
  if (typeof input.requestId !== 'string' || !/^[\w-]{1,128}$/.test(input.requestId)) fail('invalid-argument', 'Invalid request ID.');
  const bandMaximum = capacityBand(input.capacity);
  const states = ['pending', 'success', 'failure', 'cancelled'];
  if (!states.includes(input.scenario)) fail('invalid-argument', 'Invalid simulation state.');
  const payload = JSON.stringify([input.capacity, input.scenario]);
  const id = createHash('sha256').update(`${uid}:${input.requestId}`).digest('hex');
  const ref = purchases.doc(id);
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      if (existing.data().payload !== payload) fail('already-exists', 'Use a new request ID for a different simulation.');
      return;
    }
    tx.create(ref, {
      simulation: true, payload, capacity: input.capacity, bandMaximum,
      // Dummy amount exercises formatting only; it is not commercial pricing.
      fixtureTotalPaise: bandMaximum * 100, currency: 'INR',
      scenario: input.scenario, paymentVerified: false, roomCreated: false,
      createdAt: new Date().toISOString(),
    });
  });
  return { id, ...(await ref.get()).data() };
}
module.exports = { commerceOperation, capacityBand };
