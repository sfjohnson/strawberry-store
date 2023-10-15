# strawberry-store

Fault tolerant distributed key-value store

Based on MochiDB [link](https://www.scs.stanford.edu/17au-cs244b/labs/projects/tsaturyan_dhakshinamurthy.pdf)

## NOTE

This is a proof-of-concept, it's not ready for production yet!

## Sandwich structure

```
network protocol (cream)
- UDP req/res
- HTTP (TODO)
------------------------
core logic (strawberry)
------------------------
storage engine (bread)
- In-memory
- SQLite
```

## To do list

- [ ] Scrub (put a ceiling on the last read time for all stored keys, a read is performed when necessary)
- [ ] Tagging transactions so that a database transaction can be used to trigger an action that may not be database related
- [ ] Notifying peers that are slow so they can catch up (resync)
- [ ] Use an X.509 certificate for each peer signed by a certificate authority instead of using a whitelist of peer public keys
- [ ] Log warnings/errors to a file
- [ ] Tests! All the tests!
- [ ] More efficiency over the network and in storage
- [ ] Faster transactions

## Tests

- You will probably need to change the IP addresses in `PEERS` in `test.ts`

```
cd test
docker-compose up
```

## UDP req/res protocol spec

[here](udp.md)
