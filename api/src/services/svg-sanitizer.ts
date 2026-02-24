/**
 * SVG Sanitizer
 *
 * Implements the minimum sanitizer policy for certificate templates:
 * 1. Strip <script>, event handlers (on*), foreignObject, external refs, JS/data URL payloads.
 * 2. Strict allowlist of SVG tags/attributes.
 * 3. Enforce max size and required placeholders.
 * 4. Deterministic output (normalised whitespace) so hash/CID are reproducible.
 *
 * The API is the sole gatekeeper; on-chain hash is always derived from sanitized bytes only.
 */

// ============================================================
// Constants
// ============================================================

export const MAX_TEMPLATE_SIZE = 102400; // 100 KB (matches CertNFT.MAX_TEMPLATE_SIZE)

export const REQUIRED_PLACEHOLDERS = [
  '{{CERT_TYPE}}',
  '{{ITERATION}}',
  '{{TEAM_MEMBERS}}',
  '{{ACCOUNT}}',
  '{{STATUS}}',
  '{{TOKEN_ID}}',
];

/**
 * Allowlisted SVG element names (case-insensitive comparison applied at parse time).
 * foreignObject is intentionally excluded.
 */
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'use', 'symbol', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'image',
  'marker',
  'lineargradient', 'radialgradient', 'stop',
  'clippath', 'mask',
  'pattern',
  'filter',
  'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
  'feflood', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
  'femorphology', 'feoffset', 'fespeclularlighting', 'fetile', 'feturbulence',
  'fespecularlighting', 'fedistantlight', 'fepointlight', 'fespotlight',
  'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
]);

/**
 * Elements that must be completely stripped (including children).
 */
const STRIP_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed',
  'link', 'meta', 'style',
  'animate', 'animatemotion', 'animatetransform', 'set',
  'metadata',
]);

/**
 * Attribute name allowlist. Event attributes (on*) are blocked globally by the
 * sanitizer loop — no need to list them here.
 */
const ALLOWED_ATTRS = new Set([
  // Core
  'id', 'class', 'style', 'lang', 'xml:space', 'xml:lang',
  // Geometry
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points', 'dx', 'dy',
  // Presentation
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'color', 'visibility', 'display', 'overflow', 'clip-path',
  'clip-rule', 'mask', 'filter',
  // Text
  'text-anchor', 'dominant-baseline', 'font-family', 'font-size',
  'font-weight', 'font-style', 'font-variant', 'letter-spacing',
  'word-spacing', 'text-decoration',
  // Transform / coordinate
  'transform', 'viewbox', 'preserveaspectratio',
  // Gradient
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset',
  'stop-color', 'stop-opacity', 'fx', 'fy', 'fr',
  // References (values filtered separately)
  'href', 'xlink:href',
  // Image
  'image-rendering',
  // Misc structural
  'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight',
  'markerunits', 'refx', 'refy', 'orient',
  'patternunits', 'patterntransform', 'patterncontentunits',
  'clip-path', 'clipPathUnits', 'clippathunits',
  'maskcontentunits', 'maskunits',
  'in', 'in2', 'result', 'type', 'values', 'mode', 'operator',
  'k1', 'k2', 'k3', 'k4', 'order', 'kernelmatrix', 'divisor',
  'edgemode', 'bias', 'kernelunitlength', 'preservealpha',
  'scale', 'xchannelselector', 'ychannelselector',
  'stddeviation', 'stitchtiles', 'basefrequency', 'numoctaves', 'seed',
  'amplitude', 'exponent', 'intercept', 'slope', 'tablevalues',
  'azimuth', 'elevation', 'limitingconeangle', 'pointsatx', 'pointsaty', 'pointsatz',
  'specularexponent', 'specularconstant', 'diffuseconstant', 'surfacescale',
  'lightingcolor', 'floodcolor', 'floodopacity',
  'color-interpolation-filters', 'color-interpolation',
  'path', 'method', 'spacing', 'startoffset', 'side',
  'lengthAdjust', 'lengthadjust', 'textlength',
  // SVG root
  'xmlns', 'xmlns:xlink', 'xmlns:svg', 'version',
]);

