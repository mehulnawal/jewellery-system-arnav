import { businessStatus } from "../utils/businessStatus.js";
import * as firestore from "firebase/firestore";
let generation = 0;
let availabilityBlocked = false;
export const setBusinessAvailabilityBlocked = (value) => {
  availabilityBlocked = Boolean(value);
};
const assertAvailable = () => {
  if (availabilityBlocked)
    throw new Error(
      "Saving is unavailable until business system status can be verified. Retry the connection before saving.",
    );
};
export const setBusinessGeneration = (value) => {
  generation = Number(value || 0);
};
const dataCollections = new Set([
  "inventory",
  "purchases",
  "challans",
  "parties",
  "vendors",
  "brokers",
  "masterPrices",
  "activityLog",
  "activityLogFirstLogins",
  "counters",
]);
const stamp = (ref, data, version) =>
  version > 0 && dataCollections.has(ref.path.split("/")[0])
    ? { ...data, businessGeneration: version }
    : data;
export const setDoc = (ref, data, ...options) => {
  if (dataCollections.has(ref.path.split("/")[0])) assertAvailable();
  return firestore.setDoc(ref, stamp(ref, data, generation), ...options);
};
export const updateDoc = (ref, data, ...options) => {
  if (dataCollections.has(ref.path.split("/")[0])) assertAvailable();
  return firestore.updateDoc(ref, stamp(ref, data, generation), ...options);
};
export const addDoc = (ref, data) => {
  if (dataCollections.has(ref.path.split("/")[0])) assertAvailable();
  return firestore.addDoc(ref, stamp(ref, data, generation));
};
export function runTransaction(db, callback, options) {
  assertAvailable();
  const version = generation;
  return firestore.runTransaction(
    db,
    async (tx) => {
      const state = businessStatus(
        (await tx.get(firestore.doc(db, "systemState", "business"))).data(),
      );
      if (state?.locked || (state?.generation || 0) !== version)
        throw new Error(
          "Business data was reset or is resetting. Reopen this form before saving.",
        );
      const wrapped = {
        get: (...args) => tx.get(...args),
        delete: (...args) => tx.delete(...args),
        set: (ref, data, ...args) => {
          tx.set(ref, stamp(ref, data, version), ...args);
          return wrapped;
        },
        update: (ref, data, ...args) => {
          tx.update(ref, stamp(ref, data, version), ...args);
          return wrapped;
        },
      };
      return callback(wrapped);
    },
    options,
  );
}
// Transactions make deletes/batches fail offline instead of queueing a stale
// destructive operation that could later target a newly reset installation.
export const deleteDoc = (ref) =>
  runTransaction(ref.firestore, (tx) => {
    tx.delete(ref);
  });
export function writeBatch(db) {
  const operations = [],
    version = generation;
  const batch = {
    set: (...args) => {
      operations.push(["set", args]);
      return batch;
    },
    update: (...args) => {
      operations.push(["update", args]);
      return batch;
    },
    delete: (...args) => {
      operations.push(["delete", args]);
      return batch;
    },
    commit: () => {
      if (generation !== version)
        throw new Error("Business data changed. Reopen this operation.");
      return runTransaction(db, (tx) => {
        for (const [method, args] of operations) tx[method](...args);
      });
    },
  };
  return batch;
}
