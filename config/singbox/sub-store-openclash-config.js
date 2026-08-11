// Sub-Store file operator for rendering openclash-final.yaml.
//
// Required script arguments:
//   cfDialDomain  - normal Cloudflare dial domain
//   cfLiveDomain  - LIVE Cloudflare dial domain
//   substoreUrl   - ClashMeta URL of the node collection/provider
//
// Optional:
//   cfDnsServer   - resolver for both dial domains (default: 119.29.29.29)

function renderOpenClashConfig(content, args = {}) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('openclash-final.yaml content is empty')
  }

  const values = {
    __CF_DIAL_DOMAIN__: requireHostname(args, 'cfDialDomain'),
    __CF_LIVE_DOMAIN__: requireHostname(args, 'cfLiveDomain'),
    __SUBSTORE_PROVIDER_URL__: requireHttpUrl(args, 'substoreUrl'),
    __CF_DNS_SERVER__: String(args.cfDnsServer || '119.29.29.29').trim()
  }

  if (values.__CF_DIAL_DOMAIN__ === values.__CF_LIVE_DOMAIN__) {
    throw new Error('cfDialDomain and cfLiveDomain must be different')
  }

  validateDnsServer(values.__CF_DNS_SERVER__)

  let output = content
  for (const [placeholder, value] of Object.entries(values)) {
    if (!output.includes(placeholder)) {
      throw new Error(`template placeholder is missing: ${placeholder}`)
    }
    output = output.split(placeholder).join(escapeYamlDoubleQuoted(value))
  }

  const unresolved = output.match(/__[A-Z0-9_]+__/g)
  if (unresolved) {
    throw new Error(`unresolved template placeholder: ${unresolved[0]}`)
  }

  return output
}

function requireHostname(args, field) {
  const value = String(args[field] || '').trim()
  if (!value || /[\s/:]/.test(value)) {
    throw new Error(`${field} must be a hostname or IP address`)
  }
  return value
}

function requireHttpUrl(args, field) {
  const value = String(args[field] || '').trim()
  if (!/^https?:\/\/[^\s]+$/i.test(value)) {
    throw new Error(`${field} must be an http/https URL`)
  }
  return value
}

function validateDnsServer(value) {
  if (!value || /\s/.test(value)) {
    throw new Error('cfDnsServer must be an IP address or DoH URL')
  }
}

function escapeYamlDoubleQuoted(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function getBaseConfigContent() {
  if (typeof $content === 'string' && $content.trim()) {
    return $content
  }

  if (typeof $files !== 'undefined' && Array.isArray($files)) {
    for (const file of $files) {
      if (typeof file === 'string' && file.trim()) return file
      if (file && typeof file.content === 'string' && file.content.trim()) {
        return file.content
      }
    }
  }

  throw new Error('openclash-final.yaml was not provided to the file operator')
}

if (typeof module !== 'undefined') {
  module.exports = { renderOpenClashConfig }
} else {
  const args =
    typeof $arguments !== 'undefined' && $arguments ? $arguments : {}
  $content = renderOpenClashConfig(getBaseConfigContent(), args)
}
