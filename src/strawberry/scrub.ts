import Stst from '../types'

export const onScrubError = async (peerResults: Stst.ReadOperationResult[]): Promise<Stst.TransactionOperationResult[]> => {
  // This is called when there is a quorum but the data in my store is different to the other peers (I have data loss or my writes are slower).
  // I need to write the other peer's results into my own store.
  // TODO: analytics and logging
  // TODO: implement
  // DEBUG: Does this break the BFT?
  throw new Error('Scrub error')
}
