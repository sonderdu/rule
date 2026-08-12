// Sub-Store + sing-box 1.13.x 配置生成脚本 v5.4-live
//
// 推荐的单入口 + LIVE 双 Profile：
//   原始节点：ORACLE-P2-...-CF
//
//   cfDialDomain=best-cf.edge.863636.xyz
//     -> 原始 ...-CF 保持 tag 不变，只把 server 改为普通优选域名
//
//   cfLiveDomain=live-cf.edge.863636.xyz
//     -> 额外克隆 ...-CF-LIVE，只把 server 改为直播/实时优选域名
//
// 两个节点的 tls.server_name / WS Host / UUID / path / password 完全一致，
// 最终代理出口仍然是同一 Oracle origin；变化的只是 Cloudflare 入口 IP。
//
// 推荐参数：
//   client=windows
//   cfDialDomain=best-cf.edge.863636.xyz
//   cfLiveDomain=live-cf.edge.863636.xyz
//   cfDnsServer=223.5.5.5
//
// cfDnsServer 会创建/复用 dns-cf-smart，并让 CF 节点通过指定递归 DNS
// 解析业务 CNAME 域名。当前 AxisNow Managed 域名实测使用 223.5.5.5
// 可得到对应线路结果；不要将 *.alidns-3.com 写入节点的 server/SNI/WS Host。
//
// 仍兼容 v5.3 的 cfCuDomain / cfFastDomain / cfBestDomain / cfMode。
// Windows 默认 IPv4-only。

log('开始生成 sing-box 配置')

let {
  type,
  name,
  outbound,
  includeUnsupportedProxy,
  url,
  client,
  ipv6Mode,
  disableIPv6,
  enableIPv6,
  keepExperimental,
  testDomain,
  testDomainExact,
  testIP,
  testNode,
  blockQuic,
  cfDialDomain,
  cfLiveDomain,
  cfCuDomain,
  cfFastDomain,
  cfBestDomain,
  cfMode,
  cfKeepOriginal,
  cfMatch,
  cfDnsServer
} = typeof $arguments !== 'undefined' ? $arguments : {}

type = /^1$|col|组合/i.test(String(type || '')) ? 'collection' : 'subscription'

const platform = String(client || name || '').toLowerCase()
const parser = ProxyUtils.JSON5 || JSON

let config

const rawBaseConfig = getBaseConfigContent()

try {
  config = parser.parse(rawBaseConfig)
} catch (error) {
  throw new Error(
    `基础配置不是合法 JSON/JSON5：${error.message || error}`
  )
}

validateBaseConfig(config)

let proxies

if (url) {
  proxies = await produceArtifact({
    name: name || 'remote-subscription',
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': toBoolean(includeUnsupportedProxy, false)
    },
    subscription: {
      name: name || 'remote-subscription',
      url,
      source: 'remote'
    }
  })
} else {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': toBoolean(includeUnsupportedProxy, false)
    }
  })
}

if (!Array.isArray(proxies) || proxies.length === 0) {
  throw new Error('没有获取到可用节点')
}

// 同 tag 去重。
proxies = Array.from(
  new Map(
    proxies
      .filter(proxy => proxy && proxy.tag && proxy.type)
      .map(proxy => [
        String(proxy.tag).trim(),
        { ...proxy, tag: String(proxy.tag).trim() }
      ])
  ).values()
)

// 只过滤明确的说明/失效节点。
// 不再用 GB 作为过滤词，避免误删英国节点。
const invalidNodePattern =
  /(?:官网|官方|剩余(?:流量)?|流量(?:剩余|信息)?|套餐(?:信息)?|订阅(?:信息)?|到期(?:时间)?|更新节点|节点失效|失效节点|请点击更新|全球直连|Expire(?:s)?|Traffic|Usage\s*\/\s*Total)/i

const baseValidProxies = proxies.filter(
  proxy => !invalidNodePattern.test(proxy.tag)
)

if (baseValidProxies.length === 0) {
  throw new Error('过滤说明节点后没有有效节点')
}

