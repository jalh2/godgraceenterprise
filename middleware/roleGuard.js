// Simple role-based access middleware using req.userDoc from userIdentity
// Usage:
//   const { requireUser, forbidRoles } = require('../middleware/roleGuard');
//   router.use(requireUser, forbidRoles('loan officer'));

function requireUser(req, res, next) {
  if (!req.userDoc) {
    return res.status(401).json({ error: 'Authentication required. Please include x-user-email header.' });
  }
  next();
}

function forbidRoles(...disallowed) {
  const set = new Set((disallowed || []).map((s) => String(s).trim().toLowerCase()));
  return function (req, res, next) {
    if (!req.userDoc) {
      return res.status(401).json({ error: 'Authentication required. Please include x-user-email header.' });
    }
    const userRole = (req.userDoc.role || '').toString().trim().toLowerCase();
    if (set.has(userRole)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
}

function allowRoles(...allowed) {
  const set = new Set((allowed || []).map((s) => String(s).trim().toLowerCase()));
  return function (req, res, next) {
    if (!req.userDoc) {
      return res.status(401).json({ error: 'Authentication required. Please include x-user-email header.' });
    }
    const userRole = (req.userDoc.role || '').toString().trim().toLowerCase();
    if (!set.has(userRole)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
}

function forbidLoanOfficer(req, res, next) {
  if (!req.userDoc) {
    return res.status(401).json({ error: 'Authentication required. Please include x-user-email header.' });
  }
  if ((req.userDoc.role || '').toString().trim().toLowerCase() === 'loan officer') {
    return res.status(403).json({ error: 'Loan officers are not allowed to access this resource' });
  }
  next();
}

module.exports = { requireUser, forbidRoles, allowRoles, forbidLoanOfficer };

