export enum StateChangeEnum {
  REQ_CHUNK_FILLED,
  RES_CHUNK_FILLED,
  REQ_DATA_OK_TRUE,
  RES_DATA_OK_TRUE,
  SEND_PENDING_IR,
  SEND_PENDING_RI,
  COMPLETION,
  ERROR,
}

export enum PacketType {
  I_TO_R_SEND = 0,
  R_TO_I_GET,
  R_TO_I_SEND,
  I_TO_R_GET
}

export enum Side {
  INITIATOR,
  RESPONDER
}

export enum ResCbStatus {
  CONTINUE,
  RESOLVE,
  REJECT
}
