const mongoose = require('mongoose');
const Client = require('../models/Client');
const Group = require('../models/Group');
const Counter = require('../models/Counter');

exports.createClient = async (req, res) => {
  try {
    const {
      branchName,
      branchCode,
      groupName,
      groupCode,
      memberName,
      picture,
      memberAge,
      guardianName,
      memberNumber,
      admissionDate,
      passBookIssuedDate,
      nationalId,
      memberSignature,
      group,
    } = req.body;

    // Resolve optional group if provided
    let groupDoc = null;
    if (group) {
      if (!mongoose.Types.ObjectId.isValid(group)) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
      groupDoc = await Group.findById(group);
      if (!groupDoc) return res.status(404).json({ error: 'Group not found' });
    }

    // Generate a unique passbook number with retry on duplicate
    let client;
    for (let attempt = 0; attempt < 5; attempt++) {
      const counter = await Counter.findByIdAndUpdate(
        'passbook',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const generatedPassBookNumber = `PB-${String(counter.seq).padStart(6, '0')}`;

      try {
        client = await Client.create({
          passBookNumber: generatedPassBookNumber,
          branchName,
          branchCode,
          groupName: groupName || (groupDoc ? groupDoc.groupName : undefined),
          groupCode: groupCode || (groupDoc ? groupDoc.groupCode : undefined),
          memberName,
          picture,
          memberAge,
          guardianName,
          memberNumber,
          admissionDate,
          passBookIssuedDate,
          nationalId,
          memberSignature,
          group: groupDoc ? groupDoc._id : undefined,
        });
        break; // success
      } catch (e) {
        if (e && e.code === 11000 && /passBookNumber/i.test(e.message || '')) {
          // Duplicate key on passBookNumber, retry
          continue;
        }
        throw e;
      }
    }

    if (!client) {
      return res.status(500).json({ error: 'Failed to allocate passbook number' });
    }

    // Optionally add to group's clients list
    if (groupDoc) {
      try {
        await Group.updateOne({ _id: groupDoc._id }, { $addToSet: { clients: client._id } });
      } catch (e) {
        // Non-fatal; log and continue
        console.warn('[CLIENTS] createClient: failed to push into group.clients', e.message);
      }
    }

    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllClients = async (req, res) => {
  try {
    const { branchName, branchCode, groupId } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (groupId) filter.group = groupId;
    const clients = await Client.find(filter).select('-picture').sort({ createdAt: -1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select('-picture').populate('group');
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const updateData = { ...req.body };
    // Prevent passBookNumber from being updated via API
    if (Object.prototype.hasOwnProperty.call(updateData, 'passBookNumber')) {
      delete updateData.passBookNumber;
    }
    // If group provided, validate or ignore empty
    if (Object.prototype.hasOwnProperty.call(updateData, 'group')) {
      if (!updateData.group) {
        delete updateData.group; // ignore empty string/null to avoid cast errors
      } else if (!mongoose.Types.ObjectId.isValid(updateData.group)) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
    }
    const client = await Client.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClientsByGroup = async (req, res) => {
  try {
    const clients = await Client.find({ group: req.params.groupId }).select('-picture').sort({ createdAt: -1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Upload client picture using multer (memory storage). Stores as Data URI in `picture`.
exports.uploadClientPicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No picture file uploaded' });
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const mime = req.file.mimetype || 'application/octet-stream';
    const base64 = req.file.buffer.toString('base64');
    client.picture = `data:${mime};base64,${base64}`;
    await client.save();
    res.status(200).json({ message: 'Picture uploaded' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Return raw image bytes for <img src> lazy loading; falls back to 404 if not set
exports.getClientPicture = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select('picture');
    if (!client || !client.picture) return res.status(404).json({ error: 'Picture not found' });

    // Expect Data URI: data:<mime>;base64,<data>
    const [meta, data] = String(client.picture).split(',');
    const match = /^data:(.*);base64$/.exec(meta || '');
    const mime = (match && match[1]) || 'application/octet-stream';
    const buf = Buffer.from(data || '', 'base64');
    res.set('Content-Type', mime);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
