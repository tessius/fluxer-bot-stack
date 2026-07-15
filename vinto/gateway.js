import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
const Op = {
    DISPATCH: 0,
    HEARTBEAT: 1,
    IDENTIFY: 2,
    PRESENCE_UPDATE: 3,
    VOICE_STATE_UPDATE: 4,
    RESUME: 6,
    RECONNECT: 7,
    INVALID_SESSION: 9,
    HELLO: 10,
    HEARTBEAT_ACK: 11,
    GATEWAY_ERROR: 12,
};
const NON_RECOVERABLE_CLOSE_CODES = new Set([
    4004, // authentication failed
    4010, // invalid shard
    4011, // sharding required
    4012, // invalid API version
    4014, // disallowed intents
]);
const MIN_HEARTBEAT_INTERVAL_MS = 100;
const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
const SEQUENCE_ACK_HEARTBEAT_INTERVAL_MS = 750;
function isGatewayPacket(value) {
    return Boolean(value && typeof value === 'object');
}
function withGatewayQuery(url) {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('v')) {
        parsed.searchParams.set('v', '1');
    }
    if (!parsed.searchParams.has('encoding')) {
        parsed.searchParams.set('encoding', 'json');
    }
    return parsed.toString();
}
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function normalizeHeartbeatIntervalMs(value) {
    const intervalMs = Number(value);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
        return null;
    return Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.floor(intervalMs)));
}
export class Gateway extends EventEmitter {
    url;
    token;
    intents;
    logger;
    reconnectBaseDelayMs;
    reconnectMaxDelayMs;
    handshakeTimeoutMs;
    connectOpenTimeoutMs;
    ws;
    heartbeatIntervalMs;
    heartbeatIntervalHandle;
    heartbeatStartTimeoutHandle;
    sequenceAckHeartbeatTimeoutHandle;
    reconnectTimeoutHandle;
    connectOpenTimeoutHandle;
    helloTimeoutHandle;
    invalidSessionTimeoutHandle;
    sequence;
    sessionId;
    awaitingHeartbeatAck;
    lastHeartbeatSentAt;
    heartbeatLatencyMs;
    lastSequenceAckSentAt;
    lastSequenceAckSent;
    reconnectAttempts;
    manualDisconnect;
    initialPresence;
    constructor(options) {
        super();
        this.url = withGatewayQuery(options.url);
        this.token = options.token.startsWith('Bot ') ? options.token.slice(4) : options.token;
        this.intents = options.intents ?? 0;
        this.logger = options.logger ?? null;
        this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
        this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
        this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 15_000;
        this.connectOpenTimeoutMs = options.connectOpenTimeoutMs ?? 15_000;
        this.ws = null;
        this.heartbeatIntervalMs = null;
        this.heartbeatIntervalHandle = null;
        this.heartbeatStartTimeoutHandle = null;
        this.sequenceAckHeartbeatTimeoutHandle = null;
        this.reconnectTimeoutHandle = null;
        this.connectOpenTimeoutHandle = null;
        this.helloTimeoutHandle = null;
        this.invalidSessionTimeoutHandle = null;
        this.sequence = null;
        this.sessionId = null;
        this.awaitingHeartbeatAck = false;
        this.lastHeartbeatSentAt = null;
        this.heartbeatLatencyMs = null;
        this.lastSequenceAckSentAt = 0;
        this.lastSequenceAckSent = 0;
        this.reconnectAttempts = 0;
        this.manualDisconnect = false;
        this.initialPresence = options.initialPresence ?? null;
    }
    getHeartbeatLatencyMs() {
        return Number.isFinite(this.heartbeatLatencyMs) ? this.heartbeatLatencyMs : null;
    }
    async sampleHeartbeatLatency(timeoutMs = 4_000) {
        const socket = this.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return null;
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeoutHandle);
                this.off('heartbeat_ack', onAck);
                resolve(value);
            };
            const onAck = (payload) => {
                const latency = Number.isFinite(payload?.latencyMs)
                    ? (payload?.latencyMs ?? null)
                    : this.getHeartbeatLatencyMs();
                finish(latency);
            };
            const timeoutHandle = setTimeout(() => {
                finish(this.getHeartbeatLatencyMs());
            }, Math.max(250, Number.parseInt(String(timeoutMs), 10) || 4_000));
            this.on('heartbeat_ack', onAck);
            this._sendHeartbeat();
        });
    }
    connect() {
        this.manualDisconnect = false;
        this._openSocket();
    }
    disconnect() {
        this.manualDisconnect = true;
        this._clearTimers();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'manual shutdown');
        }
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.terminate();
        }
        this.ws = null;
    }
    joinVoice(guildId, channelId) {
        this._send(Op.VOICE_STATE_UPDATE, {
            guild_id: guildId,
            channel_id: channelId,
            self_mute: false,
            self_deaf: false,
        });
    }
    leaveVoice(guildId) {
        this._send(Op.VOICE_STATE_UPDATE, {
            guild_id: guildId,
            channel_id: null,
            self_mute: false,
            self_deaf: false,
        });
    }
    updatePresence(presence) {
        if (!presence || typeof presence !== 'object')
            return false;
        this.initialPresence = presence;
        this._send(Op.PRESENCE_UPDATE, presence);
        return true;
    }
    _openSocket() {
        this._clearTimers();
        this.ws = new WebSocket(this.url, {
            handshakeTimeout: this.handshakeTimeoutMs,
            perMessageDeflate: false,
        });
        this.connectOpenTimeoutHandle = setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                this.logger?.warn?.('Gateway open timeout reached, terminating socket', {
                    timeoutMs: this.connectOpenTimeoutMs,
                });
                this.ws.terminate();
            }
        }, this.connectOpenTimeoutMs);
        this.ws?.on('open', () => {
            this.reconnectAttempts = 0;
            if (this.connectOpenTimeoutHandle) {
                clearTimeout(this.connectOpenTimeoutHandle);
                this.connectOpenTimeoutHandle = null;
            }
            this.helloTimeoutHandle = setTimeout(() => {
                this.logger?.warn?.('Gateway HELLO timeout reached, terminating socket', {
                    timeoutMs: this.handshakeTimeoutMs,
                });
                this.ws?.terminate();
            }, this.handshakeTimeoutMs);
            this.logger?.info?.('Gateway connected');
            this.emit('open');
        });
        this.ws?.on('message', (raw) => {
            try {
                const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : String(raw ?? '');
                const packet = JSON.parse(text);
                this._handlePacket(packet);
            }
            catch (err) {
                this.logger?.warn?.('Gateway packet parsing failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        });
        this.ws?.on('close', (code, reason) => {
            const closeCode = Number(code);
            const closeReason = Buffer.isBuffer(reason)
                ? reason.toString()
                : String(reason ?? '');
            this.emit('close', closeCode);
            this._handleClose(Number.isFinite(closeCode) ? closeCode : 1006, closeReason);
        });
        this.ws?.on('error', (err) => {
            this.logger?.warn?.('Gateway socket error', {
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }
    _handlePacket(packet) {
        if (!isGatewayPacket(packet))
            return;
        const { op, d, t, s } = packet;
        const opCode = typeof op === 'number' ? op : Number.NaN;
        const eventName = typeof t === 'string' ? t : null;
        if (s != null) {
            const nextSequence = Number(s);
            this.sequence = Number.isFinite(nextSequence) ? nextSequence : this.sequence;
        }
        switch (opCode) {
            case Op.HELLO:
                if (this.helloTimeoutHandle) {
                    clearTimeout(this.helloTimeoutHandle);
                    this.helloTimeoutHandle = null;
                }
                this.heartbeatIntervalMs = normalizeHeartbeatIntervalMs(d?.heartbeat_interval);
                this._startHeartbeat();
                if (this.sessionId && this.sequence != null) {
                    this._resume();
                }
                else {
                    this._identify();
                }
                break;
            case Op.HEARTBEAT:
                this._sendHeartbeat();
                break;
            case Op.HEARTBEAT_ACK:
                if (Number.isFinite(this.lastHeartbeatSentAt)) {
                    this.heartbeatLatencyMs = Math.max(0, Date.now() - (this.lastHeartbeatSentAt ?? 0));
                }
                this.emit('heartbeat_ack', { latencyMs: this.heartbeatLatencyMs });
                this.awaitingHeartbeatAck = false;
                this._scheduleSequenceAckHeartbeat();
                break;
            case Op.RECONNECT:
                this.logger?.warn?.('Gateway requested reconnect');
                this._reconnectNow();
                break;
            case Op.INVALID_SESSION:
                this.logger?.warn?.('Gateway invalid session', { canResume: Boolean(d) });
                if (!d) {
                    this.sessionId = null;
                    this.sequence = null;
                }
                if (this.invalidSessionTimeoutHandle) {
                    clearTimeout(this.invalidSessionTimeoutHandle);
                    this.invalidSessionTimeoutHandle = null;
                }
                this.invalidSessionTimeoutHandle = setTimeout(() => {
                    this.invalidSessionTimeoutHandle = null;
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                        this._scheduleReconnect('invalid_session_socket_closed');
                        return;
                    }
                    if (Boolean(d) && this.sessionId && this.sequence != null) {
                        this._resume();
                        return;
                    }
                    this._identify();
                }, randomBetween(1_000, 5_000));
                break;
            case Op.DISPATCH:
                if (eventName === 'READY') {
                    const ready = d;
                    this.sessionId = String(ready?.session_id ?? '') || null;
                    this.reconnectAttempts = 0;
                    this.logger?.info?.('Gateway ready', {
                        user: String(ready?.user?.username ?? 'unknown'),
                    });
                }
                if (eventName === 'RESUMED') {
                    this.reconnectAttempts = 0;
                    this.logger?.info?.('Gateway session resumed');
                }
                if (eventName) {
                    this.emit(eventName, d);
                }
                this._scheduleSequenceAckHeartbeat();
                break;
            case Op.GATEWAY_ERROR:
                this.logger?.warn?.('Gateway reported an error', {
                    details: d ?? null,
                });
                this.emit('GATEWAY_ERROR', d);
                break;
            default:
                break;
        }
    }
    _identify() {
        const payload = {
            token: this.token,
            intents: this.intents,
            properties: {
                os: process.platform,
                browser: 'fluxer-music-bot',
                device: 'fluxer-music-bot',
            },
        };
        if (this.initialPresence && typeof this.initialPresence === 'object') {
            payload.presence = this.initialPresence;
        }
        this._send(Op.IDENTIFY, payload);
    }
    _resume() {
        this._send(Op.RESUME, {
            token: this.token,
            session_id: this.sessionId,
            seq: this.sequence,
        });
    }
    _startHeartbeat() {
        if (!this.heartbeatIntervalMs)
            return;
        if (this.heartbeatIntervalHandle) {
            clearInterval(this.heartbeatIntervalHandle);
            this.heartbeatIntervalHandle = null;
        }
        // Clamp the gateway-provided heartbeat so malformed remote values cannot pin local timers indefinitely.
        const heartbeatIntervalMs = normalizeHeartbeatIntervalMs(this.heartbeatIntervalMs);
        if (!heartbeatIntervalMs)
            return;
        const initialDelay = randomBetween(0, heartbeatIntervalMs);
        this.heartbeatStartTimeoutHandle = setTimeout(() => {
            this.heartbeatStartTimeoutHandle = null;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
                return;
            this._sendHeartbeat();
            this.heartbeatIntervalHandle = setInterval(() => {
                if (this.awaitingHeartbeatAck) {
                    this.logger?.warn?.('Gateway heartbeat ACK timeout, terminating socket');
                    this.ws?.terminate();
                    return;
                }
                this._sendHeartbeat();
            }, heartbeatIntervalMs);
        }, initialDelay);
    }
    _sendHeartbeat() {
        this.lastHeartbeatSentAt = Date.now();
        this.awaitingHeartbeatAck = true;
        const sent = this._send(Op.HEARTBEAT, this.sequence);
        if (sent && this.sequence != null) {
            this.lastSequenceAckSentAt = this.lastHeartbeatSentAt;
            this.lastSequenceAckSent = this.sequence;
        }
        return sent;
    }
    _scheduleSequenceAckHeartbeat() {
        if (this.sequence == null || this.sequence <= this.lastSequenceAckSent)
            return false;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return false;
        if (this.awaitingHeartbeatAck) {
            return false;
        }
        const now = Date.now();
        const elapsedMs = now - this.lastSequenceAckSentAt;
        const delayMs = Math.max(0, SEQUENCE_ACK_HEARTBEAT_INTERVAL_MS - elapsedMs);
        if (delayMs === 0) {
            return this._sendHeartbeat();
        }
        if (this.sequenceAckHeartbeatTimeoutHandle) {
            return false;
        }
        // Fluxer uses heartbeat sequence numbers as delivery acknowledgements, so
        // busy startup dispatch bursts need acks before the normal heartbeat tick.
        this.sequenceAckHeartbeatTimeoutHandle = setTimeout(() => {
            this.sequenceAckHeartbeatTimeoutHandle = null;
            this._scheduleSequenceAckHeartbeat();
        }, delayMs);
        return false;
    }
    _send(op, d) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return false;
        this.ws.send(JSON.stringify({ op, d }));
        return true;
    }
    _handleClose(code, reason = '') {
        this._clearTimers();
        if (this.manualDisconnect) {
            this.logger?.info?.('Gateway disconnected manually', { code, reason: reason || null });
            return;
        }
        if (NON_RECOVERABLE_CLOSE_CODES.has(code)) {
            this.logger?.error?.('Gateway closed with non-recoverable code, reconnect aborted', {
                code,
                reason: reason || null,
            });
            return;
        }
        if ([4007, 4009].includes(code)) {
            this.sessionId = null;
            this.sequence = null;
        }
        this._scheduleReconnect(code);
    }
    _reconnectNow() {
        if (!this.ws) {
            this._scheduleReconnect('manual_reconnect');
            return;
        }
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.terminate();
            return;
        }
        this._scheduleReconnect('stale_socket');
    }
    _scheduleReconnect(reason) {
        if (this.reconnectTimeoutHandle)
            return;
        this.reconnectAttempts += 1;
        const delay = Math.min(this.reconnectMaxDelayMs, this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempts - 1)) + randomBetween(0, 300);
        this.logger?.warn?.('Gateway reconnect scheduled', {
            reason,
            reconnectAttempts: this.reconnectAttempts,
            delay,
        });
        this.emit('reconnect_scheduled', {
            reason,
            reconnectAttempts: this.reconnectAttempts,
            delayMs: delay,
        });
        this.reconnectTimeoutHandle = setTimeout(() => {
            this.reconnectTimeoutHandle = null;
            this._openSocket();
        }, delay);
    }
    _clearTimers() {
        if (this.heartbeatStartTimeoutHandle) {
            clearTimeout(this.heartbeatStartTimeoutHandle);
            this.heartbeatStartTimeoutHandle = null;
        }
        if (this.heartbeatIntervalHandle) {
            clearInterval(this.heartbeatIntervalHandle);
            this.heartbeatIntervalHandle = null;
        }
        if (this.sequenceAckHeartbeatTimeoutHandle) {
            clearTimeout(this.sequenceAckHeartbeatTimeoutHandle);
            this.sequenceAckHeartbeatTimeoutHandle = null;
        }
        if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = null;
        }
        if (this.invalidSessionTimeoutHandle) {
            clearTimeout(this.invalidSessionTimeoutHandle);
            this.invalidSessionTimeoutHandle = null;
        }
        if (this.connectOpenTimeoutHandle) {
            clearTimeout(this.connectOpenTimeoutHandle);
            this.connectOpenTimeoutHandle = null;
        }
        if (this.helloTimeoutHandle) {
            clearTimeout(this.helloTimeoutHandle);
            this.helloTimeoutHandle = null;
        }
        this.awaitingHeartbeatAck = false;
    }
}
//# sourceMappingURL=gateway.js.map
