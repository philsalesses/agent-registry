/**
 * Validate a Bitcoin address (basic validation)
 * Supports: Legacy (1...), SegWit (3...), Native SegWit (bc1...)
 */
export function isValidBitcoinAddress(address: string): boolean {
  if (!address) return false;
  
  // Legacy addresses start with 1
  if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
  
  // P2SH addresses start with 3
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
  
  // Bech32 addresses start with bc1
  if (/^bc1[a-z0-9]{39,59}$/.test(address)) return true;
  
  return false;
}

/**
 * Validate a Lightning address (user@domain format)
 */
export function isValidLightningAddress(address: string): boolean {
  if (!address) return false;
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(address);
}

/**
 * Validate a URL
 */
export function isValidUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validate payment methods array
 */
export function validatePaymentMethods(methods: any[]): { valid: boolean; error?: string } {
  if (!Array.isArray(methods)) {
    return { valid: false, error: 'paymentMethods must be an array' };
  }

  for (const method of methods) {
    if (!method.type || !method.address) {
      return { valid: false, error: 'Each payment method needs type and address' };
    }

    if (method.type === 'bitcoin' && !isValidBitcoinAddress(method.address)) {
      return { valid: false, error: `Invalid Bitcoin address: ${method.address}` };
    }

    if (method.type === 'lightning' && !isValidLightningAddress(method.address)) {
      return { valid: false, error: `Invalid Lightning address: ${method.address}` };
    }
  }

  return { valid: true };
}

/**
 * Sanitize string input
 */
export function sanitizeString(str: string | undefined, maxLength: number = 500): string | undefined {
  if (!str) return undefined;
  // Remove any HTML tags and limit length
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}
