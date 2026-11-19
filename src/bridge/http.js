const MESSAGES = Object.freeze({
  MIGRATION_NOT_READY: '配置切换尚未完成，请重新打开原模型页面后重试。',
  INVALID_SHARED_CONFIG: '供应商配置只允许修改名称、地址、默认协议和请求头。',
  INVALID_SINGLE_KEY_CONFIG: '单密钥配置只允许修改凭据引用和模型列表。',
  SETTINGS_CONFLICT: '配置已变化，请刷新后重试。',
  NATIVE_CONFIG_CONFLICT: '原供应商配置已被修改，请先处理卡片中的配置冲突。',
  BRIDGE_BUSY: '正在保存，请稍后重试。',
  LEGACY_PATCH_MIGRATION_REQUIRED: '需要先迁移现有多密钥补丁，原配置会保留。',
  EMPTY_KEY_ENTRIES: '请先添加至少一组密钥。',
  INVALID_BRIDGE_CONFIG: '多密钥配置格式无效。',
  INVALID_KEY_ENTRY: '密钥组标识无效。',
  INVALID_PROTOCOL: '请选择支持的协议。',
  USE_CREDENTIAL_REFERENCE: '请使用凭据引用。',
  INVALID_CREDENTIAL_REFERENCE: '凭据引用无效。',
  INVALID_CREDENTIAL_VALUE: '请输入有效的密钥。',
  CREDENTIALS_UNAVAILABLE: '主机凭据服务尚未就绪。',
  INVALID_ENDPOINT: '接口地址无效。',
  INVALID_MODELS: '模型列表包含无效或重复的标识。',
  INVALID_MODEL_IDENTITY: '模型标识无效。',
  INVALID_MODEL_CAPABILITY: '模型能力配置无效。',
  INVALID_HEADERS: '请求头配置无效。',
  DISCOVERY_UNAVAILABLE: '当前无法获取模型列表。',
  MISSING_CREDENTIAL: '请为密钥组填写有效的凭据引用或先保存密钥。',
  AUTH_HEADER_CONFLICT: '认证请求头会覆盖所选密钥，请先在原供应商设置中移除它。',
  BRIDGE_RUNTIME_UNAVAILABLE: '当前宿主缺少独立密钥运行所需的公共接口。',
  BRIDGE_PROJECTION_UNSUPPORTED: '当前宿主不能通过公共模型配置提供此路由，请保留原配置并反馈宿主能力。',
  DISCOVERY_PROTOCOL_REQUIRED: '请先选择密钥组的 API 协议。',
  DISCOVERY_ENDPOINT_REQUIRED: '请先填写密钥组或原供应商的接口地址。',
  GUARD_CREDENTIAL_REQUIRED: '本机路由凭据尚未就绪。',
});
export function bridgeHttpHandler(controller, connection) {
  return async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const admission = connection.admit(req);
      if (!admission?.peer || admission.peer.principal?.kind !== 'owner') return send(admission?.rejection || 403, { ok: false, error: { code: 'FORBIDDEN', message: '需要已登录的主机所有者。' } });
      if (req.method === 'GET') return send(200, { ok: true, value: { ...await controller.snapshot(), ...(controller.needsInitialization?.() ? { initializationRequired: true } : {}) } });
      if (req.method !== 'POST') return send(405, { ok: false, error: { code: 'METHOD', message: '不支持此操作。' } });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, { ok: false, error: { code: 'CONTENT_TYPE', message: '只接受 JSON。' } });
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 1024 * 1024) return send(413, { ok: false, error: { code: 'BODY_LIMIT', message: '请求过大。' } });
        chunks.push(buffer);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { ok: false, error: { code: 'JSON', message: '请求格式错误。' } }); }
      if (input?.action === 'initialize' && controller.initialize) {
        await controller.initialize();
        return send(200, { ok: true, value: await controller.snapshot() });
      }
      if (input?.action === 'save') {
        await controller.save(input.provider, input.draft, input.expectedRevision);
        return send(200, { ok: true, value: await controller.snapshot() });
      }
      if (input?.action === 'credential') return send(200, { ok: true, value: await controller.setCredential(input.ref, input.value) });
      if (input?.action === 'discover') return send(200, { ok: true, value: await controller.discover(input.provider, input.entryId, input.draft, { apiKey: input.apiKey, shared: input.shared }) });
      return send(400, { ok: false, error: { code: 'ACTION', message: '不支持此操作。' } });
    } catch (error) {
      const code = Object.hasOwn(MESSAGES, error?.code ?? '') ? error.code : 'FAILED';
      return send(409, { ok: false, error: { code, message: MESSAGES[code] ?? '操作未完成，请检查后重试。' } });
    }
  };
}
