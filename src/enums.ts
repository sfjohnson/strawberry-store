// TODO: is there a way to put this inside a namespace without confusing ts?

export enum ProtocolMessageType {
  READ_REQ = 0,
  READ_RES,
  WRITE_1_REQ,
  WRITE_1_OK_RES,
  WRITE_1_REFUSED_RES,
  WRITE_2_REQ,
  WRITE_2_OK_RES,
  WRITE_2_REFUSED_RES
}

export enum TransactionOperationAction {
  READ = 0,
  DELETE,
  WRITE,
  EXECUTE
}
