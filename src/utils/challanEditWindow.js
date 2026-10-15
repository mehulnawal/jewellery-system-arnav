import { timestampMs } from "./challanAging.js";

export const CHALLAN_EDIT_WINDOW_MS = 60 * 60 * 1000;

export const challanStageEnteredAt = (
  record,
  stage = Number(record.stage || 1),
) => {
  if (stage === 1) return timestampMs(record.createdAt);
  if (stage === 2)
    return (
      timestampMs(record.stageHistory?.stage2?.enteredAt) ||
      timestampMs(record.stageHistory?.stage2?.enteredAtMs) ||
      timestampMs(record.stage2Return?.transitionedAtMs)
    );
  if (stage === 3)
    return (
      timestampMs(record.stageHistory?.stage3?.enteredAt) ||
      timestampMs(record.stageHistory?.stage3?.enteredAtMs) ||
      timestampMs(record.finalInvoice?.confirmedAtMs)
    );
  if (stage === 4)
    return (
      timestampMs(record.stageHistory?.stage4?.enteredAt) ||
      timestampMs(record.stageHistory?.stage4?.enteredAtMs) ||
      timestampMs(record.finalSettlement?.completedAtMs)
    );
  return 0;
};

export const challanEditRemaining = (record, now) => {
  const stage = Number(record.stage || 1);
  if (stage < 1 || stage > 4) return 0;
  const enteredAt = challanStageEnteredAt(record, stage);
  return enteredAt ? Math.max(0, enteredAt + CHALLAN_EDIT_WINDOW_MS - now) : 0;
};

export const canEditChallan = (record, user, now) => {
  const stage = Number(record.stage || 1);
  if (stage < 1 || stage > 4 || !user?.uid) return false;
  if (user.role === "superadmin")
    return stage === 1 || challanEditRemaining(record, now) > 0;
  return Boolean(
    user.permissions?.includes(`challan-stage-${stage}`) &&
    record.createdBy === user.uid &&
    record.createdByRole !== "superadmin" &&
    challanEditRemaining(record, now) > 0,
  );
};