// Oracle 直连节点可以保留协议描述中的 -CF，但绝不能被普通/LIVE
// Cloudflare 优选展开逻辑克隆。
function isOracleDirect(nodeName) {
  return /^ORACLE-P3-JP-TOKYO-DIRECT(?:-|$)/i.test(String(nodeName || ''))
}

// Cloudflare 优选入口展开。
// 新版默认：一个原始 -CF 节点克隆为 -CF-CU / -CF-FAST。
// 若未传新参数但仍传 cfDialDomain，则自动兼容 v4 单入口行为。
const validProxies = expandCloudflareDialDomains(config, baseValidProxies, {
  cuDomain: String(cfCuDomain || '').trim(),
  fastDomain: String(cfFastDomain || '').trim(),
  bestDomain: String(cfBestDomain || cfDialDomain || '').trim(),
  legacyDomain: String(cfDialDomain || '').trim(),
  liveDomain: String(cfLiveDomain || '').trim(),
  mode: String(cfMode || '').trim().toLowerCase(),
  keepOriginal: toBoolean(cfKeepOriginal, false),
  match: String(cfMatch || 'ℹ️^.*-CF$').trim(),
  dnsServer: String(cfDnsServer || '223.5.5.5').trim()
})

const nodeNames = validProxies.map(proxy => proxy.tag)

const isAirport5x = nodeName =>
  /^AIR-P1-POLY-/i.test(nodeName) &&
  /(?:X\s*5|5\s*X|5\s*[倍×])/i.test(nodeName)

const isSelfMain = nodeName =>
  /^SELF-P1-US-LA9929-/i.test(nodeName)

const isSharedFast = nodeName =>
  /^SHARE-P1-/i.test(nodeName)

const isBackupAirport = nodeName =>
  /^AIR-P2-BACKUP-/i.test(nodeName)

const isCloudflareOptimized = nodeName =>
  !isOracleDirect(nodeName) &&
  /-CF(?:-(?:CU|FAST|BEST))?$/i.test(nodeName)

const isCloudflareLive = nodeName =>
  /-CF-LIVE$/i.test(nodeName)

const isOracleOptimized = nodeName =>
  /^ORACLE-P2-.*-CF(?:-(?:CU|FAST|BEST))?$/i.test(nodeName)

const isOracleLive = nodeName =>
  /^ORACLE-P2-.*-CF-LIVE$/i.test(nodeName)

// 普通 CF 和 LIVE CF 分开管理。
ensureOracleOptimizedGroup(config, nodeNames.filter(isOracleOptimized))
ensureOracleLiveGroup(config, nodeNames.filter(isOracleLive))

const isOrdinary = nodeName =>
  /^AIR-P3-XL-/i.test(nodeName)

const isPolySingapore = nodeName =>
  /^AIR-P1-POLY-/i.test(nodeName) &&
  regionMatches(nodeName, 'SG')

const isQualityNode = nodeName =>
  isSelfMain(nodeName) ||
  isSharedFast(nodeName) ||
  isAirport5x(nodeName) ||
  isBackupAirport(nodeName) ||
  isCloudflareOptimized(nodeName)

const defaultGroupMatchers = [
  {
    group: /^⭐ (?:自建主力|自建高速)$/,
    match: isSelfMain
  },
  {
    group: /^🤝 合租高速$/,
    match: isSharedFast
  },
  {
    group: /^🚄 (?:机场5X|机场高速)$/,
    match: isAirport5x
  },
  {
    group: /^🛟 (?:赠送备用|备用机场)$/,
    match: isBackupAirport
  },
  {
    group: /^☁️ Oracle优化$/,
    match: isOracleOptimized
  },
  {
    group: /^📺 Oracle直播$/,
    match: isOracleLive
  },
  {
    group: /^☁️ (?:CF优化|CDN优化)$/,
    match: isCloudflareOptimized
  },
  {
    group: /^🎬 Poly线路$/,
    match: isPolySingapore
  },
  {
    group: /^☁️ Oracle直连$/,
    match: isOracleDirect
  },
  {
    group: /^🪶 (?:星链普通|普通节点)$/,
    match: isOrdinary
  },
  {
    group: /^🇭🇰 香港优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'HK')
  },
  {
    group: /^🇹🇼 台湾优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'TW')
  },
  {
    group: /^🇯🇵 日本优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'JP')
  },
  {
    group: /^🇰🇷 韩国优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'KR')
  },
  {
    group: /^🇸🇬 新加坡优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'SG')
  },
  {
    group: /^🇺🇸 美国优选$/,
    match: nodeName => isQualityNode(nodeName) && regionMatches(nodeName, 'US')
  },
  {
    group: /^(?:🐸 手动选择|🧪 测试节点)$/,
    match: () => true
  }
]

