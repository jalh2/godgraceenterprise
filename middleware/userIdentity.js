const User = require('../models/User');

// Attaches req.userEmail and req.userDoc (if x-user-email header present)
module.exports = async function userIdentity(req, res, next) {
  try {
    const email = (req.headers['x-user-email'] || '').toString().trim().toLowerCase();
    if (!email) return next();
    const user = await User.findOne({ email });
    if (user) {
      req.userEmail = email;
      req.userDoc = user;
    }
  } catch (e) {
    // non-fatal
  }
  return next();
};
