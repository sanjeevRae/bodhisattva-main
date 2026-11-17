/**
 * Mailer service (spec Part 16 transport seam for Phase 2 auth mail).
 *
 * A thin nodemailer wrapper built from AppConfig.smtp. In development the
 * SMTP settings point at a local mail catcher (localhost:1025, e.g. Mailpit);
 * no real mailbox is required for Phase 2 (DEVELOPMENT_ROADMAP.md §4
 * dependencies — the production SMTP route is Meena's later decision).
 *
 * The transport is injectable for tests: pass a nodemailer Transporter to
 * createMailer(), or replace the process-wide default via
 * setTransportForTesting().
 *
 * NEVER log message bodies, verification codes or tokens here — callers log
 * only delivery failures (recipient domain + error), never content.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../config/env.js";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Phase 7: the invoice PDF rides the outbox invoice mail. */
  attachments?: MailAttachment[];
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>;
}

export function createMailer(
  config: AppConfig,
  transport?: Transporter,
): Mailer {
  const transporter =
    transport ??
    nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      // Implicit TLS only on the standard SMTPS port; the local catcher and
      // typical submission ports use plain/STARTTLS connections.
      secure: config.smtp.port === 465,
      ...(config.smtp.user
        ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
        : {}),
    });

  return {
    async sendMail(message: MailMessage): Promise<void> {
      await transporter.sendMail({
        from: config.smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.attachments && message.attachments.length > 0
          ? {
              attachments: message.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
      });
    },
  };
}

let testingTransport: Transporter | undefined;

/** Replace the transport used by getMailer() — test suites only. */
export function setTransportForTesting(transport: Transporter | undefined): void {
  testingTransport = transport;
}

const defaultMailers = new WeakMap<AppConfig, Mailer>();

/** Process-wide mailer for a config, honouring setTransportForTesting(). */
export function getMailer(config: AppConfig): Mailer {
  if (testingTransport) return createMailer(config, testingTransport);
  let mailer = defaultMailers.get(config);
  if (!mailer) {
    mailer = createMailer(config);
    defaultMailers.set(config, mailer);
  }
  return mailer;
}