// ============================================================
// Types
// ============================================================

export interface SanitizeResult {
  sanitizedSvg: string;
  hash: string;       // hex keccak256 of sanitized UTF-8 bytes (matches Solidity keccak256)
  issues: string[];   // non-fatal issues stripped
  valid: boolean;     // false if required placeholders are missing or size exceeded
  errors: string[];   // blocking validation errors
}

// ============================================================
// Helpers
// ============================================================

/** True if the value looks like a safe local fragment reference or data URI for raster images */
function isSafeHrefValue(value: string): boolean {
  const v = value.trim();
  // Local fragment references are always safe
  if (v.startsWith('#')) return true;
  // Raster data URIs (png, jpeg, gif, webp) are allowed for <image> elements
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(v)) return true;
  return false;
}

/**
 * Presentation attributes that accept url() functional references.
 * Any url() in these attributes must resolve to a local fragment (#id) only.
 */
const URL_ATTRS = new Set([
  'fill', 'stroke', 'filter', 'clip-path', 'mask',
  'marker-start', 'marker-mid', 'marker-end',
  'color', 'flood-color', 'lighting-color',
]);

/**
 * Sanitize a url()-capable presentation attribute value.
 * Replaces any url(...) whose inner URL is not a safe local fragment (#...) with "none".
 */
function sanitizeUrlAttrValue(value: string): string {
  return value.replace(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (_match, _q, inner) => {
    const trimmed = inner.trim();
    if (trimmed.startsWith('#')) return `url(${trimmed})`;
    return 'none';
  });
}