if (String(outbound || '').trim()) {
  const customRules = String(outbound)
    .split('🕳')
    .filter(Boolean)
    .map(item => {
      const [groupPattern, tagPattern = '.*'] = item.split('🏷')
      return {
        group: createRegExp(groupPattern),
        tag: createRegExp(tagPattern)
      }
    })

  for (const group of config.outbounds) {
    for (const rule of customRules) {
      if (!rule.group.test(group.tag)) continue
      if (!Array.isArray(group.outbounds)) group.outbounds = []

      group.outbounds = unique([
        ...group.outbounds,
        ...nodeNames.filter(tag => rule.tag.test(tag))
      ])
    }
  }
} else {
  for (const group of config.outbounds) {
    for (const rule of defaultGroupMatchers) {
      if (!rule.group.test(group.tag)) continue
      if (!Array.isArray(group.outbounds)) group.outbounds = []

      group.outbounds = unique([
        ...group.outbounds,
        ...nodeNames.filter(rule.match)
      ])
    }
  }
}

for (const tag of ['🐸 手动选择', '🧪 测试节点']) {
  const group = config.outbounds.find(item => item.tag === tag)

  if (
    !group ||
    !Array.isArray(group.outbounds) ||
    group.outbounds.length === 0
  ) {
    throw new Error(`${tag} 没有匹配到任何有效节点`)
  }
}

const removableDynamicTags = new Set([
  '⭐ 自建主力',
  '⭐ 自建高速',
  '🤝 合租高速',
  '🚄 机场5X',
  '🚄 机场高速',
  '🛟 赠送备用',
  '🛟 备用机场',
  '☁️ Oracle优化',
  '📺 Oracle直播',
  '☁️ CF优化',
  '☁️ CDN优化',
  '🎬 Poly线路',
  '☁️ Oracle直连',
  '🪶 星链普通',
  '🪶 普通节点',
  '🇭🇰 香港优选',
  '🇹🇼 台湾优选',
  '🇯🇵 日本优选',
  '🇰🇷 韩国优选',
  '🇸🇬 新加坡优选',
  '🇺🇸 美国优选'
])

const emptyDynamicTags = new Set(
  config.outbounds
    .filter(item =>
      removableDynamicTags.has(item.tag) &&
      (!Array.isArray(item.outbounds) || item.outbounds.length === 0)
    )
    .map(item => item.tag)
)

if (emptyDynamicTags.size > 0) {
  config.outbounds = config.outbounds.filter(
    item => !emptyDynamicTags.has(item.tag)
  )

  for (const item of config.outbounds) {
    if (Array.isArray(item.outbounds)) {
      item.outbounds = item.outbounds.filter(
        tag => !emptyDynamicTags.has(tag)
      )
    }

    if (item.default && emptyDynamicTags.has(item.default)) {
      delete item.default
    }
  }

  config.route.rules = config.route.rules.filter(
    rule => !emptyDynamicTags.has(rule.outbound)
  )
}

for (const item of config.outbounds) {
  if (item.type !== 'selector' || !Array.isArray(item.outbounds)) continue

  if (item.default && !item.outbounds.includes(item.default)) {
    delete item.default
  }

  if (!item.default && item.outbounds.length > 0) {
    item.default = item.outbounds[0]
  }
}

injectTestRule(config, {
  suffixDomains: splitValues(testDomain),
  exactDomains: splitValues(testDomainExact),
  ipCidrs: splitValues(testIP),
  outbound: String(testNode || '🧪 测试节点')
})

