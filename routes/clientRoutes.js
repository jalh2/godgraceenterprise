const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image uploads are allowed'));
  },
});
const {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  getClientsByGroup,
  uploadClientPicture,
  getClientPicture,
} = require('../controllers/clientController');

router.post('/', createClient);
router.get('/', getAllClients);
router.get('/group/:groupId', getClientsByGroup);
router.post('/:id/picture', upload.single('picture'), uploadClientPicture);
router.get('/:id/picture', getClientPicture);
router.get('/:id', getClientById);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);

module.exports = router;
