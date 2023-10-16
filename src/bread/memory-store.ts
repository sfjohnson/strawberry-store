import Stst from '../types'
import v8 from 'v8'

// map key is store key, map value is a promise that gets resolved when the key is unlocked and the callback to resolve it
const currentLocks = new Map<string, { promise: Promise<void>, resolve: Function }>()

const store = new Map<string, Buffer>()

// DEBUG: implement auto-unlock after a timeout?
export const lockKeys = async (keys: string[]) => {
  const unlockPromises: Promise<void>[] = []
  for (const key of keys) {
    const lock = currentLocks.get(key)
    if (lock) unlockPromises.push(lock.promise)
  }

  // If any keys were locked, first wait for them all to be unlocked
  await Promise.all(unlockPromises)

  for (const key of keys) {
    currentLocks.delete(key)
    let resolve: Function | undefined
    const promise: Promise<void> = new Promise((_resolve) => {
      resolve = _resolve
    })
    currentLocks.set(key, { promise, resolve: resolve as Function })
  }
}

export const unlockKeys = (keys: string[]) => {
  for (const key of keys) {
    const lock = currentLocks.get(key)
    if (lock) {
      currentLocks.delete(key)
      lock.resolve()
    }
  }
}

export const getKey = (key: string): Stst.StoreValueObjectContainer | undefined => {
  const buf = store.get(key)
  if (!buf) return undefined
  return v8.deserialize(buf)
}

export const setKey = (key: string, svoc: Stst.StoreValueObjectContainer): void => {
  store.set(key, v8.serialize(svoc))
}

export const getAllKeysIterator = () => store.keys()