if (toBoolean(blockQuic, false)) {
  const exists = config.route.rules.some(rule =>
    rule?.network === 'udp' &&
    Number(rule?.port) === 443 &&
    rule?.action === 'reject'
  )

  if (!exists) {
    const index = config.route.rules.findIndex(
      rule => rule.action === 'hijack-dns'
    )

    config.route.rules.splice(index >= 0 ? index + 1 : 0, 0, {
      network: 'udp',
      port: 443,
      action: 'reject'
    })
  }
}

const existingTags = new Set(
  config.outbounds.map(item => item.tag).filter(Boolean)
)

config.outbounds.push(
  ...validProxies.filter(proxy => !existingTags.has(proxy.tag))
)

if (platform.includes('android')) {
  if (!toBoolean(keepExperimental, false)) {
    delete config.experimental
  } else {
    normalizeExperimental(config)
  }

  setAutoRedirect(config, false)
} else if (platform.includes('windows')) {
  normalizeExperimental(config)
  setAutoRedirect(config, false)
} else if (platform.includes('linux')) {
  if (config.experimental?.cache_file) {
    config.experimental.cache_file.path = '/etc/sing-box/cache.db'
  }

  if (config.experimental?.clash_api) {
    config.experimental.clash_api.external_controller = '0.0.0.0:9095'
    config.experimental.clash_api.external_ui = '/etc/sing-box/ui'
  }

  setAutoRedirect(config, true)
} else {
  normalizeExperimental(config)
  setAutoRedirect(config, false)
}

const resolvedIPv6Mode = resolveIPv6Mode({
  platform,
  ipv6Mode,
  disableIPv6,
  enableIPv6
})

if (resolvedIPv6Mode === 'ipv4') {
  applyIPv4Only(config)
}

$content = JSON.stringify(config, null, 2)

log(`生成完成，最终节点 ${validProxies.length} 个`)

function ensureOracleLiveGroup(config, liveNodeNames) {
  if (!Array.isArray(liveNodeNames) || liveNodeNames.length === 0) {
    return
  }

  if (!Array.isArray(config.outbounds)) {
    config.outbounds = []
  }

  let group = config.outbounds.find(
    item => item && item.tag === '📺 Oracle直播'
  )

  if (!group) {
    group = {
      tag: '📺 Oracle直播',
      type: 'selector',
      outbounds: [],
      interrupt_exist_connections: true
    }

    // 放在普通 Oracle 优化组后面，避免 LIVE 变成父 selector 的隐式默认项。
    let insertIndex = config.outbounds.findIndex(
      item => item && item.tag === '☁️ Oracle优化'
    )

    if (insertIndex >= 0) {
      insertIndex += 1
    } else {
      insertIndex = config.outbounds.findIndex(
        item => item && item.tag === '🐸 手动选择'
      )
    }

    if (insertIndex < 0) {
      config.outbounds.push(group)
    } else {
      config.outbounds.splice(insertIndex, 0, group)
    }

    log('自动创建策略组：📺 Oracle直播')
  }

  group.type = 'selector'
  group.interrupt_exist_connections = true
  group.outbounds = unique([
    ...(Array.isArray(group.outbounds) ? group.outbounds : []),
    ...liveNodeNames
  ])

  if (!group.default || !group.outbounds.includes(group.default)) {
    group.default = group.outbounds[0]
  }

  // 只挂到主 selector / GLOBAL，不自动给任何业务规则分流。
  // 用户可以整组切换到“📺 Oracle直播”，避免 TikTok 同一 App 内拆出口。
  for (const parentTag of ['🚀 默认代理', 'GLOBAL']) {
    const parent = config.outbounds.find(
      item => item && item.tag === parentTag
    )

    if (!parent || parent.type !== 'selector') continue
    if (!Array.isArray(parent.outbounds)) parent.outbounds = []
    if (parent.outbounds.includes('📺 Oracle直播')) continue

    const oracleIndex = parent.outbounds.indexOf('☁️ Oracle优化')
    if (oracleIndex >= 0) {
      parent.outbounds.splice(oracleIndex + 1, 0, '📺 Oracle直播')
    } else {
      const manualIndex = parent.outbounds.indexOf('🐸 手动选择')
      if (manualIndex >= 0) {
        parent.outbounds.splice(manualIndex, 0, '📺 Oracle直播')
        continue
      }
      parent.outbounds.push('📺 Oracle直播')
    }
  }
}

