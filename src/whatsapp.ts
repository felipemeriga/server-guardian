import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestWaWebVersion,
  DisconnectReason,
  Browsers,
  type WASocket,
  type WAMessage,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const logger = pino({ name: 'whatsapp' });

export interface WhatsAppClientOptions {
  authStatePath: string;
  selfJid?: string;
  onMessage: (msg: WAMessage) => void;
}

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private options: WhatsAppClientOptions;
  private sentMessageIds = new Set<string>();
  private recentMessages = new Map<string, number>();

  constructor(options: WhatsAppClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authStatePath);

    const { version } = await fetchLatestWaWebVersion({});
    logger.info({ version }, 'using WA Web version');

    const baileysLogger = pino({ level: 'silent' });

    this.socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      version,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: baileysLogger as any,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('scan QR code to authenticate:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        logger.warn({ reason, shouldReconnect }, 'connection closed');

        if (shouldReconnect) {
          const delay = reason === 405 ? 5000 : 2000;
          logger.info({ delay }, 'reconnecting...');
          setTimeout(() => this.connect(), delay);
        } else {
          logger.error('logged out permanently — re-scan QR code');
        }
      } else if (connection === 'open') {
        logger.info('connected to WhatsApp');
      }
    });

    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      // Only process real-time messages, skip history sync
      if (type !== 'notify') return;

      for (const msg of messages) {
        const msgId = msg.key.id || '';
        logger.info(
          { fromMe: msg.key.fromMe, jid: msg.key.remoteJid, hasMessage: !!msg.message, msgId },
          'message details',
        );

        // Skip messages sent by this bot
        if (this.sentMessageIds.has(msgId)) {
          this.sentMessageIds.delete(msgId);
          continue;
        }

        // Skip protocol-only messages (read receipts, etc.)
        const isProtocolOnly =
          msg.message &&
          Object.keys(msg.message).every((k) =>
            ['protocolMessage', 'messageContextInfo', 'senderKeyDistributionMessage'].includes(k),
          );
        if (isProtocolOnly) continue;

        if (msg.message) {
          // Deduplicate: same message arrives on multiple JIDs with different IDs.
          // Use message text + timestamp as dedup key within a 5s window.
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';
          const ts = Number(msg.messageTimestamp || 0);
          const dedupeKey = `${text}:${ts}`;
          const now = Date.now();

          if (this.recentMessages.has(dedupeKey)) {
            continue;
          }

          this.recentMessages.set(dedupeKey, now);
          // Prune entries older than 10s
          for (const [key, time] of this.recentMessages) {
            if (now - time > 10_000) this.recentMessages.delete(key);
          }

          this.options.onMessage(msg);
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    const sent = await this.socket.sendMessage(jid, { text });
    if (sent?.key.id) {
      this.sentMessageIds.add(sent.key.id);
    }
  }

  async sendTyping(jid: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.presenceSubscribe(jid);
    await this.socket.sendPresenceUpdate('composing', jid);
  }

  async stopTyping(jid: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.sendPresenceUpdate('paused', jid);
  }

  async markRead(msg: WAMessage): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.readMessages([msg.key]);
  }

  isConnected(): boolean {
    return this.socket?.user !== undefined;
  }

  async disconnect(): Promise<void> {
    this.socket?.end(undefined);
    this.socket = null;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }
}
