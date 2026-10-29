const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
initializeApp();
const db = getFirestore();
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { roomOperation } = require('./rooms.cjs');
exports.rooms = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 120 }, async request => {
  // Refuse accidental use against the original or any unrelated project.
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!['f1predict-1188e', 'demo-f1predict'].includes(project)) throw new HttpsError('failed-precondition', 'Rooms project is not configured.');
  if (typeof request.data?.action === 'string' && request.data.action.startsWith('commerce')) {
    const { commerceOperation } = require('./room-commerce.cjs');
    return commerceOperation(db, request.auth?.uid, request.data);
  }
  if (request.data?.action === 'publishResults') {
    const { publishResults } = await import('./publication.mjs');
    return publishResults(db, request.auth, request.data);
  }
  if (['roomSave', 'roomPrediction', 'roomOthers', 'roomStandings'].includes(request.data?.action)) {
    const { roomPredictionOperation } = await import('./room-predictions.mjs');
    return roomPredictionOperation(db, request.auth?.uid, request.data);
  }
  return roomOperation(db, request.auth?.uid, request.data);
});
const options = document => ({ document, region: 'us-central1', maxInstances: 2, retry: true });
exports.predictionAwards = onDocumentWritten(options('predictions/{id}'), async event => {
  if (!event.data?.before.data()?.lockedAt && !event.data?.after.data()?.lockedAt) return;
  const { verifyPrediction, reconcileUser } = await import('./processor.mjs');
  // Bind evidence to the database commit timestamp, not event delivery time.
  await verifyPrediction(db, event.params.id, event.data?.after.updateTime?.toDate().toISOString());
  const uids = new Set([event.data?.before.data()?.userId, event.data?.after.data()?.userId].filter(Boolean));
  for (const uid of uids) await reconcileUser(db, uid);
});
exports.resultAwards = onDocumentWritten(options('results/{id}'), async event => {
  const { reconcileRaceUsers } = await import('./processor.mjs');
  // Strip the full session suffix: sprint_quali contains an underscore.
  const raceId = event.params.id.replace(/_(sprint_quali|quali|sprint|race)$/, '');
  await reconcileRaceUsers(db, raceId);
});
exports.weekendAwards = onDocumentWritten(options('races/{id}'), async event => {
  const { reconcileRaceUsers } = await import('./processor.mjs');
  await reconcileRaceUsers(db, event.params.id);
});
exports.ruleAwards = onDocumentWritten(options('gamificationConfig/{id}'), async () => {
  const { reconcileAll } = await import('./processor.mjs');
  await reconcileAll(db);
});
exports.profileAwards = onDocumentWritten(options('users/{uid}'), async event => {
  if (!event.data?.before.exists && event.data?.after.exists) {
    const { reconcileUser } = await import('./processor.mjs');
    await reconcileUser(db, event.params.uid);
  }
});