function ensureOracleOptimizedGroup(config, oracleNodeNames) {
  if (!Array.isArray(oracleNodeNames) || oracleNodeNames.length === 0) {
    return
  }

  if (!Array.isArray(config.outbounds)) {
    config.outbounds = []
  }

  let group = config.outbounds.find(
    item => item && item.tag === '☁️ Oracle优化'
  )

  if (!group) {
    group = {
      tag: '☁️ Oracle优化',
      type: 'urltest',
      outbounds: [],
      url: 'https://www.gstatic.com/generate_204',
      interval: '5m',
      tolerance: 100,
      idle_timeout: '30m',
      interrupt_exist_connections: false
    }

    // 放在 Oracle直连 前面；找不到时放到手动选择前面；再不行则追加。
    let insertIndex = config.outbounds.findIndex(
      item => item && item.tag === '☁️ Oracle直连'
    )

    if (insertIndex < 0) {
      insertIndex = config.outbounds.findIndex(
        item => item && item.tag === '🐸 手动选择'
      )
    }

    if (insertIndex < 0) {
      config.outbounds.push(group)
    } else {
      config.outbounds.splice(insertIndex, 0, group)
    }

    log(`自动创建策略组：☁️ Oracle优化`)
  }

  if (!Array.isArray(group.outbounds)) {
    group.outbounds = []
  }

  group.outbounds = unique([
    ...group.outbounds,
    ...oracleNodeNames
  ])

  // 把 Oracle 优选组挂到常用父 selector。
  for (const parentTag of ['🚀 默认代理', 'GLOBAL']) {
    const parent = config.outbounds.find(
      item => item && item.tag === parentTag
    )

    if (!parent || parent.type !== 'selector') continue

    if (!Array.isArray(parent.outbounds)) {
      parent.outbounds = []
    }

    if (!parent.outbounds.includes('☁️ Oracle优化')) {
      let beforeTag = ''

      if (parentTag === '🚀 默认代理') {
        beforeTag = parent.outbounds.includes('☁️ Oracle直连')
          ? '☁️ Oracle直连'
          : '🐸 手动选择'
      } else {
        beforeTag = parent.outbounds.includes('☁️ Oracle直连')
          ? '☁️ Oracle直连'
          : '🐸 手动选择'
      }

      const index = parent.outbounds.indexOf(beforeTag)

      if (index >= 0) {
        parent.outbounds.splice(index, 0, '☁️ Oracle优化')
      } else {
        parent.outbounds.push('☁️ Oracle优化')
      }
    }
  }
}

