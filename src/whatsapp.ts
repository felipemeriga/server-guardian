import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  DisconnectReason,
  Browsers,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const logger = pino({ name: 'whatsapp' });

export interface WhatsAppClientOptions {
  authStatePath: string;
  onMessage: (msg: WAMessage) => void;
}

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private options: WhatsAppClientOptions;

  constructor(options: WhatsAppClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authStatePath);

    const { version } = await fetchLatestWaWebVersion({});
    logger.info({ version }, 'using WA Web version');

    this.socket = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS('Chrome'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: pino({ level: 'silent' }) as any,
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

    this.socket.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          this.options.onMessage(msg);
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error('WhatsApp not connected');
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

  getSocket(): WASocket | null {
    return this.socket;
  }
}
