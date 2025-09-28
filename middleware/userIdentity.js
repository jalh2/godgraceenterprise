const User = require('../models/User');

// Attaches req.userEmail and req.userDoc (if x-user-email or x-user-username headers present)
module.exports = async function userIdentity(req, res, next) {
  try {
    const email = (req.headers['x-user-email'] || '').toString().trim().toLowerCase();
    const username = (req.headers['x-user-username'] || '').toString().trim();

    let user = null;
    if (email) {
      user = await User.findOne({ email });
    } else if (username) {
      user = await User.findOne({ username });
    }

    if (user) {
      // Always reflect canonical email on the request for downstream consumers
      try { req.userEmail = String(user.email || email || '').toLowerCase(); } catch (_) { req.userEmail = email || null; }
      // Normalize role in-memory for consistent checks
      if (user.role) {
        try { user.role = String(user.role).trim().toLowerCase(); } catch (_) {}
      }
      req.userDoc = user;
    }
  } catch (e) {
    // non-fatal
  }
  return next();
};
