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
  private selfLid: string | null = null;
  private connectedAt = 0;
  private sentTexts = new Map<string, number>();
  private processedIds = new Set<string>();

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
        this.connectedAt = Math.floor(Date.now() / 1000);
        const user = this.socket?.user;
        if (user?.lid) {
          this.selfLid = user.lid.split(':')[0] + '@lid';
        }
        logger.info({ user, selfLid: this.selfLid }, 'connected to WhatsApp');
      }
    });

    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const msgId = msg.key.id || '';

        // 1. Skip already-processed message IDs (covers exact ID duplicates)
        if (this.processedIds.has(msgId)) continue;

        // 2. Skip protocol-only messages
        const keys = msg.message ? Object.keys(msg.message) : [];
        const contentKeys = keys.filter(
          (k) =>
            !['protocolMessage', 'messageContextInfo', 'senderKeyDistributionMessage'].includes(k),
        );
        if (contentKeys.length === 0) continue;

        // 3. In self-chat: only accept messages on own LID
        if (this.options.selfJid && this.selfLid) {
          if (msg.key.remoteJid !== this.selfLid) continue;
        }

        // 4. Skip old messages (before connection)
        const msgTs = Number(msg.messageTimestamp || 0);
        if (msgTs > 0 && msgTs < this.connectedAt - 5) continue;

        // 5. Skip messages whose text matches something we recently sent
        const text = this.extractText(msg);
        if (text && this.sentTexts.has(text)) continue;

        // Track this ID
        this.processedIds.add(msgId);
        if (this.processedIds.size > 500) {
          const first = this.processedIds.values().next().value!;
          this.processedIds.delete(first);
        }

        if (msg.message) {
          logger.info(
            { msgId, jid: msg.key.remoteJid, fromMe: msg.key.fromMe, text: text?.slice(0, 50) },
            'PROCESSING message',
          );
          this.options.onMessage(msg);
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');

    // Track sent text to ignore echoes
    this.sentTexts.set(text, Date.now());
    setTimeout(() => this.sentTexts.delete(text), 30_000);

    await this.socket.sendMessage(jid, { text });
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

  getSelfLid(): string | null {
    return this.selfLid;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  private extractText(msg: WAMessage): string | null {
    return (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      null
    );
  }
}
