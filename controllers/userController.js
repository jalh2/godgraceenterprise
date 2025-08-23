const User = require('../models/User');
const crypto = require('crypto');

function hashPassword(plain) {
  if (!plain || typeof plain !== 'string' || !plain.trim()) {
    throw new Error('Password is required');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function sanitizeUser(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.passwordHash;
  delete obj.passwordSalt;
  return obj;
}

exports.createUser = async (req, res) => {
  try {
    const { password, ...rest } = req.body;
    const { salt, hash } = hashPassword(password);
    const payload = { ...rest, passwordSalt: salt, passwordHash: hash };
    const user = await User.create(payload);
    res.status(201).json(sanitizeUser(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const { branchName, branchCode, role } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (role) filter.role = role;
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json(users.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const update = { ...req.body };
    // Never allow direct setting of hash/salt
    delete update.passwordHash;
    delete update.passwordSalt;
    if (Object.prototype.hasOwnProperty.call(update, 'password')) {
      const pwd = update.password;
      delete update.password;
      if (pwd) {
        const { salt, hash } = hashPassword(pwd);
        update.passwordSalt = salt;
        update.passwordHash = hash;
      }
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLoanOfficers = async (req, res) => {
  try {
    const { branchName, branchCode } = req.query;
    const filter = { role: 'loan officer' };
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    const officers = await User.find(filter).sort({ username: 1 });
    res.json(officers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBranches = async (req, res) => {
  try {
    const branches = await User.aggregate([
      { $group: { _id: { branchCode: '$branchCode', branchName: '$branchName' } } },
      { $project: { _id: 0, branchCode: '$_id.branchCode', branchName: '$_id.branchName' } },
      { $sort: { branchName: 1 } },
    ]);
    res.json(branches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