function expandCloudflareDialDomains(config, proxies, options) {
  const {
    cuDomain,
    fastDomain,
    bestDomain,
    legacyDomain,
    liveDomain,
    mode,
    keepOriginal,
    match,
    dnsServer
  } = options

  // 完全没有配置 Cloudflare 拨号域名时，不修改节点。
  if (!cuDomain && !fastDomain && !bestDomain && !legacyDomain && !liveDomain) {
    return proxies
  }

  const regex = createRegExp(match || 'ℹ️^.*-CF$')

  let resolverTag = ''

  if (dnsServer) {
    resolverTag = 'dns-cf-smart'
    ensureLocalDnsServer(config, resolverTag, dnsServer)
  }

  // 当前推荐：旧单入口普通优选 + 一个 LIVE 入口。
  // 原始 -CF -> best-cf（tag 不变）；另克隆 -CF-LIVE -> live-cf。
  const explicitBestDomain = Boolean(
    bestDomain && bestDomain !== legacyDomain
  )

  if (legacyDomain && liveDomain && !cuDomain && !fastDomain && !explicitBestDomain) {
    if (!isValidHostname(legacyDomain)) {
      throw new Error(`cfDialDomain 不是合法域名：${legacyDomain}`)
    }
    if (!isValidHostname(liveDomain)) {
      throw new Error(`cfLiveDomain 不是合法域名：${liveDomain}`)
    }

    const output = []
    let matched = 0

    for (const proxy of proxies) {
      if (!regex.test(proxy.tag) || !proxy.server || isOracleDirect(proxy.tag)) {
        output.push(proxy)
        continue
      }

      matched++

      const normal = deepClone(proxy)
      const live = deepClone(proxy)
      const oldServer = proxy.server

      normal.tag = stripCfVariantSuffix(normal.tag)
      normal.server = legacyDomain

      live.tag = `${stripCfVariantSuffix(live.tag)}-LIVE`
      live.server = liveDomain

      if (resolverTag) {
        normal.domain_resolver = resolverTag
        live.domain_resolver = resolverTag
      }

      output.push(normal, live)
      log(`CF 普通：${normal.tag} ${oldServer} -> ${legacyDomain}`)
      log(`CF LIVE：${live.tag} ${oldServer} -> ${liveDomain}`)
    }

    if (matched === 0) {
      log(`警告：cfMatch 没有匹配到原始 -CF 节点：${match}`)
      return proxies
    }

    log(`CF 普通+LIVE 展开完成：匹配 ${matched} 个原始节点，输出 ${matched * 2} 个节点`)
    return dedupeByTag(output)
  }

  // 新参数未使用、只有旧 cfDialDomain 时，保持 v4 行为：
  // 原节点 tag 不变，只替换 server。
  // 只有显式使用新版参数时才进入多入口模式。
  // 注意：bestDomain 可能由 legacy cfDialDomain 回填，不能据此判断。
  const usingNewDomains = Boolean(cuDomain || fastDomain || (
    bestDomain && bestDomain !== legacyDomain
  ))

  if (!usingNewDomains && legacyDomain) {
    if (!isValidHostname(legacyDomain)) {
      throw new Error(`cfDialDomain 不是合法域名：${legacyDomain}`)
    }

    let count = 0

    const legacy = proxies.map(proxy => {
      if (!regex.test(proxy.tag) || !proxy.server || isOracleDirect(proxy.tag)) {
        return proxy
      }

      const cloned = deepClone(proxy)
      const oldServer = cloned.server
      cloned.server = legacyDomain

      if (resolverTag) cloned.domain_resolver = resolverTag

      log(`CF 单入口兼容：${cloned.tag} ${oldServer} -> ${legacyDomain}`)
      count++
      return cloned
    })

    if (count === 0) {
      log(`警告：cfMatch 没有匹配到节点：${match}`)
    }

    return legacy
  }

  const resolvedMode = mode || 'dual'

  if (!['dual', 'best', 'all'].includes(resolvedMode)) {
    throw new Error(`不支持的 cfMode：${resolvedMode}，仅支持 dual / best / all`)
  }

  const targets = []

  if (resolvedMode === 'dual' || resolvedMode === 'all') {
    if (!cuDomain || !fastDomain) {
      throw new Error(
        `cfMode=${resolvedMode} 需要同时设置 cfCuDomain 和 cfFastDomain`
      )
    }

    targets.push(
      { suffix: 'CU', domain: cuDomain },
      { suffix: 'FAST', domain: fastDomain }
    )
  }

  if (resolvedMode === 'best' || resolvedMode === 'all') {
    if (!bestDomain) {
      throw new Error(`cfMode=${resolvedMode} 需要设置 cfBestDomain`)
    }

    targets.unshift({
      suffix: 'BEST',
      domain: bestDomain
    })
  }

  if (liveDomain) {
    targets.push({
      suffix: 'LIVE',
      domain: liveDomain
    })
  }

  for (const target of targets) {
    if (!isValidHostname(target.domain)) {
      throw new Error(
        `Cloudflare ${target.suffix} 拨号域名不是合法域名：${target.domain}`
      )
    }
  }

  const output = []
  let matched = 0
  let generated = 0

  for (const proxy of proxies) {
    // 只处理原始 -CF 节点，默认正则不会重新匹配 -CF-CU / -CF-FAST。
    if (!regex.test(proxy.tag) || !proxy.server || isOracleDirect(proxy.tag)) {
      output.push(proxy)
      continue
    }

    matched++

    if (keepOriginal) {
      output.push(proxy)
    }

    for (const target of targets) {
      const cloned = deepClone(proxy)
      const oldServer = cloned.server

      cloned.tag = `${stripCfVariantSuffix(cloned.tag)}-${target.suffix}`
      cloned.server = target.domain

      if (resolverTag) {
        cloned.domain_resolver = resolverTag
      }

      // tls.server_name / transport.headers.Host 等全部来自深拷贝，
      // 这里只改拨号 server 和 tag。
      output.push(cloned)

      log(
        `CF ${target.suffix}：${cloned.tag} ${oldServer} -> ${target.domain}`
      )
      generated++
    }
  }

  if (matched === 0) {
    log(`警告：cfMatch 没有匹配到原始 -CF 节点：${match}`)
    return proxies
  }

  log(
    `CF 优选展开完成：匹配 ${matched} 个原始节点，生成 ${generated} 个优选节点`
  )

  return dedupeByTag(output)
}

