/**
 * First-article limit math. The API owns the functions so the sheet and the
 * saved result cannot disagree. Existing sheet pass/fail is not changed.
 */
export {
  approveSource,
  canApproveFai,
  formalDate,
  freezeCharacteristic,
  judgeFrozen,
  limitsLabel,
  newSourceRow,
  noticeApproved,
  noticeAssigned,
  noticeDueSoon,
  noticeOverdue,
  noticePullAssigned,
  noticePullRecorded,
  noticeRejected,
  noticeSubmitted,
  rejectSource,
  type CharacteristicInput,
  type CharacteristicMode,
  type FrozenCharacteristic,
  type PassFailWord,
} from "../../../../services/api/src/modules/fai/fai.logic";
