// Sub-Store node operator for OpenClash/Mihomo.
//
// Add this file as a "Script Operator" after the source subscription, then
// export the subscription as Clash.Meta/Mihomo. The original ...-CF node is
// kept for normal traffic and a matching ...-CF-LIVE node is generated.
//
// Required script arguments:
//   #cfDialDomain=best-cf.edge.example.com&cfLiveDomain=live-cf.edge.example.com
// Optional:
//   &cfMatch=^ORACLE-P2-.*-CF$

const DEFAULT_CF_MATCH = '^ORACLE-P2-.*-CF$'

function operator(proxies = []) {
  if (!Array.isArray(proxies)) {
    throw new Error('Sub-Store did not provide a proxy array')
  }

  const args =
    typeof $arguments !== 'undefined' && $arguments
      ? $arguments
      : {}

  const dialDomain = requireArgument(args, 'cfDialDomain')
  const liveDomain = requireArgument(args, 'cfLiveDomain')
  const match = createRegExp(
    String(args.cfMatch || DEFAULT_CF_MATCH).trim()
  )

  validateServer(dialDomain, 'cfDialDomain')
  validateServer(liveDomain, 'cfLiveDomain')

  // Build this set first so rerunning the operator replaces existing LIVE
  // clones instead of appending another copy.
  const generatedLiveNames = new Set()
  for (const proxy of proxies) {
    const name = getName(proxy)
    if (name && matches(match, name) && proxy.server) {
      generatedLiveNames.add(toLiveName(name))
    }
  }

  const output = []
  const emittedLiveNames = new Set()
  let matched = 0

  for (const proxy of proxies) {
    if (!proxy || typeof proxy !== 'object') continue

    const name = getName(proxy)

    // A base node below regenerates this node with fresh source fields.
    if (name && generatedLiveNames.has(name) && /-CF-LIVE$/i.test(name)) {
      continue
    }

    if (!name || !matches(match, name) || !proxy.server) {
      output.push(proxy)
      continue
    }

    matched++

    const normal = deepClone(proxy)
    setName(normal, name)
    normal.server = dialDomain
    output.push(normal)

    const liveName = toLiveName(name)
    if (!emittedLiveNames.has(liveName)) {
      const live = deepClone(proxy)
      setName(live, liveName)
      live.server = liveDomain
      output.push(live)
      emittedLiveNames.add(liveName)
    }
  }

  console.log(
    `[CF-LIVE] matched ${matched} base node(s), returned ${output.length} node(s)`
  )

  if (matched === 0) {
    console.log(`[CF-LIVE] no node matched: ${match}`)
  }

  return output
}

function getName(proxy) {
  if (!proxy || typeof proxy !== 'object') return ''
  return String(proxy.name || proxy.tag || '').trim()
}

function setName(proxy, name) {
  if (Object.prototype.hasOwnProperty.call(proxy, 'name') || !proxy.tag) {
    proxy.name = name
  }
  if (Object.prototype.hasOwnProperty.call(proxy, 'tag')) {
    proxy.tag = name
  }
}

function toLiveName(name) {
  return String(name)
    .replace(/-CF-(?:CU|FAST|BEST|LIVE)$/i, '-CF')
    .replace(/-(?:CU|FAST|BEST|LIVE)$/i, '') + '-LIVE'
}

function createRegExp(value) {
  let source = value.replace(/^\u2139\ufe0f?/, '')
  let flags = 'i'
  const literal = source.match(/^\/(.*)\/([a-z]*)$/i)

  if (literal) {
    source = literal[1]
    flags = literal[2] || flags
  }

  // Stateful flags make repeated RegExp.test calls skip alternating nodes.
  flags = flags.replace(/[gy]/g, '')
  if (!flags.includes('i')) flags += 'i'

  try {
    return new RegExp(source, flags)
  } catch (error) {
    throw new Error(`cfMatch is not a valid regular expression: ${error.message}`)
  }
}

function matches(regex, value) {
  regex.lastIndex = 0
  return regex.test(value)
}

function validateServer(value, field) {
  if (!value || /[\s/:]/.test(value)) {
    throw new Error(`${field} must be a hostname or IP address: ${value}`)
  }
}

function requireArgument(args, field) {
  const value = String(args[field] || '').trim()
  if (!value) {
    throw new Error(
      `${field} is required; pass it in the Script Operator URL fragment`
    )
  }
  return value
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

if (typeof module !== 'undefined') {
  module.exports = { operator }
}
