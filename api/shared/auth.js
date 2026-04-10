function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;

    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = payload + '='.repeat((4 - (payload.length % 4 || 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function getSwaPrincipal(req) {
  const header =
    req.headers['x-ms-client-principal'] ||
    req.headers['X-MS-CLIENT-PRINCIPAL'];

  if (!header) return null;

  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
}

function getClaimFromPrincipal(principal, claimTypes) {
  if (!principal || !Array.isArray(principal.claims)) return null;

  for (const type of claimTypes) {
    const found = principal.claims.find(c => c.typ === type);
    if (found && found.val) return String(found.val).trim();
  }

  return null;
}

function getIdentity(req) {
  const principal = getSwaPrincipal(req);

  if (principal) {
    const email =
      getClaimFromPrincipal(principal, ['preferred_username', 'email', 'upn', 'emails']) ||
      principal.userDetails ||
      null;

    const aadObjectId = getClaimFromPrincipal(principal, [
      'http://schemas.microsoft.com/identity/claims/objectidentifier',
      'oid'
    ]);

    return {
      source: 'swa',
      email,
      aadObjectId,
      principal,
      mobileClaims: null
    };
  }

  const mobileIdToken =
    req.headers['x-mobile-id-token'] ||
    req.headers['X-Mobile-ID-Token'];

  if (mobileIdToken) {
    const claims = decodeJwtPayload(mobileIdToken);

    if (!claims) {
      return {
        source: 'mobile',
        email: null,
        aadObjectId: null,
        principal: null,
        mobileClaims: null
      };
    }

    return {
      source: 'mobile',
      email: claims.preferred_username || claims.email || claims.upn || null,
      aadObjectId: claims.oid || null,
      principal: null,
      mobileClaims: claims
    };
  }

  return {
    source: null,
    email: null,
    aadObjectId: null,
    principal: null,
    mobileClaims: null
  };
}

module.exports = {
  getIdentity
};