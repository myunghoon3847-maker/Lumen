'use strict';

const { applyCors, applySecurityHeaders } = require('../lib/security');

module.exports = function handler(req, res) {
  applySecurityHeaders(res);
  const cors = applyCors(req, res, ['GET', 'OPTIONS'], { requireOrigin: false });
  if (cors.handled) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET 요청만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  }
  return res.status(200).json({ ok: true, service: 'lumen-api' });
};
