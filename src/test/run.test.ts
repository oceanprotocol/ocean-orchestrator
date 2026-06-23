// Mock ESM-only packages that cannot be required in CJS test context.
// Only need to prevent require() from throwing — sinon stubs ProviderInstance at runtime.
const mockRequire = require('mock-require')

const esmOnlyPackages = [
  '@multiformats/multiaddr',
  'uint8arrays/alloc', 'uint8arrays/concat', 'uint8arrays/equals',
  'uint8arrays/from-string', 'uint8arrays/to-string',
  'libp2p',
  '@chainsafe/libp2p-noise', '@chainsafe/libp2p-yamux',
  '@libp2p/bootstrap', '@libp2p/circuit-relay-v2',
  '@libp2p/identify', '@libp2p/kad-dht',
  '@libp2p/tcp', '@libp2p/websockets'
]
for (const pkg of esmOnlyPackages) mockRequire(pkg, {})

mockRequire('@libp2p/utils', {
  UnexpectedEOFError: class UnexpectedEOFError extends Error {}
})

require('./extension.test')
require('./unit/jobNames.test')
require('./unit/incentive.test')
require('./unit/escrow.test')
require('./unit/cost.test')
require('./unit/jobStore.test')