function stripCfVariantSuffix(tag) {
  return String(tag)
    .replace(/-CF-(?:CU|FAST|BEST|LIVE)$/i, '-CF')
    .replace(/-(?:CU|FAST|BEST|LIVE)$/i, '')
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function dedupeByTag(values) {
  return Array.from(
    new Map(
      values
        .filter(item => item && item.tag)
        .map(item => [item.tag, item])
    ).values()
  )
}

function ensureLocalDnsServer(config, tag, server) {
  const existing = config.dns.servers.find(
    item => item?.tag === tag
  )

  if (existing) {
    existing.type = 'udp'
    existing.server = server
    existing.server_port = 53
    return
  }

  config.dns.servers.unshift({
    tag,
    type: 'udp',
    server,
    server_port: 53
  })
}

function resolveIPv6Mode({
  platform,
  ipv6Mode,
  disableIPv6,
  enableIPv6
}) {
  const mode = String(ipv6Mode || '').trim().toLowerCase()

  if (['ipv4', 'off', 'disable', 'disabled', '4'].includes(mode)) {
    return 'ipv4'
  }

  if (['dual', 'on', 'enable', 'enabled', '46', 'ipv6'].includes(mode)) {
    return 'dual'
  }

  if (toBoolean(disableIPv6, false)) return 'ipv4'
  if (toBoolean(enableIPv6, false)) return 'dual'

  // Windows 无原生 IPv6 的场景默认只使用 IPv4。
  if (platform.includes('windows')) return 'ipv4'

  return 'dual'
}

function applyIPv4Only(config) {
  config.dns.strategy = 'ipv4_only'

  for (const server of config.dns.servers || []) {
    if (server?.type === 'fakeip') {
      delete server.inet6_range
    }

    if (server && 'strategy' in server) {
      server.strategy = 'ipv4_only'
    }
  }

  for (const rule of config.dns.rules || []) {
    if (Array.isArray(rule.query_type)) {
      rule.query_type = rule.query_type.filter(
        item => String(item).toUpperCase() !== 'AAAA'
      )

      if (rule.query_type.length === 0) {
        delete rule.query_type
      }
    }
  }

  for (const inbound of config.inbounds || []) {
    if (
      inbound?.type === 'tun' &&
      Array.isArray(inbound.address)
    ) {
      inbound.address = inbound.address.filter(
        address => !String(address).includes(':')
      )
    }
  }
}

function injectTestRule(config, options) {
  const {
    suffixDomains,
    exactDomains,
    ipCidrs,
    outbound
  } = options

  if (
    suffixDomains.length === 0 &&
    exactDomains.length === 0 &&
    ipCidrs.length === 0
  ) {
    return
  }

  const tags = new Set(
    config.outbounds.map(item => item.tag)
  )

  if (!tags.has(outbound)) {
    throw new Error(`测试策略组不存在：${outbound}`)
  }

  const rule = { outbound }

  if (suffixDomains.length > 0) {
    rule.domain_suffix = suffixDomains
  }

  if (exactDomains.length > 0) {
    rule.domain = exactDomains
  }

  if (ipCidrs.length > 0) {
    rule.ip_cidr = ipCidrs
  }

  let insertIndex = 0

  for (let i = 0; i < config.route.rules.length; i++) {
    const current = config.route.rules[i]

    if (
      current.action === 'sniff' ||
      current.action === 'hijack-dns' ||
      current.ip_is_private === true ||
      current.clash_mode === 'direct' ||
      current.clash_mode === 'global'
    ) {
      insertIndex = i + 1
    }
  }

  config.route.rules.splice(insertIndex, 0, rule)
}

function normalizeExperimental(config) {
  if (config.experimental?.cache_file) {
    config.experimental.cache_file.path = 'cache.db'
  }

  if (config.experimental?.clash_api) {
    config.experimental.clash_api.external_controller = '127.0.0.1:9095'
    config.experimental.clash_api.external_ui = 'ui'
  }
}

function setAutoRedirect(config, enabled) {
  for (const inbound of config.inbounds || []) {
    if (inbound?.type === 'tun') {
      inbound.auto_redirect = enabled
    }
  }
}

function regionMatches(nodeName, region) {
  const patterns = {
    HK: /(?:🇭🇰|香港|Hong\s*Kong|(?:^|[-_\s])HK(?:[-_\s\d]|$))/i,
    TW: /(?:🇹🇼|台湾|台北|Taiwan|(?:^|[-_\s])TW(?:[-_\s\d]|$))/i,
    JP: /(?:🇯🇵|日本|东京|大阪|Japan|Tokyo|(?:^|[-_\s])JP(?:[-_\s\d]|$))/i,
    KR: /(?:🇰🇷|韩国|首尔|春川|Korea|Seoul|Chuncheon|(?:^|[-_\s])KR(?:[-_\s\d]|$))/i,
    SG: /(?:🇸🇬|新加坡|狮城|Singapore|(?:^|[-_\s])SG(?:[-_\s\d]|$))/i,
    US: /(?:🇺🇸|美国|洛杉矶|圣何塞|西雅图|迈阿密|芝加哥|加州|United\s*States|Los\s*Angeles|(?:^|[-_\s])US(?:[-_\s\d]|$))/i
  }

  return patterns[region]?.test(nodeName) || false
}

function getBaseConfigContent() {
  // Sub-Store 在“预览文件/脚本操作”场景中，
  // $content 可能存在但值为 ""。
  // `??` 不会把空字符串视为缺失，因此必须显式判断 trim()。
  if (
    typeof $content === 'string' &&
    $content.trim().length > 0
  ) {
    return $content
  }

  if (
    typeof $files !== 'undefined' &&
    Array.isArray($files)
  ) {
    for (const file of $files) {
      if (
        typeof file === 'string' &&
        file.trim().length > 0
      ) {
        return file
      }

      // 兼容部分 Sub-Store 环境把文件包装为对象的情况。
      if (
        file &&
        typeof file === 'object' &&
        typeof file.content === 'string' &&
        file.content.trim().length > 0
      ) {
        return file.content
      }
    }
  }

  throw new Error(
    '基础配置内容为空。请确认快捷脚本前一步已经传入 sing-box-base.json，' +
    '或脚本操作绑定了正确的文件输入。'
  )
}

function validateBaseConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('基础配置为空')
  }

  if (!Array.isArray(config.outbounds)) {
    throw new Error('缺少 outbounds')
  }

  if (!Array.isArray(config.route?.rules)) {
    throw new Error('缺少 route.rules')
  }

  if (!Array.isArray(config.dns?.servers)) {
    throw new Error('缺少 dns.servers')
  }
}

function createRegExp(pattern) {
  const value = String(pattern || '.*')
  const ignoreCase = value.includes('ℹ️')

  return new RegExp(
    value.replaceAll('ℹ️', ''),
    ignoreCase ? 'i' : undefined
  )
}

function isValidHostname(value) {
  if (!value || value.length > 253) return false

  return value.split('.').every(label =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
  )
}

function splitValues(value) {
  return unique(
    String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
}

function unique(values) {
  return Array.from(new Set(values))
}

function toBoolean(value, defaultValue) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return defaultValue
  }

  return /^(1|true|yes|on)$/i.test(String(value))
}

function log(message) {
  console.log(`[sing-box 模板] ${message}`)
}
