import test from 'node:test';
import assert from 'node:assert/strict';
import commerce from '../functions/room-commerce.cjs';
const { commerceOperation: operate, capacityBand } = commerce;
test('capacity review validates every band boundary without inventing prices', async () => {
  for (const [capacity, band] of [[2,10],[10,10],[11,25],[25,25],[26,50],[50,50],[51,100],[100,100]]) assert.equal(capacityBand(capacity), band);
  for (const invalid of [0,1,101,2.5,'10',NaN,Infinity]) assert.throws(() => capacityBand(invalid));
  const review = await operate(null,'user',{action:'commerceReview',capacity:10,totalPaise:1,paid:true});
  assert.equal(review.totalPaise,null);
  assert.equal(review.purchasingEnabled,false);
});
test('real checkout and forged confirmations fail closed, including admins', async () => {
  for (const action of ['commerceCheckout','commerceVerify','commerceRefund','commerceMarkPaid']) {
    await assert.rejects(operate(null,'admin',{action,admin:true,paid:true}),{code:'failed-precondition'});
  }
  await assert.rejects(operate(null,null,{action:'commerceStatus'}),{code:'unauthenticated'});
  await assert.rejects(operate(null,'user',{}),{code:'invalid-argument'});
});
test('simulation requires demo project AND Functions and Firestore emulators', async () => {
  for (const env of [{},{GCLOUD_PROJECT:'f1predict-1188e',FUNCTIONS_EMULATOR:'true',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},{GCLOUD_PROJECT:'demo-f1predict',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},{GCLOUD_PROJECT:'demo-f1predict',FUNCTIONS_EMULATOR:'true'}]) {
    await assert.rejects(operate(null,'user',{action:'commerceTestAttempt'},env),{code:'failed-precondition'});
  }
});
