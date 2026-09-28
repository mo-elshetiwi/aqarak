/** Exposes AQ-CANON-1 encoding and hashing for audit and request identities. */
export {
  CANON_VERSION,
  GENESIS_PREV_HASH,
  encodeCanonical,
  sha256Hex,
  computeRowHash,
  type CanonicalValue,
} from "./canonical";
/** Exposes the strict stored-event schema and its canonical projection. */
export {
  auditEventContent,
  auditEventCanonicalText,
  type AuditEventContent,
} from "./audit-event";
/** Exposes offline chain construction, verification and actor consistency checks. */
export {
  chainBreak,
  appendToChain,
  verifyChain,
  isActorConsistent,
  type ChainRow,
  type ChainCheckpoint,
  type ChainBreak,
} from "./chain";