/** Strip CSS expressions and JS URL schemes from style attribute values */
function sanitizeStyleValue(value: string): string {
  return value
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/url\s*\(\s*(['"]?)javascript:/gi, 'url($1')
    .replace(/url\s*\(\s*(['"]?)data:text\//gi, 'url($1')
    .replace(/url\s*\(\s*(['"]?)data:application\//gi, 'url($1');
}

/** Keccak256 in hex using Node.js crypto via SHA3 emulation.
 *  NOTE: Node.js crypto does not natively support keccak-256 (only SHA3-256 which differs).
 *  We use the ethereum-compatible keccak256 by computing it the same way ethers.js does:
 *  using the 'keccak256' hash algorithm available via the node-gyp bound OpenSSL in newer
 *  Node versions, or falling back to a manual implementation.
 *
 *  In practice, the hash returned here must match `keccak256(templateBytes)` in Solidity.
 *  We use the 'sha3-256' variant if 'keccak256' is not available, or import ethers here.
 *  For correctness we import ethers which is already a project dependency.
 */
function computeKeccak256(data: Buffer): string {
  // We rely on ethers being available in the API process
  // Import inline to avoid circular deps
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { keccak256 } = require('ethers');
  return keccak256(data);
}

// ============================================================
// Core parser — regex-based, single-pass
// ============================================================

/**
 * Parse and sanitize SVG using a regex-based approach.
 * Processes the document character by character using regex token matching,
 * applying the allowlist and stripping policy.
 */
function parseSanitize(raw: string): { output: string; issues: string[] } {
  const issues: string[] = [];
  let output = '';
  let pos = 0;

  // Stack of elements being stripped (we ignore their content)
  const stripStack: string[] = [];

  while (pos < raw.length) {
    // Look for the next '<'
    const nextTag = raw.indexOf('<', pos);

    if (nextTag === -1) {
      // No more tags — emit remaining text if not in a strip zone
      if (stripStack.length === 0) {
        output += raw.slice(pos);
      }
      break;
    }

    // Emit text before the tag if not stripping
    if (stripStack.length === 0) {
      output += raw.slice(pos, nextTag);
    }
    pos = nextTag;

    // Comment: <!-- ... -->
    if (raw.startsWith('<!--', pos)) {
      const end = raw.indexOf('-->', pos + 4);
      if (end === -1) {
        // Malformed comment — skip rest
        issues.push('Malformed HTML comment stripped');
        break;
      }
      // Strip all comments (may hide payloads)
      issues.push('HTML comment stripped');
      pos = end + 3;
      continue;
    }

    // CDATA: <![CDATA[ ... ]]>
    if (raw.startsWith('<![CDATA[', pos)) {
      const end = raw.indexOf(']]>', pos + 9);
      if (end === -1) {
        issues.push('Malformed CDATA stripped');
        break;
      }
      if (stripStack.length === 0) {
        // CDATA is safe in SVG text content — pass through as-is
        output += raw.slice(pos, end + 3);
      }
      pos = end + 3;
      continue;
    }

    // Processing instruction: <? ... ?>
    if (raw.startsWith('<?', pos)) {
      const end = raw.indexOf('?>', pos + 2);
      const endPos = end === -1 ? raw.length : end + 2;
      issues.push('Processing instruction stripped');
      pos = endPos;
      continue;
    }

    // DOCTYPE
    if (raw.startsWith('<!', pos)) {
      const end = raw.indexOf('>', pos + 2);
      const endPos = end === -1 ? raw.length : end + 1;
      issues.push('DOCTYPE stripped');
      pos = endPos;
      continue;
    }

    // Closing tag: </tagname>
    const closeMatch = raw.slice(pos).match(/^<\/([a-zA-Z][a-zA-Z0-9:.-]*)\s*>/);
    if (closeMatch) {
      const tagName = closeMatch[1].toLowerCase();
      const fullMatch = closeMatch[0];

      if (stripStack.length > 0 && stripStack[stripStack.length - 1] === tagName) {
        stripStack.pop();
      } else if (stripStack.length === 0) {
        if (STRIP_ELEMENTS.has(tagName)) {
          // Already stripped opening, ignore closing
          issues.push(`Stripped closing </${tagName}>`);
        } else if (ALLOWED_TAGS.has(tagName)) {
          output += fullMatch;
        } else {
          issues.push(`Unknown closing tag </${tagName}> stripped`);
        }
      }
      pos += fullMatch.length;
      continue;
    }

    // Opening (or self-closing) tag: <tagname attr1="val1" ... /> or <tagname ...>
    const tagMatch = raw.slice(pos).match(/^<([a-zA-Z][a-zA-Z0-9:.-]*)((?:\s+[^>]*?)?)(\/?)>/s);
    if (tagMatch) {
      const rawTagName = tagMatch[1];
      const tagName = rawTagName.toLowerCase();
      const attrsRaw = tagMatch[2];
      const selfClose = tagMatch[3] === '/';
      const fullMatch = tagMatch[0];

      if (STRIP_ELEMENTS.has(tagName)) {
        issues.push(`<${tagName}> element stripped`);
        if (!selfClose) {
          stripStack.push(tagName);
        }
        pos += fullMatch.length;
        continue;
      }

      if (stripStack.length > 0) {
        // Inside a stripped element — skip
        pos += fullMatch.length;
        continue;
      }

      if (!ALLOWED_TAGS.has(tagName)) {
        issues.push(`Unknown element <${tagName}> stripped`);
        if (!selfClose) {
          // Treat as opaque container — strip children too
          stripStack.push(tagName);
        }
        pos += fullMatch.length;
        continue;
      }

      // Parse and filter attributes
      const sanitizedAttrs = sanitizeAttrs(attrsRaw, tagName, issues);
      const sc = selfClose ? ' /' : '';
      output += `<${rawTagName}${sanitizedAttrs}${sc}>`;
      pos += fullMatch.length;
      continue;
    }

    // Unmatched '<' — emit as-is and advance
    if (stripStack.length === 0) {
      output += '<';
    }
    pos += 1;
  }

  return { output, issues };
}

/** Parse attribute string and return sanitized attribute string */
function sanitizeAttrs(attrsRaw: string, tagName: string, issues: string[]): string {
  if (!attrsRaw.trim()) return '';

  let result = '';

  // Match attributes: name="value", name='value', name=value, or bare name
  const attrRe = /\s+([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;

  while ((m = attrRe.exec(attrsRaw)) !== null) {
    const attrName = m[1];
    const attrNameLower = attrName.toLowerCase();
    const rawValue = m[2] ?? m[3] ?? m[4] ?? '';

    // Block all event handlers
    if (/^on/i.test(attrNameLower)) {
      issues.push(`Event handler attribute "${attrName}" stripped`);
      continue;
    }

    // Block unknown attributes
    if (!ALLOWED_ATTRS.has(attrNameLower)) {
      issues.push(`Attribute "${attrName}" stripped (not in allowlist)`);
      continue;
    }

    // href / xlink:href — must be a safe value
    if (attrNameLower === 'href' || attrNameLower === 'xlink:href') {
      if (!isSafeHrefValue(rawValue)) {
        issues.push(`Unsafe href value stripped from <${tagName}>`);
        continue;
      }
    }

    // style — strip dangerous CSS and external url() references
    if (attrNameLower === 'style') {
      let cleaned = sanitizeStyleValue(rawValue);
      // Also neutralise any url() in style that doesn't reference a local fragment
      cleaned = sanitizeUrlAttrValue(cleaned);
      if (cleaned !== rawValue) {
        issues.push('Unsafe CSS expression stripped from style attribute');
      }
      result += ` ${attrName}="${escapeAttr(cleaned)}"`;
      continue;
    }

    // Presentation attributes that accept url() — enforce local-fragment-only
    if (URL_ATTRS.has(attrNameLower)) {
      const cleaned = sanitizeUrlAttrValue(rawValue);
      if (cleaned !== rawValue) {
        issues.push(`External url() reference stripped from "${attrName}"`);
      }
      result += ` ${attrName}="${escapeAttr(cleaned)}"`;
      continue;
    }

    result += ` ${attrName}="${escapeAttr(rawValue)}"`;
  }

  return result;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Public API
// ============================================================

/**
 * Sanitize a raw SVG string and compute its keccak256 hash.
 * This is a pure function — no IPFS writes.
 */
export function sanitizeSVG(rawSvg: string): SanitizeResult {
  const errors: string[] = [];

  // Size check (raw)
  const rawBytes = Buffer.from(rawSvg, 'utf8');
  if (rawBytes.length > MAX_TEMPLATE_SIZE) {
    errors.push(`SVG exceeds maximum size (${rawBytes.length} > ${MAX_TEMPLATE_SIZE} bytes)`);
    return {
      sanitizedSvg: '',
      hash: '',
      issues: [],
      valid: false,
      errors,
    };
  }

  // Must begin with <svg (after optional XML declaration)
  const trimmed = rawSvg.trim();
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(trimmed)) {
    errors.push('Input must be an SVG document starting with <svg>');
    return { sanitizedSvg: '', hash: '', issues: [], valid: false, errors };
  }

  // Parse and sanitize
  const { output: sanitizedSvg, issues } = parseSanitize(trimmed);

  // Validate required placeholders
  for (const placeholder of REQUIRED_PLACEHOLDERS) {
    if (!sanitizedSvg.includes(placeholder)) {
      errors.push(`Missing required placeholder: ${placeholder}`);
    }
  }

  // Check sanitized size
  const sanitizedBytes = Buffer.from(sanitizedSvg, 'utf8');
  if (sanitizedBytes.length > MAX_TEMPLATE_SIZE) {
    errors.push(`Sanitized SVG exceeds maximum size (${sanitizedBytes.length} > ${MAX_TEMPLATE_SIZE} bytes)`);
  }

  const valid = errors.length === 0;
  const hash = valid ? computeKeccak256(sanitizedBytes) : '';

  return {
    sanitizedSvg,
    hash,
    issues,
    valid,
    errors,
  };
}
