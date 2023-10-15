# UDP req/res protocol spec

- The data is not protected by a hash or CRC as the logic layer computes a hash over the entire transaction
- There is no windowing, but it is valid for an initiator or responder to send more chunks than were requested to improve throughput when sending larger amounts of data on higher speed links
- There should be a periodic cleanup routine for responder state in case the completion ack is dropped

## Flags

| bit   | description       |
|-------|-------------------|
| `0, 1`  | `packetType: 0: i->r sendChunk, 1: r->i getChunk, 2: r->i sendChunk, 3: i->r getChunk` |
| `2`     | `chunkOffset is 0` |
| `3`     | `request data (i->r) read OK`  |
| `4`     | `response data (r->i) read OK` |

## Packet types

### 1. initiator -> responder (reply is 2. or 3.)

| type     | description           |
|----------|-----------------------|
| `uint8`    | `flags (0bxxx00100)`    |
| `uint32`   | `reqId (random)`        |
| `varint`   | `totalReqDataLength`    |
| `bytes`    | `chunkData`             |

- chunkLength is computed using UDP header length
- chunkLength must be chosen so the packet definitely won't get dropped due to being too large
- If there is no reply after a set time, the initiator should resend

---

### 2. responder -> initiator (got the whole reqData in one packet, or just finished getting all reqData chunks, reply is 5. or 7.)

| type     | description           |
|----------|-----------------------|
| `uint8`    | `flags (0bxxx01110)`    |
| `uint32`   | `reqId`                 |
| `varint`   | `totalResDataLength`    |
| `bytes`    | `chunkData`             |

- chunkLength is computed using UDP header length
- chunkLength must be chosen so the packet definitely won't get dropped due to being too large
- If there is no reply after a set time, the responder should resend

---

### 3. responder -> initiator (requesting another reqData chunk, reply is 4.)

| type     | description             |
|----------|-------------------------|
| `uint8`    | `flags (0bxxx00?01)`      |
| `uint32`   | `reqId`                   |
| `varint`   | `chunkOffset (requested)` |
| `varint`   | `chunkLength (requested)` |

- The responder can request any offset and length of the reqData
- If all the data fits into one chunk this packet may not be necessary
- If there is no reply after a set time, the responder should resend

---

### 4. initiator -> responder (replying with another reqData chunk)

| type     | description           |
|----------|-----------------------|
| `uint8`    | `flags (0bxxx00000)`    |
| `uint32`   | `reqId`                 |
| `varint`   | `chunkOffset`           |
| `bytes`    | `chunkData`             |

- Chunk data responding to a nonzero chunkOffset are not resent until the chunk is re-requested

---

### 5. initiator -> responder (requesting another resData chunk, reply is 6.)

| type     | description             |
|----------|-------------------------|
| `uint8`    | `flags (0bxxx01?11)`      |
| `uint32`   | `reqId`                   |
| `varint`   | `chunkOffset (requested)` |
| `varint`   | `chunkLength (requested)` |

- The initiator can request any offset and length of the resData
- If all the data fits into one chunk this packet may not be necessary
- If there is no reply after a set time, the initiator should resend

---

### 6. responder -> initiator (replying with another resData chunk)

| type     | description           |
|----------|-----------------------|
| `uint8`    | `flags (0bxxx01010)`    |
| `uint32`   | `reqId`                 |
| `varint`   | `chunkOffset`           |
| `bytes`    | `chunkData`             |

- Resending this is not necessary for completion of the req/res, but it is necessary for fast clearing of responder state
- If completion ack is dropped and this is not resent, responder state will become stale

---

### 7. initiator -> responder (completion ack)

| type     | description             |
|----------|-------------------------|
| `uint8`    | `flags (0bxxx11x11)`      |
| `uint32`   | `reqId`                   |

- req/res is complete
- Send this again if the initiator gets any further type 6. packets from the responder
- Do not resend on an interval timer
- Once this is received by the responder, it should immediately delete all state for this reqId and ignore further packets with this reqId
- After a set time, the initiator should delete all state for this reqId and ignore further packets with this reqId
